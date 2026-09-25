import { CapitalApiError, CapitalTransportError, type ResponseContext } from "@stacks-capital/client";

/** What a panel shows. "unavailable" is a real answer: the data has no source yet. */
export type PanelState =
  | { kind: "loading" }
  | { kind: "ready"; stale: boolean; warnings: string[]; observedAt: string | null }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string; canRetry: boolean; requestId: string | null };

export type QueryLike<T> = { status: string; data: T | undefined; error: unknown };

// Panels whose endpoint does not exist yet. Naming the task keeps the screen honest about why.
export const UNAVAILABLE = {
  balances: "Wallet balances need a balances endpoint, which is not built yet (I11 projects them).",
  positions: "Positions need a positions endpoint, which is not built yet (I11 decodes them).",
  quotes: "Quotes need the quote endpoint, which is not built yet.",
} as const;

export function messageFor(error: unknown): { message: string; canRetry: boolean; requestId: string | null } {
  if (error instanceof CapitalApiError) {
    const canRetry = error.errorClass === "retryable_read";
    const messages: Record<string, string> = {
      UNAUTHORIZED: "Your session has expired. Sign in again.",
      FORBIDDEN: "This app is not allowed to read that.",
      NOT_FOUND: "Not found.",
      RATE_LIMITED: `Too many requests. Try again in ${error.retryAfter ?? 60} seconds.`,
      TEMPORARY_UNAVAILABLE: "Stacks Capital is busy. Try again shortly.",
      NETWORK_MISMATCH: "That belongs to another network.",
    };
    return { message: messages[error.code] ?? error.message, canRetry, requestId: error.requestId };
  }
  if (error instanceof CapitalTransportError) {
    const messages: Record<string, string> = {
      timeout: "The request took too long. Try again.",
      aborted: "Cancelled.",
      network: "Cannot reach Stacks Capital. Check your connection.",
      protocol: "Stacks Capital answered something this app does not understand.",
    };
    return {
      message: messages[error.kind] ?? "Something went wrong.",
      canRetry: error.kind !== "aborted",
      requestId: null,
    };
  }
  if (error instanceof Error && error.message.trim() !== "") {
    return { message: error.message, canRetry: false, requestId: null };
  }
  return { message: "Something went wrong.", canRetry: false, requestId: null };
}

export function panelState<T>(query: QueryLike<T>, context?: ResponseContext | undefined): PanelState {
  if (query.status === "error" && query.data === undefined) {
    const described = messageFor(query.error);
    return { kind: "error", ...described };
  }
  if (query.data === undefined) return { kind: "loading" };
  // Data that failed to refresh is still shown, marked stale, rather than replaced by an error.
  const staleFromError = query.status === "error";
  return {
    kind: "ready",
    stale: staleFromError || context?.stale === true,
    warnings: staleFromError
      ? [messageFor(query.error).message, ...(context?.warnings ?? [])]
      : (context?.warnings ?? []),
    observedAt: context?.observedAt ?? null,
  };
}

/* =========================================================================
 * The Eight Centralized States (Task 2 / I31)
 *
 * Enforces the cross-cutting screen contract from AGENTS.md:
 * Loading, Empty, Partial, Unsupported, Stale/Disputed, Review, Submitted,
 * Failed/Delayed.
 * ========================================================================= */

export type LoadingState = {
  kind: "loading";
  what: string;
  canCancel?: boolean;
  onCancel?: () => void;
  canRetry?: boolean;
  onRetry?: () => void;
  priorVerified?: {
    timestamp: string;
    description: string;
  };
};

export type EmptyState = {
  kind: "empty";
  instruction: string;
  allowAddressInput?: boolean;
  onAddressSubmit?: (address: string) => void;
  onConnectWallet?: () => void;
  nextAction?: {
    label: string;
    onClick: () => void;
  };
};

export type PartialState = {
  kind: "partial";
  /** May already carry its unit, for a subtotal that spans several assets. */
  verifiedSubtotal: string;
  assetUnit?: string;
  excludedPositions: Array<{
    name: string;
    reason: string;
  }>;
  notice?: string;
};

export type UnsupportedState = {
  kind: "unsupported";
  assetOrProtocol: string;
  reason: string;
};

export type StaleDisputedState = {
  kind: "stale_disputed";
  ageDescription: string;
  sources: string[];
  disagreement?: string;
  onRefresh?: () => void;
  onRequote?: () => void;
};

export type ReviewState = {
  kind: "review";
  /** Amounts may already carry their unit, as reviewQuote formats them. The asset fields are for the ones that do not. */
  giveAmount: string;
  giveAsset?: string;
  receiveAmount: string;
  receiveAsset?: string;
  fees: Array<{ kind: string; amount: string; asset?: string }>;
  minimumOutput?: string;
  debtChange?: string;
  healthFactor?: string;
  protocol: string;
  contract: string;
  planValidated: boolean;
  validationError?: string;
  confirmLabel?: string;
  onConfirm?: () => void;
};

export type SubmittedState = {
  kind: "submitted";
  txId: string;
  explorerUrl: string;
  /** The real workflow state. Confirming and mint_pending are not done, so the badge never says so. */
  workflowState?: string;
  differenceNote?: string;
  nextAction?: string;
  /** Typical wait, labeled as an estimate, never as a completion clock. */
  estimatedWait?: string;
  timingNote?: string;
};

export type FailedDelayedRecovery = {
  type: "resume" | "requote" | "switch_network" | "provide_fee" | "reclaim" | "support";
  label: string;
  action: () => void;
};

export type FailedDelayedState = {
  kind: "failed_delayed";
  cause: string;
  fundsLocation: string;
  recovery: FailedDelayedRecovery[];
};

export type CanonicalState =
  | LoadingState
  | EmptyState
  | PartialState
  | UnsupportedState
  | StaleDisputedState
  | ReviewState
  | SubmittedState
  | FailedDelayedState;

export const CANONICAL_STATE_KINDS = [
  "loading",
  "empty",
  "partial",
  "unsupported",
  "stale_disputed",
  "review",
  "submitted",
  "failed_delayed",
] as const;

export type CanonicalStateKind = (typeof CANONICAL_STATE_KINDS)[number];
