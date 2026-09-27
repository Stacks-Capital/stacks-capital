import { capabilityFor, contract, FUNGIBLE_ASSET_NAME, type CapabilityRecord } from "@stacks-capital/config";
import {
  amount,
  assertPositive,
  bitcoinNative,
  capitalError,
  formatAssetId,
  integerField,
  parseQuantity,
  sip10,
  stringField,
  validatePlan,
  type CanonicalActivity,
  type Quote,
  type Plan,
  type StacksNetwork,
} from "@stacks-capital/core";
import { effect } from "../events.ts";
import type { AdapterContext, Intent, Market, ProtocolAdapter } from "../types.ts";
import type { AdapterReads } from "../reads.ts";

export const SBTC_DEPOSIT_VERSION = "sbtc-deposit@0.1.0";
export const SBTC_MARKET_DEPOSIT = "sbtc.deposit";

function token(network: StacksNetwork) {
  return sip10(network, contract("sbtc", "sbtc-token", network).contractId, FUNGIBLE_ASSET_NAME.sbtc);
}

function market(network: StacksNetwork, capability: CapabilityRecord | undefined): Market {
  return {
    id: SBTC_MARKET_DEPOSIT,
    protocol: "sbtc",
    action: "deposit_sbtc",
    network,
    suppliedAsset: formatAssetId(bitcoinNative(network)),
    receiptAsset: formatAssetId(token(network)),
    state: capability?.state ?? "disabled",
    warnings: capability?.state === "enabled" ? [] : [capability?.reason ?? "deposit is not available"],
  };
}

export function createSbtcDepositAdapter(reads: AdapterReads): ProtocolAdapter {
  return {
    protocol: "sbtc",
    version: SBTC_DEPOSIT_VERSION,
    semantics: {
      amountEncoding: "base_10_integer_base_units",
      unsupportedFieldPolicy: "omit",
      positionModel: "A deposit remains pending until a canonical sBTC mint is observed.",
      assets: [
        { unit: "satoshi", decimals: 8, evidence: "Bitcoin consensus unit" },
        { unit: "sBTC base unit", decimals: 8, evidence: "sbtc-token SIP-010 deployment" },
      ],
      actions: [
        {
          action: "deposit_sbtc",
          inputUnit: "satoshi",
          outputUnit: "sBTC base unit",
          rounding: "exact",
          completionEvidence: "canonical sBTC mint",
          postConditionPolicy: "bitcoin_script",
        },
      ],
    },
    describeCapabilities(ctx) {
      const found = capabilityFor("deposit_sbtc", ctx.network, "sbtc");
      return found ? [found] : [];
    },
    listMarkets(ctx) {
      return [market(ctx.network, capabilityFor("deposit_sbtc", ctx.network, "sbtc"))];
    },
    getMarket(ctx, marketId) {
      if (marketId !== SBTC_MARKET_DEPOSIT) throw capitalError("UNSUPPORTED_ACTION", marketId);
      return market(ctx.network, capabilityFor("deposit_sbtc", ctx.network, "sbtc"));
    },
    readPositions(ctx, owner) {
      return {
        // Pending deposits are transaction-specific evidence. A market adapter cannot infer one from
        // an address, and zero is not a position, so the lifecycle watcher owns this projection.
        value: [],
        observedAt: ctx.now.toISOString(),
        source: reads.source ?? "fixture",
        stale: false,
        warnings: [`No pending deposit is inferred for ${owner}; use transaction lifecycle evidence`],
      };
    },
    quote(ctx, intent) {
      return quoteDeposit(ctx, intent, reads);
    },
    buildPlan(ctx, quote, intent) {
      return buildDepositPlan(ctx, quote, intent, reads);
    },
    validatePlan(_ctx, plan, quote, signing) {
      return validatePlan(plan, quote, signing);
    },
    decodeEvents(ctx, events) {
      const activities: CanonicalActivity[] = [];
      for (const event of events) {
        // The registry logs a `topic` rather than an `action`, and it is the registry that logs it,
        // not the deposit contract the signers call.
        if (stringField(event, "topic") !== "completed-deposit") continue;

        // The mint names no principal: the signers broadcast it, not the depositor. The Bitcoin
        // transaction it settles is the only link back to whoever made the deposit.
        const bitcoinTxid = event.fields["bitcoin-txid"];
        const outputIndex = integerField(event, "output-index");
        const reference =
          bitcoinTxid?.kind === "buffer" && outputIndex !== null ? `${bitcoinTxid.hex}:${outputIndex}` : null;

        activities.push({
          id: event.id,
          kind: "sbtc_mint",
          blockHash: event.blockHash,
          canonical: true,
          ...(reference === null ? {} : { reference }),
          effects: effect("in", token(ctx.network), integerField(event, "amount")),
        });
      }
      return activities;
    },
    reconcile(_ctx, expected, observed) {
      return {
        matched: expected === observed,
        warnings: expected === observed ? [] : ["sBTC balance delta does not match the deposit"],
      };
    },
    explainRisk(ctx) {
      const capability = capabilityFor("deposit_sbtc", ctx.network, "sbtc");
      return {
        disclosures: [
          "Bitcoin confirmation, signer processing and Stacks mint are separate states.",
          "A Bitcoin txid is not completion.",
        ],
        stale: capability?.state !== "enabled",
        variables: { perDepositMinimum: reads.emilyLimits.perDepositMinimum },
        alerts: [],
      };
    },
  };
}

function quoteDeposit(ctx: AdapterContext, intent: Intent, reads: AdapterReads): Quote {
  if (intent.action !== "deposit_sbtc") throw capitalError("UNSUPPORTED_ACTION", intent.action);
  const capability = capabilityFor("deposit_sbtc", ctx.network, "sbtc");
  const btc = amount(bitcoinNative(ctx.network), intent.amount);
  assertPositive(btc, "deposit amount");
  const min = parseQuantity(reads.emilyLimits.perDepositMinimum);
  if (btc.quantity < min) throw capitalError("CAP_REACHED", `below perDepositMinimum ${min}`);
  const maxSigner = intent.maxFee !== undefined ? parseQuantity(intent.maxFee) : 0n;
  const boundedFee = maxSigner > btc.quantity ? btc.quantity : maxSigner;
  const sbtcOut = amount(token(ctx.network), btc.quantity - boundedFee);
  const executable = capability?.state === "enabled";
  const quote: Quote = {
    id: `q_dep_${ctx.now.getTime()}`,
    action: "deposit_sbtc",
    marketId: SBTC_MARKET_DEPOSIT,
    network: ctx.network,
    input: [btc],
    expectedOutput: [sbtcOut],
    fees:
      maxSigner > 0n
        ? [
            {
              kind: "signer",
              amount: amount(bitcoinNative(ctx.network), maxSigner),
              max: amount(bitcoinNative(ctx.network), maxSigner),
            },
          ]
        : [],
    snapshots: [`emily:${reads.emilyLimits.perDepositMinimum}`],
    expiresAt: new Date(ctx.now.getTime() + 10 * 60_000).toISOString(),
    executable,
    warnings: [
      ...(executable ? [] : [capability?.reason ?? "disabled"]),
      ...(maxSigner > 0n
        ? [
            "Minimum output uses the configured maximum signer fee; actual output is reconciled from fulfillment and mint evidence.",
          ]
        : []),
    ],
    registryVersion: ctx.registryVersion,
    adapterVersion: SBTC_DEPOSIT_VERSION,
    minimumOutput: sbtcOut,
  };
  return quote;
}

function buildDepositPlan(ctx: AdapterContext, quote: Quote, intent: Intent, _reads: AdapterReads): Plan {
  if (!quote.executable)
    throw capitalError("CAPABILITY_DISABLED", quote.warnings.join("; ") || "deposit is not executable");
  const recipient = intent.recipient;
  if (recipient === undefined) throw capitalError("PLAN_INVALID", "Stacks recipient is required");
  const maxSigner = intent.maxFee ?? "0";
  return {
    id: `p_dep_${quote.id}`,
    quoteId: quote.id,
    network: ctx.network,
    registryVersion: ctx.registryVersion,
    adapterVersion: SBTC_DEPOSIT_VERSION,
    expiresAt: quote.expiresAt,
    reviewSummary: `Send ${intent.amount} sats to the sBTC deposit script for ${recipient}. Completion requires a canonical mint, not the Bitcoin txid.`,
    steps: [
      {
        id: "bitcoin_broadcast",
        dependsOn: [],
        expectedAssetEffects: quote.expectedOutput,
        payload: {
          kind: "bitcoin_deposit",
          amountSats: intent.amount,
          stacksRecipient: recipient,
          bitcoinNetwork: ctx.network === "mainnet" ? "mainnet" : "regtest",
          reclaimLockTime: 144,
          maxSignerFeeSats: maxSigner,
          emilyNotifyPath: "/deposit",
        },
      },
    ],
  };
}
