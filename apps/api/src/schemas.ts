import { z } from "@hono/zod-openapi";

export const SCHEMA_VERSION = "1.0";

export const Network = z.enum(["mainnet", "testnet"]).openapi({
  description: "Required on every request. There is no default network.",
});

export const ListQuery = z.object({
  network: Network,
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ description: "Page size, 1 to 100." }),
  cursor: z.string().max(512).optional().openapi({ description: "Opaque cursor from the previous page's nextCursor." }),
});

export const Context = z
  .object({
    blockHeight: z.number().int().nonnegative().optional(),
    blockHash: z.string().optional(),
    observedAt: z.iso.datetime(),
    stale: z.boolean(),
    warnings: z.array(z.string()),
  })
  .openapi("Context");

export function envelope<T extends z.ZodType>(name: string, data: T) {
  return z
    .object({
      schemaVersion: z.literal(SCHEMA_VERSION),
      requestId: z.string(),
      network: z.enum(["stacks:mainnet", "stacks:testnet"]),
      data,
      context: Context,
    })
    .openapi(name);
}

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export const Capability = z
  .object({
    action: z.string(),
    state: z.enum(["enabled", "read_only", "paused", "disabled"]),
    reason: z.string(),
    contractId: z.string(),
    deploymentId: z.string().nullable(),
    adapterVersion: z.string(),
    registryVersion: z.string(),
  })
  .openapi("Capability");

export const MarketCapability = Capability.extend({ marketId: z.string() }).openapi("MarketCapability");

export const Market = z
  .object({
    id: z.string(),
    network: Network,
    protocol: z.string(),
    suppliedAssetId: z.string().nullable(),
    receiptAssetId: z.string().nullable(),
    capabilities: z.array(Capability),
  })
  .openapi("Market");

export const ErrorBody = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    requestId: z.string(),
    error: z.object({
      code: z.string(),
      message: z.string(),
      retryAfter: z.number().int().nonnegative().optional(),
      action: z.string().optional(),
    }),
  })
  .openapi("Error");

export const MarketsResponse = envelope("MarketsResponse", pageOf(Market));
export const CapabilitiesResponse = envelope("CapabilitiesResponse", pageOf(MarketCapability));

export const NetworkQuery = z.object({ network: Network });

export const ChallengeRequest = z
  .object({
    network: Network,
    address: z
      .string()
      .max(64)
      .openapi({ description: "Stacks address that will sign. It must belong to the network." }),
  })
  .openapi("ChallengeRequest");

export const Challenge = z
  .object({
    nonceId: z.string(),
    message: z.string().openapi({ description: "Sign this exact text with the wallet's message signing request." }),
    expiresAt: z.iso.datetime(),
  })
  .openapi("Challenge");

export const VerifyRequest = z
  .object({
    network: Network,
    nonceId: z.string().regex(/^non_[a-f0-9]{32}$/),
    publicKey: z.string().regex(/^[0-9a-f]{66}$/),
    signature: z.string().regex(/^[0-9a-f]{130}$/),
  })
  .openapi("VerifyRequest");

export const Session = z
  .object({
    token: z.string().openapi({ description: "Bearer token for this wallet session. It is returned only once." }),
    sessionId: z.string(),
    address: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .openapi("Session");

export const WorkflowParams = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .openapi({ param: { name: "id", in: "path" } }),
});

export const Workflow = z
  .object({
    id: z.string(),
    network: Network,
    state: z.string(),
    nextAction: z.string(),
    quoteId: z.string().nullable(),
    planId: z.string().nullable(),
    action: z.string().nullable(),
    ownerAddress: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    transitions: z.array(
      z.object({
        sequence: z.number().int(),
        from: z.string(),
        to: z.string(),
        reason: z.string(),
        actor: z.string(),
        evidence: z.string(),
        at: z.iso.datetime(),
      }),
    ),
    attempts: z.array(
      z.object({
        stepId: z.string(),
        chain: z.enum(["bitcoin", "stacks"]),
        outcome: z.enum(["BROADCAST", "SIGNED", "UNKNOWN"]),
        txid: z.string().nullable(),
        recordedAt: z.iso.datetime(),
      }),
    ),
  })
  .openapi("Workflow");

export const ChallengeResponse = envelope("ChallengeResponse", Challenge);
export const SessionResponse = envelope("SessionResponse", Session);
export const WorkflowResponse = envelope("WorkflowResponse", Workflow);

export const Action = z.enum([
  "deposit_sbtc",
  "withdraw_sbtc",
  "supply",
  "withdraw_supply",
  "borrow",
  "repay",
  "swap",
  "stake",
]);

const IntegerString = z.string().regex(/^[0-9]+$/);

export const IntentBody = z
  .object({
    action: Action,
    marketId: z.string().min(1).max(128),
    amount: IntegerString.max(39),
    recipient: z.string().max(128).optional(),
    maxFee: IntegerString.max(39).optional(),
    minOut: IntegerString.optional(),
    collateralAmount: IntegerString.optional(),
    slippageBps: IntegerString.max(5).optional(),
    bufferBps: IntegerString.optional(),
    onBehalfOf: z.string().max(64).optional(),
    routePool: z.string().max(128).optional(),
    inputAsset: z.string().max(64).optional(),
  })
  .openapi("Intent");

export const QuoteRequest = IntentBody.extend({
  network: Network,
  owner: z
    .string()
    .max(64)
    .optional()
    .openapi({ description: "Required for API keys. Wallet sessions quote for the signed-in address." }),
}).openapi("QuoteRequest");

export const AmountWire = z.object({
  asset: z.string().openapi({ description: "Canonical asset id from formatAssetId, never a ticker." }),
  quantity: z.string().regex(/^-?[0-9]+$/),
});

export const AssetAmount = AmountWire;

export const Fee = z.object({
  kind: z.enum(["miner", "signer", "protocol", "network"]),
  amount: AmountWire,
  max: AmountWire.optional(),
});

export const Quote = z
  .object({
    id: z.string(),
    action: Action,
    marketId: z.string(),
    network: Network,
    input: z.array(AmountWire),
    expectedOutput: z.array(AmountWire),
    fees: z.array(Fee),
    snapshots: z.array(z.string()),
    expiresAt: z.iso.datetime(),
    executable: z.boolean(),
    warnings: z.array(z.string()),
    registryVersion: z.string(),
    adapterVersion: z.string(),
    minimumOutput: AmountWire.optional(),
  })
  .openapi("Quote");

const BitcoinPayload = z.object({
  kind: z.literal("bitcoin_deposit"),
  amountSats: IntegerString,
  stacksRecipient: z.string(),
  bitcoinNetwork: z.enum(["mainnet", "test", "regtest"]),
  reclaimLockTime: z.number().int(),
  maxSignerFeeSats: IntegerString,
  emilyNotifyPath: z.string(),
});

const StacksPayload = z.object({
  kind: z.literal("stacks_contract_call"),
  contractId: z.string(),
  functionName: z.string(),
  functionArgs: z.array(z.unknown()),
  postConditions: z.array(
    z.object({
      principal: z.string(),
      mode: z.enum(["send_lte", "send_eq", "send_gte", "receive_gte"]),
      amount: AmountWire,
    }),
  ),
  postConditionMode: z.enum(["deny", "allow"]),
  network: Network,
});

export const PlanStep = z
  .object({
    id: z.string(),
    dependsOn: z.array(z.string()),
    expectedAssetEffects: z.array(AmountWire),
    payload: z.discriminatedUnion("kind", [BitcoinPayload, StacksPayload]),
  })
  .openapi("PlanStep");

export const Plan = z
  .object({
    id: z.string(),
    quoteId: z.string(),
    network: Network,
    registryVersion: z.string(),
    adapterVersion: z.string(),
    expiresAt: z.iso.datetime(),
    reviewSummary: z.string(),
    steps: z.array(PlanStep),
  })
  .openapi("Plan");

export const PlanRequest = z
  .object({
    network: Network,
    owner: z.string().max(64).optional(),
    intent: IntentBody,
    quote: Quote,
  })
  .openapi("PlanRequest");

export const StartWorkflowRequest = z
  .object({
    network: Network,
    quoteId: z.string().max(128),
    idempotencyKey: z.string().min(8).max(128).openapi({ description: "The same key always names the same workflow." }),
    ownerAddress: z
      .string()
      .max(64)
      .optional()
      .openapi({ description: "Required for an API key, ignored for a session." }),
  })
  .openapi("StartWorkflowRequest");

export const SignatureRequest = z
  .object({
    network: Network,
    stepId: z.string().max(128),
    walletResult: z.looseObject({}).openapi({ description: "Exactly what the wallet returned, unchanged." }),
  })
  .openapi("SignatureRequest");

export const SignatureOutcome = z
  .object({
    state: z.string(),
    nextAction: z.string(),
    outcome: z.enum(["BROADCAST", "SIGNED", "UNKNOWN"]),
    txid: z.string().nullable(),
  })
  .openapi("SignatureOutcome");

export const QuoteResponse = envelope("QuoteResponse", z.object({ quote: Quote, plan: Plan }));
export const PlanResponse = envelope("PlanResponse", Plan);

const SwapExactAsset = z
  .string()
  .max(200)
  .regex(
    /^stacks:mainnet:(native:stx|contract:S[PM][A-Z0-9]{25,41}\.[A-Za-z0-9\-_]+:[A-Za-z0-9\-_$.]+)$/,
    "must be an exact Stacks mainnet asset identity",
  );

export const SwapMarketsQuery = z.object({
  network: z.literal("mainnet").openapi({ description: "Swap catalogs are mainnet-only." }),
});

export const SwapProviderName = z.enum(["bitflow", "velar", "alex"]);

export const SwapCatalogSource = z.object({
  status: z.enum(["ok", "unavailable"]),
  count: z.number().int().nonnegative(),
  reason: z.string().nullable(),
});

export const SwapComparisonRequest = z
  .object({
    network: z.literal("mainnet"),
    owner: z.string().min(1).max(64).optional(),
    inputAsset: SwapExactAsset,
    outputAsset: SwapExactAsset,
    amount: IntegerString.max(39).refine((value) => BigInt(value) > 0n, "amount must be greater than zero"),
    slippageBps: z.number().int().min(0).max(300).default(50),
  })
  .refine((value) => value.inputAsset !== value.outputAsset, {
    message: "inputAsset and outputAsset must differ",
    path: ["outputAsset"],
  })
  .openapi("SwapComparisonRequest");

export const SwapAsset = z.object({
  key: z.string(),
  assetId: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  providers: z.array(SwapProviderName),
});

export const SwapMarketsResponse = envelope(
  "SwapMarketsResponse",
  z.object({
    items: z.array(SwapAsset),
    sources: z.object({
      bitflow: SwapCatalogSource,
      velar: SwapCatalogSource,
      alex: SwapCatalogSource,
    }),
  }),
);

const SwapWalletPostCondition = z.union([
  z.object({
    type: z.literal("stx-postcondition"),
    address: z.string(),
    condition: z.enum(["lte", "eq", "gte"]),
    amount: IntegerString,
  }),
  z.object({
    type: z.literal("ft-postcondition"),
    address: z.string(),
    condition: z.enum(["lte", "eq", "gte"]),
    amount: IntegerString,
    asset: z.string(),
  }),
]);

export const SwapWalletCall = z.object({
  contractId: z.string(),
  functionName: z.string(),
  functionArgs: z.array(z.string().regex(/^0x[0-9a-f]+$/i)),
  postConditions: z.array(SwapWalletPostCondition).min(1),
  postConditionMode: z.enum(["deny", "allow"]),
  network: z.literal("mainnet"),
});

export const SwapOffer = z.object({
  provider: SwapProviderName,
  rank: z.number().int().positive(),
  status: z.enum(["executable", "quote_only"]),
  inputAsset: z.string(),
  outputAsset: z.string(),
  amountIn: IntegerString,
  amountOut: IntegerString,
  minimumAmountOut: IntegerString,
  fee: z.object({ asset: z.string(), quantity: IntegerString }).nullable(),
  priceImpactBps: z.number().nonnegative().nullable(),
  route: z.array(z.string()),
  targetContract: z.string(),
  observedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  evidenceSource: z.string(),
  executionReason: z.string(),
  walletCall: SwapWalletCall.optional(),
});

export const SwapComparisonResponse = envelope(
  "SwapComparisonResponse",
  z.object({
    assets: z.array(SwapAsset),
    offers: z.array(SwapOffer),
    unavailable: z.array(z.object({ provider: SwapProviderName, reason: z.string() })),
  }),
);
export const StartedWorkflowResponse = envelope(
  "StartedWorkflowResponse",
  z.object({ workflowId: z.string(), state: z.string(), nextAction: z.string(), plan: Plan }),
);
export const SignatureResponse = envelope("SignatureResponse", SignatureOutcome);

export type QuoteRequestBody = z.infer<typeof QuoteRequest>;
export type PlanRequestBody = z.infer<typeof PlanRequest>;
export type IntentBodyValue = z.infer<typeof IntentBody>;
export const PositionQuery = z.object({
  network: Network,
  owner: z.string().max(64).optional().openapi({ description: "Required for an API key, ignored for a session." }),
});

export const LinkedCollateral = z
  .object({
    marketId: z.string(),
    assetId: z.string(),
    protocolKey: z.string().optional(),
    quantity: z.string().nullable().optional(),
  })
  .openapi("LinkedCollateral");

export const Position = z
  .object({
    marketId: z.string(),
    kind: z.enum([
      "wallet",
      "supplied",
      "lp",
      "collateral",
      "debt",
      "locked",
      "pending_deposit",
      "pending_withdrawal",
      "staked",
    ]),
    protocolKey: z.string(),
    assetId: z.string(),
    quantity: z.string().nullable().openapi({ description: "Null when unknown. Zero is a real balance." }),
    stale: z.boolean(),
    warnings: z.array(z.string()),
    observedAt: z.iso.datetime(),
    blockHeight: z.number().int().nullable(),
    rewardRate: z.string().nullable(),
    rewardScale: z.number().int().nullable(),
    adapterVersion: z.string(),
    calculationVersion: z.string(),
    linkedCollateral: LinkedCollateral.nullable().optional(),
  })
  .openapi("Position");

export const PositionsResponse = envelope("PositionsResponse", z.object({ items: z.array(Position) }));

export const EarnOptionEvidence = z
  .object({
    ageSeconds: z.number().nullable(),
    blockHeight: z.number().int().nullable(),
    blockHash: z.string().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    source: z.string(),
    disagreement: z.enum(["match", "mismatch", "unavailable"]).nullable(),
    isIndependentRead: z.boolean(),
  })
  .openapi("EarnOptionEvidence");

export const EarnOption = z
  .object({
    marketId: z.string(),
    protocol: z.string(),
    suppliedAssetId: z.string().nullable(),
    receiptAssetId: z.string().nullable(),
    supply: z.object({ state: z.string(), reason: z.string() }),
    withdrawal: z.object({ state: z.string(), reason: z.string() }).nullable(),
    baseRate: z.string().nullable(),
    baseRateScale: z.number().int().nullable(),
    incentiveRate: z.string().nullable(),
    incentiveRateScale: z.number().int().nullable(),
    availableLiquidity: z.string().nullable(),
    capacity: z.string().nullable(),
    paused: z.boolean().nullable(),
    stale: z.boolean(),
    warnings: z.array(z.string()),
    observedAt: z.iso.datetime().nullable(),
    adapterVersion: z.string(),
    evidence: EarnOptionEvidence.optional(),
  })
  .openapi("EarnOption");

export const EarnOptionsResponse = envelope("EarnOptionsResponse", z.object({ items: z.array(EarnOption) }));

export const MarketObservation = z
  .object({
    source: z.string(),
    sourceType: z.enum(["independent", "provider_reported"]),
    isIndependentRead: z.boolean(),
    availableLiquidity: z.string().nullable(),
    capacity: z.string().nullable(),
    supplyRate: z.string().nullable(),
    borrowRate: z.string().nullable(),
    rateScale: z.number().int().nullable(),
    paused: z.boolean().nullable(),
    stale: z.boolean(),
    warnings: z.array(z.string()),
    observedAt: z.iso.datetime(),
    blockHeight: z.number().int().nullable(),
    blockHash: z.string().nullable(),
  })
  .openapi("MarketObservation");

export const MarketEvidence = z
  .object({
    marketId: z.string(),
    network: z.string(),
    protocol: z.string(),
    source: z.string(),
    blockHeight: z.number().int().nullable(),
    blockHash: z.string().nullable(),
    observedAt: z.iso.datetime().nullable(),
    evidenceAgeSeconds: z.number().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    disagreement: z.enum(["match", "mismatch", "unavailable"]).nullable(),
    disagreementDetail: z.string().nullable(),
    isIndependentRead: z.boolean(),
    rate: z.object({
      supplyRate: z.string().nullable(),
      borrowRate: z.string().nullable(),
      rateScale: z.number().int().nullable(),
      stale: z.boolean(),
    }),
    liquidity: z.object({
      available: z.string().nullable(),
      capacity: z.string().nullable(),
      stale: z.boolean(),
    }),
    warnings: z.array(z.string()),
    observations: z.array(MarketObservation),
  })
  .openapi("MarketEvidence");

export const MarketEvidenceResponse = envelope("MarketEvidenceResponse", MarketEvidence);

export const OracleQuote = z
  .object({
    feedKey: z.string(),
    price: z.string().nullable(),
    scale: z.number().int(),
    publishedAt: z.iso.datetime().nullable(),
    observedAt: z.iso.datetime(),
    source: z.string(),
    stale: z.boolean(),
    warnings: z.array(z.string()),
    assetId: z.string().optional(),
    sourceSet: z.array(z.string()).optional(),
    disagreement: z.boolean().optional(),
    status: z.enum(["verified", "disputed", "stale", "unsupported"]).optional(),
  })
  .openapi("OracleQuote");

export const AssetValuation = z
  .object({
    assetId: z.string(),
    price: z.string().nullable(),
    scale: z.number().int(),
    sourceSet: z.array(z.string()),
    timestamp: z.iso.datetime(),
    status: z.enum(["verified", "disputed", "stale", "unsupported"]),
    disagreement: z.boolean(),
    spreadBps: z.number().nullable(),
    warnings: z.array(z.string()),
  })
  .openapi("AssetValuation");

export const PortfolioCoverage = z
  .object({
    isComplete: z.boolean(),
    valuedCount: z.number().int(),
    unvaluedCount: z.number().int(),
    totalCount: z.number().int(),
    coverageBps: z.number().int().nullable(),
    valuedAssets: z.array(z.string()),
    unvaluedAssets: z.array(
      z.object({
        assetId: z.string(),
        reason: z.string(),
        quantity: z.string().nullable(),
      }),
    ),
  })
  .openapi("PortfolioCoverage");

export const ValuedHoldingItem = z
  .object({
    assetId: z.string(),
    quantity: z.string().nullable(),
    decimals: z.number().int(),
    usdValue: z.string().nullable(),
    status: z.enum(["valued", "unsupported", "stale", "disputed", "missing_quantity"]),
    unvaluedReason: z.string().nullable(),
    valuation: AssetValuation.nullable(),
  })
  .openapi("ValuedHoldingItem");

export const PortfolioValuation = z
  .object({
    totalUsd: z.string().nullable(),
    coverage: PortfolioCoverage,
    items: z.array(ValuedHoldingItem),
    warnings: z.array(z.string()),
  })
  .openapi("PortfolioValuation");

export const PortfolioValuationResponse = envelope("PortfolioValuationResponse", PortfolioValuation);
export const ValuationsResponse = envelope("ValuationsResponse", z.object({ items: z.array(AssetValuation) }));

export const AccountingEntrySchema = z
  .object({
    id: z.string(),
    category: z.enum(["wallet", "supplied", "lp", "collateral", "debt", "locked"]),
    assetId: z.string(),
    quantity: z.string().nullable(),
    marketId: z.string().nullable(),
    protocolKey: z.string().nullable(),
    isReceipt: z.boolean(),
    countsTowardTotal: z.boolean(),
    linkedCollateral: LinkedCollateral.nullable(),
    stale: z.boolean(),
    warnings: z.array(z.string()),
  })
  .openapi("AccountingEntry");

export const CategoryAccountingSummarySchema = z
  .object({
    totalUsd: z.string().nullable(),
    count: z.number().int(),
    items: z.array(ValuedHoldingItem),
  })
  .openapi("CategoryAccountingSummary");

export const PortfolioAccounting = z
  .object({
    grossAssetsUsd: z.string().nullable(),
    grossDebtUsd: z.string().nullable(),
    netWorthUsd: z.string().nullable(),
    coverage: PortfolioCoverage,
    entries: z.array(AccountingEntrySchema),
    byCategory: z.record(z.string(), CategoryAccountingSummarySchema),
    incomplete: z.boolean(),
    warnings: z.array(z.string()),
  })
  .openapi("PortfolioAccounting");

export const PortfolioAccountingResponse = envelope("PortfolioAccountingResponse", PortfolioAccounting);

export const MarketRisk = z
  .object({
    marketId: z.string(),
    params: z
      .object({
        ltvBorrowBps: z.string(),
        ltvLiqBps: z.string(),
        bufferBps: z.string(),
        collateralDecimals: z.number().int(),
        debtDecimals: z.number().int(),
      })
      .nullable()
      .openapi({ description: "Null when the protocol's risk parameters could not be read." }),
    collateralOracle: OracleQuote,
    debtOracle: OracleQuote,
    position: z.object({
      collateral: z.string().nullable(),
      debt: z.string().nullable(),
      stale: z.boolean(),
      warnings: z.array(z.string()),
    }),
    warnings: z.array(z.string()),
  })
  .openapi("MarketRisk");

export const MarketRiskResponse = envelope("MarketRiskResponse", MarketRisk);

export const PricesResponse = envelope("PricesResponse", z.object({ items: z.array(OracleQuote) }));

export const WorkflowListQuery = z.object({
  network: Network,
  owner: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
});

export const WorkflowSummary = z
  .object({
    id: z.string(),
    network: Network,
    state: z.string(),
    nextAction: z.string(),
    quoteId: z.string().nullable(),
    planId: z.string().nullable(),
    action: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    transitionCount: z.number().int(),
  })
  .openapi("WorkflowSummary");

export const WorkflowsResponse = envelope("WorkflowsResponse", pageOf(WorkflowSummary));

export const EarnPerformanceQuery = z.object({
  network: Network,
  owner: z.string().max(64).optional(),
  marketId: z.string().max(64).optional(),
});

export const CashFlowAttributionSchema = z
  .object({
    depositsTotal: z.string(),
    withdrawalsTotal: z.string(),
    netDeposits: z.string(),
    feesTotal: z.string(),
    claimedRewardsTotal: z.string(),
    costBasis: z.string(),
    currentValue: z.string(),
    unattributedInflow: z.string(),
    hasUnattributedInflow: z.boolean(),
    earnedYield: z.string(),
    warnings: z.array(z.string()),
  })
  .openapi("CashFlowAttribution");

export const RealizedEarningsSchema = z
  .object({
    amount: z.string(),
    usdValue: z.string().nullable(),
    assetId: z.string(),
  })
  .openapi("RealizedEarnings");

export const UnclaimedRewardSchema = z
  .object({
    assetId: z.string(),
    amount: z.string(),
    usdValue: z.string().nullable(),
    observedAt: z.string(),
  })
  .openapi("UnclaimedReward");

export const AccruedEstimateSchema = z
  .object({
    amount: z.string(),
    usdValue: z.string().nullable(),
    assetId: z.string(),
    shareAppreciationAmount: z.string(),
    unclaimedRewards: z.array(UnclaimedRewardSchema),
  })
  .openapi("AccruedEstimate");

export const Forward30dProjectionSchema = z
  .object({
    isProjectionAvailable: z.boolean(),
    projected30dAmount: z.string().nullable(),
    projected30dUsd: z.string().nullable(),
    rateUsedBps: z.string().nullable(),
    rateStatus: z.enum(["verified", "unverified", "stale", "disputed", "missing"]),
    unavailableReason: z.string().nullable(),
  })
  .openapi("Forward30dProjection");

export const CanonicalPerformancePointSchema = z
  .object({
    timestamp: z.string(),
    blockHeight: z.number().int().nullable(),
    blockHash: z.string().nullable(),
    source: z.string(),
    shareRate: z.object({ numerator: z.string(), denominator: z.string() }).nullable(),
    positionShares: z.string().nullable(),
    underlyingValue: z.string(),
    cumulativeYield: z.string(),
  })
  .openapi("CanonicalPerformancePoint");

export const PerformanceChartSeriesSchema = z
  .object({
    hasChart: z.boolean(),
    points: z.array(CanonicalPerformancePointSchema),
    observationCount: z.number().int(),
    reason: z.string().nullable(),
  })
  .openapi("PerformanceChartSeries");

export const EarnPerformanceItem = z
  .object({
    marketId: z.string(),
    assetId: z.string(),
    attribution: CashFlowAttributionSchema,
    realizedEarnings: RealizedEarningsSchema,
    accruedEstimate: AccruedEstimateSchema,
    forward30dProjection: Forward30dProjectionSchema,
    chart: PerformanceChartSeriesSchema,
  })
  .openapi("EarnPerformanceItem");

export const EarnPerformanceResponse = envelope(
  "EarnPerformanceResponse",
  z.object({ items: z.array(EarnPerformanceItem) }),
);

export const EndpointParams = z.object({
  id: z
    .string()
    .regex(/^whe_[a-f0-9]{16}$/)
    .openapi({ description: "Webhook endpoint ID" }),
});

export const CreateWebhookEndpointRequest = z
  .object({
    url: z.string().url().openapi({ description: "Destination URL to receive signed POST webhooks." }),
    events: z.array(z.string()).min(1).openapi({ description: "List of event types to subscribe to." }),
  })
  .openapi("CreateWebhookEndpointRequest");

export const WebhookEndpointView = z
  .object({
    id: z.string().openapi({ description: "Unique webhook endpoint ID (whe_...)." }),
    url: z.string().url(),
    events: z.array(z.string()),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    secret: z.string().optional().openapi({ description: "Plaintext webhook secret, returned ONLY upon creation." }),
  })
  .openapi("WebhookEndpoint");

export const WebhookEndpointsResponse = envelope(
  "WebhookEndpointsResponse",
  z.object({ items: z.array(WebhookEndpointView) }),
);

export const WebhookEndpointCreatedResponse = envelope("WebhookEndpointCreatedResponse", WebhookEndpointView);

export const WebhookEndpointDeleteResponse = envelope(
  "WebhookEndpointDeleteResponse",
  z.object({ deleted: z.boolean() }),
);
