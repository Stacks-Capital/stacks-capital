import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { connect, MIGRATIONS_DIR, migrate, type Sql } from "@stacks-capital/database";
import { seedFixtures } from "@stacks-capital/database/fixtures";
import { advanceSubmittedWorkflows } from "../../src/confirmations.ts";
import type { Hiro, HiroTransaction } from "../../src/hiro.ts";
import { reconcileConfirmedWorkflows } from "../../src/reconciliation.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

/*
 * Pilot blocker B1, the second half. Confirmation moved a workflow to STEP_CONFIRMED and nothing
 * took it further, so every action sat on "waiting" forever even after the money arrived.
 *
 * These tests drive the whole path with real SQL: broadcast, confirm from chain evidence, attribute
 * the amounts an event recorded, then judge them against the band the user signed for.
 */

describe("completing a workflow from the amounts its transaction emitted", {
  skip: DATABASE_URL === "" ? "DATABASE_URL is not set" : false,
}, () => {
  const admin = connect(DATABASE_URL);
  const schema = `test_${randomBytes(6).toString("hex")}`;
  let sql: Sql;
  let quoteId = "";
  let planId = "";
  let owner = "";
  let blockHeight = 0;
  let blockHash = "";
  let expected: { asset: string; quantity: string };
  let minimum: { asset: string; quantity: string } | null;
  const at = new Date(Date.UTC(2026, 8, 23, 12, 0, 0));

  before(async () => {
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    sql = connect(DATABASE_URL, schema);
    await migrate(sql, MIGRATIONS_DIR);
    await seedFixtures(sql);

    const [seeded] = await sql<{ quoteId: string; planId: string; owner: string }[]>`
        SELECT quote_id AS "quoteId", plan_id AS "planId", owner_address AS owner FROM workflows LIMIT 1
      `;
    assert.ok(seeded, "the fixtures should seed a workflow to borrow a quote and plan from");
    quoteId = seeded.quoteId;
    planId = seeded.planId;
    owner = seeded.owner;

    const [quote] = await sql<
      { expectedOutput: { asset: string; quantity: string }[]; minimumOutput: typeof minimum }[]
    >`
        SELECT expected_output AS "expectedOutput", minimum_output AS "minimumOutput"
        FROM quotes WHERE id = ${quoteId}
      `;
    assert.ok(quote?.expectedOutput[0], "the seeded quote should state an expected output");
    expected = quote.expectedOutput[0];
    minimum = quote.minimumOutput;

    const [checkpoint] = await sql<{ height: number }[]>`
        SELECT height::int FROM ingestion_checkpoints WHERE chain = 'stacks' AND network = 'mainnet'
      `;
    assert.ok(checkpoint);
    blockHeight = checkpoint.height - 1;
    const [block] = await sql<{ hash: string }[]>`
        SELECT hash FROM chain_blocks
        WHERE chain = 'stacks' AND network = 'mainnet' AND height = ${blockHeight} AND canonical
      `;
    assert.ok(block);
    blockHash = block.hash;
  });

  after(async () => {
    await sql.end();
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  /** A workflow in the state the API leaves behind, then walked to STEP_CONFIRMED for real. */
  async function confirmedWorkflow(): Promise<{ id: string; txid: string }> {
    const id = `wf_${randomBytes(6).toString("hex")}`;
    const txid = `0x${randomBytes(32).toString("hex")}`;
    await sql`
        INSERT INTO workflows (id, network, idempotency_key, app_id, owner_address, quote_id, plan_id,
                               state, next_action, created_at, updated_at)
        VALUES (${id}, 'mainnet', ${`idem_${id}`}, 'app_fixture', ${owner}, ${quoteId}, ${planId},
                'SUBMITTED', 'WAIT', ${at}, ${at})
      `;
    await sql`
        INSERT INTO workflow_steps (id, workflow_id, ordinal, kind, depends_on)
        VALUES (${`${id}:s0`}, ${id}, 0, 'stacks_contract_call', '{}')
      `;
    await sql`
        INSERT INTO transaction_attempts (workflow_id, step_id, chain, network, outcome, txid, evidence, recorded_at)
        VALUES (${id}, ${`${id}:s0`}, 'stacks', 'mainnet', 'BROADCAST', ${txid}, 'wallet response', ${at})
      `;
    const moves = [
      ["DRAFT", "QUOTED"],
      ["QUOTED", "AWAITING_SIGNATURE"],
      ["AWAITING_SIGNATURE", "SUBMITTED"],
    ] as const;
    for (const [index, [from, to]] of moves.entries()) {
      await sql`
          INSERT INTO state_transitions (workflow_id, sequence, from_state, to_state, reason, actor, evidence, at)
          VALUES (${id}, ${index + 1}, ${from}, ${to}, 'test setup', 'test', 'test', ${at})
        `;
    }

    const hiro = {
      async transaction(): Promise<HiroTransaction> {
        return { status: "success", canonical: true, blockHeight, blockHash };
      },
    } as unknown as Hiro;
    await advanceSubmittedWorkflows({ sql, hiro, network: "mainnet", at, checkpointHeight: blockHeight + 1 });
    assert.equal(await stateOf(id), "STEP_CONFIRMED", "setup should leave the workflow confirmed, not completed");
    return { id, txid };
  }

  /** The row ingestion writes once an adapter has read the amounts out of a log. */
  async function attribute(workflowId: string, quantity: string, assetId = expected.asset): Promise<void> {
    const rawId = `evt_${randomBytes(6).toString("hex")}`;
    await sql`
        INSERT INTO raw_events (id, chain, network, block_hash, payload, source, observed_at)
        VALUES (${rawId}, 'stacks', 'mainnet', ${blockHash}, '0x00', 'test', ${at})
      `;
    await sql`
        INSERT INTO canonical_activities (id, raw_event_id, kind, chain, network, block_hash, workflow_id,
                                          owner, adapter_version, calculation_version)
        VALUES (${`act_${rawId}`}, ${rawId}, 'zest_deposit', 'stacks', 'mainnet', ${blockHash}, ${workflowId},
                ${owner}, 'test', 'test')
      `;
    await sql`
        INSERT INTO activity_effects (activity_id, ordinal, direction, asset_id, quantity)
        VALUES (${`act_${rawId}`}, 0, 'in', ${assetId}, ${quantity})
      `;
  }

  const stateOf = async (id: string) => {
    const [row] = await sql<{ state: string }[]>`SELECT state FROM workflows WHERE id = ${id}`;
    return row?.state;
  };

  const movesOf = async (id: string) => {
    const rows = await sql<{ from: string; to: string }[]>`
        SELECT from_state AS "from", to_state AS "to" FROM state_transitions
        WHERE workflow_id = ${id} ORDER BY sequence
      `;
    return rows.map((row) => `${row.from}->${row.to}`);
  };

  const run = () => reconcileConfirmedWorkflows({ sql, network: "mainnet", at });

  it("reaches COMPLETED through RECONCILING once the credited amount is attributed", async () => {
    const { id } = await confirmedWorkflow();
    await attribute(id, expected.quantity);

    const summary = await run();

    // The run sweeps every pending workflow in the schema, so the counts are asserted as "at
    // least this one" and the state of this workflow is what the test really pins.
    assert.ok(summary.completed >= 1, "the run should have completed at least this workflow");
    assert.equal(await stateOf(id), "COMPLETED");
    const moves = await movesOf(id);
    assert.ok(moves.includes("STEP_CONFIRMED->RECONCILING"), `expected reconciliation in ${moves.join(", ")}`);
    assert.ok(moves.includes("RECONCILING->COMPLETED"), `expected completion in ${moves.join(", ")}`);
  });

  it("stays where it is when nothing has been attributed yet", async () => {
    const { id } = await confirmedWorkflow();

    const before = await movesOf(id);
    const summary = await run();

    assert.ok(summary.waiting >= 1);
    assert.equal(await stateOf(id), "STEP_CONFIRMED", "an absent read is not evidence that nothing arrived");
    assert.deepEqual(await movesOf(id), before, "a workflow with no evidence should not move at all");
  });

  it("sends a shortfall below the signed minimum to a human instead of completing it", async () => {
    if (minimum === null) return;
    const { id } = await confirmedWorkflow();
    await attribute(id, (BigInt(minimum.quantity) - 1n).toString(10));

    const summary = await run();

    assert.ok(summary.mismatched >= 1);
    assert.equal(await stateOf(id), "ACTION_REQUIRED");
  });

  it("records what it matched against as evidence on the completing transition", async () => {
    const { id } = await confirmedWorkflow();
    await attribute(id, expected.quantity);
    await run();

    const [row] = await sql<{ evidence: string; actor: string }[]>`
        SELECT evidence, actor FROM state_transitions
        WHERE workflow_id = ${id} AND to_state = 'COMPLETED'
      `;
    assert.match(String(row?.evidence), /received \d+/);
    assert.equal(row?.actor, "worker", "the worker judged this, so the ledger should not credit the adapter");
  });

  it("does not complete twice", async () => {
    const { id } = await confirmedWorkflow();
    await attribute(id, expected.quantity);
    await run();
    const before = await movesOf(id);
    assert.ok(before.includes("RECONCILING->COMPLETED"));

    await run();

    // COMPLETED is not in the set the sweep selects, so a second pass must leave it untouched
    // rather than append another completion to an append-only ledger.
    assert.deepEqual(await movesOf(id), before);
    assert.equal(await stateOf(id), "COMPLETED");
  });
});
