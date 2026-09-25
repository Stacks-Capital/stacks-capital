export type WorkflowArrivalKind = "deposit" | "withdraw" | "stacks" | "unknown";

export type WorkflowArrivalPhase = "not_started" | "in_flight" | "arrived" | "stopped";

export type ArrivalFollowStep = {
  id: string;
  label: string;
  detail: string;
  status: "done" | "current" | "todo";
};

export type WorkflowArrival = {
  kind: WorkflowArrivalKind;
  title: string;
  destination: string;
  typicalWait: string;
  elapsed: string | null;
  remaining: string;
  phase: WorkflowArrivalPhase;
  headline: string;
  stageTitle: string;
  stageIndex: number;
  stageCount: number;
  note: string;
  steps: ArrivalFollowStep[];
};

export function workflowActionTitle(kind: WorkflowArrivalKind): string {
  switch (kind) {
    case "deposit":
      return "BTC → sBTC deposit";
    case "withdraw":
      return "sBTC → BTC withdraw";
    case "stacks":
      return "Stacks transaction";
    default:
      return "Workflow";
  }
}

export function workflowStateLabel(state: string): string {
  switch (state.toUpperCase()) {
    case "DRAFT":
    case "QUOTED":
    case "PLANNED":
    case "AWAITING_SIGNATURE":
      return "Waiting for signature";
    case "SUBMITTED":
      return "Broadcast";
    case "CONFIRMING":
    case "REQUEST_CONFIRMING":
      return "Confirming";
    case "STEP_CONFIRMED":
      return "Step confirmed";
    case "SIGNER_PROCESSING":
      return "Signers working";
    case "MINT_PENDING":
      return "Mint pending";
    case "PAYOUT_CONFIRMING":
      return "Bitcoin payout confirming";
    case "RECONCILING":
      return "Reconciling";
    case "RECONCILED":
    case "COMPLETED":
    case "SETTLED":
      return "Complete";
    case "RECLAIMABLE":
      return "Reclaimable";
    case "BROADCAST_UNKNOWN":
      return "Broadcast unknown";
    case "USER_REJECTED":
      return "Cancelled";
    case "FAILED":
    case "REJECTED":
    case "RECONCILIATION_FAILED":
      return "Needs attention";
    default:
      return state.replace(/_/g, " ");
  }
}

export function workflowArrivalKind(action: string | null | undefined): WorkflowArrivalKind {
  const normalized = (action ?? "").toLowerCase().replace(/-/g, "_");
  if (normalized === "deposit_sbtc" || normalized === "sbtc_deposit") return "deposit";
  if (normalized === "withdraw_sbtc" || normalized === "sbtc_withdrawal" || normalized === "sbtc_withdraw") {
    return "withdraw";
  }
  if (normalized.includes("deposit") && normalized.includes("sbtc")) return "deposit";
  if (normalized.includes("withdraw") && normalized.includes("sbtc")) return "withdraw";
  if (
    normalized.includes("swap") ||
    normalized.includes("earn") ||
    normalized.includes("supply") ||
    normalized.includes("borrow") ||
    normalized.includes("repay") ||
    normalized.includes("stak") ||
    normalized.includes("liquidity")
  ) {
    return "stacks";
  }
  return "unknown";
}

export function destinationChainLabel(kind: WorkflowArrivalKind): string {
  switch (kind) {
    case "deposit":
      return "Stacks (sBTC)";
    case "withdraw":
      return "Bitcoin (BTC)";
    case "stacks":
      return "Stacks";
    default:
      return "destination chain";
  }
}

export function typicalWaitMinutes(kind: WorkflowArrivalKind): number {
  switch (kind) {
    case "deposit":
      return 45;
    case "withdraw":
      return 120;
    case "stacks":
      return 5;
    default:
      return 60;
  }
}

export function typicalWaitLabel(kind: WorkflowArrivalKind): string {
  switch (kind) {
    case "deposit":
      return "15–60 minutes";
    case "withdraw":
      return "1–3 hours";
    case "stacks":
      return "about 1–5 minutes";
    default:
      return "varies by route";
  }
}

export function arrivalPhase(state: string): WorkflowArrivalPhase {
  const normalized = state.toLowerCase();
  if (["completed", "reconciled", "settled"].includes(normalized)) return "arrived";
  if (
    [
      "failed",
      "rejected",
      "user_rejected",
      "reconciliation_failed",
      "reclaimable",
      "expired",
      "stale",
      "signer_rejection_pending",
    ].includes(normalized)
  ) {
    return "stopped";
  }
  if (["draft", "quoted", "planned", "awaiting_signature"].includes(normalized)) return "not_started";
  return "in_flight";
}

export function formatElapsedSince(fromIso: string, nowMs: number): string | null {
  const started = Date.parse(fromIso);
  if (!Number.isFinite(started)) return null;
  const minutes = Math.max(0, Math.floor((nowMs - started) / 60_000));
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} ${hours === 1 ? "hour" : "hours"} ${rem} min`;
}

function followStepStatus(
  currentIndex: number,
  index: number,
  phase: WorkflowArrivalPhase,
): ArrivalFollowStep["status"] {
  if (phase === "arrived") return "done";
  if (phase === "not_started" || phase === "stopped") return "todo";
  if (index < currentIndex) return "done";
  if (index === currentIndex) return "current";
  return "todo";
}

function currentFollowIndex(kind: WorkflowArrivalKind, state: string, phase: WorkflowArrivalPhase): number {
  if (phase === "arrived") return 99;
  const normalized = state.toUpperCase();
  if (kind === "withdraw") {
    if (normalized === "RECONCILING") return 2;
    if (
      normalized === "CONFIRMING" ||
      normalized === "REQUEST_CONFIRMING" ||
      normalized === "STEP_CONFIRMED" ||
      normalized === "SIGNER_PROCESSING" ||
      normalized === "PAYOUT_CONFIRMING"
    ) {
      return 1;
    }
    return 0;
  }
  if (kind === "deposit") {
    if (normalized === "RECONCILING" || normalized === "MINT_PENDING" || normalized === "STEP_CONFIRMED") {
      return 2;
    }
    if (normalized === "CONFIRMING" || normalized === "SIGNER_PROCESSING") {
      return 1;
    }
    return 0;
  }
  return 0;
}

export function followAlongSteps(
  kind: WorkflowArrivalKind,
  state: string,
  phase: WorkflowArrivalPhase,
): ArrivalFollowStep[] {
  const current = currentFollowIndex(kind, state, phase);
  const catalog: { id: string; label: string; detail: string }[] =
    kind === "withdraw"
      ? [
          { id: "stacks", label: "1. Stacks request", detail: "Withdrawal is submitted on Stacks" },
          { id: "btc-confirms", label: "2. Bitcoin confirmations", detail: "About 6 blocks · ~60 minutes" },
          { id: "payout", label: "3. BTC arrives", detail: "Signers sweep BTC to your Bitcoin wallet" },
        ]
      : kind === "deposit"
        ? [
            { id: "bitcoin-sent", label: "1. Bitcoin sent", detail: "BTC is in the official deposit script" },
            { id: "btc-confirms", label: "2. Bitcoin confirmations", detail: "1–3 blocks · usually 15–30 minutes" },
            { id: "mint", label: "3. sBTC minted", detail: "Signers mint sBTC to your Stacks wallet" },
          ]
        : [{ id: "stacks", label: "1. Stacks confirmation", detail: "Usually 1–5 minutes" }];
  return catalog.map((item, index) => ({
    ...item,
    status: followStepStatus(current, index, phase),
  }));
}

function formatDurationMinutes(minutes: number): string {
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `about ${minutes} more ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `about ${hours} more ${hours === 1 ? "hour" : "hours"}`;
  return `about ${hours}h ${rem}m remaining`;
}

function withStage(
  base: Omit<WorkflowArrival, "title" | "headline" | "stageTitle" | "stageIndex" | "stageCount">,
): WorkflowArrival {
  const stageCount = base.steps.length;
  const current = base.steps.findIndex((step) => step.status === "current");
  const doneCount = base.steps.filter((step) => step.status === "done").length;
  const stageIndex =
    base.phase === "arrived" ? stageCount : current >= 0 ? current + 1 : Math.min(doneCount + 1, stageCount);
  const currentStep = base.steps.find((step) => step.status === "current") ?? base.steps[stageIndex - 1];
  const stageTitle =
    base.phase === "arrived"
      ? "Arrived"
      : base.phase === "stopped"
        ? "Stopped"
        : base.phase === "not_started"
          ? "Waiting to sign"
          : (currentStep?.label.replace(/^\d+\.\s*/, "") ?? workflowStateLabel(base.steps[0]?.label ?? "In progress"));
  const headline =
    base.phase === "arrived"
      ? `Complete · ${base.destination}`
      : base.phase === "stopped"
        ? `Stopped · ${workflowActionTitle(base.kind)}`
        : base.phase === "not_started"
          ? `Not started · typically ${base.typicalWait}`
          : `Step ${stageIndex} of ${stageCount} · ${stageTitle}`;
  return {
    ...base,
    title: workflowActionTitle(base.kind),
    headline,
    stageTitle,
    stageIndex,
    stageCount,
  };
}

export function canCancelUnsignedWorkflow(state: string): boolean {
  return state.toUpperCase() === "AWAITING_SIGNATURE";
}

export function describeWorkflowArrival(input: {
  action?: string | null | undefined;
  state: string;
  createdAt?: string | null | undefined;
  nowMs: number;
}): WorkflowArrival {
  const kind = workflowArrivalKind(input.action);
  const destination = destinationChainLabel(kind);
  const typicalWait = typicalWaitLabel(kind);
  const phase = arrivalPhase(input.state);
  const elapsed = input.createdAt ? formatElapsedSince(input.createdAt, input.nowMs) : null;
  const steps = followAlongSteps(kind, input.state, phase);
  const normalized = input.state.toUpperCase();

  if (normalized === "BROADCAST_UNKNOWN") {
    const unknownSteps = followAlongSteps(kind, input.state, "in_flight").map((step, index) =>
      index === 0
        ? {
            ...step,
            status: "current" as const,
            detail: "Wallet returned no proven txid — check Leather before sending again",
          }
        : { ...step, status: "todo" as const },
    );
    return {
      ...withStage({
        kind,
        destination,
        typicalWait,
        elapsed,
        remaining: "Unknown — wallet never returned a txid",
        phase: "stopped",
        note:
          kind === "deposit"
            ? "Broadcast unknown means the wallet result had no Bitcoin txid. If Leather shows no send, nothing moved — start a new deposit. If Leather shows a txid, notify Emily with that hex. Do not send again."
            : "Broadcast unknown means the wallet result had no proven txid. Check the wallet history before retrying. Never send the same transaction twice.",
        steps: unknownSteps,
      }),
      headline: "Could not confirm send — check Leather",
      stageTitle: "Broadcast unconfirmed",
    };
  }

  if (phase === "arrived") {
    return withStage({
      kind,
      destination,
      typicalWait,
      elapsed,
      remaining: "Arrived — no remaining wait",
      phase,
      note: `Tokens are on ${destination}. This estimate is closed.`,
      steps,
    });
  }
  if (phase === "stopped") {
    return withStage({
      kind,
      destination,
      typicalWait,
      elapsed,
      remaining: "Not in transit",
      phase,
      note: "This workflow is not currently moving funds to the destination chain.",
      steps,
    });
  }
  if (phase === "not_started") {
    return withStage({
      kind,
      destination,
      typicalWait,
      elapsed,
      remaining: `Starts after signing — typically ${typicalWait}`,
      phase,
      note: `The arrival clock starts once the wallet signs. Destination: ${destination}.`,
      steps,
    });
  }

  const started = input.createdAt ? Date.parse(input.createdAt) : Number.NaN;
  if (!Number.isFinite(started)) {
    return withStage({
      kind,
      destination,
      typicalWait,
      elapsed: null,
      remaining: `Typically ${typicalWait}`,
      phase,
      note: arrivalNote(kind, destination),
      steps,
    });
  }

  const elapsedMin = Math.max(0, Math.floor((input.nowMs - started) / 60_000));
  const leftover = typicalWaitMinutes(kind) - elapsedMin;
  const remaining =
    leftover <= 0
      ? kind === "withdraw"
        ? "Past the typical 1–3 hour window — not complete until Bitcoin is paid out"
        : kind === "deposit"
          ? "Past the typical window — not complete until sBTC is minted on Stacks"
          : "Past the typical window — not complete until the destination balance updates"
      : formatDurationMinutes(leftover);

  return withStage({
    kind,
    destination,
    typicalWait,
    elapsed,
    remaining,
    phase,
    note: arrivalNote(kind, destination),
    steps,
  });
}

function arrivalNote(kind: WorkflowArrivalKind, destination: string): string {
  switch (kind) {
    case "deposit":
      return `Official sBTC deposits typically need 1–3 Bitcoin blocks, then signers mint on ${destination}. A Bitcoin txid is not a mint.`;
    case "withdraw":
      return `Official sBTC withdrawals typically need 6 Bitcoin blocks (~60 minutes) after the Stacks request, then signers sweep BTC to ${destination}. Plan on 1–3 hours. A Stacks txid is not a payout.`;
    case "stacks":
      return `Stacks confirmation is usually a few minutes. Destination: ${destination}.`;
    default:
      return `Typical wait is an estimate. Destination: ${destination}.`;
  }
}
