import { REGISTRY_VERSION } from "@stacks-capital/config";
import {
  type ActivityEffect,
  type AssetId,
  type CanonicalActivity,
  type ClarityValue,
  type DecodedEvent,
  parseAssetId,
} from "@stacks-capital/core";
import { CAPTURED_MAINNET_EVENTS, type CapturedEvent } from "./capturedEvents.ts";
import { assetForPrincipal } from "./events.ts";
import { createBitflowSwapAdapter } from "./bitflow/swap.ts";
import { assertAdapterCertified, type AdapterCertificationFixture } from "./certification.ts";
import { createGraniteCreditAdapter } from "./granite/credit.ts";
import type { AdapterReads } from "./reads.ts";
import { createSbtcDepositAdapter } from "./sbtc/deposit.ts";
import { createSbtcWithdrawAdapter } from "./sbtc/withdraw.ts";
import type { AdapterContext } from "./types.ts";
import { createZestEarnAdapter } from "./zest/earn.ts";

const OWNER = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const NOW = "2026-09-15T12:00:00.000Z";
const BLOCK_HEIGHT = 8_993_830;
const BLOCK_HASH = "0x000000000000000000000000000000000000000000000000000000008993830";
const SBTC = "stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token";
const BTC = "bitcoin:mainnet:native:btc";
const USDCX = "stacks:mainnet:contract:SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx:usdcx-token";
const ZSBTC = "stacks:mainnet:contract:SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc:zft";
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const USDCX_CONTRACT = "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx";
const ZEST_VAULT = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc";
const GRANITE_MARKET = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-8-market";
const BITFLOW_ROUTER = "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-2";
const BITFLOW_POOL = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.sbtc-usdcx-dlmm-fixture";

const context: AdapterContext = {
  network: "mainnet",
  now: new Date(NOW),
  owner: OWNER,
  registryVersion: REGISTRY_VERSION,
};

const reads: AdapterReads = {
  source: "adapter-certification-fixture",
  emilyLimits: { perDepositMinimum: "1000", perWithdrawalCap: "50100000000" },
  vault: {
    pausedDeposit: false,
    pausedRedeem: false,
    totalAssets: "66022279734",
    capSupply: "500000000000",
    shareRateNumerator: "2",
    shareRateDenominator: "3",
    availableAssets: "66022279734",
    interestRateBps: "130",
  },
  debtVault: {
    pausedDeposit: false,
    pausedRedeem: false,
    totalAssets: "250000000000",
    capSupply: "500000000000",
    shareRateNumerator: "1",
    shareRateDenominator: "1",
  },
  oracle: {
    sbtc: {
      price: "10000000000000",
      scale: "8",
      observedAt: NOW,
      source: "adapter-certification-fixture",
      stale: false,
      maxAgeMs: 180_000,
    },
    usdcx: {
      price: "100000000",
      scale: "8",
      observedAt: NOW,
      source: "adapter-certification-fixture",
      stale: false,
      maxAgeMs: 180_000,
    },
  },
  swap: {
    poolId: BITFLOW_POOL,
    routerId: BITFLOW_ROUTER,
    amountIn: "100000000",
    amountOut: "99500000000",
    xAsset: "sbtc",
    stale: false,
    observedAt: NOW,
    source: "fixture",
    maxAgeMs: 180_000,
  },
  position: { collateral: "100000000", debt: "0" },
  riskParams: {
    ltvBorrowBps: "7000",
    ltvLiqBps: "8000",
    bufferBps: "500",
    sbtcDecimals: "8",
    usdcxDecimals: "6",
  },
  balances: { sbtc: "123", zsbtc: "77", usdcx: "456" },
};

function captured(protocol: string, action: string): CapturedEvent {
  const found = CAPTURED_MAINNET_EVENTS.find((item) => item.protocol === protocol && item.action === action);
  if (found === undefined) {
    throw new Error(`No captured ${protocol} ${action} event. Run pnpm capture:events.`);
  }
  return found;
}

function capturedInteger(source: CapturedEvent, name: string): bigint {
  const field = source.fields[name];
  if (field?.kind !== "integer") {
    throw new Error(`Captured ${source.protocol} ${source.action} has no integer field ${name}`);
  }
  return field.value;
}

function capturedPrincipal(source: CapturedEvent, name: string): string {
  const field = source.fields[name];
  if (field?.kind !== "principal") {
    throw new Error(`Captured ${source.protocol} ${source.action} has no principal field ${name}`);
  }
  return field.value;
}

/**
 * Where an expected effect's asset comes from. A fixed id pins a protocol that only ever moves one
 * asset; `fromField` pins the rule instead, for a contract that routes many assets and whose
 * captured example can change pool on the next refresh.
 */
type EffectSpec = {
  direction: ActivityEffect["direction"];
  asset: string | { fromField: string };
  field: string;
};

/**
 * Builds a certification case from a real captured mainnet log.
 *
 * The decoder is fed exactly what ingestion would hand it, and the expected activity names the
 * field each amount must come from. Amounts move when the capture is refreshed; which field means
 * what does not, and that mapping is what this pins.
 */
function eventCase(input: {
  protocol: string;
  action: string;
  id: string;
  kind: string;
  ownerField?: string;
  reference?: (source: CapturedEvent) => string;
  effects: readonly EffectSpec[];
}): { raw: DecodedEvent[]; expected: CanonicalActivity[] } {
  const source = captured(input.protocol, input.action);
  const owner = input.ownerField === undefined ? undefined : capturedPrincipal(source, input.ownerField);
  const reference = input.reference?.(source);
  return {
    raw: [{ id: input.id, blockHash: BLOCK_HASH, contractId: source.contractId, fields: source.fields }],
    expected: [
      {
        id: input.id,
        kind: input.kind,
        blockHash: BLOCK_HASH,
        canonical: true,
        ...(owner === undefined ? {} : { owner }),
        ...(reference === undefined ? {} : { reference }),
        effects: input.effects.map((spec) => ({
          direction: spec.direction,
          asset:
            typeof spec.asset === "string"
              ? (parseAssetId(spec.asset) as AssetId)
              : expectedAsset(source, spec.asset.fromField),
          quantity: capturedInteger(source, spec.field),
        })),
      },
    ],
  };
}

/** Resolves the asset a captured event named in one of its principal fields. */
function expectedAsset(source: CapturedEvent, field: string): AssetId {
  const asset = assetForPrincipal("mainnet", capturedPrincipal(source, field));
  if (asset === null) {
    throw new Error(`Captured ${source.protocol} ${source.action} names an unpinned asset in ${field}`);
  }
  return asset;
}

function merge(...cases: { raw: DecodedEvent[]; expected: CanonicalActivity[] }[]) {
  return {
    raw: cases.flatMap((item) => item.raw),
    expected: cases.flatMap((item) => item.expected),
  };
}

const commonEvidence = { blockHeight: BLOCK_HEIGHT, blockHash: BLOCK_HASH, source: "adapter-certification-fixture" };

export const ADAPTER_CERTIFICATION_FIXTURES: readonly AdapterCertificationFixture[] = [
  {
    id: "sbtc-deposit-mainnet-v1",
    adapter: createSbtcDepositAdapter(reads),
    context,
    intent: {
      action: "deposit_sbtc",
      marketId: "sbtc.deposit",
      amount: "10000",
      recipient: OWNER,
      maxFee: "200",
    },
    evidence: {
      ...commonEvidence,
      deployment: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit",
      deploymentRevision: "328228",
    },
    read: {
      owner: OWNER,
      expected: {
        value: [],
        observedAt: NOW,
        source: "adapter-certification-fixture",
        stale: false,
        warnings: [`No pending deposit is inferred for ${OWNER}; use transaction lifecycle evidence`],
      },
    },
    quote: {
      action: "deposit_sbtc",
      marketId: "sbtc.deposit",
      network: "mainnet",
      input: [{ asset: BTC, quantity: "10000" }],
      expectedOutput: [{ asset: SBTC, quantity: "9800" }],
      fees: [
        {
          kind: "signer",
          amount: { asset: BTC, quantity: "200" },
          max: { asset: BTC, quantity: "200" },
        },
      ],
      snapshots: ["emily:1000"],
      executable: true,
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "sbtc-deposit@0.1.0",
      minimumOutput: { asset: SBTC, quantity: "9800" },
    },
    plan: {
      network: "mainnet",
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "sbtc-deposit@0.1.0",
      steps: [
        {
          id: "bitcoin_broadcast",
          dependsOn: [],
          expectedAssetEffects: [{ asset: SBTC, quantity: "9800" }],
          payload: {
            kind: "bitcoin_deposit",
            amountSats: "10000",
            stacksRecipient: OWNER,
            bitcoinNetwork: "mainnet",
            reclaimLockTime: 144,
            maxSignerFeeSats: "200",
            emilyNotifyPath: "/deposit",
          },
        },
      ],
    },
    events: eventCase({
      protocol: "sbtc",
      action: "completed-deposit",
      id: "deposit-1",
      kind: "sbtc_mint",
      // The signers broadcast the mint, so it names no principal. The Bitcoin output it settles is
      // the only way back to the depositor.
      reference: (source) => {
        const txid = source.fields["bitcoin-txid"];
        if (txid?.kind !== "buffer") throw new Error("captured mint has no bitcoin-txid");
        return `${txid.hex}:${capturedInteger(source, "output-index")}`;
      },
      effects: [{ direction: "in", asset: SBTC, field: "amount" }],
    }),
    reconciliation: { expected: "9800", observed: "9800", mismatchedObserved: "9799" },
  },
  {
    id: "sbtc-withdraw-mainnet-v1",
    adapter: createSbtcWithdrawAdapter(reads),
    context,
    intent: {
      action: "withdraw_sbtc",
      marketId: "sbtc.withdraw",
      amount: "10000",
      recipient: "04:00112233445566778899aabbccddeeff00112233",
      maxFee: "1000",
    },
    evidence: {
      ...commonEvidence,
      deployment: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal",
      deploymentRevision: "328228",
    },
    read: {
      owner: OWNER,
      expected: {
        value: [],
        observedAt: NOW,
        source: "adapter-certification-fixture",
        stale: false,
        warnings: [`No pending withdrawal is inferred for ${OWNER}; use request lifecycle evidence`],
      },
    },
    quote: {
      action: "withdraw_sbtc",
      marketId: "sbtc.withdraw",
      network: "mainnet",
      input: [{ asset: SBTC, quantity: "11000" }],
      expectedOutput: [{ asset: BTC, quantity: "10000" }],
      fees: [
        {
          kind: "signer",
          amount: { asset: SBTC, quantity: "1000" },
          max: { asset: SBTC, quantity: "1000" },
        },
      ],
      snapshots: ["emily:50100000000"],
      executable: true,
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "sbtc-withdraw@0.1.0",
      minimumOutput: { asset: BTC, quantity: "10000" },
    },
    plan: {
      network: "mainnet",
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "sbtc-withdraw@0.1.0",
      steps: [
        {
          id: "initiate_withdrawal",
          dependsOn: [],
          expectedAssetEffects: [{ asset: BTC, quantity: "10000" }],
          payload: {
            kind: "stacks_contract_call",
            contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal",
            functionName: "initiate-withdrawal-request",
            functionArgs: [
              { type: "uint", value: "10000" },
              {
                type: "tuple",
                value: {
                  version: { type: "buff", hex: "04" },
                  hashbytes: { type: "buff", hex: "00112233445566778899aabbccddeeff00112233" },
                },
              },
              { type: "uint", value: "1000" },
            ],
            postConditions: [{ principal: OWNER, mode: "send_lte", amount: { asset: SBTC, quantity: "11000" } }],
            postConditionMode: "deny",
            network: "mainnet",
          },
        },
      ],
    },
    // A withdrawal is two events: the request carries the amount, the acceptance carries the
    // Bitcoin payout and no amount at all. Both are certified so the pairing stays visible.
    events: merge(
      eventCase({
        protocol: "sbtc",
        action: "withdrawal-create",
        id: "withdraw-1",
        kind: "sbtc_withdrawal_requested",
        ownerField: "sender",
        reference: (source) => capturedInteger(source, "request-id").toString(10),
        effects: [{ direction: "out", asset: SBTC, field: "amount" }],
      }),
      eventCase({
        protocol: "sbtc",
        action: "withdrawal-accept",
        id: "withdraw-2",
        kind: "sbtc_payout",
        reference: (source) => capturedInteger(source, "request-id").toString(10),
        effects: [],
      }),
    ),
    reconciliation: { expected: "10000", observed: "10000", mismatchedObserved: "9999" },
  },
  {
    id: "zest-earn-mainnet-v1",
    adapter: createZestEarnAdapter(reads),
    context,
    intent: { action: "supply", marketId: "zest.sbtc.vault", amount: "100" },
    evidence: { ...commonEvidence, deployment: ZEST_VAULT, deploymentRevision: "6162063" },
    read: {
      owner: OWNER,
      expected: {
        value: [{ owner: OWNER, marketId: "zest.sbtc.vault", kind: "supplied", quantity: "115" }],
        observedAt: NOW,
        source: "adapter-certification-fixture",
        stale: false,
        warnings: [],
      },
    },
    quote: {
      action: "supply",
      marketId: "zest.sbtc.vault",
      network: "mainnet",
      input: [{ asset: SBTC, quantity: "100" }],
      expectedOutput: [{ asset: ZSBTC, quantity: "66" }],
      fees: [],
      snapshots: ["vault:66022279734"],
      executable: true,
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "zest-earn@0.1.0",
      minimumOutput: { asset: ZSBTC, quantity: "66" },
    },
    plan: {
      network: "mainnet",
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "zest-earn@0.1.0",
      steps: [
        {
          id: "deposit",
          dependsOn: [],
          expectedAssetEffects: [{ asset: ZSBTC, quantity: "66" }],
          payload: {
            kind: "stacks_contract_call",
            contractId: ZEST_VAULT,
            functionName: "deposit",
            functionArgs: [
              { type: "uint", value: "100" },
              { type: "uint", value: "66" },
              { type: "principal", value: OWNER },
            ],
            postConditions: [{ principal: OWNER, mode: "send_lte", amount: { asset: SBTC, quantity: "100" } }],
            postConditionMode: "deny",
            network: "mainnet",
          },
        },
      ],
    },
    events: eventCase({
      protocol: "zest",
      action: "deposit",
      id: "zest-1",
      kind: "zest_deposit",
      ownerField: "recipient",
      effects: [
        { direction: "out", asset: SBTC, field: "amount" },
        { direction: "in", asset: ZSBTC, field: "shares-minted" },
      ],
    }),
    reconciliation: { expected: "66", observed: "66", mismatchedObserved: "65" },
  },
  {
    id: "zest-redeem-mainnet-v1",
    adapter: createZestEarnAdapter(reads),
    context,
    intent: { action: "withdraw_supply", marketId: "zest.sbtc.vault", amount: "66", minOut: "99" },
    evidence: { ...commonEvidence, deployment: ZEST_VAULT, deploymentRevision: "6162063" },
    read: {
      owner: OWNER,
      expected: {
        value: [{ owner: OWNER, marketId: "zest.sbtc.vault", kind: "supplied", quantity: "115" }],
        observedAt: NOW,
        source: "adapter-certification-fixture",
        stale: false,
        warnings: [],
      },
    },
    quote: {
      action: "withdraw_supply",
      marketId: "zest.sbtc.vault",
      network: "mainnet",
      input: [{ asset: ZSBTC, quantity: "66" }],
      expectedOutput: [{ asset: SBTC, quantity: "99" }],
      fees: [],
      snapshots: ["vault:66022279734"],
      executable: true,
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "zest-earn@0.1.0",
      minimumOutput: { asset: SBTC, quantity: "99" },
    },
    plan: {
      network: "mainnet",
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "zest-earn@0.1.0",
      steps: [
        {
          id: "redeem",
          dependsOn: [],
          expectedAssetEffects: [{ asset: SBTC, quantity: "99" }],
          payload: {
            kind: "stacks_contract_call",
            contractId: ZEST_VAULT,
            functionName: "redeem",
            functionArgs: [
              { type: "uint", value: "66" },
              { type: "uint", value: "99" },
              { type: "principal", value: OWNER },
            ],
            postConditions: [{ principal: OWNER, mode: "send_lte", amount: { asset: ZSBTC, quantity: "66" } }],
            postConditionMode: "deny",
            network: "mainnet",
          },
        },
      ],
    },
    events: eventCase({
      protocol: "zest",
      action: "redeem",
      id: "zest-2",
      kind: "zest_redeem",
      ownerField: "recipient",
      effects: [
        { direction: "in", asset: SBTC, field: "amount-received" },
        { direction: "out", asset: ZSBTC, field: "shares-burned" },
      ],
    }),
    reconciliation: { expected: "99", observed: "99", mismatchedObserved: "98" },
  },
  {
    id: "granite-borrow-mainnet-v1",
    adapter: createGraniteCreditAdapter(reads),
    context,
    intent: { action: "borrow", marketId: "granite.sbtc.isolated", amount: "50000000000" },
    evidence: { ...commonEvidence, deployment: GRANITE_MARKET, deploymentRevision: "8883545" },
    read: {
      owner: OWNER,
      expected: {
        value: [
          { owner: OWNER, marketId: "granite.sbtc.isolated", kind: "collateral", quantity: "100000000" },
          { owner: OWNER, marketId: "granite.sbtc.isolated", kind: "debt", quantity: "0" },
        ],
        observedAt: NOW,
        source: "adapter-certification-fixture",
        stale: false,
        warnings: [],
      },
    },
    quote: {
      action: "borrow",
      marketId: "granite.sbtc.isolated",
      network: "mainnet",
      input: [],
      expectedOutput: [{ asset: USDCX, quantity: "50000000000" }],
      fees: [],
      snapshots: [
        `market:${GRANITE_MARKET}`,
        "ltv:5000",
        "maxBorrow:65000000000",
        "health:16000",
        "liquidity:250000000000",
        "pause:off",
        `oracle:${NOW}`,
      ],
      executable: true,
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "granite-credit@0.1.0",
      minimumOutput: { asset: USDCX, quantity: "50000000000" },
    },
    plan: {
      network: "mainnet",
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "granite-credit@0.1.0",
      steps: [
        {
          id: "borrow",
          dependsOn: [],
          expectedAssetEffects: [{ asset: USDCX, quantity: "50000000000" }],
          payload: {
            kind: "stacks_contract_call",
            contractId: GRANITE_MARKET,
            functionName: "borrow",
            functionArgs: [
              { type: "principal", value: USDCX_CONTRACT },
              { type: "uint", value: "50000000000" },
              { type: "none" },
              { type: "none" },
            ],
            postConditions: [
              { principal: OWNER, mode: "receive_gte", amount: { asset: USDCX, quantity: "50000000000" } },
            ],
            postConditionMode: "deny",
            network: "mainnet",
          },
        },
      ],
    },
    // The captured borrow is for usdh, which this registry does not pin. The activity and the
    // account are still recorded; the amount is left off, because an unrecognised asset is
    // unknown and must never be reported as a movement of some other asset.
    events: eventCase({
      protocol: "granite",
      action: "borrow",
      id: "granite-1",
      kind: "granite_borrow",
      ownerField: "account",
      effects: [],
    }),
    reconciliation: { expected: "50000000000", observed: "50000000000", mismatchedObserved: "49999999999" },
  },
  {
    id: "bitflow-swap-mainnet-v1",
    adapter: createBitflowSwapAdapter(reads),
    context,
    intent: { action: "swap", marketId: "bitflow.sbtc-usdcx", amount: "100000000" },
    evidence: { ...commonEvidence, deployment: BITFLOW_ROUTER, deploymentRevision: "6979616" },
    read: {
      owner: OWNER,
      expected: {
        value: [{ owner: OWNER, marketId: "bitflow.sbtc-usdcx", kind: "wallet", quantity: "123" }],
        observedAt: NOW,
        source: "fixture",
        stale: false,
        warnings: [],
      },
    },
    quote: {
      action: "swap",
      marketId: "bitflow.sbtc-usdcx",
      network: "mainnet",
      input: [{ asset: SBTC, quantity: "100000000" }],
      expectedOutput: [{ asset: USDCX, quantity: "99500000000" }],
      fees: [],
      snapshots: [`router:${BITFLOW_ROUTER}`, `pool:${BITFLOW_POOL}`, "minOut:99002500000"],
      executable: true,
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "bitflow-swap@0.1.0",
      minimumOutput: { asset: USDCX, quantity: "99002500000" },
    },
    plan: {
      network: "mainnet",
      registryVersion: REGISTRY_VERSION,
      adapterVersion: "bitflow-swap@0.1.0",
      steps: [
        {
          id: "swap-x-for-y-simple-range-multi",
          dependsOn: [],
          expectedAssetEffects: [{ asset: USDCX, quantity: "99500000000" }],
          payload: {
            kind: "stacks_contract_call",
            contractId: BITFLOW_ROUTER,
            functionName: "swap-x-for-y-simple-range-multi",
            functionArgs: [
              { type: "principal", value: BITFLOW_POOL },
              { type: "principal", value: SBTC_TOKEN },
              { type: "principal", value: USDCX_CONTRACT },
              { type: "uint", value: "100000000" },
              { type: "uint", value: "99002500000" },
              { type: "uint", value: "8" },
              { type: "none" },
            ] satisfies readonly ClarityValue[],
            postConditions: [
              { principal: OWNER, mode: "send_lte", amount: { asset: SBTC, quantity: "100000000" } },
              { principal: OWNER, mode: "receive_gte", amount: { asset: USDCX, quantity: "99002500000" } },
            ],
            postConditionMode: "deny",
            network: "mainnet",
          },
        },
      ],
    },
    // The router serves every pool, so which assets a captured swap moved depends on whichever
    // trade was most recent. What is pinned is the rule: on an x-for-y swap the caller parts with
    // x-token and receives y-token, and the received side is read from the delta rather than from
    // the amount requested.
    events: eventCase({
      protocol: "bitflow",
      action: "swap-x-for-y",
      id: "bitflow-1",
      kind: "bitflow_swap",
      ownerField: "caller",
      effects: [
        { direction: "out", asset: { fromField: "x-token" }, field: "x-amount" },
        { direction: "in", asset: { fromField: "y-token" }, field: "dy" },
      ],
    }),
    reconciliation: { expected: "99002500000", observed: "99002500000", mismatchedObserved: "99002499999" },
  },
] as const;

export function certifyBuiltinAdapters() {
  return ADAPTER_CERTIFICATION_FIXTURES.map(assertAdapterCertified);
}
