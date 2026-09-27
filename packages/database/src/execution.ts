import type { Plan, Quote, Transition, Workflow, WorkflowState } from "@stacks-capital/core";
import { toJson } from "./json.ts";
import type postgres from "postgres";
import type { Sql } from "./lib.ts";
import type { NetworkName } from "./registry.ts";

// A transaction and the pool accept the same tagged queries, but postgres.js types them separately.
type Queryable = Sql | postgres.TransactionSql;

export type StoredQuote = { quote: Quote; plan: Plan };

export async function insertQuote(sql: Sql, quote: Quote, createdAt: Date): Promise<void> {
  await sql`
    INSERT INTO quotes (id, network, market_id, action, input, expected_output, minimum_output, fees, snapshots,
                        warnings, executable, registry_version, adapter_version, expires_at, created_at)
    VALUES (${quote.id}, ${quote.network}, ${quote.marketId}, ${quote.action}, ${sql.json(toJson(quote.input))},
            ${sql.json(toJson(quote.expectedOutput))},
            ${quote.minimumOutput === undefined ? null : sql.json(toJson(quote.minimumOutput))},
            ${sql.json(toJson(quote.fees))}, ${sql.array(quote.snapshots)}, ${sql.array(quote.warnings)},
            ${quote.executable}, ${quote.registryVersion}, ${quote.adapterVersion}, ${quote.expiresAt}, ${createdAt})
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function insertPlan(sql: Sql, plan: Plan, createdAt: Date): Promise<void> {
  await sql`
    INSERT INTO plans (id, quote_id, network, registry_version, adapter_version, steps, review_summary, expires_at,
                       created_at)
    VALUES (${plan.id}, ${plan.quoteId}, ${plan.network}, ${plan.registryVersion}, ${plan.adapterVersion},
            ${sql.json(toJson(plan.steps))}, ${plan.reviewSummary}, ${plan.expiresAt}, ${createdAt})
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function findStoredQuote(
  sql: Sql,
  input: { quoteId: string; network: NetworkName },
): Promise<StoredQuote | null> {
  const [row] = await sql<{ quote: Quote; plan: Plan | null }[]>`
    SELECT
      json_build_object(
        'id', q.id, 'network', q.network, 'marketId', q.market_id, 'action', q.action, 'input', q.input,
        'expectedOutput', q.expected_output, 'minimumOutput', q.minimum_output, 'fees', q.fees,
        'snapshots', q.snapshots, 'warnings', q.warnings, 'executable', q.executable,
        'registryVersion', q.registry_version, 'adapterVersion', q.adapter_version,
        'expiresAt', to_char(q.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) AS quote,
      CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
        'id', p.id, 'quoteId', p.quote_id, 'network', p.network, 'registryVersion', p.registry_version,
        'adapterVersion', p.adapter_version, 'steps', p.steps, 'reviewSummary', p.review_summary,
        'expiresAt', to_char(p.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) END AS plan
    FROM quotes q
    LEFT JOIN plans p ON p.quote_id = q.id
    WHERE q.id = ${input.quoteId} AND q.network = ${input.network}
  `;
  if (row === undefined || row.plan === null) return null;
  return { quote: row.quote, plan: row.plan };
}

export type WorkflowInsert = {
  workflow: Workflow;
  appId: string;
  ownerAddress: string;
  plan: Plan;
  at: Date;
};

/** Returns the existing workflow id when the idempotency key was already used, so a retry never duplicates one. */
export async function createWorkflowRow(sql: Sql, input: WorkflowInsert): Promise<{ id: string; created: boolean }> {
  return sql.begin(async (tx) => {
    const [existing] = await tx<{ id: string }[]>`
      SELECT id FROM workflows WHERE idempotency_key = ${input.workflow.idempotencyKey}
    `;
    if (existing !== undefined) return { id: existing.id, created: false };

    const workflow = input.workflow;
    await tx`
      INSERT INTO workflows (id, network, idempotency_key, app_id, owner_address, quote_id, plan_id, state,
                             next_action, created_at, updated_at)
      VALUES (${workflow.id}, ${workflow.network}, ${workflow.idempotencyKey}, ${input.appId}, ${input.ownerAddress},
              ${workflow.quoteId ?? null}, ${workflow.planId ?? null}, ${workflow.state}, ${workflow.nextAction},
              ${input.at}, ${input.at})
    `;
    for (const [ordinal, step] of input.plan.steps.entries()) {
      await tx`
        INSERT INTO workflow_steps (id, workflow_id, ordinal, kind, depends_on)
        VALUES (${stepKey(workflow.id, step.id)}, ${workflow.id}, ${ordinal}, ${step.payload.kind},
                ${sql.array(step.dependsOn.map((id) => stepKey(workflow.id, id)))})
      `;
    }
    for (const [index, move] of workflow.transitions.entries()) {
      await insertTransition(tx, workflow.id, move, index + 1);
    }
    return { id: workflow.id, created: true };
  });
}

export function stepKey(workflowId: string, stepId: string): string {
  return `${workflowId}:${stepId}`;
}

async function insertTransition(sql: Queryable, workflowId: string, move: Transition, sequence: number): Promise<void> {
  await sql`
    INSERT INTO state_transitions (workflow_id, sequence, from_state, to_state, reason, actor, evidence, at)
    VALUES (${workflowId}, ${sequence}, ${move.from}, ${move.to}, ${move.reason}, ${move.actor},
            ${move.evidence}, ${move.at})
    ON CONFLICT (workflow_id, sequence) DO NOTHING
  `;
}

export type AttemptInsert = {
  workflowId: string;
  stepId: string;
  network: NetworkName;
  chain: "bitcoin" | "stacks";
  outcome: "BROADCAST" | "SIGNED" | "UNKNOWN";
  txid: string | null;
  evidence: string;
  at: Date;
};

/** Records the wallet's answer and moves the workflow, both or neither. */
export async function recordAttempt(
  sql: Sql,
  input: { attempt: AttemptInsert; workflow: Workflow; moves: Transition[] },
): Promise<void> {
  await sql.begin(async (tx) => {
    const attempt = input.attempt;
    await tx`
      INSERT INTO transaction_attempts (workflow_id, step_id, chain, network, outcome, txid, evidence, recorded_at)
      VALUES (${attempt.workflowId}, ${stepKey(attempt.workflowId, attempt.stepId)}, ${attempt.chain},
              ${attempt.network}, ${attempt.outcome}, ${attempt.txid}, ${attempt.evidence}, ${attempt.at})
      ON CONFLICT DO NOTHING
    `;
    // Transitions are append only, so each one keeps the sequence it already had in the workflow.
    const offset = input.workflow.transitions.length - input.moves.length;
    for (const [index, move] of input.moves.entries()) {
      await insertTransition(tx, input.workflow.id, move, offset + index + 1);
    }
    await tx`
      UPDATE workflows
      SET state = ${input.workflow.state}, next_action = ${input.workflow.nextAction},
          updated_at = ${attempt.at}
      WHERE id = ${input.workflow.id}
    `;
  });
}

export async function findAttempt(
  sql: Sql,
  input: { workflowId: string; stepId: string },
): Promise<{ outcome: string; txid: string | null } | null> {
  const [row] = await sql<{ outcome: string; txid: string | null }[]>`
    SELECT outcome, txid FROM transaction_attempts
    WHERE workflow_id = ${input.workflowId} AND step_id = ${stepKey(input.workflowId, input.stepId)}
    ORDER BY id DESC LIMIT 1
  `;
  return row ?? null;
}

/**
 * A workflow that broadcast a transaction and is waiting on chain evidence, with the transaction id
 * the worker needs in order to look it up. `findAttempt` only searches the other way, by workflow
 * and step, which is why nothing ever read a confirmation back to its workflow (pilot blocker B1).
 */
export type AwaitingConfirmation = {
  workflowId: string;
  network: NetworkName;
  state: WorkflowState;
  stepId: string;
  txid: string;
  /** How many transitions the workflow already has, so appended ones keep the sequence. */
  transitionCount: number;
  /** True when no later step is waiting, so a confirmed step ends the signing sequence. */
  isFinalStep: boolean;
};

export async function listWorkflowsAwaitingConfirmation(
  sql: Sql,
  input: { network: NetworkName; limit: number },
): Promise<AwaitingConfirmation[]> {
  return sql<AwaitingConfirmation[]>`
    SELECT w.id AS "workflowId",
           w.network,
           w.state,
           substr(a.step_id, char_length(w.id) + 2) AS "stepId",
           a.txid,
           (SELECT count(*)::int FROM state_transitions t WHERE t.workflow_id = w.id) AS "transitionCount",
           NOT EXISTS (
             SELECT 1 FROM workflow_steps later
             WHERE later.workflow_id = w.id AND later.ordinal > s.ordinal
           ) AS "isFinalStep"
    FROM workflows w
    JOIN LATERAL (
      SELECT step_id, txid FROM transaction_attempts
      WHERE workflow_id = w.id AND outcome = 'BROADCAST' AND txid IS NOT NULL
      ORDER BY id DESC LIMIT 1
    ) a ON true
    JOIN workflow_steps s ON s.workflow_id = w.id AND s.id = a.step_id
    WHERE w.network = ${input.network}
      AND w.state IN ('SUBMITTED', 'CONFIRMING')
    ORDER BY w.updated_at ASC
    LIMIT ${input.limit}
  `;
}

/** The workflow and step that broadcast this transaction, so observed activity can be attributed. */
export async function findWorkflowByTxid(
  sql: Sql,
  input: { network: NetworkName; txid: string },
): Promise<{ workflowId: string; stepId: string } | null> {
  const [row] = await sql<{ workflowId: string; stepId: string }[]>`
    SELECT a.workflow_id AS "workflowId", substr(a.step_id, char_length(a.workflow_id) + 2) AS "stepId"
    FROM transaction_attempts a
    WHERE a.network = ${input.network} AND a.txid = ${input.txid}
    ORDER BY a.id DESC LIMIT 1
  `;
  return row ?? null;
}

/**
 * Appends the transitions a chain reading produced and moves the workflow, both or neither.
 *
 * `expectedTransitionCount` is the count this decision was made against. A concurrent writer that
 * moved the workflow first leaves the count stale, the update matches no row, and this returns
 * false rather than writing a transition that starts from a state the workflow has already left.
 */
export async function advanceWorkflowFromChain(
  sql: Sql,
  input: { workflow: Workflow; moves: Transition[]; expectedTransitionCount: number; at: Date },
): Promise<boolean> {
  if (input.moves.length === 0) return false;
  return sql.begin(async (tx) => {
    const [claimed] = await tx<{ id: string }[]>`
      UPDATE workflows
      SET state = ${input.workflow.state}, next_action = ${input.workflow.nextAction}, updated_at = ${input.at}
      WHERE id = ${input.workflow.id}
        AND (SELECT count(*)::int FROM state_transitions t WHERE t.workflow_id = workflows.id)
            = ${input.expectedTransitionCount}
      RETURNING id
    `;
    if (claimed === undefined) return false;
    for (const [index, move] of input.moves.entries()) {
      await insertTransition(tx, input.workflow.id, move, input.expectedTransitionCount + index + 1);
    }
    return true;
  });
}

export type WorkflowStepKind = "bitcoin_deposit" | "stacks_contract_call";

export async function findWorkflowStepKind(
  sql: Sql,
  input: { workflowId: string; stepId: string },
): Promise<WorkflowStepKind | null> {
  const [row] = await sql<{ kind: WorkflowStepKind }[]>`
    SELECT kind FROM workflow_steps
    WHERE workflow_id = ${input.workflowId} AND id = ${stepKey(input.workflowId, input.stepId)}
  `;
  return row?.kind ?? null;
}

export type AwaitingReconciliation = {
  workflowId: string;
  network: NetworkName;
  state: WorkflowState;
  transitionCount: number;
  owner: string | null;
  /** Amounts as stored: `{asset, quantity}` with the quantity a base-10 integer string. */
  expectedOutput: { asset: string; quantity: string }[];
  minimumOutput: { asset: string; quantity: string } | null;
};

/**
 * Workflows whose final step is confirmed on chain and now needs its effects checked.
 *
 * The quote travels with them because it carries the band the user signed for: the minimum output
 * is the floor they accepted, and the expected output is only what was quoted.
 */
export async function listWorkflowsAwaitingReconciliation(
  sql: Sql,
  input: { network: NetworkName; limit: number },
): Promise<AwaitingReconciliation[]> {
  return sql<AwaitingReconciliation[]>`
    SELECT w.id AS "workflowId",
           w.network,
           w.state,
           (SELECT count(*)::int FROM state_transitions t WHERE t.workflow_id = w.id) AS "transitionCount",
           w.owner_address AS owner,
           q.expected_output AS "expectedOutput",
           q.minimum_output AS "minimumOutput"
    FROM workflows w
    JOIN quotes q ON q.id = w.quote_id AND q.network = w.network
    WHERE w.network = ${input.network}
      AND w.state IN ('STEP_CONFIRMED', 'RECONCILING')
    ORDER BY w.updated_at ASC
    LIMIT ${input.limit}
  `;
}
