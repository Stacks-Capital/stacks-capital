import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { decodeEventFields } from "../../apps/worker/src/clarity.ts";
import type { DecodedField } from "../../packages/core/src/index.ts";
import { PROVIDERS } from "../../packages/config/src/index.ts";

/**
 * Captures one real contract log per action, straight from mainnet, and writes them as fixtures.
 *
 * The certification fixtures fed `decodeEvents` plain English ("deposit", "borrow") while ingestion
 * stores `contract_log.value.hex`. Nothing bridged the two, so the decoders were certified against
 * data the chain never emits. These are the real payloads, kept with the transaction they came from
 * so any claim about a shape can be rechecked against the explorer.
 *
 * Run: pnpm capture:events
 */

type ContractLog = {
  contract_id: string;
  value: { hex: string; repr: string };
};

type EventPage = { results: { tx_id: string; event_index: number; contract_log?: ContractLog }[] };

type Target = {
  protocol: string;
  /** The contract that emits the logs, which is not always the one the plan calls. */
  contractId: string;
  /** Tuple field naming the action. sBTC uses `topic`, the rest use `action`. */
  discriminator: "action" | "topic";
  /** Actions worth keeping. Anything else found is reported but not written. */
  wanted: readonly string[];
};

const TARGETS: readonly Target[] = [
  {
    protocol: "zest",
    contractId: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc",
    discriminator: "action",
    // The vault is ERC4626 shaped: supply emits `deposit`, withdraw_supply emits `redeem`. The
    // `system-*` actions it also emits are the market borrowing from the vault, not user actions.
    wanted: ["deposit", "redeem"],
  },
  {
    protocol: "granite",
    contractId: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-8-market",
    discriminator: "action",
    wanted: ["collateral-add", "collateral-remove", "borrow", "repay"],
  },
  {
    protocol: "sbtc",
    contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
    discriminator: "topic",
    wanted: ["completed-deposit", "withdrawal-create", "withdrawal-accept", "withdrawal-reject"],
  },
  {
    protocol: "bitflow",
    contractId: "SP1PFR4V08H1RAZXREBGFFQ59WB739XM8VVGTFSEA.dlmm-core-v-1-1",
    discriminator: "action",
    wanted: ["swap-x-for-y", "swap-y-for-x"],
  },
];

const PAGE = 50;
const MAX_PAGES = 120;

const key = process.env.HIRO_API_KEY ?? "";
const headers = key ? { "x-api-key": key } : {};
const base = PROVIDERS.mainnet.stacksApi;

/** Hiro ships the decoded Clarity value beside the hex, so no decoder is needed to sort events. */
function actionFrom(repr: string, field: "action" | "topic"): string | null {
  return new RegExp(`\\(${field} "([^"]+)"\\)`).exec(repr)?.[1] ?? null;
}

/** Field names only, so an amount changing is not a diff but a renamed or dropped field is. */
function shapeFrom(repr: string): string {
  const names = [...repr.matchAll(/\(([a-z][a-z0-9-]*) /g)].map((match) => match[1]);
  return [...new Set(names)]
    .filter((name) => name !== "tuple" && name !== "some")
    .sort()
    .join(" ");
}

type Captured = {
  protocol: string;
  action: string;
  contractId: string;
  txid: string;
  eventIndex: number;
  payloadHex: string;
  repr: string;
  shape: string;
  /** Decoded by the worker at capture time, so the fixtures can be read without a Clarity library. */
  fields: Record<string, DecodedField>;
};

/**
 * What is already on disk. The events endpoint is a moving window, so an action that was quiet
 * during this run would otherwise be dropped from the fixtures. A recapture refreshes what it
 * finds and keeps the rest.
 */
const existing = new Map<string, Captured>();
try {
  const previous = (await import("../../packages/adapters/src/capturedEvents.ts")) as {
    CAPTURED_MAINNET_EVENTS?: readonly Captured[];
  };
  for (const event of previous.CAPTURED_MAINNET_EVENTS ?? []) {
    existing.set(`${event.protocol} ${event.action}`, event);
  }
} catch {
  // First run, nothing to keep.
}

const captured: Captured[] = [];

for (const target of TARGETS) {
  const taken = new Set<string>();
  const seen = new Set<string>();
  let pages = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (target.wanted.every((action) => taken.has(action))) break;
    pages += 1;
    const url = `${base}/extended/v1/contract/${target.contractId}/events?limit=${PAGE}&offset=${page * PAGE}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.error(`${target.protocol}: HTTP ${res.status} on page ${page}`);
      break;
    }
    const body = (await res.json()) as EventPage;
    if (body.results.length === 0) break;

    for (const event of body.results) {
      if (event.contract_log === undefined) continue;
      const action = actionFrom(event.contract_log.value.repr, target.discriminator);
      if (action === null) continue;
      seen.add(action);
      if (!target.wanted.includes(action) || taken.has(action)) continue;
      taken.add(action);
      captured.push({
        protocol: target.protocol,
        action,
        contractId: event.contract_log.contract_id,
        txid: event.tx_id,
        eventIndex: event.event_index,
        payloadHex: event.contract_log.value.hex,
        repr: event.contract_log.value.repr,
        shape: shapeFrom(event.contract_log.value.repr),
        fields: decodeEventFields(event.contract_log.value.hex),
      });
    }
  }

  const missing = target.wanted.filter((action) => !taken.has(action));
  console.log(
    `${target.protocol}: ${target.wanted.length - missing.length}/${target.wanted.length} captured over ${pages} pages` +
      (missing.length > 0 ? `, MISSING ${missing.join(", ")}` : "") +
      `\n  actions seen: ${[...seen].sort().join(", ") || "none"}`,
  );
}

const refreshed = new Set(captured.map((event) => `${event.protocol} ${event.action}`));
const kept = [...existing.entries()].filter(([key]) => !refreshed.has(key));
for (const [key, event] of kept) {
  console.log(`keeping the stored capture for ${key}; this run did not reach one`);
  captured.push(event);
}

captured.sort((a, b) =>
  a.protocol === b.protocol ? a.action.localeCompare(b.action) : a.protocol.localeCompare(b.protocol),
);

/** Emits the decoded fields as TypeScript, keeping integers as bigint literals. */
function renderFields(fields: Record<string, DecodedField>): string {
  const entries = Object.entries(fields).map(([name, field]) => {
    const body =
      field.kind === "integer"
        ? `{ kind: "integer", value: ${field.value.toString(10)}n }`
        : field.kind === "buffer"
          ? `{ kind: "buffer", hex: ${JSON.stringify(field.hex)} }`
          : field.kind === "other"
            ? `{ kind: "other", repr: ${JSON.stringify(field.repr)} }`
            : `{ kind: ${JSON.stringify(field.kind)}, value: ${JSON.stringify(field.value)} }`;
    return `      ${JSON.stringify(name)}: ${body},`;
  });
  return entries.length === 0 ? "{}" : `{\n${entries.join("\n")}\n    }`;
}

const header = `// Generated by scripts/contracts/captureEvents.ts. Do not edit by hand; rerun \`pnpm capture:events\`.
//
// Real mainnet contract logs, one per action, in the exact form ingestion stores them
// (\`contract_log.value.hex\`). Captured ${new Date().toISOString().slice(0, 10)}.
//
// The emitting contract is not always the one the plan calls: the Bitflow router and both sBTC
// entry contracts emit nothing of their own, so their events come from the pool core and the
// sBTC registry instead.

import type { DecodedField } from "@stacks-capital/core";

export type CapturedEvent = {
  protocol: string;
  /** The \`action\` field for Zest, Granite and Bitflow; the \`topic\` field for sBTC. */
  action: string;
  /** The contract that emitted the log. */
  contractId: string;
  txid: string;
  eventIndex: number;
  payloadHex: string;
  /** Hiro's decoded rendering, kept so a reviewer can read the payload without decoding it. */
  repr: string;
  /** Field names only, so a renamed or dropped field shows as a diff but an amount does not. */
  shape: string;
  /**
   * The payload decoded into the shape an adapter receives, so certification can feed a decoder
   * exactly what ingestion would hand it. Decoded by the worker at capture time, because adapters
   * have no Clarity library of their own.
   */
  fields: Readonly<Record<string, DecodedField>>;
};

export const CAPTURED_MAINNET_EVENTS: readonly CapturedEvent[] = [
`;

const body = captured
  .map(
    (row) =>
      `  {\n    protocol: ${JSON.stringify(row.protocol)},\n    action: ${JSON.stringify(row.action)},\n` +
      `    contractId: ${JSON.stringify(row.contractId)},\n    txid: ${JSON.stringify(row.txid)},\n` +
      `    eventIndex: ${row.eventIndex},\n    payloadHex: ${JSON.stringify(row.payloadHex)},\n` +
      `    repr: ${JSON.stringify(row.repr)},\n    shape: ${JSON.stringify(row.shape)},\n` +
      `    fields: ${renderFields(row.fields)},\n  },`,
  )
  .join("\n");

const out = "packages/adapters/src/capturedEvents.ts";
writeFileSync(out, `${header}${body}\n] as const;\n`);
// Formatted here so a recapture never lands a file that fails lint.
execFileSync("npx", ["biome", "check", "--write", out], { stdio: "inherit" });
console.log(`\nWrote ${captured.length} events to ${out}`);
