import {
  insertMarketSnapshot,
  insertPositionSnapshot,
  insertRewardSnapshot,
  listKnownOwners,
  listMarketAssets,
  recordOpsEvent,
  insertPriceSnapshot,
  latestMarketSnapshot,
  listProjectionTargets,
  type NetworkName,
  recordReconciliation,
  type Sql,
} from "@stacks-capital/database";
import { advanceSubmittedWorkflows, type AdvanceSummary } from "./confirmations.ts";
import { reconcileConfirmedWorkflows, type ReconcileSummary } from "./reconciliation.ts";
import type { Hiro } from "./hiro.ts";
import { ingestBlocks, ingestEvents } from "./ingest.ts";
import { PROJECTION_SOURCE, projectMarket, reconciliation } from "./markets.ts";
import { projectOwner, readRewardRate } from "./owners.ts";
import { rewardSnapshot } from "./positions.ts";
import { readPrices } from "./prices.ts";

export type TickDeps = {
  sql: Sql;
  hiro: Hiro;
  network: NetworkName;
  at: Date;
  maxBlocks?: number;
  priceFeeds?: readonly string[];
};

export type TickSummary = {
  at: string;
  network: NetworkName;
  tipHeight: number;
  blocks: number;
  reorg: { ancestorHash: string; blocks: number; events: number; activities: number } | null;
  events: number;
  activities: number;
  markets: { written: number; stale: number };
  prices: { written: number; unknown: number };
  positions: { owners: number; written: number; unknown: number };
  rewards: { written: number; stale: number };
  reconciliation: { match: number; mismatch: number; unavailable: number };
  workflows: AdvanceSummary;
  reconciled: ReconcileSummary;
};

// One pass of the K05 pipeline: evidence first, then projections, then reconciliation.
export async function tick(deps: TickDeps): Promise<TickSummary> {
  const ingested = await ingestBlocks(deps);
  // How far behind the chain this tick left us. Alerts read this, not the log.
  await recordOpsEvent(deps.sql, {
    kind: "ingestion_tick",
    network: deps.network,
    subject: "stacks",
    value: ingested.checkpoint === null ? null : Math.max(0, ingested.tipHeight - ingested.checkpoint.height),
    at: deps.at,
  });
  const targets = await listProjectionTargets(deps.sql, deps.network);
  const events = await ingestEvents({ ...deps, targets });

  const block =
    ingested.checkpoint === null ? null : { height: ingested.checkpoint.height, hash: ingested.checkpoint.hash };
  const summary: TickSummary = {
    at: deps.at.toISOString(),
    network: deps.network,
    tipHeight: ingested.tipHeight,
    blocks: ingested.blocks,
    reorg: ingested.reorg,
    events: events.events,
    activities: events.activities,
    markets: { written: 0, stale: 0 },
    prices: { written: 0, unknown: 0 },
    positions: { owners: 0, written: 0, unknown: 0 },
    rewards: { written: 0, stale: 0 },
    reconciliation: { match: 0, mismatch: 0, unavailable: 0 },
    workflows: { examined: 0, advanced: 0, unchanged: 0, unreadable: 0 },
    reconciled: { examined: 0, completed: 0, mismatched: 0, waiting: 0 },
  };

  // Straight after ingestion, so confirmation is judged against this tick's checkpoint.
  summary.workflows = await advanceSubmittedWorkflows({
    sql: deps.sql,
    hiro: deps.hiro,
    network: deps.network,
    at: deps.at,
    checkpointHeight: block?.height ?? null,
  });

  // After confirmation and after this tick's events are stored, so the amounts a transaction
  // emitted are already attributed by the time its workflow is judged against them.
  summary.reconciled = await reconcileConfirmedWorkflows({
    sql: deps.sql,
    network: deps.network,
    at: deps.at,
  });

  for (const target of targets) {
    const projected = await latestMarketSnapshot(deps.sql, {
      network: deps.network,
      marketId: target.marketId,
      source: PROJECTION_SOURCE,
    });
    const observed = await projectMarket(deps.hiro, deps.network, target, block, deps.at);
    if (await insertMarketSnapshot(deps.sql, observed)) summary.markets.written += 1;
    if (observed.stale) summary.markets.stale += 1;

    const run = reconciliation(deps.network, target, projected, observed, deps.at);
    await recordReconciliation(deps.sql, run);
    summary.reconciliation[run.status] += 1;
  }

  const marketAssets = await listMarketAssets(deps.sql, deps.network);
  for (const target of targets) {
    const reading = await readRewardRate(deps.hiro, target);
    const row = rewardSnapshot(deps.network, reading, target.marketId, target.adapterVersion, deps.at, block);
    if (await insertRewardSnapshot(deps.sql, row)) summary.rewards.written += 1;
    if (row.stale) summary.rewards.stale += 1;
  }

  // Positions are only projected for addresses the platform already knows, which today means workflow owners.
  for (const owner of await listKnownOwners(deps.sql, deps.network)) {
    summary.positions.owners += 1;
    const projected = await projectOwner(deps.hiro, {
      network: deps.network,
      owner,
      targets,
      markets: marketAssets,
      at: deps.at,
      block,
    });
    for (const row of projected.rows) {
      if (await insertPositionSnapshot(deps.sql, row)) summary.positions.written += 1;
      if (row.quantity === null) summary.positions.unknown += 1;
    }
  }

  const prices = await readPrices(deps.hiro, {
    network: deps.network,
    sender: deps.network === "mainnet" ? "SP000000000000000000002Q6VF78" : "ST000000000000000000002AMW42H",
    at: deps.at,
    ...(deps.priceFeeds ? { feeds: deps.priceFeeds } : {}),
  });
  for (const price of prices) {
    if (await insertPriceSnapshot(deps.sql, price)) summary.prices.written += 1;
    if (price.price === null) summary.prices.unknown += 1;
  }

  return summary;
}
