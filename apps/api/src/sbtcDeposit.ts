import { createEmilyDepositNotification, parseEmilyDeposit, type EmilyDeposit } from "@stacks-capital/adapters";
import { PROVIDERS } from "@stacks-capital/config";
import { parseQuantity } from "@stacks-capital/core";
import { buildSbtcDepositAddress, MAINNET, SbtcApiClientMainnet } from "sbtc";

const HEX = /^(?:0x)?(?:[0-9a-fA-F]{2})+$/;
const TXID = /^(?:0x)?[0-9a-fA-F]{64}$/;
const STACKS = /^S[PM][A-Z0-9]{25,41}$/;
const BURN_STACKS = new Set(["SP000000000000000000002Q6VF78", "ST000000000000000000002AMW42H"]);

export function isBurnStacksRecipient(value: string): boolean {
  return BURN_STACKS.has(value.trim().toUpperCase());
}
/** Adapter and plan pin 144. Official sbtc default is 950; prepare follows the plan. */
export const SBTC_DEPOSIT_RECLAIM_LOCK_TIME = 144;

export type PreparedSbtcDeposit = {
  address: string;
  depositScript: string;
  reclaimScript: string;
  signersPublicKey: string;
  reclaimLockTime: number;
  amountSats: string;
  maxSignerFeeSats: string;
  stacksRecipient: string;
  bitcoinNetwork: "mainnet";
  emilyNotifyPath: "/deposit";
};

export type PrepareSbtcDepositInput = {
  network: "mainnet" | "testnet";
  stacksRecipient: string;
  amountSats: string;
  maxSignerFeeSats: string;
  reclaimPublicKey: string;
  reclaimLockTime?: number;
};

export type NotifySbtcDepositInput = {
  network: "mainnet" | "testnet";
  bitcoinTxid: string;
  bitcoinTxOutputIndex?: number;
  transactionHex?: string;
  depositScript: string;
  reclaimScript: string;
  stacksRecipient: string;
  amountSats: string;
  maxSignerFeeSats: string;
};

export type SbtcDepositBridge = {
  fetchSignersPublicKey(): Promise<string>;
  fetchTxHex(txid: string): Promise<string>;
  notifyEmily(body: {
    bitcoinTxid: string;
    bitcoinTxOutputIndex: number;
    depositScript: string;
    reclaimScript: string;
    transactionHex: string;
  }): Promise<unknown>;
};

export function schnorrPublicKey(value: string): string {
  const hex = value.trim().replace(/^0x/i, "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return hex;
  if (/^0[23][0-9a-f]{64}$/.test(hex)) return hex.slice(2);
  throw new Error("Bitcoin reclaim key must be a 32-byte x-only or 33-byte compressed public key");
}

export function safeSatsNumber(value: string, name: string): number {
  const quantity = parseQuantity(value);
  if (quantity <= 0n) throw new Error(`${name} must be positive`);
  if (quantity > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} exceeds the integer range the sBTC constructor accepts`);
  }
  return Number(quantity);
}

export type BitcoinRecoverTx = {
  txid?: string;
  vin?: Array<{ witness?: string[] }>;
  vout?: Array<{ value?: number; scriptpubkey_address?: string }>;
  status?: { confirmed?: boolean };
};

export function p2wpkhSpendPublicKey(tx: BitcoinRecoverTx): string | null {
  const key = tx.vin?.[0]?.witness?.[1];
  if (typeof key !== "string") return null;
  const hex = key.trim().replace(/^0x/i, "").toLowerCase();
  return /^(?:02|03)[0-9a-f]{64}$/.test(hex) ? hex : null;
}

export function depositOutputSats(tx: BitcoinRecoverTx): string | null {
  const value = tx.vout?.[0]?.value;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}

export function depositOutputAddress(tx: BitcoinRecoverTx): string | null {
  const address = tx.vout?.[0]?.scriptpubkey_address;
  return typeof address === "string" && address.startsWith("bc1p") ? address : null;
}

export async function fetchBitcoinRecoverTx(
  txid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BitcoinRecoverTx> {
  const id = txid.replace(/^0x/i, "").toLowerCase();
  const response = await fetchImpl(`https://mempool.space/api/tx/${id}`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) throw new Error("Bitcoin transaction is not visible on mempool.space");
  if (!response.ok) throw new Error(`Bitcoin transaction read failed with HTTP ${response.status}`);
  return (await response.json()) as BitcoinRecoverTx;
}

export function normalizeBitcoinTxHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^0x/i, "").toLowerCase();
  return HEX.test(hex) ? hex : null;
}

async function readTxHex(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  const response = await fetchImpl(url, { headers: { accept: "text/plain" } });
  if (!response.ok) return null;
  return normalizeBitcoinTxHex(await response.text());
}

/** Leather returns a txid before mempool.space has the hex. Retry, then try Blockstream. */
export async function fetchBitcoinTxHex(
  txid: string,
  fetchImpl: typeof fetch = fetch,
  waitsMs: readonly number[] = [0, 750, 1500, 2500, 4000],
): Promise<string> {
  const id = txid.replace(/^0x/i, "").toLowerCase();
  const sources = [`https://mempool.space/api/tx/${id}/hex`, `https://blockstream.info/api/tx/${id}/hex`];
  for (const wait of waitsMs) {
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    for (const url of sources) {
      const hex = await readTxHex(url, fetchImpl).catch(() => null);
      if (hex !== null) return hex;
    }
  }
  throw new Error(
    "Bitcoin transaction is not visible on the network yet. The send succeeded. Wait a few seconds and notify Emily again.",
  );
}

export function createMainnetSbtcBridge(): SbtcDepositBridge {
  const client = new SbtcApiClientMainnet({
    sbtcApiUrl: PROVIDERS.mainnet.emily,
    stxApiUrl: "https://api.hiro.so",
    sbtcContract: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
  });
  return {
    fetchSignersPublicKey: () => client.fetchSignersPublicKey(),
    fetchTxHex: (txid) => fetchBitcoinTxHex(txid),
    async notifyEmily(body) {
      const response = await fetch(`${PROVIDERS.mainnet.emily}/deposit`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof json === "object" && json !== null && "message" in json && typeof json.message === "string"
            ? json.message
            : `Emily notify failed with HTTP ${response.status}`;
        throw new Error(message);
      }
      return json;
    },
  };
}

export async function prepareSbtcDeposit(
  input: PrepareSbtcDepositInput,
  bridge: SbtcDepositBridge = createMainnetSbtcBridge(),
): Promise<PreparedSbtcDeposit> {
  if (input.network !== "mainnet") {
    throw new Error("sBTC deposit construction is mainnet only. Testnet Emily does not track public Stacks testnet.");
  }
  if (!STACKS.test(input.stacksRecipient)) throw new Error("stacksRecipient must be a mainnet Stacks address");
  if (isBurnStacksRecipient(input.stacksRecipient)) {
    throw new Error("stacksRecipient cannot be a burn or test Stacks address");
  }
  const amountSats = parseQuantity(input.amountSats).toString(10);
  const maxSignerFeeSats = parseQuantity(input.maxSignerFeeSats).toString(10);
  if (parseQuantity(amountSats) <= 0n) throw new Error("amountSats must be positive");
  if (parseQuantity(maxSignerFeeSats) < 0n) throw new Error("maxSignerFeeSats cannot be negative");
  const reclaimLockTime = input.reclaimLockTime ?? SBTC_DEPOSIT_RECLAIM_LOCK_TIME;
  if (!Number.isSafeInteger(reclaimLockTime) || reclaimLockTime < 1) {
    throw new Error("reclaimLockTime must be a positive integer");
  }
  const signersPublicKey = schnorrPublicKey(await bridge.fetchSignersPublicKey());
  const built = buildSbtcDepositAddress({
    network: MAINNET,
    stacksAddress: input.stacksRecipient,
    signersPublicKey,
    maxSignerFee: safeSatsNumber(maxSignerFeeSats, "maxSignerFeeSats"),
    reclaimLockTime,
    reclaimPublicKey: schnorrPublicKey(input.reclaimPublicKey),
  });
  if (built.address === undefined || !built.address.startsWith("bc1p")) {
    throw new Error("sBTC constructor did not return a mainnet P2TR deposit address");
  }
  return {
    address: built.address,
    depositScript: built.depositScript.toLowerCase(),
    reclaimScript: built.reclaimScript.toLowerCase(),
    signersPublicKey,
    reclaimLockTime,
    amountSats,
    maxSignerFeeSats,
    stacksRecipient: input.stacksRecipient,
    bitcoinNetwork: "mainnet",
    emilyNotifyPath: "/deposit",
  };
}

export async function notifySbtcDeposit(
  input: NotifySbtcDepositInput,
  bridge: SbtcDepositBridge = createMainnetSbtcBridge(),
): Promise<EmilyDeposit> {
  if (input.network !== "mainnet") {
    throw new Error("Emily notify is mainnet only. Testnet Emily does not track public Stacks testnet.");
  }
  if (!TXID.test(input.bitcoinTxid)) throw new Error("bitcoinTxid must be 32-byte hex");
  const bitcoinTxid = input.bitcoinTxid.replace(/^0x/i, "").toLowerCase();
  const bitcoinTxOutputIndex = input.bitcoinTxOutputIndex ?? 0;
  const transactionHex = normalizeBitcoinTxHex(input.transactionHex ?? (await bridge.fetchTxHex(bitcoinTxid)));
  if (transactionHex === null) {
    throw new Error("transactionHex must be non-empty byte hex");
  }
  const notification = createEmilyDepositNotification({
    network: "mainnet",
    bitcoinTxid,
    bitcoinTxOutputIndex,
    transactionHex,
    depositScript: input.depositScript,
    reclaimScript: input.reclaimScript,
    recipient: input.stacksRecipient,
    amountSats: input.amountSats,
    maxSignerFeeSats: input.maxSignerFeeSats,
  });
  return parseEmilyDeposit(await bridge.notifyEmily(notification));
}
