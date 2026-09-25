import { createRoute } from "@hono/zod-openapi";
import {
  CapabilitiesResponse,
  ChallengeRequest,
  ChallengeResponse,
  CreateWebhookEndpointRequest,
  EarnOptionsResponse,
  EarnPerformanceQuery,
  EarnPerformanceResponse,
  EndpointParams,
  ErrorBody,
  ListQuery,
  MarketEvidenceResponse,
  MarketRiskResponse,
  MarketsResponse,
  NetworkQuery,
  PlanRequest,
  PlanResponse,
  QuoteRequest,
  QuoteResponse,
  PositionQuery,
  PortfolioAccountingResponse,
  PricesResponse,
  PositionsResponse,
  SessionResponse,
  AttachBroadcastRequest,
  AttachBroadcastResponse,
  CancelWorkflowRequest,
  CancelWorkflowResponse,
  SignatureRequest,
  SignatureResponse,
  StartedWorkflowResponse,
  StartWorkflowRequest,
  SbtcDepositNotifyRequest,
  SbtcDepositNotifyResponse,
  SbtcDepositPrepareRequest,
  SbtcDepositPrepareResponse,
  SwapComparisonRequest,
  SwapComparisonResponse,
  SwapMarketsQuery,
  SwapMarketsResponse,
  ValuationsResponse,
  VerifyRequest,
  WebhookEndpointCreatedResponse,
  WebhookEndpointsResponse,
  WebhookEndpointDeleteResponse,
  WorkflowParams,
  WorkflowListQuery,
  WorkflowResponse,
  WorkflowsResponse,
} from "./schemas.ts";

const error = (description: string) => ({ description, content: { "application/json": { schema: ErrorBody } } });

const errorResponses = {
  400: error("Invalid request or network mismatch"),
  401: error("Missing or invalid credentials"),
  403: error("Credentials do not allow this request"),
  429: error("Rate limit reached. Retry after the number of seconds in retryAfter"),
  500: error("Unexpected error"),
  503: error("Temporarily unavailable"),
} as const;

const anyCaller = [{ apiKey: [] }, { walletSession: [] }, { clientId: [] }];
const browserApp = [{ clientId: [] }];
const keyOrSession = [{ apiKey: [] }, { walletSession: [] }];
const keyOnly = [{ apiKey: [] }];

const json = <T>(description: string, schema: T) => ({ description, content: { "application/json": { schema } } });

const body = <T>(schema: T) => ({ required: true, content: { "application/json": { schema } } });

export const marketsRoute = createRoute({
  method: "get",
  path: "/v1/markets",
  security: anyCaller,
  request: { query: ListQuery },
  responses: { 200: json("Markets with their capabilities", MarketsResponse), ...errorResponses },
});

export const capabilitiesRoute = createRoute({
  method: "get",
  path: "/v1/capabilities",
  security: anyCaller,
  request: { query: ListQuery },
  responses: { 200: json("Capabilities by market and action", CapabilitiesResponse), ...errorResponses },
});

export const challengeRoute = createRoute({
  method: "post",
  path: "/v1/auth/challenge",
  security: browserApp,
  request: { body: body(ChallengeRequest) },
  responses: { 200: json("Message for the wallet to sign", ChallengeResponse), ...errorResponses },
});

export const verifyRoute = createRoute({
  method: "post",
  path: "/v1/auth/verify",
  security: browserApp,
  request: { body: body(VerifyRequest) },
  responses: { 200: json("Wallet session", SessionResponse), ...errorResponses },
});

export const quoteRoute = createRoute({
  method: "post",
  path: "/v1/quotes",
  security: keyOrSession,
  request: { body: body(QuoteRequest) },
  responses: { 200: json("A quote and the unsigned plan that executes it", QuoteResponse), ...errorResponses },
});

export const swapMarketsRoute = createRoute({
  method: "get",
  path: "/v1/swaps/markets",
  security: anyCaller,
  request: { query: SwapMarketsQuery },
  responses: {
    200: json("Live mainnet tokens listed by Bitflow, Velar and ALEX", SwapMarketsResponse),
    ...errorResponses,
  },
});

export const swapComparisonRoute = createRoute({
  method: "post",
  path: "/v1/swaps/quotes",
  security: keyOrSession,
  request: { body: body(SwapComparisonRequest) },
  responses: {
    200: json("Ranked mainnet swap quotes from Bitflow, Velar and ALEX", SwapComparisonResponse),
    ...errorResponses,
  },
});

export const sbtcDepositPrepareRoute = createRoute({
  method: "post",
  path: "/v1/sbtc/deposits/prepare",
  security: keyOrSession,
  request: { body: body(SbtcDepositPrepareRequest) },
  responses: {
    200: json("Unsigned mainnet sBTC deposit address and scripts", SbtcDepositPrepareResponse),
    ...errorResponses,
  },
});

export const sbtcDepositNotifyRoute = createRoute({
  method: "post",
  path: "/v1/sbtc/deposits/notify",
  security: keyOrSession,
  request: { body: body(SbtcDepositNotifyRequest) },
  responses: {
    200: json("Emily accepted the deposit for tracking. This is not a mint.", SbtcDepositNotifyResponse),
    ...errorResponses,
  },
});

export const planRoute = createRoute({
  method: "post",
  path: "/v1/plans",
  security: keyOrSession,
  request: { body: body(PlanRequest) },
  responses: { 200: json("Unsigned plan bound to a posted quote", PlanResponse), ...errorResponses },
});

export const startWorkflowRoute = createRoute({
  method: "post",
  path: "/v1/workflows",
  security: keyOrSession,
  request: { body: body(StartWorkflowRequest) },
  responses: {
    200: json("The workflow and the plan to sign", StartedWorkflowResponse),
    404: error("No such quote"),
    ...errorResponses,
  },
});

export const signatureRoute = createRoute({
  method: "post",
  path: "/v1/workflows/{id}/signature",
  security: keyOrSession,
  request: { params: WorkflowParams, body: body(SignatureRequest) },
  responses: {
    200: json("What the wallet answered, and where the workflow stands", SignatureResponse),
    404: error("No such workflow for the caller"),
    ...errorResponses,
  },
});

export const cancelWorkflowRoute = createRoute({
  method: "post",
  path: "/v1/workflows/{id}/cancel",
  security: keyOrSession,
  request: { params: WorkflowParams, body: body(CancelWorkflowRequest) },
  responses: {
    200: json("Unsigned workflow marked USER_REJECTED", CancelWorkflowResponse),
    404: error("No such workflow for the caller"),
    ...errorResponses,
  },
});

export const attachBroadcastRoute = createRoute({
  method: "post",
  path: "/v1/workflows/{id}/broadcast",
  security: keyOrSession,
  request: { params: WorkflowParams, body: body(AttachBroadcastRequest) },
  responses: {
    200: json("Found Bitcoin txid attached and Emily notified when scripts match", AttachBroadcastResponse),
    404: error("No such workflow for the caller"),
    ...errorResponses,
  },
});

export const earnOptionsRoute = createRoute({
  method: "get",
  path: "/v1/earn/options",
  security: anyCaller,
  request: { query: NetworkQuery },
  responses: { 200: json("What each earn market pays and allows", EarnOptionsResponse), ...errorResponses },
});

export const earnPerformanceRoute = createRoute({
  method: "get",
  path: "/v1/earn/performance",
  security: keyOrSession,
  request: { query: EarnPerformanceQuery },
  responses: {
    200: json(
      "Earned yield attribution, three-tier earnings separation, and historical performance",
      EarnPerformanceResponse,
    ),
    ...errorResponses,
  },
});

export const pricesRoute = createRoute({
  method: "get",
  path: "/v1/prices",
  security: anyCaller,
  request: { query: NetworkQuery },
  responses: { 200: json("Latest price for each feed the platform reads", PricesResponse), ...errorResponses },
});

export const priceValuationsRoute = createRoute({
  method: "get",
  path: "/v1/prices/valuations",
  security: anyCaller,
  request: { query: NetworkQuery },
  responses: {
    200: json("Reconciled price quorum valuations for supported assets", ValuationsResponse),
    ...errorResponses,
  },
});

export const marketRiskRoute = createRoute({
  method: "get",
  path: "/v1/markets/{id}/risk",
  security: keyOrSession,
  request: { params: WorkflowParams, query: PositionQuery },
  responses: {
    200: json("Risk parameters, prices and the caller's position", MarketRiskResponse),
    404: error("No such market"),
    ...errorResponses,
  },
});

export const marketEvidenceRoute = createRoute({
  method: "get",
  path: "/v1/markets/{id}/evidence",
  security: anyCaller,
  request: { params: WorkflowParams, query: NetworkQuery },
  responses: {
    200: json(
      "Full source-tagged evidence, telemetry age, confidence and disagreement for one market",
      MarketEvidenceResponse,
    ),
    404: error("No such market"),
    ...errorResponses,
  },
});

export const positionsRoute = createRoute({
  method: "get",
  path: "/v1/positions",
  security: keyOrSession,
  request: { query: PositionQuery },
  responses: { 200: json("Positions for one address", PositionsResponse), ...errorResponses },
});

export const portfolioRoute = createRoute({
  method: "get",
  path: "/v1/portfolio",
  security: keyOrSession,
  request: { query: PositionQuery },
  responses: {
    200: json("Canonical portfolio and debt accounting for one address", PortfolioAccountingResponse),
    ...errorResponses,
  },
});

export const workflowsRoute = createRoute({
  method: "get",
  path: "/v1/workflows",
  security: keyOrSession,
  request: { query: WorkflowListQuery },
  responses: { 200: json("The caller's workflows, newest first", WorkflowsResponse), ...errorResponses },
});

export const workflowRoute = createRoute({
  method: "get",
  path: "/v1/workflows/{id}",
  security: keyOrSession,
  request: { params: WorkflowParams, query: NetworkQuery },
  responses: {
    200: json("Workflow with its state transitions", WorkflowResponse),
    404: error("No workflow with this id for the caller"),
    ...errorResponses,
  },
});

export const createWebhookEndpointRoute = createRoute({
  method: "post",
  path: "/v1/webhooks/endpoints",
  security: keyOnly,
  request: { body: body(CreateWebhookEndpointRequest) },
  responses: {
    201: json("Created webhook endpoint with secret", WebhookEndpointCreatedResponse),
    ...errorResponses,
  },
});

export const listWebhookEndpointsRoute = createRoute({
  method: "get",
  path: "/v1/webhooks/endpoints",
  security: keyOnly,
  responses: {
    200: json("Active webhook endpoints for tenant", WebhookEndpointsResponse),
    ...errorResponses,
  },
});

export const deleteWebhookEndpointRoute = createRoute({
  method: "delete",
  path: "/v1/webhooks/endpoints/{id}",
  security: keyOnly,
  request: { params: EndpointParams },
  responses: {
    200: json("Endpoint deactivation result", WebhookEndpointDeleteResponse),
    404: error("No such webhook endpoint for caller"),
    ...errorResponses,
  },
});
