import { createBitflowSwapAdapter } from "./bitflow/swap.ts";
import { createGraniteCreditAdapter } from "./granite/credit.ts";
import type { AdapterReads } from "./reads.ts";
import { createSbtcDepositAdapter } from "./sbtc/deposit.ts";
import { createSbtcWithdrawAdapter } from "./sbtc/withdraw.ts";
import type { ProtocolAdapter } from "./types.ts";
import { createZestEarnAdapter } from "./zest/earn.ts";

/**
 * Adapters built for event decoding alone.
 *
 * `decodeEvents` turns a log the chain already produced into meaning, and reads nothing from a
 * provider to do it. These instances therefore carry no market data, and quoting or planning with
 * one would be reading limits that were never fetched. Ingestion is the only caller.
 */
const NO_READS: AdapterReads = {
  source: "event-decoding-only",
  // Required by the type and never consulted: a zero here would be read as a real limit by any
  // other method, which is why these instances decode and nothing else.
  emilyLimits: { perDepositMinimum: "0", perWithdrawalCap: "0" },
};

export function eventDecodingAdapters(): readonly ProtocolAdapter[] {
  return [
    createSbtcDepositAdapter(NO_READS),
    createSbtcWithdrawAdapter(NO_READS),
    createZestEarnAdapter(NO_READS),
    createGraniteCreditAdapter(NO_READS),
    createBitflowSwapAdapter(NO_READS),
  ];
}
