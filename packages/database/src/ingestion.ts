import type { Sql } from "./lib.ts";
import type { NetworkName } from "./registry.ts";

export type ChainName = "bitcoin" | "stacks";

export type BlockRow = {
  chain: ChainName;
  network: NetworkName;
  height: number;
  hash: string;
  parentHash: string;
  source: string;
  observedAt: Date;
};

export type EventRow = { id: string; blockHash: string; payload: string; source: string; observedAt: Date };

export type CheckpointRow = { height: number; hash: string };

export type ActivityEffectRow = {
  direction: "in" | "out";
  /** Formatted asset id, as `formatAssetId` renders it. */
  assetId: string;
  quantity: string;
};

export type ActivityRow = {
  id: string;
  rawEventId: string;
  kind: string;
  chain: ChainName;
  network: NetworkName;
  blockHash: string;
  workflowId: string | null;
  owner?: string | null;
  reference?: string | null;
  /** Empty means the adapter read the event but could not attribute amounts to it. */
  effects?: readonly ActivityEffectRow[];
  adapterVersion: string;
  calculationVersion: string;
};

// Every projection carries where it came from and whether it can be trusted (page 01 data model).
export type Provenance = {
  stale: boolean;
  warnings: string[];
  source: string;
  observedAt: Date;
  blockHeight: number | null;
  blockHash: string | null;
};

export type MarketSnapshotRow = Provenance & {
  network: NetworkName;
  marketId: string;
  supplyRate: string | null;
  borrowRate: string | null;
  rateScale: number | null;
  availableLiquidity: string | null;
  capacity: string | null;
  paused: boolean | null;
  adapterVersion: string;
  calculationVersion: string;
};

export type PriceSnapshotRow = Provenance & {
  network: NetworkName;
  feedKey: string;
  price: string | null;
  priceScale: number;
  publishedAt: Date | null;
};

export type ReconciliationRow = {
  network: NetworkName;
  marketId: string;
  status: "match" | "mismatch" | "unavailable";
  detail: string;
  projected: unknown;
  observed: unknown;
  source: string;
  runAt: Date;
};

export async function readCheckpoint(sql: Sql, chain: ChainName, network: NetworkName): Promise<CheckpointRow | null> {
  const [row] = await sql<CheckpointRow[]>`
    SELECT height::int, hash FROM ingestion_checkpoints WHERE chain = ${chain} AND network = ${network}
  `;
  return row ?? null;
}

export async function findCanonicalBlock(
  sql: Sql,
  input: { chain: ChainName; network: NetworkName; height: number },
): Promise<{ hash: string; parentHash: string } | null> {
  const [row] = await sql<{ hash: string; parentHash: string }[]>`
    SELECT hash, parent_hash AS "parentHash"
    FROM chain_blocks
    WHERE chain = ${input.chain} AND network = ${input.network} AND height = ${input.height} AND canonical
  `;
  return row ?? null;
}

export type ProjectionTarget = {
  marketId: string;
  protocol: string;
  contractId: string;
  role: string;
  revision: string;
  adapterVersion: string;
};

// Markets the worker projects: those with at least one action that is not disabled and a verified deployment.
export async function listProjectionTargets(sql: Sql, network: NetworkName): Promise<ProjectionTarget[]> {
  return sql<ProjectionTarget[]>`
    SELECT DISTINCT ON (m.id)
           m.id AS "marketId", m.protocol_id AS protocol, d.contract_id AS "contractId",
           d.role, d.revision, c.adapter_version AS "adapterVersion"
    FROM markets m
    JOIN capabilities c ON c.network = m.network AND c.market_id = m.id AND c.state <> 'disabled'
    JOIN deployments d ON d.id = c.deployment_id AND d.network = m.network
    WHERE m.network = ${network}
    ORDER BY m.id, c.action
  `;
}

export async function rawEventExists(sql: Sql, id: string): Promise<boolean> {
  const [row] = await sql<{ found: boolean }[]>`SELECT EXISTS (SELECT 1 FROM raw_events WHERE id = ${id}) AS found`;
  return row?.found === true;
}

// Evidence for a block an event points at, without touching the checkpoint.
export async function insertBlock(sql: Sql, block: BlockRow): Promise<boolean> {
  const result = await sql`
    INSERT INTO chain_blocks (chain, network, hash, height, parent_hash, source, observed_at)
    VALUES (${block.chain}, ${block.network}, ${block.hash}, ${block.height}, ${block.parentHash},
            ${block.source}, ${block.observedAt})
    ON CONFLICT (chain, network, hash) DO NOTHING
  `;
  return result.count > 0;
}

export async function insertRawEvent(
  sql: Sql,
  network: NetworkName,
  chain: ChainName,
  event: EventRow,
): Promise<boolean> {
  const result = await sql`
    INSERT INTO raw_events (id, chain, network, block_hash, payload, source, observed_at)
    VALUES (${event.id}, ${chain}, ${network}, ${event.blockHash}, ${event.payload}, ${event.source}, ${event.observedAt})
    ON CONFLICT (id) DO NOTHING
  `;
  return result.count > 0;
}

// Appending a block, its raw events and the checkpoint is one transaction, so a crash never advances past stored evidence.
export async function recordBlock(
  sql: Sql,
  block: BlockRow,
  events: EventRow[],
): Promise<{ block: boolean; events: number }> {
  return sql.begin(async (tx) => {
    const inserted = await tx`
      INSERT INTO chain_blocks (chain, network, hash, height, parent_hash, source, observed_at)
      VALUES (${block.chain}, ${block.network}, ${block.hash}, ${block.height}, ${block.parentHash},
              ${block.source}, ${block.observedAt})
      ON CONFLICT (chain, network, hash) DO NOTHING
    `;
    let stored = 0;
    for (const event of events) {
      const result = await tx`
        INSERT INTO raw_events (id, chain, network, block_hash, payload, source, observed_at)
        VALUES (${event.id}, ${block.chain}, ${block.network}, ${event.blockHash}, ${event.payload},
                ${event.source}, ${event.observedAt})
        ON CONFLICT (id) DO NOTHING
      `;
      stored += result.count;
    }
    await tx`
      INSERT INTO ingestion_checkpoints (chain, network, height, hash, updated_at)
      VALUES (${block.chain}, ${block.network}, ${block.height}, ${block.hash}, ${block.observedAt})
      ON CONFLICT (chain, network) DO UPDATE SET height = EXCLUDED.height, hash = EXCLUDED.hash,
                                                 updated_at = EXCLUDED.updated_at
    `;
    return { block: inserted.count > 0, events: stored };
  });
}

// A reorg never deletes evidence. Blocks above the common ancestor, their events and activities become noncanonical.
export async function markReorg(
  sql: Sql,
  input: { chain: ChainName; network: NetworkName; ancestorHash: string; at: Date },
): Promise<{ blocks: number; events: number; activities: number }> {
  return sql.begin(async (tx) => {
    const [ancestor] = await tx<{ height: number }[]>`
      SELECT height::int FROM chain_blocks
      WHERE chain = ${input.chain} AND network = ${input.network} AND hash = ${input.ancestorHash}
    `;
    if (ancestor === undefined) throw new Error(`Unknown ancestor ${input.ancestorHash}`);

    const orphaned = await tx<{ hash: string }[]>`
      SELECT hash FROM chain_blocks
      WHERE chain = ${input.chain} AND network = ${input.network} AND height > ${ancestor.height} AND canonical
    `;
    await tx`
      UPDATE ingestion_checkpoints SET height = ${ancestor.height}, hash = ${input.ancestorHash}, updated_at = ${input.at}
      WHERE chain = ${input.chain} AND network = ${input.network}
    `;
    const hashes = orphaned.map((row) => row.hash);
    if (hashes.length === 0) return { blocks: 0, events: 0, activities: 0 };

    const activities = await tx`
      UPDATE canonical_activities SET canonical = false
      WHERE chain = ${input.chain} AND network = ${input.network} AND canonical
        AND block_hash = ANY(${sql.array(hashes)})
    `;
    const events = await tx`
      UPDATE raw_events SET canonical = false
      WHERE chain = ${input.chain} AND network = ${input.network} AND canonical
        AND block_hash = ANY(${sql.array(hashes)})
    `;
    const blocks = await tx`
      UPDATE chain_blocks SET canonical = false
      WHERE chain = ${input.chain} AND network = ${input.network} AND hash = ANY(${sql.array(hashes)})
    `;
    return { blocks: blocks.count, events: events.count, activities: activities.count };
  });
}

/**
 * Stores an activity and the amounts it recorded, both or neither.
 *
 * The effects are written in the same transaction as the activity, so an activity can never be
 * read back as having moved nothing when it actually moved something the writer had not got to.
 */
export async function recordActivity(sql: Sql, activity: ActivityRow): Promise<boolean> {
  return sql.begin(async (tx) => {
    const result = await tx`
      INSERT INTO canonical_activities (id, raw_event_id, kind, chain, network, block_hash, workflow_id,
                                        owner, reference, adapter_version, calculation_version)
      VALUES (${activity.id}, ${activity.rawEventId}, ${activity.kind}, ${activity.chain}, ${activity.network},
              ${activity.blockHash}, ${activity.workflowId}, ${activity.owner ?? null},
              ${activity.reference ?? null}, ${activity.adapterVersion}, ${activity.calculationVersion})
      ON CONFLICT (raw_event_id, kind) DO NOTHING
    `;
    if (result.count === 0) return false;

    for (const [ordinal, effect] of (activity.effects ?? []).entries()) {
      await tx`
        INSERT INTO activity_effects (activity_id, ordinal, direction, asset_id, quantity)
        VALUES (${activity.id}, ${ordinal}, ${effect.direction}, ${effect.assetId}, ${effect.quantity})
      `;
    }
    return true;
  });
}

export type StoredEffect = ActivityEffectRow & { kind: string; owner: string | null };

/** Everything a workflow's own transactions recorded moving, newest activity last. */
export async function listWorkflowEffects(
  sql: Sql,
  input: { network: NetworkName; workflowId: string },
): Promise<StoredEffect[]> {
  return sql<StoredEffect[]>`
    SELECT a.kind, a.owner, e.direction, e.asset_id AS "assetId", e.quantity::text AS quantity
    FROM canonical_activities a
    JOIN activity_effects e ON e.activity_id = a.id
    WHERE a.network = ${input.network} AND a.workflow_id = ${input.workflowId} AND a.canonical
    ORDER BY a.id, e.ordinal
  `;
}

export async function insertMarketSnapshot(sql: Sql, row: MarketSnapshotRow): Promise<boolean> {
  const result = await sql`
    INSERT INTO market_snapshots (network, market_id, supply_rate, borrow_rate, rate_scale, available_liquidity,
                                  capacity, paused, stale, warnings, source, observed_at, block_height, block_hash,
                                  adapter_version, calculation_version)
    VALUES (${row.network}, ${row.marketId}, ${row.supplyRate}, ${row.borrowRate}, ${row.rateScale},
            ${row.availableLiquidity}, ${row.capacity}, ${row.paused}, ${row.stale}, ${sql.array(row.warnings)},
            ${row.source}, ${row.observedAt}, ${row.blockHeight}, ${row.blockHash}, ${row.adapterVersion},
            ${row.calculationVersion})
    ON CONFLICT (network, market_id, source, observed_at) DO NOTHING
  `;
  return result.count > 0;
}

export async function insertPriceSnapshot(sql: Sql, row: PriceSnapshotRow): Promise<boolean> {
  const result = await sql`
    INSERT INTO price_snapshots (network, feed_key, price, price_scale, published_at, stale, warnings, source,
                                 observed_at, block_height, block_hash)
    VALUES (${row.network}, ${row.feedKey}, ${row.price}, ${row.priceScale}, ${row.publishedAt}, ${row.stale},
            ${sql.array(row.warnings)}, ${row.source}, ${row.observedAt}, ${row.blockHeight}, ${row.blockHash})
    ON CONFLICT (network, feed_key, source, observed_at) DO NOTHING
  `;
  return result.count > 0;
}

export async function recordReconciliation(sql: Sql, row: ReconciliationRow): Promise<void> {
  await sql`
    INSERT INTO reconciliation_runs (network, market_id, status, detail, projected, observed, source, run_at)
    VALUES (${row.network}, ${row.marketId}, ${row.status}, ${row.detail},
            ${row.projected === null ? null : sql.json(row.projected as never)},
            ${row.observed === null ? null : sql.json(row.observed as never)},
            ${row.source}, ${row.runAt})
  `;
}

export async function latestMarketSnapshot(
  sql: Sql,
  input: { network: NetworkName; marketId: string; source: string },
): Promise<MarketSnapshotRow | null> {
  const [row] = await sql<MarketSnapshotRow[]>`
    SELECT network, market_id AS "marketId", supply_rate::text AS "supplyRate", borrow_rate::text AS "borrowRate",
           rate_scale::int AS "rateScale", available_liquidity::text AS "availableLiquidity", capacity::text AS capacity,
           paused, stale, warnings, source, observed_at AS "observedAt", block_height::int AS "blockHeight",
           block_hash AS "blockHash", adapter_version AS "adapterVersion", calculation_version AS "calculationVersion"
    FROM market_snapshots
    WHERE network = ${input.network} AND market_id = ${input.marketId} AND source = ${input.source}
    ORDER BY observed_at DESC, id DESC
    LIMIT 1
  `;
  return row ?? null;
}

export type CheckpointRecord = {
  chain: ChainName;
  network: NetworkName;
  height: number;
  hash: string;
  updatedAt: Date;
};

export async function listAllCheckpoints(sql: Sql): Promise<CheckpointRecord[]> {
  return sql<CheckpointRecord[]>`
    SELECT chain, network, height::int, hash, updated_at AS "updatedAt"
    FROM ingestion_checkpoints
    ORDER BY chain, network
  `;
}

export async function getMissingSnapshotTargets(sql: Sql, network: NetworkName, source: string): Promise<string[]> {
  const rows = await sql<{ marketId: string }[]>`
    SELECT DISTINCT m.id AS "marketId"
    FROM markets m
    JOIN capabilities c ON c.network = m.network AND c.market_id = m.id AND c.state <> 'disabled'
    LEFT JOIN market_snapshots s ON s.network = m.network AND s.market_id = m.id AND s.source = ${source}
    WHERE m.network = ${network} AND s.id IS NULL
    ORDER BY m.id
  `;
  return rows.map((r) => r.marketId);
}
