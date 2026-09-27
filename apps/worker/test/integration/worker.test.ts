import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { connect, MIGRATIONS_DIR, migrate, type Sql } from "@stacks-capital/database";
import { seedFixtures } from "@stacks-capital/database/fixtures";
import type { Hiro } from "../../src/hiro.ts";
import { tick } from "../../src/tick.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const VAULT = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc";
const DIA = "SP1G48FZ4Y7JY8G2Z0N51QTCYGBQ6F4J43J77BQC0.dia-oracle";
const FEEDS = ["BTC/USD", "USDC/USD"];

// Recorded mainnet values (see hiro.test.ts).
const HEX = {
  total: "0x070100000000000000000000000f5fd643d9",
  available: "0x0100000000000000000000000daa6428a4",
  cap: "0x07010000000000000000000000746a528800",
  rate: "0x070100000000000000000000000000000082",
  pause:
    "0x070c00000006066163637275650406626f72726f7704076465706f7369740409666c6173686c6f616e040672656465656d0405726570617904",
  btc: "0x070c000000020974696d657374616d70010000000000000000000001a0b0e88ccf0576616c7565010000000000000000000006f65088415c",
  zero: "0x070c000000020974696d657374616d7001000000000000000000000000000000000576616c75650100000000000000000000000000000000",
  shares: "0x070100000000000000000000000005f5e100",
  assets: "0x070100000000000000000000000005f6b79a",
  points: "0x070b0000000201000000000000000000000000000000820100000000000000000000000000000082",
  updated: "0x07010000000000000000000000006aacee0c",
  event:
    "0x0c0000000306616374696f6e0d000000076465706f7369740663616c6c657206165423cdfe275d8bb19862b0cf342c616a7a18c8420b76302d382d6d61726b657404646174610c0000000506616d6f756e740100000000000000000000000000001962066173736574730100000000000000000000000f5fc768c8096465706f7369746f7206165423cdfe275d8bb19862b0cf342c616a7a18c8420b76302d382d6d61726b657409726563697069656e740516756f6730289f363631aa3c732974504560192bfa0d7368617265732d6d696e746564010000000000000000000000000000195e",
};

type FakeBlock = { height: number; hash: string; parentHash: string };
type FakeEvent = { txId: string; eventIndex: number; payloadHex: string; blockHeight: number; canonical: boolean };

// A chain the test controls, so reorgs and provider failures are reproducible.
function fakeChain() {
  const state = {
    blocks: [] as FakeBlock[],
    events: new Map<string, FakeEvent[]>(),
    available: HEX.available,
    failVaultReads: false,
  };

  const grow = (count: number, prefix = "b") => {
    for (let index = 0; index < count; index += 1) {
      const last = state.blocks.at(-1);
      const height = (last?.height ?? 99) + 1;
      state.blocks.push({ height, hash: `0x${prefix}${height}`, parentHash: last?.hash ?? "0xgenesis" });
    }
  };

  const hiro: Hiro = {
    async latestBlock() {
      const tip = state.blocks.at(-1);
      if (tip === undefined) throw new Error("empty chain");
      return { ...tip, blockTime: "2026-09-17T12:00:00.000Z" };
    },
    async blockAt(height: number) {
      const block = state.blocks.find((candidate) => candidate.height === height);
      if (block === undefined) throw new Error(`no block at ${height}`);
      return { ...block, blockTime: "2026-09-17T12:00:00.000Z" };
    },
    async contractEvents(contractId: string) {
      return (state.events.get(contractId) ?? []).map((event) => ({
        txId: event.txId,
        eventIndex: event.eventIndex,
        payloadHex: event.payloadHex,
        contractId,
      }));
    },
    async transaction(txId: string) {
      for (const events of state.events.values()) {
        const event = events.find((candidate) => candidate.txId === txId);
        if (event === undefined) continue;
        const block = state.blocks.find((candidate) => candidate.height === event.blockHeight);
        if (block === undefined) throw new Error(`no block for ${txId}`);
        return { status: "success", blockHeight: block.height, blockHash: block.hash, canonical: event.canonical };
      }
      throw new Error(`no transaction ${txId}`);
    },
    async callRead(contractId: string, fn: string, args: string[]) {
      if (contractId === DIA) return args[0]?.includes("425443") === true ? HEX.btc : HEX.zero;
      if (contractId !== VAULT) throw new Error(`no read for ${contractId}`);
      if (state.failVaultReads) throw new Error("HTTP 503");
      const byFunction: Record<string, string> = {
        "get-balance": HEX.shares,
        "convert-to-assets": HEX.assets,
        "get-points-rate": HEX.points,
        "get-last-update": HEX.updated,
        "get-total-assets": HEX.total,
        "get-available-assets": state.available,
        "get-cap-supply": HEX.cap,
        "get-interest-rate": HEX.rate,
        "get-pause-states": HEX.pause,
      };
      const hex = byFunction[fn];
      if (hex === undefined) throw new Error(`no read for ${fn}`);
      return hex;
    },
  };

  return { state, grow, hiro };
}

describe("worker", { skip: DATABASE_URL === "" ? "DATABASE_URL is not set" : false }, () => {
  const admin = connect(DATABASE_URL);
  const schema = `test_${randomBytes(6).toString("hex")}`;
  let sql: Sql;
  const chain = fakeChain();
  // The fixtures seed three blocks and a checkpoint, so the fake chain continues from the seeded tip.
  let base = 0;
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 17, 20, minutes, 0));
  const run = (minutes: number) =>
    tick({ sql, hiro: chain.hiro, network: "mainnet", at: at(minutes), priceFeeds: FEEDS });

  before(async () => {
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    sql = connect(DATABASE_URL, schema);
    await migrate(sql, MIGRATIONS_DIR);
    await seedFixtures(sql);
    const [checkpoint] = await sql<{ height: number; hash: string }[]>`
      SELECT height::int, hash FROM ingestion_checkpoints WHERE chain = 'stacks' AND network = 'mainnet'
    `;
    assert.ok(checkpoint !== undefined);
    base = checkpoint.height;
    chain.state.blocks = [{ height: base, hash: checkpoint.hash, parentHash: "0xseeded" }];
    chain.grow(2);
  });

  after(async () => {
    await sql.end();
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  const count = async (table: string, where = "true") => {
    const [row] = await sql.unsafe<{ count: string }[]>(`SELECT count(*) AS count FROM ${table} WHERE ${where}`);
    return Number(row?.count);
  };
  const checkpoint = async () => {
    const [row] = await sql<{ height: number; hash: string }[]>`
      SELECT height::int, hash FROM ingestion_checkpoints WHERE chain = 'stacks' AND network = 'mainnet'
    `;
    return row;
  };

  it("follows the chain forward from the stored checkpoint", async () => {
    const summary = await run(0);
    assert.equal(summary.blocks, 2);
    assert.equal(summary.reorg, null);
    assert.equal(summary.tipHeight, base + 2);
    assert.deepEqual(await checkpoint(), { height: base + 2, hash: `0xb${base + 2}` });
  });

  it("projects a vault market from its reads and everything else as unknown", async () => {
    const [vault] = await sql<
      {
        availableLiquidity: string | null;
        capacity: string | null;
        supplyRate: string | null;
        rateScale: number | null;
        paused: boolean;
        stale: boolean;
        blockHeight: number;
      }[]
    >`
      SELECT available_liquidity::text AS "availableLiquidity", capacity::text AS capacity,
             supply_rate::text AS "supplyRate", rate_scale::int AS "rateScale", paused, stale,
             block_height::int AS "blockHeight"
      FROM market_snapshots WHERE market_id = 'zest.sbtc.vault' AND source = 'hiro-read' ORDER BY id DESC LIMIT 1
    `;
    assert.deepEqual(vault, {
      availableLiquidity: "58693265572",
      capacity: "500000000000",
      supplyRate: "130",
      rateScale: 4,
      paused: false,
      stale: false,
      blockHeight: base + 2,
    });

    const unknown = await sql<{ marketId: string; warnings: string[] }[]>`
      SELECT market_id AS "marketId", warnings FROM market_snapshots
      WHERE source = 'hiro-read' AND available_liquidity IS NULL ORDER BY market_id
    `;
    assert.deepEqual(
      unknown.map((row) => row.marketId),
      ["bitflow.sbtc-usdcx", "granite.sbtc.isolated", "sbtc.deposit", "sbtc.withdraw"],
    );
    assert.ok(unknown.every((row) => row.warnings.length > 0));
  });

  it("stores a price with its publication time and an empty feed as unknown", async () => {
    const rows = await sql<{ feedKey: string; price: string | null; stale: boolean; warnings: string[] }[]>`
      SELECT feed_key AS "feedKey", price::text AS price, stale, warnings FROM price_snapshots ORDER BY feed_key
    `;
    assert.deepEqual(
      rows.map((row) => [row.feedKey, row.price, row.stale]),
      [
        ["BTC/USD", "7654982828380", false],
        ["USDC/USD", null, true],
      ],
    );
    assert.deepEqual(rows[1]?.warnings, ["USDC/USD has no price in dia-oracle"]);
  });

  it("ingests contract logs as raw events and canonical activities, once", async () => {
    chain.state.events.set(VAULT, [
      { txId: "0xtx1", eventIndex: 4, payloadHex: HEX.event, blockHeight: base + 2, canonical: true },
    ]);
    const first = await run(1);
    assert.deepEqual([first.events, first.activities], [1, 1]);
    // The Zest adapter claims the log and names it, so the kind is the adapter's, not a generic
    // `protocol.action` built from whatever string happened to be in the payload.
    const [activity] = await sql<{ kind: string; canonical: boolean; owner: string | null }[]>`
      SELECT kind, canonical, owner FROM canonical_activities WHERE id = 'act_0xtx1:4'
    `;
    assert.deepEqual(activity, {
      kind: "zest_deposit",
      canonical: true,
      owner: "SP1TPYSSG52FKCDHHN8Y76ABMA12P069BZBFAYEAF",
    });

    // The amounts the log recorded are stored with it. Without these there is nothing to reconcile
    // a workflow against, which is what left every action on "waiting" (pilot blocker B1).
    const effects = await sql<{ direction: string; assetId: string; quantity: string }[]>`
      SELECT direction, asset_id AS "assetId", quantity::text AS quantity
      FROM activity_effects WHERE activity_id = 'act_0xtx1:4' ORDER BY ordinal
    `;
    assert.equal(effects.length, 2, "a deposit pays sBTC in and mints shares");
    assert.deepEqual(
      effects.map((row) => [row.direction, row.quantity]),
      [
        ["out", "6498"],
        ["in", "6494"],
      ],
    );

    const before = await count("raw_events");
    const second = await run(2);
    assert.deepEqual([second.events, second.activities], [0, 0]);
    assert.equal(await count("raw_events"), before);
  });

  it("reconciles a fresh read against the stored projection", async () => {
    const matched = await run(3);
    assert.equal(matched.reconciliation.match, 1);
    assert.equal(matched.reconciliation.unavailable, 4);

    chain.state.available = "0x0100000000000000000000000000000001";
    const changed = await run(4);
    assert.equal(changed.reconciliation.mismatch, 1);
    const [mismatch] = await sql<{ detail: string; projected: unknown; observed: unknown }[]>`
      SELECT detail, projected, observed FROM reconciliation_runs WHERE status = 'mismatch' ORDER BY id DESC LIMIT 1
    `;
    assert.match(mismatch?.detail ?? "", /projected 58693265572\/500000000000, read 1\/500000000000/);
    assert.notEqual(mismatch?.projected, null);
    assert.notEqual(mismatch?.observed, null);
    chain.state.available = HEX.available;
  });

  it("keeps a failed read out of the projection instead of writing zero", async () => {
    chain.state.failVaultReads = true;
    await run(5);
    const [row] = await sql<{ availableLiquidity: string | null; stale: boolean; warnings: string[] }[]>`
      SELECT available_liquidity::text AS "availableLiquidity", stale, warnings FROM market_snapshots
      WHERE market_id = 'zest.sbtc.vault' ORDER BY id DESC LIMIT 1
    `;
    assert.equal(row?.availableLiquidity, null);
    assert.equal(row?.stale, true);
    assert.match(row?.warnings[0] ?? "", /read failed: HTTP 503/);
    chain.state.failVaultReads = false;
  });

  it("projects the vault position for a known owner in underlying units", async () => {
    await run(20);
    const rows = await sql<
      { marketId: string; kind: string; assetId: string; quantity: string | null; warnings: string[] }[]
    >`
      SELECT DISTINCT ON (market_id)
             market_id AS "marketId", kind, asset_id AS "assetId", quantity::text AS quantity, warnings
      FROM position_snapshots WHERE source = 'hiro-read' ORDER BY market_id, id DESC
    `;
    // The newest row per market: an earlier test deliberately writes unknown positions from a
    // failed read, and picking any row rather than the latest made this depend on insert order.
    const vault = rows.find((row) => row.marketId === "zest.sbtc.vault");
    // 1.0 share is worth 1.00054938 sBTC, and the position is stored in sBTC, not in shares.
    assert.equal(vault?.quantity, "100054938");
    assert.match(vault?.assetId ?? "", /sbtc-token$/);
    assert.deepEqual(vault?.warnings, []);

    // Markets with no per address read are unknown, never zero.
    const unknown = rows.filter((row) => row.marketId !== "zest.sbtc.vault");
    assert.ok(unknown.length > 0);
    assert.ok(unknown.every((row) => row.quantity === null && row.warnings.length > 0));
  });

  it("projects the reward rate with the time the vault last updated it", async () => {
    const [reward] = await sql<{ rate: string; rateScale: number; updatedAt: Date; stale: boolean }[]>`
      SELECT rate::text AS rate, rate_scale::int AS "rateScale", updated_at AS "updatedAt", stale
      FROM reward_snapshots WHERE market_id = 'zest.sbtc.vault' ORDER BY id DESC LIMIT 1
    `;
    assert.equal(reward?.rate, "130");
    assert.equal(reward?.rateScale, 4);
    assert.equal(reward?.updatedAt.toISOString(), "2026-09-18T07:53:48.000Z");
  });

  it("rewinds a reorg without deleting evidence", async () => {
    chain.grow(2);
    assert.equal((await run(6)).blocks, 2);

    const before = { blocks: await count("chain_blocks"), events: await count("raw_events") };
    // The two newest blocks are replaced by another fork, so the common ancestor is the block below them.
    chain.state.blocks = chain.state.blocks.filter((block) => block.height <= base + 2);
    chain.grow(2, "f");

    const summary = await run(7);
    assert.deepEqual(summary.reorg, { ancestorHash: `0xb${base + 2}`, blocks: 2, events: 0, activities: 0 });
    assert.deepEqual(await checkpoint(), { height: base + 2, hash: `0xb${base + 2}` });
    assert.equal(await count("chain_blocks"), before.blocks);
    assert.equal(await count("raw_events"), before.events);
    assert.equal(await count("chain_blocks", "NOT canonical"), 2);

    // The next tick follows the new fork from the ancestor.
    assert.equal((await run(8)).blocks, 2);
    assert.equal(await count("chain_blocks", `canonical AND height > ${base + 2}`), 2);
  });

  it("marks the events of an orphaned block noncanonical", async () => {
    chain.state.events.set(VAULT, [
      { txId: "0xtx2", eventIndex: 1, payloadHex: HEX.event, blockHeight: base + 4, canonical: true },
    ]);
    await run(9);
    assert.equal(await count("raw_events", "canonical AND id = '0xtx2:1'"), 1);

    const before = await count("raw_events");
    chain.state.blocks = chain.state.blocks.filter((block) => block.height <= base + 3);
    chain.grow(2, "g");
    await run(10);

    assert.equal(await count("raw_events", "NOT canonical"), 1);
    assert.equal(await count("canonical_activities", "NOT canonical"), 1);
    assert.equal(await count("raw_events"), before);
  });

  it("skips a transaction the chain no longer holds", async () => {
    chain.state.events.set(VAULT, [
      { txId: "0xtx3", eventIndex: 1, payloadHex: HEX.event, blockHeight: base + 5, canonical: false },
    ]);
    const summary = await run(11);
    assert.equal(summary.events, 0);
    assert.equal(await count("raw_events", "id = '0xtx3:1'"), 0);
  });
});

describe("worker bootstrap", { skip: DATABASE_URL === "" ? "DATABASE_URL is not set" : false }, () => {
  const admin = connect(DATABASE_URL);
  const schema = `test_${randomBytes(6).toString("hex")}`;
  let sql: Sql;
  const chain = fakeChain();

  before(async () => {
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    sql = connect(DATABASE_URL, schema);
    await migrate(sql, MIGRATIONS_DIR);
    chain.grow(3);
  });

  after(async () => {
    await sql.end();
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  it("starts at the chain tip when there is no checkpoint", async () => {
    const summary = await tick({
      sql,
      hiro: chain.hiro,
      network: "mainnet",
      at: new Date(Date.UTC(2026, 8, 17, 20, 0, 0)),
      priceFeeds: FEEDS,
    });
    assert.deepEqual([summary.blocks, summary.tipHeight], [1, 102]);
    const [checkpoint] = await sql<{ height: number; hash: string }[]>`
      SELECT height::int, hash FROM ingestion_checkpoints
    `;
    assert.deepEqual(checkpoint, { height: 102, hash: "0xb102" });
    const [blocks] = await sql<{ count: string }[]>`SELECT count(*) AS count FROM chain_blocks`;
    assert.equal(Number(blocks?.count), 1);
  });
});
