import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { connect, createApiKey, MIGRATIONS_DIR, migrate, type Sql } from "@stacks-capital/database";
import { FIXTURE_APP, seedFixtures } from "@stacks-capital/database/fixtures";
import { MAINNET_OWNER, MAINNET_READS } from "@stacks-capital/fixtures";
import { createApp } from "../../src/app.ts";
import { memoryLimiter } from "../../src/rateLimit.ts";
import {
  CapabilitiesResponse,
  MarketsResponse,
  PlanResponse,
  QuoteResponse,
  SwapComparisonResponse,
} from "../../src/schemas.ts";
import type { SwapQuoteProvider } from "../../src/swapQuotes.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const NOW = "2026-09-15T12:00:00.000Z";

describe("API against the seeded database", { skip: DATABASE_URL === "" ? "DATABASE_URL is not set" : false }, () => {
  const admin = connect(DATABASE_URL);
  const schema = `test_${randomBytes(6).toString("hex")}`;
  let sql: Sql;
  let app: ReturnType<typeof createApp>;
  let headers: Record<string, string>;
  const get = (path: string) => app.request(path, { headers });

  before(async () => {
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    sql = connect(DATABASE_URL, schema);
    await migrate(sql, MIGRATIONS_DIR);
    await seedFixtures(sql);
    app = createApp({ sql, limiter: memoryLimiter(), now: () => new Date(NOW), reads: MAINNET_READS });
    const { token } = await createApiKey(sql, { appId: FIXTURE_APP.id, scopes: ["markets:read", "quotes:write"] });
    headers = { authorization: `Bearer ${token}` };
  });

  after(async () => {
    await sql.end();
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  async function walk<T>(path: string, parse: (body: unknown) => { data: { items: T[]; nextCursor: string | null } }) {
    const items: T[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await get(cursor === null ? path : `${path}&cursor=${encodeURIComponent(cursor)}`);
      assert.equal(response.status, 200);
      const body = parse(await response.json());
      items.push(...body.data.items);
      cursor = body.data.nextCursor;
      pages += 1;
      assert.ok(pages < 50, "pagination did not terminate");
    } while (cursor !== null);
    return { items, pages };
  }

  it("returns mainnet markets in the response envelope", async () => {
    const response = await get("/v1/markets?network=mainnet");
    const body = MarketsResponse.parse(await response.json());
    assert.equal(body.schemaVersion, "1.0");
    assert.equal(body.network, "stacks:mainnet");
    assert.equal(body.requestId, response.headers.get("x-request-id"));
    assert.deepEqual(body.context, { observedAt: NOW, stale: false, warnings: [] });
    assert.deepEqual(
      body.data.items.map((market) => market.id),
      ["bitflow.sbtc-usdcx", "granite.sbtc.isolated", "sbtc.deposit", "sbtc.withdraw", "zest.sbtc.vault"],
    );
    const zest = body.data.items.find((market) => market.id === "zest.sbtc.vault");
    assert.deepEqual(
      zest?.capabilities.map((capability) => [capability.action, capability.state, capability.deploymentId !== null]),
      [
        ["supply", "enabled", true],
        ["withdraw_supply", "enabled", true],
      ],
    );
  });

  it("walks every market page by page without gaps or repeats", async () => {
    const whole = MarketsResponse.parse(await (await get("/v1/markets?network=mainnet&limit=100")).json());
    const paged = await walk("/v1/markets?network=mainnet&limit=2", (body) => MarketsResponse.parse(body));
    assert.equal(paged.pages, 3);
    assert.deepEqual(
      paged.items.map((market) => market.id),
      whole.data.items.map((market) => market.id),
    );
  });

  it("reports every testnet action as disabled", async () => {
    const { items } = await walk("/v1/markets?network=testnet&limit=100", (body) => MarketsResponse.parse(body));
    assert.ok(items.length > 0);
    assert.ok(items.every((market) => market.capabilities.every((capability) => capability.state === "disabled")));
  });

  it("walks capabilities in stable order and matches the database", async () => {
    const { items } = await walk("/v1/capabilities?network=mainnet&limit=4", (body) =>
      CapabilitiesResponse.parse(body),
    );
    const [row] = await sql<{ count: string }[]>`SELECT count(*) AS count FROM capabilities WHERE network = 'mainnet'`;
    assert.equal(items.length, Number(row?.count));
    const keys = items.map((capability) => `${capability.marketId}/${capability.action}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(keys, [...keys].sort());
  });

  it("quotes and plans Zest supply with onchain zft receipts", async () => {
    const quoteResponse = await app.request("/v1/quotes", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        network: "mainnet",
        action: "supply",
        marketId: "zest.sbtc.vault",
        amount: "100000000",
        owner: MAINNET_OWNER,
      }),
    });
    assert.equal(quoteResponse.status, 200);
    const quoted = QuoteResponse.parse(await quoteResponse.json());
    assert.equal(quoted.data.quote.executable, true);
    assert.match(quoted.data.quote.expectedOutput[0]?.asset ?? "", /:zft$/);
    assert.equal(quoted.data.plan.quoteId, quoted.data.quote.id);
    assert.equal(quoted.data.plan.steps[0]?.payload.kind, "stacks_contract_call");

    const planResponse = await app.request("/v1/plans", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        network: "mainnet",
        owner: MAINNET_OWNER,
        intent: { action: "supply", marketId: "zest.sbtc.vault", amount: "100000000" },
        quote: quoted.data.quote,
      }),
    });
    assert.equal(planResponse.status, 200);
    const planned = PlanResponse.parse(await planResponse.json());
    assert.equal(planned.data.quoteId, quoted.data.quote.id);
    assert.equal(planned.data.steps[0]?.payload.kind, "stacks_contract_call");
  });

  it("compares authenticated swap quotes without calling live providers", async () => {
    const fixture = (name: SwapQuoteProvider["name"], minimum: string): SwapQuoteProvider => ({
      name,
      async quote(request, now) {
        return {
          provider: name,
          inputAsset: request.inputAsset,
          outputAsset: request.outputAsset,
          amountIn: request.amount,
          amountOut: (BigInt(minimum) + 3n).toString(),
          minimumAmountOut: minimum,
          fee: null,
          priceImpactBps: null,
          route: [`SP000.${name}-pool`],
          targetContract: `SP000.${name}`,
          observedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 30_000).toISOString(),
          evidenceSource: `${name}-integration-fixture`,
        };
      },
    });
    const comparing = createApp({
      sql,
      limiter: memoryLimiter(),
      now: () => new Date(NOW),
      reads: MAINNET_READS,
      swapQuoteProviders: [fixture("bitflow", "100"), fixture("velar", "110"), fixture("alex", "90")],
    });
    const body = {
      network: "mainnet",
      owner: MAINNET_OWNER,
      inputAsset: "stacks:mainnet:native:stx",
      outputAsset: "stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token",
      amount: "1000000",
      slippageBps: 50,
    };
    const unauthorized = await comparing.request("/v1/swaps/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(unauthorized.status, 401);

    const missingOwner = await comparing.request("/v1/swaps/quotes", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ ...body, owner: undefined }),
    });
    assert.equal(missingOwner.status, 400);

    const { token: readOnly } = await createApiKey(sql, { appId: FIXTURE_APP.id, scopes: ["markets:read"] });
    const forbidden = await comparing.request("/v1/swaps/quotes", {
      method: "POST",
      headers: { authorization: `Bearer ${readOnly}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(forbidden.status, 403);

    const response = await comparing.request("/v1/swaps/quotes", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    const compared = SwapComparisonResponse.parse(await response.json());
    assert.equal(compared.schemaVersion, "1.0");
    assert.equal(compared.network, "stacks:mainnet");
    assert.deepEqual(
      compared.data.offers.map((offer) => [offer.rank, offer.provider, offer.minimumAmountOut]),
      [
        [1, "velar", "110"],
        [2, "bitflow", "100"],
        [3, "alex", "90"],
      ],
    );
    assert.equal(compared.data.offers[0]?.amountIn, "1000000");
    assert.equal(compared.data.unavailable.length, 0);
  });
});
