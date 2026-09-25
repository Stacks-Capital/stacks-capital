import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CapitalClient, CLIENT_ID_HEADER, type ClientOptions, createClient } from "./client.ts";
import {
  CapitalApiError,
  CapitalConfigError,
  CapitalTransportError,
  errorClassOf,
  isCapitalApiError,
  isCapitalFinancialError,
  isRetryable,
} from "./errors.ts";

const BASE = "https://api.example";
const MARKET = {
  id: "zest.sbtc.vault",
  network: "mainnet",
  protocol: "zest",
  suppliedAssetId: "stacks:mainnet:contract:SP1.sbtc-token:sbtc-token",
  receiptAssetId: null,
  capabilities: [],
};

type Call = { url: string; method: string; headers: Headers; body: string | null };

function recorder(responses: (Response | (() => Response))[]) {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next === undefined) throw new Error("no response queued");
    return typeof next === "function" ? next() : next.clone();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const envelope = (data: unknown, extras: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      schemaVersion: "1.0",
      requestId: "req_1",
      network: "stacks:mainnet",
      data,
      context: { observedAt: "2026-09-18T09:00:00.000Z", stale: false, warnings: [] },
      ...extras,
    }),
    { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_1" } },
  );

const apiError = (status: number, code: string, extras: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      schemaVersion: "1.0",
      requestId: "req_err",
      error: { code, message: `${code} happened`, ...extras },
    }),
    { status, headers: { "content-type": "application/json", "x-request-id": "req_err" } },
  );

function build(responses: (Response | (() => Response))[], options: Partial<ClientOptions> = {}) {
  const { calls, fetchImpl } = recorder(responses);
  const client: CapitalClient = createClient({
    baseUrl: BASE,
    network: "mainnet",
    clientId: "pk_demo_sandbox",
    fetch: fetchImpl,
    sleep: async () => {},
    jitter: () => 0,
    ...options,
  });
  return { client, calls };
}

describe("building a client", () => {
  it("refuses an API key in a browser, where the bundle is public", () => {
    const globals = globalThis as { window?: unknown; document?: unknown };
    globals.window = {};
    globals.document = {};
    try {
      assert.throws(
        () => createClient({ baseUrl: BASE, network: "mainnet", apiKey: "key_1.secret" }),
        (error: unknown) =>
          error instanceof CapitalConfigError && /never be used in a browser/.test((error as Error).message),
      );
      // A client id is publishable, so the same call is fine in a browser.
      assert.ok(createClient({ baseUrl: BASE, network: "mainnet", clientId: "pk_demo_sandbox" }));
    } finally {
      globals.window = undefined;
      globals.document = undefined;
      delete globals.window;
      delete globals.document;
    }
  });

  it("refuses a relative base URL, an unknown network and no credentials at all", () => {
    assert.throws(() => createClient({ baseUrl: "/v1", network: "mainnet", clientId: "pk_1" }), CapitalConfigError);
    assert.throws(() => createClient({ baseUrl: BASE, network: "devnet" as "mainnet", clientId: "pk_1" }));
    assert.throws(() => createClient({ baseUrl: BASE, network: "mainnet" }), CapitalConfigError);
  });

  it("sends the client id, and a session token in the Authorization header", async () => {
    const { client, calls } = build([envelope({ items: [MARKET], nextCursor: null })]);
    await client.markets();
    assert.equal(calls[0]?.headers.get(CLIENT_ID_HEADER), "pk_demo_sandbox");
    assert.equal(calls[0]?.headers.get("authorization"), null);

    const signedIn = client.withSession("ses_1.secret");
    const second = build([envelope({ items: [], nextCursor: null })], { sessionToken: "ses_1.secret" });
    await second.client.markets();
    assert.equal(second.calls[0]?.headers.get("authorization"), "Bearer ses_1.secret");
    assert.equal(signedIn.hasSession, true);
    assert.equal(client.hasSession, false);
  });

  it("never puts a credential in the URL", async () => {
    const { client, calls } = build([envelope({ items: [], nextCursor: null })], {
      clientId: undefined,
      apiKey: "key_1.secret",
    });
    await client.markets();
    assert.doesNotMatch(calls[0]?.url ?? "", /secret/);
    assert.equal(calls[0]?.headers.get("authorization"), "Bearer key_1.secret");
  });
});

describe("the default fetch", () => {
  it("is called the way browsers require, not detached from the global object", async () => {
    const original = globalThis.fetch;
    // Browsers throw when fetch runs with any receiver other than the global object. This does the same.
    globalThis.fetch = function (this: unknown, ..._args: unknown[]) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(envelope({ items: [], nextCursor: null }));
    } as typeof fetch;
    try {
      const client = createClient({ baseUrl: BASE, network: "mainnet", clientId: "pk_1" });
      const page = await client.markets();
      assert.deepEqual(page.items, []);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("reads", () => {
  it("always sends the network and returns the envelope context", async () => {
    const { client, calls } = build([envelope({ items: [MARKET], nextCursor: "cursor_2" })]);
    const page = await client.markets({ limit: 2 });
    assert.equal(calls[0]?.url, `${BASE}/v1/markets?network=mainnet&limit=2`);
    assert.deepEqual(page.items, [MARKET]);
    assert.equal(page.nextCursor, "cursor_2");
    assert.deepEqual(page.context, {
      requestId: "req_1",
      network: "mainnet",
      observedAt: "2026-09-18T09:00:00.000Z",
      stale: false,
      warnings: [],
    });
  });

  it("follows cursors to collect every market", async () => {
    const pages = [
      envelope({ items: [MARKET], nextCursor: "cursor_2" }),
      envelope({ items: [{ ...MARKET, id: "granite.sbtc.isolated" }], nextCursor: null }),
    ];
    const { client, calls } = build(pages);
    const markets = await client.allMarkets();
    assert.deepEqual(
      markets.map((market) => market.id),
      ["zest.sbtc.vault", "granite.sbtc.isolated"],
    );
    assert.match(calls[1]?.url ?? "", /cursor=cursor_2/);
  });

  it("reads a workflow by id", async () => {
    const workflow = { id: "wf_1", network: "mainnet", state: "CONFIRMING", transitions: [] };
    const { client, calls } = build([envelope(workflow)]);
    const result = await client.workflow("wf_1");
    assert.equal(calls[0]?.url, `${BASE}/v1/workflows/wf_1?network=mainnet`);
    assert.equal(result.data.state, "CONFIRMING");
    assert.equal(result.context.requestId, "req_1");
  });

  it("attaches a found Bitcoin broadcast", async () => {
    const { client, calls } = build([
      envelope({
        state: "SUBMITTED",
        nextAction: "WAIT",
        txid: "aa".repeat(32),
        emilyNotified: true,
        emilyStatus: "pending",
      }),
    ]);
    const result = await client.attachFoundBroadcast("wf_1", { txid: "aa".repeat(32) });
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, `${BASE}/v1/workflows/wf_1/broadcast`);
    assert.equal(result.data.state, "SUBMITTED");
    assert.equal(result.data.emilyNotified, true);
  });

  it("cancels an unsigned workflow", async () => {
    const { client, calls } = build([envelope({ state: "USER_REJECTED", nextAction: "START_NEW" })]);
    const result = await client.cancelWorkflow("wf_1");
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, `${BASE}/v1/workflows/wf_1/cancel`);
    assert.equal(result.data.state, "USER_REJECTED");
    assert.equal(calls[0]?.body, JSON.stringify({ network: "mainnet" }));
  });

  it("reads earn performance attribution and charts", async () => {
    const performanceData = {
      items: [
        {
          marketId: "zest.sbtc.vault",
          assetId: "sbtc-token",
          attribution: {
            depositsTotal: "100000000",
            withdrawalsTotal: "0",
            netDeposits: "100000000",
            feesTotal: "0",
            claimedRewardsTotal: "0",
            costBasis: "100000000",
            currentValue: "105000000",
            unattributedInflow: "0",
            hasUnattributedInflow: false,
            earnedYield: "5000000",
            warnings: [],
          },
          realizedEarnings: { amount: "0", usdValue: null, assetId: "sbtc-token" },
          accruedEstimate: {
            amount: "5000000",
            usdValue: null,
            assetId: "sbtc-token",
            shareAppreciationAmount: "5000000",
            unclaimedRewards: [],
          },
          forward30dProjection: {
            isProjectionAvailable: true,
            projected30dAmount: "410958",
            projected30dUsd: null,
            rateUsedBps: "500",
            rateStatus: "verified",
            unavailableReason: null,
          },
          chart: {
            hasChart: true,
            points: [],
            observationCount: 2,
            reason: null,
          },
        },
      ],
    };
    const { client, calls } = build([envelope(performanceData)]);
    const res = await client.earnPerformance({ owner: "SP1", marketId: "zest.sbtc.vault" });
    assert.equal(calls[0]?.url, `${BASE}/v1/earn/performance?network=mainnet&owner=SP1&marketId=zest.sbtc.vault`);
    assert.equal(res.data.items[0]?.attribution.earnedYield, "5000000");
    assert.equal(res.data.items[0]?.forward30dProjection.rateStatus, "verified");
  });
});

describe("swap quote comparison", () => {
  it("reads the live mainnet swap catalog", async () => {
    const data = {
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
    const { client, calls } = build([envelope(data)]);
    const result = await client.swapMarkets();
    assert.deepEqual(result.data, data);
    assert.equal(calls[0]?.url, `${BASE}/v1/swaps/markets?network=mainnet`);
  });

  it("posts the exact asset identities and does not retry the provider comparison", async () => {
    const data = { assets: [], offers: [], unavailable: [{ provider: "alex", reason: "pair unavailable" }] };
    const { client, calls } = build([envelope(data)], { sessionToken: "ses_1.secret" });
    const result = await client.swapQuotes({
      inputAsset: "stacks:mainnet:native:stx",
      outputAsset: "stacks:mainnet:contract:SM3.sbtc-token:sbtc-token",
      amount: "1000000",
      slippageBps: 50,
      owner: "SP_OWNER",
    });
    assert.deepEqual(result.data, data);
    assert.equal(calls[0]?.url, `${BASE}/v1/swaps/quotes`);
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
      network: "mainnet",
      inputAsset: "stacks:mainnet:native:stx",
      outputAsset: "stacks:mainnet:contract:SM3.sbtc-token:sbtc-token",
      amount: "1000000",
      slippageBps: 50,
      owner: "SP_OWNER",
    });
  });
});

describe("sBTC deposit prepare and notify", () => {
  it("posts the official prepare and notify routes without retrying", async () => {
    const prepared = {
      address: "bc1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq8x4x2k",
      depositScript: "51",
      reclaimScript: "ac",
      signersPublicKey: "11".repeat(32),
      reclaimLockTime: 144,
      amountSats: "100000",
      maxSignerFeeSats: "1000",
      stacksRecipient: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
      bitcoinNetwork: "mainnet",
      emilyNotifyPath: "/deposit",
    };
    const notified = {
      bitcoinTxid: "22".repeat(32),
      bitcoinTxOutputIndex: 0,
      recipient: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
      amount: "100000",
      status: "accepted",
      statusMessage: "tracked",
      complete: false,
      parameters: { lockTime: 144, maxFee: "1000" },
    };
    const { client, calls } = build([envelope(prepared), envelope(notified)], { sessionToken: "ses_1.secret" });
    const first = await client.prepareSbtcDeposit({
      stacksRecipient: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
      amountSats: "100000",
      maxSignerFeeSats: "1000",
      reclaimPublicKey: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    });
    assert.equal(first.data.address, prepared.address);
    assert.equal(calls[0]?.url, `${BASE}/v1/sbtc/deposits/prepare`);
    const second = await client.notifySbtcDeposit({
      bitcoinTxid: "22".repeat(32),
      depositScript: "51",
      reclaimScript: "ac",
      stacksRecipient: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
      amountSats: "100000",
      maxSignerFeeSats: "1000",
    });
    assert.equal(second.data.complete, false);
    assert.equal(calls[1]?.url, `${BASE}/v1/sbtc/deposits/notify`);
  });
});

describe("sign in", () => {
  it("asks for a challenge and exchanges a signature for a session", async () => {
    const challenge = { nonceId: "non_1", message: "sign me", expiresAt: "2026-09-18T09:05:00.000Z" };
    const session = {
      token: "ses_1.secret",
      sessionId: "ses_1",
      address: "SP1",
      expiresAt: "2026-09-18T10:00:00.000Z",
    };
    const { client, calls } = build([envelope(challenge), envelope(session)]);

    const first = await client.challenge({ address: "SP1" });
    assert.equal(first.data.nonceId, "non_1");
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), { network: "mainnet", address: "SP1" });

    const verified = await client.verify({ nonceId: "non_1", publicKey: "02ab", signature: "ff" });
    assert.equal(verified.data.token, "ses_1.secret");
    assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), {
      network: "mainnet",
      nonceId: "non_1",
      publicKey: "02ab",
      signature: "ff",
    });
  });
});

describe("webhooks", () => {
  it("creates, lists and deletes webhook endpoints", async () => {
    const createdEp = {
      id: "whe_1",
      url: "https://example.com/webhook",
      events: ["workflow.completed"],
      active: true,
      createdAt: "2026-09-22T00:00:00.000Z",
      secret: "whsec_123",
    };
    const epList = { items: [createdEp] };
    const delResult = { deleted: true };

    const { client, calls } = build([envelope(createdEp), envelope(epList), envelope(delResult)]);

    const created = await client.createWebhookEndpoint({
      url: "https://example.com/webhook",
      events: ["workflow.completed"],
    });
    assert.equal(created.data.id, "whe_1");
    assert.equal(created.data.secret, "whsec_123");
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, "https://api.example/v1/webhooks/endpoints");

    const list = await client.webhookEndpoints();
    assert.equal(list.data.items.length, 1);
    assert.equal(calls[1]?.method, "GET");

    const deleted = await client.deleteWebhookEndpoint("whe_1");
    assert.equal(deleted.data.deleted, true);
    assert.equal(calls[2]?.method, "DELETE");
    assert.equal(calls[2]?.url, "https://api.example/v1/webhooks/endpoints/whe_1");
  });
});

describe("errors", () => {
  it("turn an error body into a typed error with its class and request id", async () => {
    const { client } = build([apiError(403, "FORBIDDEN")]);
    await assert.rejects(client.markets(), (error: unknown) => {
      assert.ok(error instanceof CapitalApiError);
      assert.deepEqual(
        { code: error.code, status: error.status, requestId: error.requestId, errorClass: error.errorClass },
        { code: "FORBIDDEN", status: 403, requestId: "req_err", errorClass: "user_action" },
      );
      return true;
    });
  });

  it("classify core codes the way core does and unknown codes as investigation", () => {
    assert.equal(errorClassOf("RATE_LIMITED"), "retryable_read");
    assert.equal(errorClassOf("QUOTE_EXPIRED"), "requote");
    assert.equal(errorClassOf("UNAUTHORIZED"), "user_action");
    assert.equal(errorClassOf("TEMPORARY_UNAVAILABLE"), "retryable_read");
    assert.equal(errorClassOf("SOMETHING_NEW"), "investigation");
  });

  it("instantiates CapitalFinancialError for financial core codes with classification predicates", async () => {
    const { client } = build([apiError(400, "QUOTE_EXPIRED", { action: "deposit" })]);
    await assert.rejects(client.quote({ marketId: "m1", action: "deposit", amount: "100" }), (error: unknown) => {
      assert.ok(isCapitalApiError(error));
      assert.ok(isCapitalFinancialError(error));
      assert.equal(error.action, "deposit");
      assert.equal(error.isRequote(), true);
      assert.equal(error.isUserAction(), false);
      assert.equal(error.isInvestigation(), false);
      assert.equal(error.isRetryableRead(), false);
      return true;
    });
  });

  it("report a response that is not our contract as a protocol error", async () => {
    const wrongVersion = new Response(JSON.stringify({ schemaVersion: "2.0", data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(build([wrongVersion]).client.markets(), (error: unknown) => {
      assert.ok(error instanceof CapitalTransportError);
      assert.equal(error.kind, "protocol");
      return true;
    });

    const notJson = new Response("<html>gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    await assert.rejects(build([notJson]).client.markets(), (error: unknown) => {
      assert.ok(error instanceof CapitalTransportError);
      return true;
    });
  });

  it("say which errors are worth retrying", () => {
    const rateLimited = new CapitalApiError({
      code: "RATE_LIMITED",
      message: "slow down",
      status: 429,
      requestId: "r",
    });
    const forbidden = new CapitalApiError({ code: "FORBIDDEN", message: "no", status: 403, requestId: "r" });
    assert.equal(isRetryable(rateLimited), true);
    assert.equal(isRetryable(forbidden), false);
    assert.equal(isRetryable(new CapitalTransportError("network", "down")), true);
    assert.equal(isRetryable(new CapitalTransportError("aborted", "cancelled")), false);
    assert.equal(isRetryable(new Error("anything else")), false);
  });
});

describe("retries", () => {
  it("retry a safe read until it succeeds", async () => {
    const { client, calls } = build([
      () => apiError(503, "TEMPORARY_UNAVAILABLE"),
      () => apiError(503, "TEMPORARY_UNAVAILABLE"),
      () => envelope({ items: [MARKET], nextCursor: null }),
    ]);
    const page = await client.markets();
    assert.equal(page.items.length, 1);
    assert.equal(calls.length, 3);
  });

  it("give up after the configured attempts and report the last error", async () => {
    const { client, calls } = build([() => apiError(429, "RATE_LIMITED", { retryAfter: 1 })], {
      retry: { attempts: 2 },
    });
    await assert.rejects(
      client.markets(),
      (error: unknown) => error instanceof CapitalApiError && error.code === "RATE_LIMITED",
    );
    assert.equal(calls.length, 2);
  });

  it("do not retry an error the caller must act on", async () => {
    const { client, calls } = build([() => apiError(400, "INVALID_REQUEST")]);
    await assert.rejects(client.markets(), CapitalApiError);
    assert.equal(calls.length, 1);
  });

  it("do not retry a write, because a challenge can only be answered once", async () => {
    const { client, calls } = build([() => apiError(503, "TEMPORARY_UNAVAILABLE")]);
    await assert.rejects(client.verify({ nonceId: "non_1", publicKey: "02ab", signature: "ff" }), CapitalApiError);
    assert.equal(calls.length, 1);
  });

  it("wait as long as the server asked, and stop when that is too long", async () => {
    const waits: number[] = [];
    const { client, calls } = build(
      [() => apiError(429, "RATE_LIMITED", { retryAfter: 2 }), () => envelope({ items: [], nextCursor: null })],
      { sleep: async (ms) => void waits.push(ms) },
    );
    await client.markets();
    assert.deepEqual(waits, [2000]);
    assert.equal(calls.length, 2);

    const slow = build([() => apiError(429, "RATE_LIMITED", { retryAfter: 600 })]);
    await assert.rejects(slow.client.markets(), CapitalApiError);
    assert.equal(slow.calls.length, 1);
  });

  it("back off between attempts when the server does not say how long", async () => {
    const waits: number[] = [];
    const { client } = build(
      [
        () => apiError(503, "TEMPORARY_UNAVAILABLE"),
        () => apiError(503, "TEMPORARY_UNAVAILABLE"),
        () => envelope({ items: [], nextCursor: null }),
      ],
      { sleep: async (ms) => void waits.push(ms), retry: { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000 } },
    );
    await client.markets();
    assert.deepEqual(waits, [100, 200]);
  });
});

describe("cancellation", () => {
  it("stops a request when the caller aborts", async () => {
    const controller = new AbortController();
    const hanging = (async (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      })) as typeof fetch;

    const client = createClient({ baseUrl: BASE, network: "mainnet", clientId: "pk_1", fetch: hanging });
    const pending = client.markets({ signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof CapitalTransportError);
      assert.equal(error.kind, "aborted");
      return true;
    });
  });

  it("reports its own timeout separately from a cancellation", async () => {
    const hanging = (async (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")), {
          once: true,
        });
      })) as typeof fetch;

    const client = createClient({
      baseUrl: BASE,
      network: "mainnet",
      clientId: "pk_1",
      fetch: hanging,
      timeoutMs: 10,
      retry: { attempts: 1 },
    });
    await assert.rejects(client.markets(), (error: unknown) => {
      assert.ok(error instanceof CapitalTransportError);
      assert.equal(error.kind, "timeout");
      return true;
    });
  });

  it("does not retry after the caller has cancelled", async () => {
    const controller = new AbortController();
    let calls = 0;
    const failing = (async () => {
      calls += 1;
      controller.abort();
      throw new TypeError("connection reset");
    }) as typeof fetch;

    const client = createClient({
      baseUrl: BASE,
      network: "mainnet",
      clientId: "pk_1",
      fetch: failing,
      sleep: async () => {},
    });
    await assert.rejects(client.markets({ signal: controller.signal }), CapitalTransportError);
    assert.equal(calls, 1);
  });
});
