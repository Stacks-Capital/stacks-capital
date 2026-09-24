import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createExecutionEngine } from "@stacks-capital/engine";
import { FIXTURE_NOW, MAINNET_OWNER, MAINNET_READS } from "@stacks-capital/fixtures";
import {
  CapitalApiError,
  CapitalConfigError,
  CapitalFinancialError,
  CapitalTransportError,
  compareSwaps,
  createStacksCapital,
  createClient,
  formatQuantity,
  formatUnits,
  isCapitalApiError,
  isCapitalFinancialError,
  isFinancialError,
  isInvestigationError,
  isRequoteError,
  isRetryableRead,
  isUserActionError,
  parseFinancialJson,
  parseQuantity,
  parseUnits,
  safeBigIntReplacer,
  serializeFinancialJson,
  type CapitalClient,
  type StacksCapital,
  type Plan,
  type Quote,
} from "./index.ts";

describe("I29: Clean Consumer Compatibility & SDK Surface", () => {
  describe("Browser and Server Execution Environments", () => {
    it("runs in a browser environment using clientId without API key", () => {
      // Simulate browser global environment
      const prevWindow = (globalThis as unknown as { window?: unknown }).window;
      const prevDoc = (globalThis as unknown as { document?: unknown }).document;
      try {
        (globalThis as unknown as { window: unknown }).window = {};
        (globalThis as unknown as { document: unknown }).document = {};

        // Browser client requires clientId or sessionToken, forbids secret apiKey
        const client = createClient({
          baseUrl: "https://api.example",
          network: "mainnet",
          clientId: "cid_browser_123",
          fetch: async () => new Response(JSON.stringify({ schemaVersion: "1.0", data: [] })),
        });
        assert.equal(client.network, "mainnet");

        // Attempting to use a secret apiKey in the browser throws CapitalConfigError
        assert.throws(
          () =>
            createClient({
              baseUrl: "https://api.example",
              network: "mainnet",
              apiKey: "sk_secret_never_in_browser",
            }),
          (error: unknown) => error instanceof CapitalConfigError && /API key must never be used/i.test(error.message),
        );
      } finally {
        if (prevWindow === undefined) delete (globalThis as unknown as { window?: unknown }).window;
        else (globalThis as unknown as { window: unknown }).window = prevWindow;

        if (prevDoc === undefined) delete (globalThis as unknown as { document?: unknown }).document;
        else (globalThis as unknown as { document: unknown }).document = prevDoc;
      }
    });

    it("runs in a server environment using server apiKey", () => {
      const serverClient = createClient({
        baseUrl: "https://api.example",
        network: "mainnet",
        apiKey: "sk_server_service_key",
        fetch: async () => new Response(JSON.stringify({ schemaVersion: "1.0", data: [] })),
      });
      assert.equal(serverClient.network, "mainnet");
    });
  });

  describe("Read, Quote, Plan, Workflow, and Validation Clients", () => {
    const mockEnvelope = (data: unknown) =>
      new Response(
        JSON.stringify({
          schemaVersion: "1.0",
          requestId: "req_test_1",
          network: "stacks:mainnet",
          data,
          context: { observedAt: "2026-09-22T00:00:00.000Z", stale: false, warnings: [] },
        }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_test_1" } },
      );

    it("executes public read operations through CapitalClient", async () => {
      const recordedUrls: string[] = [];
      const client: CapitalClient = createClient({
        baseUrl: "https://api.example",
        network: "mainnet",
        clientId: "cid_123",
        fetch: async (input) => {
          recordedUrls.push(String(input));
          return mockEnvelope({ items: [], nextCursor: null });
        },
      });

      const markets = await client.markets();
      assert.ok(Array.isArray(markets.items));
      assert.equal(markets.context.requestId, "req_test_1");
      assert.match(recordedUrls[0] ?? "", /v1\/markets\?network=mainnet/);

      const prices = await client.prices();
      assert.ok(Array.isArray(prices.data.items));
      assert.match(recordedUrls[1] ?? "", /v1\/prices\?network=mainnet/);
    });

    it("compares live swap venues through the public SDK client", async () => {
      const recorded: { url: string; method: string }[] = [];
      const catalog = {
        items: [
          {
            key: "stx",
            assetId: "stacks:mainnet:native:stx",
            symbol: "STX",
            name: "Stacks",
            decimals: 6,
            providers: ["bitflow"],
          },
        ],
        sources: {
          bitflow: { status: "ok", count: 1, reason: null },
          velar: { status: "unavailable", count: 0, reason: "timeout" },
          alex: { status: "ok", count: 0, reason: null },
        },
      };
      const comparison = {
        assets: catalog.items,
        offers: [
          {
            provider: "bitflow",
            rank: 1,
            status: "quote_only",
            inputAsset: "stacks:mainnet:native:stx",
            outputAsset: "stacks:mainnet:contract:SM3.sbtc-token:sbtc-token",
            amountIn: "1000000",
            amountOut: "305",
            minimumAmountOut: "304",
            fee: null,
            priceImpactBps: null,
            route: ["SP.bitflow"],
            targetContract: "SP.bitflow",
            observedAt: "2026-09-24T10:00:00.000Z",
            expiresAt: "2026-09-24T10:00:30.000Z",
            evidenceSource: "bitflow-fixture",
            executionReason: "fixture",
          },
        ],
        unavailable: [{ provider: "alex", reason: "This pair is not listed" }],
      };
      const client: CapitalClient = createClient({
        baseUrl: "https://api.example",
        network: "mainnet",
        clientId: "cid_123",
        fetch: async (input, init) => {
          recorded.push({ url: String(input), method: init?.method ?? "GET" });
          return mockEnvelope(String(input).includes("/v1/swaps/markets") ? catalog : comparison);
        },
      });
      const result = await compareSwaps({
        client,
        inputAsset: "stacks:mainnet:native:stx",
        outputAsset: "stacks:mainnet:contract:SM3.sbtc-token:sbtc-token",
        amount: "1000000",
        owner: MAINNET_OWNER,
      });
      assert.equal(result.selected?.provider, "bitflow");
      assert.equal(result.recommended?.rank, 1);
      assert.match(recorded[0]?.url ?? "", /v1\/swaps\/markets\?network=mainnet/);
      assert.equal(recorded[1]?.method, "POST");
    });

    it("orchestrates local quote, plan validation, and state machine transitions through Stacks Capital", () => {
      const engine = createExecutionEngine({
        network: "mainnet",
        reads: MAINNET_READS,
        owner: MAINNET_OWNER,
        now: new Date(FIXTURE_NOW),
      });
      const os: StacksCapital = createStacksCapital({ network: "mainnet", now: new Date(FIXTURE_NOW) });
      assert.equal(os.network, "mainnet");

      const intent = { action: "supply" as const, marketId: "zest.sbtc.vault", amount: "99999000" };
      const { quote, plan }: { quote: Quote; plan: Plan } = engine.quoteAndPlan(intent);

      // 1. Validate plan binding to quote
      const validation = os.validate(plan, quote, { sender: MAINNET_OWNER });
      assert.equal(validation.ok, true);

      // 2. Hard signing boundary gate
      assert.doesNotThrow(() => os.assertReadyToSign(plan, quote, { sender: MAINNET_OWNER }));

      // 3. Workflow progression
      let workflow = os.startWorkflow({ id: "wf_1", idempotencyKey: "idem_1" });
      assert.equal(workflow.state, "DRAFT");

      workflow = os.recordQuote(workflow, quote);
      assert.equal(workflow.state, "QUOTED");

      workflow = os.recordPlan(workflow, plan, quote, { sender: MAINNET_OWNER });
      assert.equal(workflow.state, "AWAITING_SIGNATURE");

      workflow = os.recordBroadcast(workflow, "0xdeadbeef");
      assert.equal(workflow.state, "SUBMITTED");

      workflow = os.beginConfirming(workflow, "block_100");
      assert.equal(workflow.state, "CONFIRMING");

      workflow = os.markStepConfirmed(workflow, "step_1_confirmed");
      workflow = os.beginReconciling(workflow, "start_reconcile");
      assert.equal(workflow.state, "RECONCILING");

      workflow = os.completeFromReconciliation(workflow, {
        matched: true,
        evidence: "State changes matched expected amounts",
      });
      assert.equal(workflow.state, "COMPLETED");
    });
  });

  describe("Typed Financial Errors", () => {
    it("classifies API errors into actionable financial categories", () => {
      const requoteErr = new CapitalFinancialError({
        code: "QUOTE_EXPIRED",
        message: "Quote expired",
        status: 400,
        requestId: "req_1",
        action: "supply",
      });

      assert.ok(isCapitalApiError(requoteErr));
      assert.ok(isCapitalFinancialError(requoteErr));
      assert.ok(isFinancialError(requoteErr));
      assert.equal(requoteErr.action, "supply");
      assert.equal(requoteErr.isRequote(), true);
      assert.equal(requoteErr.isUserAction(), false);
      assert.equal(requoteErr.isInvestigation(), false);
      assert.equal(requoteErr.isRetryableRead(), false);
      assert.equal(isRequoteError(requoteErr), true);

      const userErr = new CapitalFinancialError({
        code: "INSUFFICIENT_BALANCE",
        message: "Wallet balance too low",
        status: 400,
        requestId: "req_2",
      });
      assert.equal(userErr.isUserAction(), true);
      assert.equal(isUserActionError(userErr), true);

      const investErr = new CapitalFinancialError({
        code: "BROADCAST_UNKNOWN",
        message: "Broadcast status indeterminate",
        status: 500,
        requestId: "req_3",
      });
      assert.equal(investErr.isInvestigation(), true);
      assert.equal(isInvestigationError(investErr), true);

      const apiErr = new CapitalApiError({
        code: "RATE_LIMITED",
        message: "Too many requests",
        status: 429,
        requestId: "req_rl",
      });
      assert.equal(isRetryableRead(apiErr), true);

      const transportErr = new CapitalTransportError("timeout", "HTTP timeout");
      assert.equal(isCapitalFinancialError(transportErr), false);
    });
  });

  describe("Safe BigInt and Fixed-Point Serialization", () => {
    it("round-trips fixed-point units without precision loss or float drift", () => {
      // sBTC 8 decimals
      const sbtcSatoshis = parseUnits("1.00000001", 8);
      assert.equal(sbtcSatoshis, 100000001n);
      assert.equal(formatUnits(sbtcSatoshis, 8), "1.00000001");
      assert.equal(formatUnits(sbtcSatoshis, 8, { maxDecimals: 4 }), "1.0000");
      assert.equal(formatUnits(sbtcSatoshis, 8, { maxDecimals: 4, trimTrailingZeros: true }), "1");
      assert.equal(formatQuantity(sbtcSatoshis), "100000001");

      // USDCx 6 decimals
      const usdcxUnits = parseUnits("250.50", 6);
      assert.equal(usdcxUnits, 250500000n);
      assert.equal(formatUnits(usdcxUnits, 6, { trimTrailingZeros: true }), "250.5");

      // 18 decimals
      const wei = parseUnits("1.0", 18);
      assert.equal(wei, 1000000000000000000n);
      assert.equal(formatUnits(wei, 18, { trimTrailingZeros: true }), "1");
    });

    it("safely serializes objects containing BigInt properties to JSON", () => {
      assert.equal(safeBigIntReplacer("balance", 50000000n), "50000000");

      const payload = {
        market: "zest.sbtc.vault",
        amount: 50000000n,
        maxBorrow: 125000000n,
      };

      const serialized = serializeFinancialJson(payload);
      assert.equal(serialized, '{"market":"zest.sbtc.vault","amount":"50000000","maxBorrow":"125000000"}');

      const parsed = parseFinancialJson<{ market: string; amount: string; maxBorrow: string }>(serialized);
      assert.equal(parsed.market, "zest.sbtc.vault");
      assert.equal(parseQuantity(parsed.amount), 50000000n);
      assert.equal(parseQuantity(parsed.maxBorrow), 125000000n);
    });
  });
});
