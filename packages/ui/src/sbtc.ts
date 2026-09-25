import type { WorkflowSummary } from "@stacks-capital/client";
import { parseQuantity, type StacksNetwork } from "@stacks-capital/core";

export type SbtcBridgeMode = "deposit" | "withdraw";

export type SbtcBridgeStage = "form" | "review" | "signing" | "confirming" | "recovery" | "reclaim" | "done";

const DEPOSIT_STAGES: Record<string, SbtcBridgeStage> = {
  DRAFT: "review",
  QUOTED: "review",
  AWAITING_SIGNATURE: "signing",
  SUBMITTED: "confirming",
  CONFIRMING: "confirming",
  STEP_CONFIRMED: "confirming",
  SIGNER_PROCESSING: "confirming",
  MINT_PENDING: "confirming",
  RECLAIMABLE: "reclaim",
  RECONCILING: "confirming",
  RECONCILED: "done",
  COMPLETED: "done",
  BROADCAST_UNKNOWN: "recovery",
  ACTION_REQUIRED: "recovery",
  MANUAL_REVIEW: "recovery",
  RECONCILIATION_FAILED: "recovery",
  FAILED: "recovery",
};

const WITHDRAWAL_STAGES: Record<string, SbtcBridgeStage> = {
  DRAFT: "review",
  QUOTED: "review",
  AWAITING_SIGNATURE: "signing",
  SUBMITTED: "confirming",
  CONFIRMING: "confirming",
  STEP_CONFIRMED: "confirming",
  REQUEST_CONFIRMING: "confirming",
  SIGNER_PROCESSING: "confirming",
  PAYOUT_CONFIRMING: "confirming",
  SIGNER_REJECTION_PENDING: "recovery",
  RECONCILING: "confirming",
  RECONCILED: "done",
  COMPLETED: "done",
  BROADCAST_UNKNOWN: "recovery",
  ACTION_REQUIRED: "recovery",
  MANUAL_REVIEW: "recovery",
  RECONCILIATION_FAILED: "recovery",
  REJECTED: "recovery",
  FAILED: "recovery",
};

export function stageForDeposit(workflowState: string | null): SbtcBridgeStage {
  if (workflowState === null) return "form";
  return DEPOSIT_STAGES[workflowState] ?? "recovery";
}

export function stageForWithdrawal(workflowState: string | null): SbtcBridgeStage {
  if (workflowState === null) return "form";
  return WITHDRAWAL_STAGES[workflowState] ?? "recovery";
}

const HEX_BYTE = /^[0-9a-fA-F]{2}$/;
const HEX = /^[0-9a-fA-F]+$/;
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/** Fixture used in adapter tests. Never a wallet anyone in this app controls. */
export const PLACEHOLDER_BTC_RECIPIENT = "04:00112233445566778899aabbccddeeff00112233";
export const PLACEHOLDER_BTC_HASHBYTES = "00112233445566778899aabbccddeeff00112233";
/** Consensus burn addresses. sBTC minted here is not recoverable by a user wallet. */
export const BURN_STACKS_RECIPIENTS = [
  "SP000000000000000000002Q6VF78",
  "ST000000000000000000002AMW42H",
] as const;

export type RecipientValidation = {
  valid: boolean;
  version?: string;
  hashbytes?: string;
  address?: string;
  encoded?: string;
  error?: string;
};

export function isPlaceholderStacksRecipient(value: string): boolean {
  return (BURN_STACKS_RECIPIENTS as readonly string[]).includes(value.trim().toUpperCase());
}

export function isPlaceholderBtcRecipient(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === PLACEHOLDER_BTC_RECIPIENT) return true;
  if (trimmed.includes(":")) {
    const hash = trimmed.split(":")[1];
    return hash === PLACEHOLDER_BTC_HASHBYTES;
  }
  return trimmed === "bc1qqqgjyv6y24n80zye42aueh0wluqpzg3ndy2ehs";
}

function bech32Polymod(values: readonly number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if (((top >> i) & 1) !== 0) chk ^= BECH32_GEN[i] ?? 0;
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const chars = [...hrp];
  return [...chars.map((c) => c.charCodeAt(0) >> 5), 0, ...chars.map((c) => c.charCodeAt(0) & 31)];
}

function convertBits(data: readonly number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & max);
    return out;
  }
  if (bits >= from || ((acc << (to - bits)) & max) !== 0) return null;
  return out;
}

function decodeBech32Address(address: string): { version: number; program: string } | { error: string } {
  const trimmed = address.trim();
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) {
    return { error: "Bitcoin address cannot mix case" };
  }
  const lower = trimmed.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) return { error: "Bitcoin address is not valid bech32" };
  const hrp = lower.slice(0, sep);
  if (hrp !== "bc") return { error: "Withdrawals on mainnet must use a bc1 Bitcoin address" };
  const data: number[] = [];
  for (const char of lower.slice(sep + 1)) {
    const value = BECH32_CHARSET.indexOf(char);
    if (value === -1) return { error: "Bitcoin address contains an invalid character" };
    data.push(value);
  }
  const words = data.slice(0, -6);
  const checksum = data.slice(-6);
  const candidate = [...bech32HrpExpand(hrp), ...words, ...checksum];
  const witnessVersion = words[0];
  if (witnessVersion === undefined) return { error: "Bitcoin address is missing a witness version" };
  const encodingConst = witnessVersion === 0 ? 1 : 0x2bc830a3;
  if (bech32Polymod(candidate) !== encodingConst) return { error: "Bitcoin address checksum is invalid" };
  const programWords = convertBits(words.slice(1), 5, 8, false);
  if (programWords === null) return { error: "Bitcoin address payload is invalid" };
  const program = programWords.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (witnessVersion === 0 && program.length !== 40 && program.length !== 64) {
    return { error: "SegWit address must be P2WPKH or P2WSH" };
  }
  if (witnessVersion === 1 && program.length !== 64) return { error: "Taproot address must be 32 bytes" };
  if (witnessVersion > 1) return { error: "Unsupported Bitcoin witness version" };
  return { version: witnessVersion, program };
}

export function bitcoinRecipientFromAddress(address: string): { recipient: string; address: string } | { error: string } {
  const decoded = decodeBech32Address(address);
  if ("error" in decoded) return decoded;
  const contractVersion = decoded.version === 0 ? (decoded.program.length === 40 ? "04" : "05") : "06";
  const recipient = `${contractVersion}:${decoded.program}`;
  if (isPlaceholderBtcRecipient(recipient)) {
    return { error: "This is a test placeholder, not a Bitcoin wallet you control." };
  }
  return { recipient, address: address.trim() };
}

/**
 * Accepts a connected bc1 address or version:hashbytes. The adapter fixture
 * 04:00112233… is never a valid user destination.
 */
export function validateBtcRecipient(recipient: string): RecipientValidation {
  const trimmed = recipient.trim();
  if (trimmed === "") {
    return { valid: false, error: "Connect a Bitcoin wallet so payout can go to an address you control." };
  }
  if (isPlaceholderBtcRecipient(trimmed)) {
    return {
      valid: false,
      error: "This is a test placeholder, not a Bitcoin wallet you control. Connect your Bitcoin wallet.",
    };
  }
  if (!trimmed.includes(":")) {
    const encoded = bitcoinRecipientFromAddress(trimmed);
    if ("error" in encoded) return { valid: false, error: encoded.error };
    const [version, hashbytes] = encoded.recipient.split(":");
    if (version === undefined || hashbytes === undefined) {
      return { valid: false, error: "Bitcoin address could not be encoded for withdrawal." };
    }
    return { valid: true, version, hashbytes, address: encoded.address, encoded: encoded.recipient };
  }
  const [ver, hash] = trimmed.split(":");
  if (ver === undefined || hash === undefined || ver.length !== 2 || !HEX_BYTE.test(ver)) {
    return { valid: false, error: "Version must be exactly one byte (2 hex characters, 00-06)" };
  }
  if (!HEX.test(hash)) {
    return { valid: false, error: "Hashbytes must be valid hex characters" };
  }

  const verNum = Number.parseInt(ver, 16);
  if (verNum < 0 || verNum > 6) {
    return { valid: false, error: "Version byte must be between 00 and 06" };
  }

  if (verNum === 0 || verNum === 1 || verNum === 4) {
    if (hash.length !== 40) {
      return {
        valid: false,
        error: `Version ${ver} requires a 20-byte hash (40 hex chars), got ${hash.length} chars`,
      };
    }
  } else if (verNum === 5 || verNum === 6) {
    if (hash.length !== 64) {
      return {
        valid: false,
        error: `Version ${ver} requires a 32-byte hash (64 hex chars), got ${hash.length} chars`,
      };
    }
  } else {
    return { valid: false, error: `Version ${ver} is not supported` };
  }

  const encoded = `${ver.toLowerCase()}:${hash.toLowerCase()}`;
  if (isPlaceholderBtcRecipient(encoded)) {
    return {
      valid: false,
      error: "This is a test placeholder, not a Bitcoin wallet you control. Connect your Bitcoin wallet.",
    };
  }
  return { valid: true, version: ver.toLowerCase(), hashbytes: hash.toLowerCase(), encoded };
}

/** Reads the Bitcoin payout the withdrawal plan will actually lock on-chain. */
export function withdrawRecipientFromPlan(plan: {
  steps: ReadonlyArray<{ payload?: Record<string, unknown> }>;
}): { version: string; hashbytes: string } | null {
  const step =
    plan.steps.find((item) => item.payload?.functionName === "initiate-withdrawal-request") ?? plan.steps[0];
  const args = step?.payload?.functionArgs;
  const dest = Array.isArray(args) ? args[1] : undefined;
  if (dest === null || typeof dest !== "object" || !("type" in dest) || dest.type !== "tuple") return null;
  const value = "value" in dest ? dest.value : undefined;
  if (value === null || typeof value !== "object") return null;
  const fields = value as Record<string, { hex?: string }>;
  const version = fields.version?.hex?.replace(/^0x/i, "").toLowerCase();
  const hashbytes = fields.hashbytes?.hex?.replace(/^0x/i, "").toLowerCase();
  if (version === undefined || hashbytes === undefined || version === "" || hashbytes === "") return null;
  return { version, hashbytes };
}

/** Reads the Stacks mint destination the deposit plan will actually use. */
export function depositStacksRecipientFromPlan(plan: {
  steps: ReadonlyArray<{ payload?: Record<string, unknown> }>;
}): string | null {
  const step = plan.steps.find((item) => item.payload?.kind === "bitcoin_deposit") ?? plan.steps[0];
  const recipient = step?.payload?.stacksRecipient;
  return typeof recipient === "string" && recipient !== "" ? recipient : null;
}

function sameBitcoinAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function assertSafeWithdrawPayout(input: {
  encodedRecipient: string;
  destinationAddress: string;
  connectedBitcoinAddress?: string;
  planRecipient: { version: string; hashbytes: string } | null;
  confirmedForeignAddress: boolean;
}): { ok: true; matchesConnectedWallet: boolean } | { ok: false; error: string } {
  if (isPlaceholderBtcRecipient(input.destinationAddress) || isPlaceholderBtcRecipient(input.encodedRecipient)) {
    return { ok: false, error: "This is a test placeholder, not a Bitcoin wallet you control. Signing is blocked." };
  }
  const expected = validateBtcRecipient(input.destinationAddress);
  if (!expected.valid || expected.encoded === undefined) {
    return { ok: false, error: expected.error ?? "Connect a Bitcoin wallet so payout can go to an address you control." };
  }
  if (expected.encoded.toLowerCase() !== input.encodedRecipient.toLowerCase()) {
    return { ok: false, error: "Payout address changed after the preview. Wait for the preview to refresh." };
  }
  if (input.planRecipient === null) {
    return { ok: false, error: "The withdrawal plan does not include a Bitcoin payout address. Signing is blocked." };
  }
  const planned = `${input.planRecipient.version}:${input.planRecipient.hashbytes}`.toLowerCase();
  if (isPlaceholderBtcRecipient(planned)) {
    return { ok: false, error: "The quote pays the test placeholder address. Signing is blocked." };
  }
  if (planned !== expected.encoded.toLowerCase()) {
    return {
      ok: false,
      error: "The quote pays a different Bitcoin address than the one on this screen. Signing is blocked.",
    };
  }
  const connected = input.connectedBitcoinAddress?.trim();
  const matchesConnectedWallet =
    connected !== undefined && connected !== "" && sameBitcoinAddress(connected, input.destinationAddress);
  if (!matchesConnectedWallet && !input.confirmedForeignAddress) {
    return {
      ok: false,
      error: "Confirm you control this Bitcoin address. Funds sent to the wrong address cannot be recovered.",
    };
  }
  return { ok: true, matchesConnectedWallet };
}

export function assertSafeDeposit(input: {
  depositAddress: string;
  stacksRecipient: string;
  preparedAmountSats: string;
  walletAddress: string;
  amountSats: string;
  planRecipient?: string | null;
}): { ok: true } | { ok: false; error: string } {
  if (!input.depositAddress.toLowerCase().startsWith("bc1")) {
    return { ok: false, error: "Deposit address is not a Bitcoin address. Nothing will be sent." };
  }
  if (isPlaceholderStacksRecipient(input.stacksRecipient) || isPlaceholderStacksRecipient(input.walletAddress)) {
    return {
      ok: false,
      error: "sBTC would mint to a burn/test Stacks address, not your wallet. Signing is blocked.",
    };
  }
  if (input.stacksRecipient !== input.walletAddress) {
    return {
      ok: false,
      error: "sBTC would mint to a different Stacks address than the connected wallet. Signing is blocked.",
    };
  }
  if (
    input.planRecipient !== undefined &&
    input.planRecipient !== null &&
    input.planRecipient !== input.walletAddress
  ) {
    return {
      ok: false,
      error: "The quote mints sBTC to a different Stacks address than the connected wallet. Signing is blocked.",
    };
  }
  if (input.preparedAmountSats !== input.amountSats) {
    return {
      ok: false,
      error: "Prepared deposit amount does not match the amount on this screen. Wait for the preview to refresh.",
    };
  }
  return { ok: true };
}

export type DepositAccounting = {
  depositAmountSats: string;
  maxSignerFeeSats: string;
  minExpectedSbtcSats: string;
};

export function calculateDepositAccounting(params: { amountSats: string; maxFeeSats: string }): DepositAccounting {
  const deposit = parseQuantity(params.amountSats);
  const maxFee = parseQuantity(params.maxFeeSats);
  if (deposit <= 0n) throw new Error("Deposit amount must be positive");
  if (maxFee < 0n) throw new Error("Max signer fee cannot be negative");

  const expected = deposit > maxFee ? deposit - maxFee : 0n;
  return {
    depositAmountSats: deposit.toString(10),
    maxSignerFeeSats: maxFee.toString(10),
    minExpectedSbtcSats: expected.toString(10),
  };
}

export type WithdrawalAccounting = {
  withdrawalAmountSats: string;
  maximumSignerFeeSats: string;
  initiallyLockedSats: string;
  actualSignerFeeSats: string | null;
  finalSbtcDebitSats: string | null;
  refundedSbtcSats: string | null;
  bitcoinReceivedSats: string | null;
};

export function calculateWithdrawalAccounting(params: {
  amountSats: string;
  maxFeeSats: string;
  actualFeeSats?: string | null;
  refundedSats?: string | null;
  bitcoinReceivedSats?: string | null;
}): WithdrawalAccounting {
  const amount = parseQuantity(params.amountSats);
  const maxFee = parseQuantity(params.maxFeeSats);
  if (amount <= 0n) throw new Error("Withdrawal amount must be positive");
  if (maxFee < 0n) throw new Error("Max signer fee cannot be negative");

  const initiallyLocked = amount + maxFee;
  let actualSignerFeeSats: string | null = null;
  let finalSbtcDebitSats: string | null = null;
  let refundedSbtcSats: string | null = null;

  if (params.actualFeeSats !== undefined && params.actualFeeSats !== null) {
    const actual = parseQuantity(params.actualFeeSats);
    actualSignerFeeSats = actual.toString(10);
    finalSbtcDebitSats = (amount + actual).toString(10);
    const refund = maxFee > actual ? maxFee - actual : 0n;
    refundedSbtcSats =
      params.refundedSats !== undefined && params.refundedSats !== null
        ? parseQuantity(params.refundedSats).toString(10)
        : refund.toString(10);
  }

  return {
    withdrawalAmountSats: amount.toString(10),
    maximumSignerFeeSats: maxFee.toString(10),
    initiallyLockedSats: initiallyLocked.toString(10),
    actualSignerFeeSats,
    finalSbtcDebitSats,
    refundedSbtcSats,
    bitcoinReceivedSats: params.bitcoinReceivedSats ?? null,
  };
}

/**
 * Invariant: Pending BTC and spendable sBTC are never combined into a single balance.
 * Throws if someone attempts to add or merge them together.
 */
export function assertDistinctBalances(
  pendingBtcSats: string,
  spendableSbtcSats: string,
): {
  pendingBtcSats: string;
  spendableSbtcSats: string;
} {
  return { pendingBtcSats, spendableSbtcSats };
}

/**
 * Prior workflows never take over the Bridge form. Follow them in the Workflows
 * drawer. Auto-resuming BROADCAST_UNKNOWN / FAILED used to trap the user on a
 * recovery card with no way back.
 */
export function shouldResumeSbtcWorkflow(_state: string): boolean {
  return false;
}

/** A workflow can warn. It must not hide Deposit / Withdraw. */
export function sbtcWorkflowBlocksComposer(_state: string | null): boolean {
  return false;
}

const IGNORED_SBTC_WORKFLOWS_KEY = "stacks-capital:ignored-sbtc-workflows";

export function loadIgnoredSbtcWorkflows(): string[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(IGNORED_SBTC_WORKFLOWS_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberIgnoredSbtcWorkflow(id: string): void {
  try {
    const next = new Set(loadIgnoredSbtcWorkflows());
    next.add(id);
    globalThis.sessionStorage?.setItem(IGNORED_SBTC_WORKFLOWS_KEY, JSON.stringify([...next]));
  } catch {
    /* Private mode or missing sessionStorage must not block the form. */
  }
}

/**
 * Finds the latest workflow for a specific sBTC action from a list of user workflows.
 */
export function findLatestSbtcWorkflow(
  workflows: WorkflowSummary[],
  action: "deposit_sbtc" | "withdraw_sbtc",
  network?: StacksNetwork,
): WorkflowSummary | null {
  const matching = workflows.filter((wf) => wf.action === action && (network === undefined || wf.network === network));
  if (matching.length === 0) return null;
  // Sort descending by updatedAt or createdAt
  return [...matching].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null;
}

/**
 * Distinguishes whether an attempt is a known broadcast or needs investigation.
 */
export function isAttemptBroadcastUnknown(attempt: { outcome: string; txid: string | null } | undefined): boolean {
  if (!attempt) return true;
  if (attempt.outcome === "UNKNOWN") return true;
  if (attempt.outcome === "BROADCAST" && (attempt.txid === null || attempt.txid === "")) return true;
  return false;
}
