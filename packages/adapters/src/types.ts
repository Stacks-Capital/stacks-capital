import type {
  Action,
  CanonicalActivity,
  DecodedEvent,
  DataPoint,
  Intent,
  Plan,
  PlanValidation,
  Quote,
  SigningContext,
  StacksNetwork,
} from "@stacks-capital/core";
import type { CapabilityRecord } from "@stacks-capital/config";

export type AdapterContext = {
  network: StacksNetwork;
  now: Date;
  owner?: string;
  registryVersion: string;
};

export type Market = {
  id: string;
  protocol: string;
  action: Action;
  network: StacksNetwork;
  suppliedAsset: string;
  receiptAsset?: string;
  state: CapabilityRecord["state"];
  warnings: string[];
};

export type Position = {
  owner: string;
  marketId: string;
  kind: string;
  quantity: string;
  blockHeight?: number;
};

export type { Intent };

export type Reconciliation = {
  matched: boolean;
  warnings: string[];
};

export type RiskExplanation = {
  disclosures: string[];
  stale: boolean;
  variables: Record<string, string>;
  alerts: string[];
};

export type SemanticAsset = {
  unit: string;
  decimals: number;
  evidence: string;
};

export type ActionSemantics = {
  action: Action;
  inputUnit: string;
  outputUnit: string;
  rounding: "exact" | "down";
  completionEvidence: string;
  postConditionPolicy: "bitcoin_script" | "deny_mode";
};

/**
 * Protocol facts that an adapter is allowed to use when normalizing data.
 * Anything absent from this declaration must remain absent instead of being
 * guessed from a ticker, a balance delta, or another protocol.
 */
export type AdapterSemantics = {
  amountEncoding: "base_10_integer_base_units";
  unsupportedFieldPolicy: "omit";
  positionModel: string;
  assets: readonly SemanticAsset[];
  actions: readonly ActionSemantics[];
};

export type ProtocolAdapter = {
  protocol: string;
  version: string;
  semantics: AdapterSemantics;
  describeCapabilities(ctx: AdapterContext): CapabilityRecord[];
  listMarkets(ctx: AdapterContext): Market[];
  getMarket(ctx: AdapterContext, marketId: string): Market;
  readPositions(ctx: AdapterContext, owner: string): DataPoint<Position[]>;
  quote(ctx: AdapterContext, intent: Intent): Quote;
  buildPlan(ctx: AdapterContext, quote: Quote, intent: Intent): Plan;
  validatePlan(ctx: AdapterContext, plan: Plan, quote: Quote, signing: SigningContext): PlanValidation;
  /**
   * Turns decoded contract logs into canonical activity, with the amounts that moved.
   *
   * The worker decodes the Clarity payload, because it owns the chain library; the adapter says
   * what the fields mean, because it owns the protocol. An event this adapter does not recognise
   * is dropped rather than guessed at.
   */
  decodeEvents(ctx: AdapterContext, events: readonly DecodedEvent[]): CanonicalActivity[];
  reconcile(ctx: AdapterContext, expected: string, observed: string): Reconciliation;
  explainRisk(ctx: AdapterContext, marketId: string): RiskExplanation;
};
