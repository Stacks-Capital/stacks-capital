import type { NotifiedSbtcDeposit, PreparedSbtcDeposit } from "@stacks-capital/client";

/** Leather often returns a 33-byte compressed key; the official sBTC constructor wants x-only. */
export function schnorrPublicKey(value: string): string {
  const hex = value.trim().replace(/^0x/i, "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return hex;
  if (/^0[23][0-9a-f]{64}$/.test(hex)) return hex.slice(2);
  throw new Error("Bitcoin reclaim key must be a 32-byte x-only or 33-byte compressed public key");
}

export function assertPreparedSbtcDeposit(prepared: PreparedSbtcDeposit): PreparedSbtcDeposit {
  if (prepared.bitcoinNetwork !== "mainnet") throw new Error("sBTC deposits are mainnet only");
  if (!prepared.address.startsWith("bc1p")) throw new Error("Prepared deposit is missing a P2TR address");
  if (prepared.emilyNotifyPath !== "/deposit") throw new Error("Prepared deposit is missing the Emily notify path");
  return prepared;
}

/** Emily accepted/pending/confirmed is tracking. Only a later canonical mint is completion. */
export function emilyDepositIsComplete(notified: NotifiedSbtcDeposit): false {
  return notified.complete;
}
