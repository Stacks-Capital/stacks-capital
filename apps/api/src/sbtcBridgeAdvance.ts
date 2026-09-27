import { fetchEmilyDeposit, fetchEmilyWithdrawal, parseEmilyWithdrawal } from "@stacks-capital/adapters";
import { PROVIDERS } from "@stacks-capital/config";
import {
  beginConfirming,
  beginReconciling,
  completeFromReconciliation,
  markStepConfirmed,
  type Workflow,
  type WorkflowId,
  type WorkflowState,
} from "@stacks-capital/core";
import {
  advanceWorkflowFromChain,
  findWorkflowForTenant,
  type Sql,
  type WorkflowRecord,
} from "@stacks-capital/database";

const IN_FLIGHT = new Set<string>(["SUBMITTED", "CONFIRMING", "STEP_CONFIRMED", "RECONCILING"]);
const BRIDGE_ACTIONS = new Set(["withdraw_sbtc", "deposit_sbtc"]);

export function isSbtcBridgeInFlight(action: string | null, state: string): boolean {
  return action !== null && BRIDGE_ACTIONS.has(action) && IN_FLIGHT.has(state);
}

export type BridgeFetch = typeof fetch;

export type SbtcBridgeAdvanceResult = {
  changed: boolean;
  state: string;
};

type HiroTx = {
  tx_id?: string;
  tx_status?: string;
  canonical?: boolean;
  block_height?: number;
  tx_result?: { repr?: string };
  contract_call?: { function_name?: string };
  events?: Array<{
    event_type?: string;
    contract_log?: { value?: { repr?: string } };
  }>;
};

type BitcoinTx = {
  vout?: Array<{ value?: number; scriptpubkey?: string }>;
  status?: { confirmed?: boolean; block_height?: number; block_hash?: string };
};

function strip0x(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}

function asWorkflow(record: WorkflowRecord): Workflow {
  return {
    id: record.id as WorkflowId,
    network: record.network,
    state: record.state as WorkflowState,
    nextAction: record.nextAction as Workflow["nextAction"],
    idempotencyKey: "",
    transitions: record.transitions.map((move) => ({
      from: move.from as WorkflowState,
      to: move.to as WorkflowState,
      reason: move.reason,
      actor: move.actor,
      evidence: move.evidence,
      at: new Date(move.at).toISOString(),
    })),
  };
}

function broadcastTxid(record: WorkflowRecord): { txid: string; chain: "bitcoin" | "stacks" } | null {
  for (let i = record.attempts.length - 1; i >= 0; i -= 1) {
    const attempt = record.attempts[i];
    if (attempt?.outcome === "BROADCAST" && attempt.txid !== null && attempt.txid !== "") {
      return { txid: strip0x(attempt.txid), chain: attempt.chain };
    }
  }
  return null;
}

export function parseWithdrawalRequestId(tx: HiroTx): string | null {
  const fromResult = /\(ok u(\d+)\)/.exec(tx.tx_result?.repr ?? "");
  if (fromResult?.[1] !== undefined) return fromResult[1];
  for (const event of tx.events ?? []) {
    const repr = event.contract_log?.value?.repr ?? "";
    const fromEvent = /request-id u(\d+)/.exec(repr);
    if (fromEvent?.[1] !== undefined) return fromEvent[1];
  }
  return null;
}

function applyStacksConfirmed(flow: Workflow, evidence: string): Workflow {
  let next = flow;
  if (next.state === "SUBMITTED") next = beginConfirming(next, evidence);
  if (next.state === "CONFIRMING") next = markStepConfirmed(next, evidence);
  return next;
}

function applyCompleted(flow: Workflow, evidence: string): Workflow {
  let next = applyStacksConfirmed(flow, evidence);
  if (next.state === "STEP_CONFIRMED") next = beginReconciling(next, evidence);
  if (next.state === "RECONCILING") {
    next = completeFromReconciliation(next, { matched: true, evidence });
  }
  return next;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

async function fetchHiroTx(txid: string, fetchImpl: BridgeFetch, signal?: AbortSignal): Promise<HiroTx | null> {
  const response = await fetchImpl(`https://api.hiro.so/extended/v1/tx/${txid}`, {
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Hiro tx read failed with HTTP ${response.status}`);
  return (await readJson(response)) as HiroTx;
}

async function fetchBitcoinTx(txid: string, fetchImpl: BridgeFetch, signal?: AbortSignal): Promise<BitcoinTx | null> {
  const response = await fetchImpl(`https://mempool.space/api/tx/${txid}`, {
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Bitcoin tx read failed with HTTP ${response.status}`);
  return (await readJson(response)) as BitcoinTx;
}

function bitcoinPayoutMatches(input: {
  bitcoin: BitcoinTx;
  amountSats: string;
  scriptPubKey: string;
  outputIndex: number;
}): boolean {
  if (input.bitcoin.status?.confirmed !== true) return false;
  const output = input.bitcoin.vout?.[input.outputIndex];
  if (output === undefined) return false;
  return (
    String(output.value) === input.amountSats &&
    (output.scriptpubkey ?? "").toLowerCase() === input.scriptPubKey.toLowerCase()
  );
}

async function withdrawalComplete(input: {
  stacksTxid: string;
  ownerAddress: string | null;
  fetch: BridgeFetch;
  signal?: AbortSignal;
}): Promise<{ complete: boolean; stacksConfirmed: boolean; evidence: string }> {
  const initiate = await fetchHiroTx(input.stacksTxid, input.fetch, input.signal);
  const stacksConfirmed = initiate?.tx_status === "success" && initiate.canonical !== false;
  if (!stacksConfirmed) {
    return { complete: false, stacksConfirmed: false, evidence: `stacks:${input.stacksTxid}` };
  }

  const requestId = parseWithdrawalRequestId(initiate);
  let emily =
    requestId === null
      ? null
      : await fetchEmilyWithdrawal({
          network: "mainnet",
          requestId,
          fetch: input.fetch,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });

  if (emily === null && input.ownerAddress !== null) {
    const listed = await input.fetch(`${PROVIDERS.mainnet.emily}/withdrawal/sender/${input.ownerAddress}`, {
      headers: { accept: "application/json" },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (listed.ok) {
      const body = (await listed.json()) as { withdrawals?: unknown[] } | unknown[];
      const rows = Array.isArray(body) ? body : (body.withdrawals ?? []);
      for (const row of rows) {
        try {
          const parsed = parseEmilyWithdrawal(row);
          if (parsed.txid === input.stacksTxid.toLowerCase()) {
            emily = parsed;
            break;
          }
        } catch {}
      }
    }
  }

  const fulfillment = emily?.fulfillment ?? null;
  if (emily?.status !== "confirmed" || fulfillment === null) {
    return {
      complete: false,
      stacksConfirmed: true,
      evidence: `stacks:${input.stacksTxid}:request:${requestId ?? "unknown"}`,
    };
  }

  const [bitcoin, accept] = await Promise.all([
    fetchBitcoinTx(fulfillment.bitcoinTxid, input.fetch, input.signal),
    fetchHiroTx(fulfillment.stacksTxid, input.fetch, input.signal),
  ]);
  const acceptOk =
    accept?.tx_status === "success" && accept.contract_call?.function_name === "accept-withdrawal-request";
  const payoutOk =
    bitcoin !== null &&
    bitcoinPayoutMatches({
      bitcoin,
      amountSats: emily.amountSats,
      scriptPubKey: emily.recipientScript,
      outputIndex: fulfillment.bitcoinTxOutputIndex,
    });

  if (!acceptOk || !payoutOk) {
    return {
      complete: false,
      stacksConfirmed: true,
      evidence: `emily:${emily.requestId}:awaiting-independent-payout`,
    };
  }

  return {
    complete: true,
    stacksConfirmed: true,
    evidence: `sbtc-withdraw:${emily.requestId}:${fulfillment.bitcoinTxid}:${fulfillment.bitcoinTxOutputIndex}`,
  };
}

async function depositComplete(input: {
  bitcoinTxid: string;
  fetch: BridgeFetch;
  signal?: AbortSignal;
}): Promise<{ complete: boolean; stacksConfirmed: boolean; evidence: string }> {
  const bitcoin = await fetchBitcoinTx(input.bitcoinTxid, input.fetch, input.signal);
  const bitcoinConfirmed = bitcoin?.status?.confirmed === true;
  if (!bitcoinConfirmed) {
    return { complete: false, stacksConfirmed: false, evidence: `bitcoin:${input.bitcoinTxid}` };
  }

  let emily = await fetchEmilyDeposit({
    network: "mainnet",
    bitcoinTxid: input.bitcoinTxid,
    bitcoinTxOutputIndex: 0,
    fetch: input.fetch,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (emily === null) {
    emily = await fetchEmilyDeposit({
      network: "mainnet",
      bitcoinTxid: input.bitcoinTxid,
      bitcoinTxOutputIndex: 1,
      fetch: input.fetch,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }

  const mintTxid = emily?.fulfillment?.stacksTxid;
  if (emily?.status !== "confirmed" || mintTxid === undefined || mintTxid === "") {
    return {
      complete: false,
      stacksConfirmed: true,
      evidence: `bitcoin:${input.bitcoinTxid}:emily:${emily?.status ?? "missing"}`,
    };
  }

  const mint = await fetchHiroTx(mintTxid, input.fetch, input.signal);
  if (mint?.tx_status !== "success") {
    return {
      complete: false,
      stacksConfirmed: true,
      evidence: `bitcoin:${input.bitcoinTxid}:mint-pending`,
    };
  }

  return {
    complete: true,
    stacksConfirmed: true,
    evidence: `sbtc-deposit:${input.bitcoinTxid}:${mintTxid}`,
  };
}

export async function decideAndApplySbtcBridge(record: WorkflowRecord, fetchImpl: BridgeFetch): Promise<Workflow> {
  const flow = asWorkflow(record);
  if (record.network !== "mainnet" || record.action === null || !BRIDGE_ACTIONS.has(record.action)) return flow;
  if (!IN_FLIGHT.has(record.state)) return flow;
  const broadcast = broadcastTxid(record);
  if (broadcast === null) return flow;

  const signal = AbortSignal.timeout(8_000);
  const outcome =
    record.action === "withdraw_sbtc"
      ? await withdrawalComplete({
          stacksTxid: broadcast.txid,
          ownerAddress: record.ownerAddress,
          fetch: fetchImpl,
          signal,
        })
      : await depositComplete({ bitcoinTxid: broadcast.txid, fetch: fetchImpl, signal });

  if (outcome.complete) return applyCompleted(flow, outcome.evidence);
  if (outcome.stacksConfirmed) return applyStacksConfirmed(flow, outcome.evidence);
  return flow;
}

export async function advanceSbtcBridgeWorkflow(
  sql: Sql,
  input: {
    record: WorkflowRecord;
    fetch?: BridgeFetch;
    now: Date;
  },
): Promise<SbtcBridgeAdvanceResult> {
  if (input.record.network !== "mainnet" || input.record.action === null || !BRIDGE_ACTIONS.has(input.record.action)) {
    return { changed: false, state: input.record.state };
  }
  if (!IN_FLIGHT.has(input.record.state)) return { changed: false, state: input.record.state };

  try {
    const after = await decideAndApplySbtcBridge(input.record, input.fetch ?? fetch);
    if (after.state === input.record.state) return { changed: false, state: input.record.state };
    const moved = after.transitions.slice(input.record.transitions.length);
    const written = await advanceWorkflowFromChain(sql, {
      workflow: after,
      moves: moved,
      expectedTransitionCount: input.record.transitions.length,
      at: input.now,
    });
    return { changed: written, state: written ? after.state : input.record.state };
  } catch {
    return { changed: false, state: input.record.state };
  }
}

export async function advanceSbtcBridgeById(
  sql: Sql,
  input: {
    id: string;
    appId: string;
    ownerAddress: string | null;
    fetch?: BridgeFetch;
    now: Date;
  },
): Promise<WorkflowRecord | null> {
  const record = await findWorkflowForTenant(sql, {
    id: input.id,
    appId: input.appId,
    ownerAddress: input.ownerAddress,
  });
  if (record === null) return null;
  await advanceSbtcBridgeWorkflow(sql, {
    record,
    now: input.now,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  return findWorkflowForTenant(sql, {
    id: input.id,
    appId: input.appId,
    ownerAddress: input.ownerAddress,
  });
}
