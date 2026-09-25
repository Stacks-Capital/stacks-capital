import { requireNetwork, type StacksNetwork } from "@stacks-capital/core";
import { CapitalConfigError } from "./errors.ts";
import {
  DEFAULT_RETRY,
  DEFAULT_TIMEOUT_MS,
  defaultSleep,
  type RequestSpec,
  type RetryPolicy,
  send,
  type Transport,
} from "./http.ts";
import type {
  AssetValuation,
  Challenge,
  EarnOption,
  EarnPerformanceItemView,
  Market,
  MarketCapability,
  MarketEvidence,
  MarketRisk,
  OracleQuoteView,
  Page,
  Position,
  PortfolioAccountingView,
  QuotedPlan,
  Result,
  Session,
  AttachedBroadcast,
  CancelledWorkflow,
  SignatureOutcome,
  StartedWorkflow,
  SwapMarketCatalog,
  SwapQuoteComparison,
  PreparedSbtcDeposit,
  NotifiedSbtcDeposit,
  Workflow,
  WorkflowSummary,
  WebhookEndpoint,
  CreateWebhookEndpointInput,
} from "./types.ts";

export const CLIENT_ID_HEADER = "x-capital-client-id";

export type ClientOptions = {
  baseUrl: string;
  network: StacksNetwork;
  /** Publishable id, safe in browser code. The API only accepts it from an origin the app allows. */
  clientId?: string | undefined;
  /** Secret key. Server side only: building a client with one in a browser throws. */
  apiKey?: string | undefined;
  /** Wallet session token from verify(). */
  sessionToken?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  jitter?: () => number;
};

export type CallOptions = { signal?: AbortSignal | undefined };
export type PageOptions = CallOptions & { limit?: number | undefined; cursor?: string | undefined };

function isBrowser(): boolean {
  return typeof globalThis === "object" && "window" in globalThis && "document" in globalThis;
}

/**
 * Primary HTTP API client for Stacks Capital.
 * Works seamlessly across browser and server environments.
 * Every query returns both the response payload and canonical telemetry context
 * (requestId, network, observedAt, blockHeight, blockHash, staleness, and warnings).
 */
export type CapitalClient = {
  /** The target Stacks network (mainnet or testnet). */
  readonly network: StacksNetwork;

  /** True if the client is authenticated with a user session token. */
  readonly hasSession: boolean;

  /** The publishable client id / tenant identifier, if configured. */
  readonly clientId?: string | undefined;

  /**
   * Lists available money markets with pagination.
   * Evidence: Returns telemetry context and current block height.
   * Retries automatically up to configured retry attempts on network or 5xx failures.
   * @throws {CapitalApiError} If the server rejects the request.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  markets(options?: PageOptions): Promise<Page<Market>>;

  /**
   * Fetches all pages of money markets up to maxPages.
   * Evidence: Aggregates verified markets across paginated endpoints.
   * Retries automatically on transient read errors.
   * @throws {CapitalConfigError} If market pages exceed maxPages limit.
   * @throws {CapitalApiError} If the server rejects the request.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  allMarkets(options?: CallOptions & { maxPages?: number }): Promise<Market[]>;

  /**
   * Lists supported protocol capabilities (deposit, borrow, repay, withdraw) per market.
   * Evidence: Telemetry and pause state per capability.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If the server rejects the request.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  capabilities(options?: PageOptions): Promise<Page<MarketCapability>>;

  /**
   * Fetches state, transitions, and step confirmation details for a specific workflow.
   * Evidence: Carries complete state audit trail, confirmed steps, and resume hints.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If workflow is not found or request is invalid.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  workflow(id: string, options?: CallOptions): Promise<Result<Workflow>>;

  /**
   * Issues a cryptographic challenge for wallet authentication.
   * Never retried automatically.
   * @throws {CapitalApiError} If challenge generation fails.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  challenge(input: { address: string }, options?: CallOptions): Promise<Result<Challenge>>;

  /**
   * Verifies a signed wallet challenge and exchanges it for an authenticated session token.
   * Never retried automatically because challenges are single-use.
   * @throws {CapitalApiError} If the signature is invalid or expired.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  verify(
    input: { nonceId: string; publicKey: string; signature: string },
    options?: CallOptions,
  ): Promise<Result<Session>>;

  /**
   * What each earn market pays and allows, as verified factual observations. Ranking is the caller's decision.
   * Evidence: Carries observed APYs, contract addresses, and risk parameters.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If the server rejects the request.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  earnOptions(options?: CallOptions): Promise<Result<{ items: EarnOption[] }>>;

  /**
   * Lists the caller's workflows, newest first, with pagination.
   * Evidence: Returns verified workflow summaries and current execution states.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If the server rejects the request.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  workflows(options?: PageOptions & { owner?: string }): Promise<Page<WorkflowSummary>>;

  /**
   * Latest oracle prices for each feed monitored by the platform.
   * Evidence: Carries feed publisher, publication timestamp, and observation age.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If the server rejects the request.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  prices(options?: CallOptions): Promise<Result<{ items: OracleQuoteView[] }>>;

  /**
   * Reconciled multi-source price quorum valuations for supported assets.
   * Evidence: Carries individual source readings, spread, and staleness flags.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If the server rejects the request.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  priceValuations(options?: CallOptions): Promise<Result<{ items: AssetValuation[] }>>;

  /**
   * Risk parameters, liquidation thresholds, collateral factors, and user position for a market.
   * Evidence: Health factor calculation, oracle timestamps, and borrow caps.
   * Retries automatically on transient read errors.
   * @throws {CapitalFinancialError} If oracle is stale or risk evaluation fails.
   * @throws {CapitalApiError} If the market is not found.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  marketRisk(marketId: string, options?: CallOptions & { owner?: string }): Promise<Result<MarketRisk>>;

  /**
   * Full source-tagged evidence, telemetry age, confidence, and quorum disagreement for one market.
   * Evidence: Granular oracle and protocol telemetry.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If the market is not found.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  marketEvidence(marketId: string, options?: CallOptions): Promise<Result<MarketEvidence>>;

  /**
   * Positions for an address. A session reads its own; an API key can specify an owner.
   * Evidence: Collateral and debt balances verified against on-chain protocol contracts.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If query fails or owner is missing.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  positions(input?: { owner?: string } & CallOptions): Promise<Result<{ items: Position[] }>>;

  /**
   * Canonical portfolio and debt accounting for an address, segregated into capital categories.
   * Evidence: Total assets, debt liabilities, net worth, and risk-weighted collateral valuations.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If query fails.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  portfolio(input?: { owner?: string } & CallOptions): Promise<Result<PortfolioAccountingView>>;

  /**
   * Earned yield attribution, 3-tier earnings separation (realized, claimed, accrued), and historical performance.
   * Evidence: Verified cash flows and non-synthetic canonical observation points.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If query fails.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  earnPerformance(
    input?: { owner?: string; marketId?: string } & CallOptions,
  ): Promise<Result<{ items: EarnPerformanceItemView[] }>>;

  /**
   * Requests a server-verified quote and execution plan for an intent.
   * Failure Semantics: Never auto-retried to avoid submitting non-idempotent writes.
   * @throws {CapitalFinancialError} If quote expired, caps reached, oracle stale, or insufficient balance.
   * @throws {CapitalApiError} If parameters or action are invalid.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  quote(
    input: {
      marketId: string;
      action: string;
      amount: string;
      owner?: string;
      slippageBps?: string;
      maxFee?: string;
      recipient?: string;
    },
    options?: CallOptions,
  ): Promise<Result<QuotedPlan>>;

  /**
   * Lists live mainnet tokens from Bitflow, Velar and ALEX.
   * Identities are exact contract IDs. A venue catalog failure never removes tokens listed by the others.
   */
  swapMarkets(options?: CallOptions): Promise<Result<SwapMarketCatalog>>;

  /**
   * Compares exact-asset mainnet quotes from Bitflow, Velar and ALEX.
   * Offers are ranked by guaranteed minimum output. A provider failure does not hide healthy offers.
   */
  swapQuotes(
    input: {
      inputAsset: string;
      outputAsset: string;
      amount: string;
      slippageBps?: number;
      owner?: string;
    },
    options?: CallOptions,
  ): Promise<Result<SwapQuoteComparison>>;

  /**
   * Builds the official mainnet sBTC P2TR deposit address and scripts.
   * This is not a mint. The host wallet still has to send Bitcoin and notify Emily.
   */
  prepareSbtcDeposit(
    input: {
      stacksRecipient: string;
      amountSats: string;
      maxSignerFeeSats: string;
      reclaimPublicKey: string;
      reclaimLockTime?: number;
    },
    options?: CallOptions,
  ): Promise<Result<PreparedSbtcDeposit>>;

  /**
   * Tells Emily about a broadcast Bitcoin deposit. Accepted/pending is tracking, never completion.
   */
  notifySbtcDeposit(
    input: {
      bitcoinTxid: string;
      bitcoinTxOutputIndex?: number;
      transactionHex?: string;
      depositScript: string;
      reclaimScript: string;
      stacksRecipient: string;
      amountSats: string;
      maxSignerFeeSats: string;
    },
    options?: CallOptions,
  ): Promise<Result<NotifiedSbtcDeposit>>;

  /**
   * Initiates an execution workflow bound to an existing quote.
   * Failure Semantics: Uses idempotencyKey to guarantee exactly-once workflow creation. Never auto-retried.
   * @throws {CapitalFinancialError} If quote expired or plan is invalid.
   * @throws {CapitalApiError} If quote is not found or request is malformed.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  startWorkflow(
    input: { quoteId: string; idempotencyKey: string; ownerAddress?: string },
    options?: CallOptions,
  ): Promise<Result<StartedWorkflow>>;

  /**
   * Reports the raw outcome of a wallet signature attempt for a workflow step.
   * Failure Semantics: Records broadcast txid or wallet rejection. An unknown broadcast is recorded
   * and never retried blindly to prevent double-execution.
   * @throws {CapitalFinancialError} If step cannot be signed or workflow state forbids transition.
   * @throws {CapitalApiError} If workflow or step does not exist.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  recordSignature(
    workflowId: string,
    input: { stepId: string; walletResult: unknown },
    options?: CallOptions,
  ): Promise<Result<SignatureOutcome>>;

  /**
   * Cancels a workflow that is still awaiting a signature. Broadcast-unknown workflows cannot use
   * this path — a missing txid is not proof that nothing moved.
   */
  cancelWorkflow(workflowId: string, options?: CallOptions): Promise<Result<CancelledWorkflow>>;

  /**
   * Attaches a Bitcoin txid found after an uncertain wallet answer and notifies Emily when the
   * deposit script matches the on-chain output.
   */
  attachFoundBroadcast(
    workflowId: string,
    input: { txid: string; reclaimPublicKey?: string },
    options?: CallOptions,
  ): Promise<Result<AttachedBroadcast>>;

  /**
   * Creates a new signed webhook endpoint for receiving async event notifications.
   * Server-only method requiring tenant authentication.
   * @throws {CapitalApiError} If URL is invalid or tenant is unauthorized.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  createWebhookEndpoint(input: CreateWebhookEndpointInput, options?: CallOptions): Promise<Result<WebhookEndpoint>>;

  /**
   * Lists active webhook endpoints registered for the authenticated tenant.
   * Retries automatically on transient read errors.
   * @throws {CapitalApiError} If tenant is unauthorized.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  webhookEndpoints(options?: CallOptions): Promise<Result<{ items: WebhookEndpoint[] }>>;

  /**
   * Deactivates and deletes a webhook endpoint by ID.
   * Never retried automatically.
   * @throws {CapitalApiError} If endpoint does not exist or tenant is unauthorized.
   * @throws {CapitalTransportError} If network or timeout fails.
   */
  deleteWebhookEndpoint(id: string, options?: CallOptions): Promise<Result<{ deleted: boolean }>>;

  /**
   * Returns a new client clone bound to the specified wallet session token.
   * The original client instance remains unmodified.
   */
  withSession(sessionToken: string): CapitalClient;
};

export function createClient(options: ClientOptions): CapitalClient {
  const network = requireNetwork(options.network);
  if (!/^https?:\/\//.test(options.baseUrl)) {
    throw new CapitalConfigError("baseUrl must be an absolute http or https URL");
  }
  // A secret key in browser code would ship in the bundle and be readable by anyone (SDK-01, page 03).
  if (options.apiKey !== undefined && isBrowser()) {
    throw new CapitalConfigError("An API key must never be used in a browser. Use a client id and a wallet session.");
  }
  if (options.apiKey === undefined && options.clientId === undefined && options.sessionToken === undefined) {
    throw new CapitalConfigError("Provide a clientId, an apiKey or a sessionToken");
  }

  const transport: Transport = {
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    // Browsers refuse fetch called on anything but the window ("Illegal invocation"), so it is never
    // stored bare and called as a method of another object.
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retry: { ...DEFAULT_RETRY, ...options.retry },
    sleep: options.sleep ?? defaultSleep,
    jitter: options.jitter ?? Math.random,
  };

  const headers = (): Record<string, string> => {
    const built: Record<string, string> = { accept: "application/json" };
    if (options.clientId !== undefined) built[CLIENT_ID_HEADER] = options.clientId;
    // A session speaks for a signed in user, so it wins over a server key when both are configured.
    const bearer = options.sessionToken ?? options.apiKey;
    if (bearer !== undefined) built.authorization = `Bearer ${bearer}`;
    return built;
  };

  const call = <T>(spec: Omit<RequestSpec, "headers">) => send<T>(transport, { ...spec, headers: headers() });

  const listPage = async <T>(path: string, page: PageOptions | undefined): Promise<Page<T>> => {
    const { data, context } = await call<{ items: T[]; nextCursor: string | null }>({
      method: "GET",
      path,
      query: { network, limit: page?.limit, cursor: page?.cursor },
      signal: page?.signal,
      retry: true,
    });
    return { items: data.items, nextCursor: data.nextCursor, context };
  };

  const client: CapitalClient = {
    network,
    hasSession: options.sessionToken !== undefined,
    clientId: options.clientId,

    markets: (page) => listPage<Market>("/v1/markets", page),
    capabilities: (page) => listPage<MarketCapability>("/v1/capabilities", page),

    async allMarkets(call_) {
      const maxPages = call_?.maxPages ?? 20;
      const items: Market[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < maxPages; page += 1) {
        const next = await client.markets({ limit: 100, cursor, signal: call_?.signal });
        items.push(...next.items);
        if (next.nextCursor === null) return items;
        cursor = next.nextCursor;
      }
      throw new CapitalConfigError(`Markets did not finish within ${maxPages} pages`);
    },

    workflow: (id, call_) =>
      call<Workflow>({
        method: "GET",
        path: `/v1/workflows/${encodeURIComponent(id)}`,
        query: { network },
        signal: call_?.signal,
        retry: true,
      }),

    challenge: (input, call_) =>
      call<Challenge>({
        method: "POST",
        path: "/v1/auth/challenge",
        body: { network, address: input.address },
        signal: call_?.signal,
        retry: false,
      }),

    // Never retried: a challenge can be answered once, so a second attempt would always fail.
    verify: (input, call_) =>
      call<Session>({
        method: "POST",
        path: "/v1/auth/verify",
        body: { network, ...input },
        signal: call_?.signal,
        retry: false,
      }),

    earnOptions: (call_) =>
      call<{ items: EarnOption[] }>({
        method: "GET",
        path: "/v1/earn/options",
        query: { network },
        signal: call_?.signal,
        retry: true,
      }),

    workflows: async (page) => {
      const { data, context } = await call<{ items: WorkflowSummary[]; nextCursor: string | null }>({
        method: "GET",
        path: "/v1/workflows",
        query: { network, limit: page?.limit, cursor: page?.cursor, owner: page?.owner },
        signal: page?.signal,
        retry: true,
      });
      return { items: data.items, nextCursor: data.nextCursor, context };
    },

    prices: (call_) =>
      call<{ items: OracleQuoteView[] }>({
        method: "GET",
        path: "/v1/prices",
        query: { network },
        signal: call_?.signal,
        retry: true,
      }),

    priceValuations: (call_) =>
      call<{ items: AssetValuation[] }>({
        method: "GET",
        path: "/v1/prices/valuations",
        query: { network },
        signal: call_?.signal,
        retry: true,
      }),

    marketRisk: (marketId, call_) =>
      call<MarketRisk>({
        method: "GET",
        path: `/v1/markets/${encodeURIComponent(marketId)}/risk`,
        query: { network, owner: call_?.owner },
        signal: call_?.signal,
        retry: true,
      }),

    marketEvidence: (marketId, call_) =>
      call<MarketEvidence>({
        method: "GET",
        path: `/v1/markets/${encodeURIComponent(marketId)}/evidence`,
        query: { network },
        signal: call_?.signal,
        retry: true,
      }),

    positions: (call_) =>
      call<{ items: Position[] }>({
        method: "GET",
        path: "/v1/positions",
        query: { network, owner: call_?.owner },
        signal: call_?.signal,
        retry: true,
      }),

    portfolio: (call_) =>
      call<PortfolioAccountingView>({
        method: "GET",
        path: "/v1/portfolio",
        query: { network, owner: call_?.owner },
        signal: call_?.signal,
        retry: true,
      }),

    earnPerformance: (call_) =>
      call<{ items: EarnPerformanceItemView[] }>({
        method: "GET",
        path: "/v1/earn/performance",
        query: { network, owner: call_?.owner, marketId: call_?.marketId },
        signal: call_?.signal,
        retry: true,
      }),

    quote: (input, call_) =>
      call<QuotedPlan>({
        method: "POST",
        path: "/v1/quotes",
        body: { network, ...input },
        signal: call_?.signal,
        retry: false,
      }),

    swapMarkets: (call_) =>
      call<SwapMarketCatalog>({
        method: "GET",
        path: "/v1/swaps/markets",
        query: { network },
        signal: call_?.signal,
        retry: true,
      }),

    swapQuotes: (input, call_) =>
      call<SwapQuoteComparison>({
        method: "POST",
        path: "/v1/swaps/quotes",
        body: { network, ...input },
        signal: call_?.signal,
        retry: false,
      }),

    prepareSbtcDeposit: (input, call_) =>
      call<PreparedSbtcDeposit>({
        method: "POST",
        path: "/v1/sbtc/deposits/prepare",
        body: { network, ...input },
        signal: call_?.signal,
        retry: false,
      }),

    notifySbtcDeposit: (input, call_) =>
      call<NotifiedSbtcDeposit>({
        method: "POST",
        path: "/v1/sbtc/deposits/notify",
        body: { network, ...input },
        signal: call_?.signal,
        retry: false,
      }),

    startWorkflow: (input, call_) =>
      call<StartedWorkflow>({
        method: "POST",
        path: "/v1/workflows",
        body: { network, ...input },
        signal: call_?.signal,
        retry: false,
      }),

    recordSignature: (workflowId, input, call_) =>
      call<SignatureOutcome>({
        method: "POST",
        path: `/v1/workflows/${encodeURIComponent(workflowId)}/signature`,
        body: { network, ...input },
        signal: call_?.signal,
        retry: false,
      }),

    cancelWorkflow: (workflowId, call_) =>
      call<CancelledWorkflow>({
        method: "POST",
        path: `/v1/workflows/${encodeURIComponent(workflowId)}/cancel`,
        body: { network },
        signal: call_?.signal,
        retry: false,
      }),

    attachFoundBroadcast: (workflowId, input, call_) =>
      call<AttachedBroadcast>({
        method: "POST",
        path: `/v1/workflows/${encodeURIComponent(workflowId)}/broadcast`,
        body: { network, ...input },
        signal: call_?.signal,
        retry: false,
      }),

    createWebhookEndpoint: (input, call_) =>
      call<WebhookEndpoint>({
        method: "POST",
        path: "/v1/webhooks/endpoints",
        body: input,
        signal: call_?.signal,
        retry: false,
      }),

    webhookEndpoints: (call_) =>
      call<{ items: WebhookEndpoint[] }>({
        method: "GET",
        path: "/v1/webhooks/endpoints",
        signal: call_?.signal,
        retry: true,
      }),

    deleteWebhookEndpoint: (id, call_) =>
      call<{ deleted: boolean }>({
        method: "DELETE",
        path: `/v1/webhooks/endpoints/${encodeURIComponent(id)}`,
        signal: call_?.signal,
        retry: false,
      }),

    withSession: (sessionToken) => createClient({ ...options, sessionToken }),
  };

  return client;
}
