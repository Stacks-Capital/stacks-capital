import type { StacksNetwork } from "@stacks-capital/core";
import type { WorkflowSummary } from "@stacks-capital/client";

export type WorkflowGroupKind = "active" | "recovery_needed" | "completed";

export type WorkflowRecoveryType = "reclaim" | "requote" | "retry" | "resume" | "view_proof";

export type RecoveryActionView = {
  type: WorkflowRecoveryType;
  label: string;
  description: string;
  executable: boolean;
  reason?: string;
  targetHref?: string;
};

export type EnrichedWorkflow = WorkflowSummary & {
  group: WorkflowGroupKind;
  actionLabel: string;
  statusLabel: string;
  statusTone: "success" | "warning" | "danger" | "neutral";
  recoveryActions: RecoveryActionView[];
  formattedDate: string;
};

/**
 * Maps raw workflow action string to human-readable label
 */
export function formatWorkflowAction(action: string | null): string {
  if (!action) return "Unknown Operation";
  switch (action) {
    case "sbtc_deposit":
    case "deposit_sbtc":
      return "Bitcoin Deposit (BTC → sBTC)";
    case "sbtc_withdrawal":
    case "sbtc_withdraw":
    case "withdraw_sbtc":
      return "Bitcoin Withdrawal (sBTC → BTC)";
    case "zest_supply":
    case "earn_supply":
      return "Zest Earn Supply";
    case "granite_borrow":
    case "borrow":
      return "Granite Borrow (USDCx)";
    case "granite_repay":
    case "repay":
      return "Granite Repay (USDCx)";
    case "bitflow_swap":
    case "swap":
      return "Bitflow Swap";
    case "stx_staking":
      return "STX Stacking";
    default:
      return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/**
 * Maps workflow status string to display badge and tone
 */
export function formatWorkflowStatus(state: string): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
} {
  const normalized = state.toLowerCase();
  switch (normalized) {
    case "completed":
    case "reconciled":
    case "settled":
      return { label: "Completed & Reconciled", tone: "success" };
    case "user_rejected":
      return { label: "Cancelled", tone: "neutral" };
    case "broadcast_unknown":
      return { label: "Broadcast unknown", tone: "warning" };
    case "submitted":
    case "confirming":
    case "signer_processing":
    case "mint_pending":
    case "request_confirming":
    case "payout_confirming":
      return { label: "In Progress (Confirming)", tone: "neutral" };
    case "delayed":
    case "reclaimable":
      return { label: "Delayed — Reclaim Ready", tone: "warning" };
    case "stale":
    case "expired":
      return { label: "Expired Quote", tone: "warning" };
    case "failed":
    case "reconciliation_failed":
    case "rejected":
      return { label: "Failed / Disputed", tone: "danger" };
    case "draft":
    case "quoted":
    case "planned":
    case "awaiting_signature":
      return { label: "Awaiting Signature", tone: "neutral" };
    default:
      return { label: state, tone: "neutral" };
  }
}

/**
 * Classifies workflow into active, recovery_needed, or completed group
 */
export function classifyWorkflowGroup(state: string): WorkflowGroupKind {
  const normalized = state.toLowerCase();
  if (["completed", "reconciled", "settled", "user_rejected"].includes(normalized)) {
    return "completed";
  }
  if (
    [
      "delayed",
      "reclaimable",
      "stale",
      "expired",
      "failed",
      "reconciliation_failed",
      "rejected",
      "broadcast_unknown",
    ].includes(normalized)
  ) {
    return "recovery_needed";
  }
  return "active";
}

/**
 * Resolves available recovery actions for a given workflow
 */
export function resolveWorkflowRecovery(workflow: WorkflowSummary, network: StacksNetwork): RecoveryActionView[] {
  const normalized = workflow.state.toLowerCase();
  const actions: RecoveryActionView[] = [];

  // Completed or reconciled workflow: offer explorer proof verification
  if (["completed", "reconciled", "settled"].includes(normalized)) {
    actions.push({
      type: "view_proof",
      label: "View Canonical Proof",
      description: "Inspect certified on-chain block events and receipt balance.",
      executable: true,
      targetHref: `https://explorer.hiro.so/txid/${workflow.id}?chain=${network}`,
    });
    return actions;
  }

  // Bitcoin deposit past lock-height: offer atomic refund reclaim
  if (
    (workflow.action === "sbtc_deposit" || workflow.action === "deposit_sbtc") &&
    (normalized === "reclaimable" || normalized === "delayed")
  ) {
    actions.push({
      type: "reclaim",
      label: "Reclaim Bitcoin Deposit",
      description:
        "Deposit lock height reached without canonical Stacks mint. Broadcast Bitcoin reclaim transaction to return satoshis to sender address.",
      executable: true,
    });
  }

  // Stale quote or expired plan: offer fresh requote
  if (normalized === "expired" || normalized === "stale" || workflow.nextAction?.toLowerCase().includes("quote")) {
    actions.push({
      type: "requote",
      label: "Request New Quote",
      description: "Market pricing or slippage tolerance expired. Refresh rates and rebuild transaction plan.",
      executable: true,
    });
  }

  // Failed submission or signer rejection: offer retry
  if (normalized === "failed" || normalized === "reconciliation_failed") {
    actions.push({
      type: "retry",
      label: "Retry Transaction",
      description: "Retry submission with updated gas parameters and nonce verification.",
      executable: true,
    });
  }

  if (normalized === "broadcast_unknown") {
    actions.push({
      type: "retry",
      label: "Check Leather — do not send again",
      description:
        "The wallet never returned a Bitcoin txid. If Leather shows no send, nothing moved — start a new deposit. If Leather shows a txid, notify Emily with that hex.",
      executable: false,
    });
  }

  // Stalled in draft/awaiting signature: offer resume
  if (["draft", "quoted", "planned", "awaiting_signature"].includes(normalized)) {
    actions.push({
      type: "resume",
      label: "Resume Signing",
      description: "Continue the pending workflow and request wallet signature.",
      executable: true,
    });
  }

  return actions;
}

/**
 * Enriches a list of workflow summaries with grouping, metadata, and recovery actions
 */
export function enrichWorkflows(items: WorkflowSummary[], network: StacksNetwork): EnrichedWorkflow[] {
  return items.map((wf) => {
    const group = classifyWorkflowGroup(wf.state);
    const { label: statusLabel, tone: statusTone } = formatWorkflowStatus(wf.state);
    const recoveryActions = resolveWorkflowRecovery(wf, network);
    const actionLabel = formatWorkflowAction(wf.action);
    const dateObj = new Date(wf.updatedAt || wf.createdAt || Date.now());
    const formattedDate = Number.isNaN(dateObj.getTime())
      ? "Unknown Date"
      : dateObj.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

    return {
      ...wf,
      group,
      actionLabel,
      statusLabel,
      statusTone,
      recoveryActions,
      formattedDate,
    };
  });
}

/**
 * Groups workflows by their lifecycle category
 */
export function groupWorkflows(enriched: EnrichedWorkflow[]): Record<WorkflowGroupKind, EnrichedWorkflow[]> {
  const result: Record<WorkflowGroupKind, EnrichedWorkflow[]> = {
    active: [],
    recovery_needed: [],
    completed: [],
  };

  for (const wf of enriched) {
    result[wf.group].push(wf);
  }

  return result;
}
