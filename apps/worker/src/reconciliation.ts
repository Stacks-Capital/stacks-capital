import { completeFromReconciliation, type ReconciliationResult, type Workflow } from "@stacks-capital/core";
import {
  advanceWorkflowFromChain,
  listWorkflowEffects,
  listWorkflowsAwaitingReconciliation,
  type AwaitingReconciliation,
  type NetworkName,
  type Sql,
  type StoredEffect,
} from "@stacks-capital/database";

/**
 * Moves a confirmed workflow to COMPLETED, or to ACTION_REQUIRED when the chain disagrees.
 *
 * Pilot blocker B1: confirmation stopped at STEP_CONFIRMED because nothing checked what actually
 * moved. This is that check. It judges the amounts a transaction emitted against the band the user
 * signed for, not against the number they were quoted.
 *
 * The band is already in the plan and already enforced on chain. `minimumOutput` is the floor the
 * post conditions bound the transaction to, so landing between that floor and the quote is a
 * normal execution and completes with a note, not a mismatch. Only falling below the floor, or
 * receiving nothing at all, is a real disagreement.
 */

export type ReconciliationDecision = {
  result: ReconciliationResult | null;
  /** Why nothing was decided this tick. Empty when a decision was made. */
  reason: string;
};

function sameAssetId(left: string, right: string): boolean {
  return left === right;
}

export function reconciliationDecision(input: {
  workflow: AwaitingReconciliation;
  effects: readonly StoredEffect[];
}): ReconciliationDecision {
  const expected = input.workflow.expectedOutput[0];
  if (expected === undefined) {
    return { result: null, reason: "quote records no expected output to check against" };
  }

  if (input.effects.length === 0) {
    // Ingestion has attributed no amounts yet. That is not evidence that nothing arrived, so the
    // workflow waits rather than failing the user on a read that has not happened.
    return { result: null, reason: "no attributed effects for this workflow yet" };
  }

  const owner = input.workflow.owner;
  const received = input.effects.filter(
    (effect) =>
      effect.direction === "in" &&
      sameAssetId(effect.assetId, expected.asset) &&
      (owner === null || effect.owner === null || effect.owner === owner),
  );

  if (received.length === 0) {
    return {
      result: { matched: false, evidence: `no ${expected.asset} credited to ${owner ?? "the workflow"}` },
      reason: "",
    };
  }

  const observed = received.reduce((total, effect) => total + BigInt(effect.quantity), 0n);
  const floor = input.workflow.minimumOutput;
  const quoted = BigInt(expected.quantity);

  if (floor !== null && sameAssetId(floor.asset, expected.asset)) {
    const minimum = BigInt(floor.quantity);
    if (observed < minimum) {
      return {
        result: { matched: false, evidence: `received ${observed} below the signed minimum ${minimum}` },
        reason: "",
      };
    }
    const note = observed < quoted ? `, under the ${quoted} quoted` : "";
    return {
      result: { matched: true, evidence: `received ${observed}, at or above the signed minimum ${minimum}${note}` },
      reason: "",
    };
  }

  // No floor on this asset, so the quote is the only reference there is. It is recorded as
  // evidence rather than enforced, because nothing bound the chain to it.
  return {
    result: { matched: true, evidence: `received ${observed} against ${quoted} quoted, with no signed minimum` },
    reason: "",
  };
}

export type ReconcileDeps = {
  sql: Sql;
  network: NetworkName;
  at: Date;
  maxWorkflows?: number;
};

export type ReconcileSummary = {
  examined: number;
  completed: number;
  mismatched: number;
  /** Still waiting on evidence. The workflow keeps its state and is retried next tick. */
  waiting: number;
};

export async function reconcileConfirmedWorkflows(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { examined: 0, completed: 0, mismatched: 0, waiting: 0 };
  const pending = await listWorkflowsAwaitingReconciliation(deps.sql, {
    network: deps.network,
    limit: deps.maxWorkflows ?? 50,
  });

  for (const row of pending) {
    summary.examined += 1;
    const effects = await listWorkflowEffects(deps.sql, { network: deps.network, workflowId: row.workflowId });
    const decision = reconciliationDecision({ workflow: row, effects });

    if (decision.result === null) {
      summary.waiting += 1;
      continue;
    }

    const before: Workflow = {
      id: row.workflowId,
      network: row.network === "mainnet" ? "mainnet" : "testnet",
      state: row.state,
      nextAction: "WAIT",
      transitions: [],
      idempotencyKey: row.workflowId,
    };
    // The worker judged this, not the adapter, so the transitions say so.
    const after = completeFromReconciliation(before, decision.result, "worker");

    const written = await advanceWorkflowFromChain(deps.sql, {
      workflow: after,
      moves: after.transitions,
      expectedTransitionCount: row.transitionCount,
      at: deps.at,
    });
    if (!written) {
      summary.waiting += 1;
      continue;
    }
    if (decision.result.matched) summary.completed += 1;
    else summary.mismatched += 1;
  }

  return summary;
}
