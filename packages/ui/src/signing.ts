import type { PlanStep, SwapWalletCall } from "@stacks-capital/client";
import { parseAssetId, type PlanValidation, type StacksNetwork } from "@stacks-capital/core";
import { classifyWalletError, type WalletId } from "@stacks-capital/wallets";
import {
  Cl,
  type ClarityValue as StacksClarityValue,
  type PostCondition,
  cvToHex,
  postConditionToHex,
} from "@stacks/transactions";

type PlanClarityValue =
  | { type: "uint"; value: string }
  | { type: "principal"; value: string }
  | { type: "buff"; hex: string }
  | { type: "tuple"; value: Record<string, PlanClarityValue> }
  | { type: "none" }
  | { type: "some"; value: PlanClarityValue };

type PlanPostCondition = {
  principal: string;
  mode: "send_lte" | "send_eq" | "send_gte" | "receive_gte";
  amount: { asset: string; quantity: string };
};

type StacksCall = {
  kind: "stacks_contract_call";
  contractId: string;
  functionName: string;
  functionArgs: PlanClarityValue[];
  postConditions: PlanPostCondition[];
  postConditionMode: "deny" | "allow";
  network: StacksNetwork;
};

export type WalletRequest = {
  method: "stx_callContract";
  params: {
    contract: string;
    functionName: string;
    functionArgs: string[];
    postConditions: string[];
    postConditionMode: "deny" | "allow";
    network: StacksNetwork;
  };
};

export type PostConditionRequest =
  | { type: "stx-postcondition"; address: string; condition: string; amount: string }
  | { type: "ft-postcondition"; address: string; condition: string; amount: string; asset: string };

const CONDITIONS: Record<PlanPostCondition["mode"], string> = {
  send_lte: "lte",
  send_eq: "eq",
  send_gte: "gte",
  receive_gte: "gte",
};

export function encodeArgument(value: PlanClarityValue): string {
  return cvToHex(toClarity(value));
}

function toClarity(value: PlanClarityValue): StacksClarityValue {
  switch (value.type) {
    case "uint":
      return Cl.uint(BigInt(value.value));
    case "principal":
      return Cl.principal(value.value);
    case "buff":
      return Cl.bufferFromHex(value.hex.replace(/^0x/, ""));
    case "none":
      return Cl.none();
    case "some":
      return Cl.some(toClarity(value.value));
    case "tuple":
      return Cl.tuple(Object.fromEntries(Object.entries(value.value).map(([key, entry]) => [key, toClarity(entry)])));
    default:
      throw new Error(`Plan step uses a value this app cannot encode: ${JSON.stringify(value)}`);
  }
}

export function encodePostCondition(condition: PlanPostCondition): PostConditionRequest {
  const asset = parseAssetId(condition.amount.asset);
  const shared = {
    address: condition.principal,
    condition: CONDITIONS[condition.mode],
    amount: condition.amount.quantity,
  };
  if (asset.identity.kind === "native") return { type: "stx-postcondition", ...shared };
  return {
    type: "ft-postcondition",
    ...shared,
    asset: `${asset.identity.principal}::${asset.identity.assetName}`,
  };
}

/** Rejects any plan that failed SDK validation before a wallet request is built. */
export function assertWalletAllowed(validation: PlanValidation): void {
  if (!validation.ok) {
    throw new Error(`Plan failed SDK validation before the wallet could open: ${validation.reasons.join("; ")}`);
  }
}

/** Turns a plan step into the exact request the wallet is asked to sign. Nothing is added or dropped. */
export function toWalletRequest(step: PlanStep, validation: PlanValidation): WalletRequest {
  assertWalletAllowed(validation);
  if (step.payload.kind !== "stacks_contract_call") {
    throw new Error(`This app can only sign Stacks contract calls, not ${step.payload.kind}`);
  }
  const payload = step.payload as unknown as StacksCall;
  return {
    method: "stx_callContract",
    params: {
      contract: payload.contractId,
      functionName: payload.functionName,
      functionArgs: payload.functionArgs.map(encodeArgument),
      postConditions: payload.postConditions.map((condition) =>
        serializeWalletPostCondition(encodePostCondition(condition)),
      ),
      postConditionMode: payload.postConditionMode,
      network: payload.network,
    },
  };
}

export type WalletAnswer =
  | { kind: "answered"; result: unknown }
  /** The user said no in the wallet. Nothing was signed or sent, so the step can simply be asked again. */
  | { kind: "rejected"; message: string }
  /** The wallet failed in a way that does not say whether anything was sent. That has to be recorded, not retried. */
  | { kind: "unknown"; result: { error: string } };

/**
 * Asks the wallet to sign one plan step and sorts the answer into what it means (I02 findings:
 * Leather rejects with 4001, Xverse with -32000). A rejection is kept out of the workflow, because
 * recording it as an unknown broadcast would send the user to support for something they chose.
 * Callers must pass a successful PlanValidation from the SDK — the wallet never opens otherwise.
 */
export async function askWallet(
  provider: { request(method: string, params?: unknown): Promise<unknown> },
  walletId: WalletId,
  request: WalletRequest,
  validation: PlanValidation,
): Promise<WalletAnswer> {
  assertWalletAllowed(validation);
  return askWalletRequest(provider, walletId, request);
}

/** Turns a provider-built swap call into the exact request the wallet is asked to sign. */
export function toWalletCallRequest(call: SwapWalletCall): WalletRequest {
  if (call.network !== "mainnet") throw new Error("This app only signs mainnet swap calls");
  if (call.functionName.length === 0) throw new Error("Swap call is missing a function name");
  if (call.functionArgs.length === 0 || !call.functionArgs.every((argument) => /^0x[0-9a-f]+$/i.test(argument))) {
    throw new Error("Swap call arguments must be encoded Clarity hex");
  }
  if (call.postConditions.length === 0) {
    throw new Error("Swap call is missing post-conditions that protect the exact assets");
  }
  return {
    method: "stx_callContract",
    params: {
      contract: call.contractId,
      functionName: call.functionName,
      functionArgs: call.functionArgs,
      postConditions: call.postConditions.map(serializeWalletPostCondition),
      postConditionMode: call.postConditionMode,
      network: call.network,
    },
  };
}

/**
 * Asks the wallet to sign a provider-built swap call. This path does not claim CapitalOS registry
 * execution, so it never runs SDK plan validation.
 */
export type BitcoinTransferRequest = {
  method: "sendTransfer";
  params: {
    recipients: { address: string; amount: string | number }[];
    network: "mainnet";
  };
};

/** Official sBTC deposit path: send BTC to the constructed P2TR address. Not a Stacks contract call. */
export function toBitcoinTransferRequest(
  address: string,
  amountSats: string,
  walletId: WalletId = "leather",
): BitcoinTransferRequest {
  if (!address.startsWith("bc1p")) throw new Error("sBTC deposits must go to a mainnet P2TR address");
  const quantity = BigInt(amountSats);
  if (quantity <= 0n) throw new Error("Deposit amount must be positive satoshis");
  if (quantity > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Deposit amount exceeds the integer range sendTransfer accepts");
  }
  // Leather requires satoshis as a string; Xverse requires a number (Stacks Connect wallet-support).
  const amount = walletId === "xverse" ? Number(quantity) : quantity.toString(10);
  return {
    method: "sendTransfer",
    params: {
      recipients: [{ address, amount }],
      network: "mainnet",
    },
  };
}

export async function askBitcoinTransfer(
  provider: { request(method: string, params?: unknown): Promise<unknown> },
  walletId: WalletId,
  request: BitcoinTransferRequest,
): Promise<WalletAnswer> {
  return askWalletRequest(provider, walletId, request);
}

const BITCOIN_TXID = /^(?:0x)?[0-9a-fA-F]{64}$/;

export function bitcoinTransferTxid(result: unknown): string | null {
  if (typeof result === "string" && BITCOIN_TXID.test(result.trim())) {
    return result.trim().replace(/^0x/i, "").toLowerCase();
  }
  if (Array.isArray(result)) {
    for (const item of result) {
      const found = bitcoinTransferTxid(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof result !== "object" || result === null) return null;
  const record = result as Record<string, unknown>;
  for (const key of ["txid", "txId", "txnId", "txhash", "txHash", "hash", "tx_id"]) {
    if (record[key] !== undefined) {
      const found = bitcoinTransferTxid(record[key]);
      if (found !== null) return found;
    }
  }
  if (Array.isArray(record.txids)) {
    const found = bitcoinTransferTxid(record.txids);
    if (found !== null) return found;
  }
  if (record.result !== undefined) return bitcoinTransferTxid(record.result);
  return null;
}

export type RecentBitcoinDepositLookup = {
  fromAddress: string;
  toAddress: string;
  amountSats: string;
};

export async function findRecentBitcoinDepositTxid(
  input: RecentBitcoinDepositLookup,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetchImpl(`https://mempool.space/api/address/${encodeURIComponent(input.fromAddress)}/txs`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{
    txid?: string;
    vin?: Array<{ prevout?: { scriptpubkey_address?: string } }>;
    vout?: Array<{ value?: number; scriptpubkey_address?: string }>;
  }>;
  if (!Array.isArray(rows)) return null;
  for (const tx of rows) {
    if (typeof tx.txid !== "string" || !BITCOIN_TXID.test(tx.txid)) continue;
    const spentFromWallet = (tx.vin ?? []).some(
      (inputRow) => inputRow.prevout?.scriptpubkey_address === input.fromAddress,
    );
    const paidDeposit = (tx.vout ?? []).some(
      (output) => output.scriptpubkey_address === input.toAddress && String(output.value) === input.amountSats,
    );
    if (spentFromWallet && paidDeposit) return tx.txid.replace(/^0x/i, "").toLowerCase();
  }
  return null;
}

export async function waitForBitcoinDepositTxid(
  input: RecentBitcoinDepositLookup,
  waitsMs: readonly number[] = [0, 1200, 2500, 4000],
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  for (const wait of waitsMs) {
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const found = await findRecentBitcoinDepositTxid(input, fetchImpl).catch(() => null);
    if (found !== null) return found;
  }
  return null;
}

export async function askWalletCall(
  provider: { request(method: string, params?: unknown): Promise<unknown> },
  walletId: WalletId,
  request: WalletRequest,
): Promise<WalletAnswer> {
  return askWalletRequest(provider, walletId, request);
}

async function askWalletRequest(
  provider: { request(method: string, params?: unknown): Promise<unknown> },
  walletId: WalletId,
  request: { method: string; params?: unknown },
): Promise<WalletAnswer> {
  try {
    return { kind: "answered", result: unwrapWalletResponse(await provider.request(request.method, request.params)) };
  } catch (error) {
    if (classifyWalletError(walletId, error) === "USER_REJECTED") {
      return { kind: "rejected", message: "You declined in your wallet. Nothing was sent." };
    }
    return { kind: "unknown", result: { error: walletErrorMessage(error) } };
  }
}

/** Leather returns SIP-30 envelopes: `{ result }` on success and `{ error: { code, message } }` on failure. */
function unwrapWalletResponse(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (record.error !== undefined && record.error !== null) throw record.error;
  return record.result === undefined ? value : record.result;
}

function walletErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error !== "object" || error === null) return "The wallet did not answer";
  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.length > 0) return record.message;
  if (record.error !== undefined) return walletErrorMessage(record.error);
  return "The wallet did not answer";
}

function serializeWalletPostCondition(condition: PostConditionRequest): string {
  // Leather's hexToBytes rejects a 0x prefix ("Not a serialized post condition").
  return postConditionToHex(condition as PostCondition).replace(/^0x/i, "");
}
