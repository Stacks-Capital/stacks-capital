import { capitalError, type CapitalError, type ErrorCode } from "./errors.ts";
import type { PlanId, QuoteId, StepId, WorkflowId } from "./ids.ts";
import type { StacksNetwork } from "./network.ts";

export type WorkflowState =
  | "DRAFT"
  | "QUOTED"
  | "AWAITING_SIGNATURE"
  | "BROADCAST_UNKNOWN"
  | "SUBMITTED"
  | "CONFIRMING"
  | "STEP_CONFIRMED"
  | "RECONCILING"
  | "ACTION_REQUIRED"
  | "REORGED"
  | "MANUAL_REVIEW"
  | "COMPLETED"
  | "EXPIRED"
  | "USER_REJECTED"
  | "FAILED";

export type NextAction =
  | "SIGN"
  | "REQUOTE"
  | "WAIT"
  | "RETRY_READ"
  | "RECLAIM"
  | "FOLLOW_UP"
  | "CONTACT_SUPPORT"
  | "COMPLETE"
  | "START_NEW";

export type Transition = {
  from: WorkflowState;
  to: WorkflowState;
  reason: string;
  actor: string;
  evidence: string;
  at: string;
};

export type Workflow = {
  id: WorkflowId;
  network: StacksNetwork;
  quoteId?: QuoteId;
  planId?: PlanId;
  stepId?: StepId;
  state: WorkflowState;
  nextAction: NextAction;
  transitions: Transition[];
  idempotencyKey: string;
};

export type ResumeHint = {
  state: WorkflowState;
  nextAction: NextAction;
  /** Reload can continue from this state without starting a new workflow. */
  resumable: boolean;
  canSign: boolean;
  canRetryRead: boolean;
  awaitingConfirmation: boolean;
  awaitingReconciliation: boolean;
  terminal: boolean;
};

export type ReconciliationResult = {
  matched: boolean;
  evidence: string;
};

export type UnknownBroadcastResolution = { kind: "found"; txid: string } | { kind: "absent"; evidence: string };

/** Wait / sign states a reload must be able to resume. */
const RESUMABLE: ReadonlySet<WorkflowState> = new Set([
  "QUOTED",
  "AWAITING_SIGNATURE",
  "BROADCAST_UNKNOWN",
  "SUBMITTED",
  "CONFIRMING",
  "STEP_CONFIRMED",
  "RECONCILING",
  "ACTION_REQUIRED",
  "REORGED",
  "MANUAL_REVIEW",
]);

const TERMINAL: ReadonlySet<WorkflowState> = new Set(["COMPLETED", "EXPIRED", "USER_REJECTED", "FAILED"]);

const ALLOWED: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  DRAFT: ["QUOTED", "EXPIRED", "FAILED"],
  QUOTED: ["AWAITING_SIGNATURE", "EXPIRED", "FAILED"],
  AWAITING_SIGNATURE: ["SUBMITTED", "BROADCAST_UNKNOWN", "USER_REJECTED", "EXPIRED", "FAILED", "ACTION_REQUIRED"],
  // Self-transitions record outage / evidence refresh without enabling another write.
  BROADCAST_UNKNOWN: ["SUBMITTED", "CONFIRMING", "BROADCAST_UNKNOWN", "MANUAL_REVIEW", "FAILED"],
  SUBMITTED: ["CONFIRMING", "BROADCAST_UNKNOWN", "SUBMITTED", "REORGED", "FAILED", "ACTION_REQUIRED"],
  CONFIRMING: ["STEP_CONFIRMED", "REORGED", "BROADCAST_UNKNOWN", "CONFIRMING", "ACTION_REQUIRED", "FAILED"],
  // Completion requires RECONCILING — never jump straight to COMPLETED.
  STEP_CONFIRMED: ["RECONCILING", "AWAITING_SIGNATURE", "REORGED", "ACTION_REQUIRED"],
  RECONCILING: ["COMPLETED", "STEP_CONFIRMED", "REORGED", "ACTION_REQUIRED", "RECONCILING", "FAILED"],
  ACTION_REQUIRED: ["CONFIRMING", "AWAITING_SIGNATURE", "RECONCILING", "MANUAL_REVIEW", "FAILED"],
  REORGED: ["RECONCILING", "CONFIRMING", "MANUAL_REVIEW", "FAILED"],
  MANUAL_REVIEW: ["RECONCILING", "FAILED"],
  COMPLETED: ["REORGED"],
  EXPIRED: [],
  USER_REJECTED: [],
  FAILED: [],
};

export function nextActionFor(state: WorkflowState, evidence?: string): NextAction {
  switch (state) {
    case "DRAFT":
      return "REQUOTE";
    case "QUOTED":
    case "AWAITING_SIGNATURE":
      return "SIGN";
    case "BROADCAST_UNKNOWN":
      return "RETRY_READ";
    case "SUBMITTED":
    case "CONFIRMING":
    case "STEP_CONFIRMED":
    case "RECONCILING":
      return evidence?.startsWith("outage:") ? "RETRY_READ" : "WAIT";
    case "ACTION_REQUIRED":
      if (evidence?.startsWith("partial:")) return "FOLLOW_UP";
      if (evidence?.startsWith("outage:")) return "RETRY_READ";
      if (evidence?.startsWith("mismatch:")) return "CONTACT_SUPPORT";
      return "RECLAIM";
    case "REORGED":
    case "MANUAL_REVIEW":
      return "CONTACT_SUPPORT";
    case "COMPLETED":
      return "COMPLETE";
    case "EXPIRED":
      return "REQUOTE";
    case "USER_REJECTED":
    case "FAILED":
      return "START_NEW";
  }
}

export function canSubmitWrite(state: WorkflowState): boolean {
  return state === "AWAITING_SIGNATURE";
}

export function assertWriteAllowed(workflow: Workflow): void {
  if (!canSubmitWrite(workflow.state)) {
    throw capitalError("PLAN_INVALID", `Cannot submit a write while workflow is ${workflow.state}`);
  }
}

export function isResumableState(state: WorkflowState): boolean {
  return RESUMABLE.has(state);
}

export function isTerminalState(state: WorkflowState): boolean {
  return TERMINAL.has(state);
}

export function resumeHint(workflow: Workflow): ResumeHint {
  const { state, nextAction } = workflow;
  return {
    state,
    nextAction,
    resumable: isResumableState(state),
    canSign: canSubmitWrite(state),
    canRetryRead: nextAction === "RETRY_READ",
    awaitingConfirmation: state === "SUBMITTED" || state === "CONFIRMING",
    awaitingReconciliation: state === "RECONCILING" || state === "STEP_CONFIRMED",
    terminal: isTerminalState(state),
  };
}

export function createWorkflow(input: {
  id: WorkflowId;
  network: StacksNetwork;
  idempotencyKey: string;
  at?: string;
}): Workflow {
  return {
    id: input.id,
    network: input.network,
    state: "DRAFT",
    nextAction: nextActionFor("DRAFT"),
    transitions: [],
    idempotencyKey: input.idempotencyKey,
  };
}

export function transition(
  workflow: Workflow,
  to: WorkflowState,
  input: { reason: string; actor: string; evidence: string; at?: string },
): Workflow {
  const allowed = ALLOWED[workflow.state];
  if (!allowed.includes(to)) {
    throw capitalError("PLAN_INVALID", `Cannot move workflow ${workflow.id} from ${workflow.state} to ${to}`);
  }
  const record: Transition = {
    from: workflow.state,
    to,
    reason: input.reason,
    actor: input.actor,
    evidence: input.evidence,
    at: input.at ?? new Date().toISOString(),
  };
  return {
    ...workflow,
    state: to,
    nextAction: nextActionFor(to, input.evidence),
    transitions: [...workflow.transitions, record],
  };
}

export function recordRejection(workflow: Workflow, evidence = "user rejected in wallet"): Workflow {
  assertWriteAllowed(workflow);
  return transition(workflow, "USER_REJECTED", {
    reason: "User declined the signature request",
    actor: "wallet",
    evidence,
  });
}

export function recordBroadcast(workflow: Workflow, txid: string): Workflow {
  assertWriteAllowed(workflow);
  if (txid.trim().length === 0) {
    throw capitalError("BROADCAST_UNKNOWN", "Broadcast evidence must include a non-empty txid");
  }
  return transition(workflow, "SUBMITTED", {
    reason: "Wallet returned a broadcast txid",
    actor: "wallet",
    evidence: txid,
  });
}

export function recordUnknownBroadcast(workflow: Workflow, evidence: string): Workflow {
  if (workflow.state !== "AWAITING_SIGNATURE" && workflow.state !== "SUBMITTED" && workflow.state !== "CONFIRMING") {
    throw capitalError("PLAN_INVALID", `Cannot record unknown broadcast from ${workflow.state}`);
  }
  return transition(workflow, "BROADCAST_UNKNOWN", {
    reason: "Wallet or broadcast result did not include a txid",
    actor: "wallet",
    evidence,
  });
}

/**
 * Leaves BROADCAST_UNKNOWN only after a read finds the tx or proves it never landed.
 * Never returns to AWAITING_SIGNATURE — that would blindly retry an uncertain write.
 */
export function resolveUnknownBroadcast(workflow: Workflow, resolution: UnknownBroadcastResolution): Workflow {
  if (workflow.state !== "BROADCAST_UNKNOWN") {
    throw capitalError("PLAN_INVALID", `Cannot resolve unknown broadcast from ${workflow.state}`);
  }
  if (resolution.kind === "found") {
    if (resolution.txid.trim().length === 0) {
      throw capitalError("BROADCAST_UNKNOWN", "Found resolution requires a non-empty txid");
    }
    return transition(workflow, "SUBMITTED", {
      reason: "Read recovered a txid after an uncertain wallet answer",
      actor: "worker",
      evidence: resolution.txid,
    });
  }
  return transition(workflow, "MANUAL_REVIEW", {
    reason: "Read could not find a broadcast after an uncertain wallet answer",
    actor: "worker",
    evidence: resolution.evidence,
  });
}

export function beginConfirming(workflow: Workflow, evidence: string): Workflow {
  if (workflow.state !== "SUBMITTED" && workflow.state !== "ACTION_REQUIRED" && workflow.state !== "REORGED") {
    throw capitalError("PLAN_INVALID", `Cannot begin confirming from ${workflow.state}`);
  }
  return transition(workflow, "CONFIRMING", {
    reason: "Waiting for canonical confirmation",
    actor: "worker",
    evidence,
  });
}

export function markStepConfirmed(workflow: Workflow, evidence: string): Workflow {
  if (workflow.state !== "CONFIRMING") {
    throw capitalError("PLAN_INVALID", `Cannot mark a step confirmed from ${workflow.state}`);
  }
  return transition(workflow, "STEP_CONFIRMED", {
    reason: "Plan step confirmed on chain",
    actor: "worker",
    evidence,
  });
}

export function beginReconciling(workflow: Workflow, evidence: string, actor = "adapter"): Workflow {
  if (
    workflow.state !== "STEP_CONFIRMED" &&
    workflow.state !== "REORGED" &&
    workflow.state !== "ACTION_REQUIRED" &&
    workflow.state !== "MANUAL_REVIEW"
  ) {
    throw capitalError("PLAN_INVALID", `Cannot begin reconciliation from ${workflow.state}`);
  }
  return transition(workflow, "RECONCILING", {
    reason: "Begin canonical position reconciliation",
    actor,
    evidence,
  });
}

/**
 * Completion is allowed only after a matched canonical reconciliation.
 *
 * `actor` names what decided. It stays the adapter by default, because the adapter's own
 * reconcile call is what produced the verdict, and becomes the worker when the worker judged the
 * evidence itself.
 */
export function completeFromReconciliation(
  workflow: Workflow,
  result: ReconciliationResult,
  actor = "adapter",
): Workflow {
  let flow = workflow;
  if (flow.state === "STEP_CONFIRMED") {
    flow = beginReconciling(flow, result.evidence, actor);
  }
  if (flow.state !== "RECONCILING") {
    throw capitalError(
      "PLAN_INVALID",
      `Cannot complete workflow ${flow.id} from ${flow.state}; canonical reconciliation is required`,
    );
  }
  if (!result.matched) {
    return transition(flow, "ACTION_REQUIRED", {
      reason: "Canonical position did not match the expected effect",
      actor,
      evidence: `mismatch:${result.evidence}`,
    });
  }
  return transition(flow, "COMPLETED", {
    reason: "Canonical position matched",
    actor,
    evidence: result.evidence,
  });
}

export function recordProviderOutage(workflow: Workflow, evidence: string): Workflow {
  const wait: WorkflowState[] = ["SUBMITTED", "CONFIRMING", "STEP_CONFIRMED", "RECONCILING", "BROADCAST_UNKNOWN"];
  if (!wait.includes(workflow.state)) {
    throw capitalError("PLAN_INVALID", `Cannot record a provider outage from ${workflow.state}`);
  }
  if (canSubmitWrite(workflow.state)) {
    throw capitalError("PLAN_INVALID", "Provider outage must not reopen a write");
  }
  const to: WorkflowState = workflow.state === "STEP_CONFIRMED" ? "RECONCILING" : workflow.state;
  return transition(workflow, to, {
    reason: "Provider outage while waiting on chain evidence",
    actor: "worker",
    evidence: `outage:${evidence}`,
  });
}

export function applyReorgToWorkflow(workflow: Workflow, evidence: string): Workflow {
  if (workflow.state === "EXPIRED" || workflow.state === "USER_REJECTED" || workflow.state === "FAILED") {
    return workflow;
  }
  if (workflow.state === "REORGED") return workflow;
  return transition(workflow, "REORGED", {
    reason: "Canonical chain evidence was rewound",
    actor: "ingestion",
    evidence,
  });
}

/** After a reorg, resume by re-reading positions — never by rewriting. */
export function resumeAfterReorg(workflow: Workflow, evidence: string): Workflow {
  if (workflow.state !== "REORGED") {
    throw capitalError("PLAN_INVALID", `Cannot resume after reorg from ${workflow.state}`);
  }
  return transition(workflow, "RECONCILING", {
    reason: "Re-read canonical positions after a reorg",
    actor: "worker",
    evidence,
  });
}

export function errorFromState(state: WorkflowState): CapitalError | null {
  const codes: Partial<Record<WorkflowState, ErrorCode>> = {
    BROADCAST_UNKNOWN: "BROADCAST_UNKNOWN",
    USER_REJECTED: "USER_REJECTED",
    REORGED: "REORG_DETECTED",
    EXPIRED: "QUOTE_EXPIRED",
  };
  const code = codes[state];
  return code ? capitalError(code, state) : null;
}
