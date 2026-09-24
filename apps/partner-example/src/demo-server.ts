import { createServer, type IncomingMessage, type Server } from "node:http";
import {
  isCapitalError,
  parseQuote,
  serializePlan,
  serializeQuote,
  type Intent,
  type QuoteWire,
  type StacksNetwork,
} from "@stacks-capital/core";
import { createExecutionEngine, loadServerReads, type AdapterReads } from "@stacks-capital/engine";
import { MAINNET_READS } from "@stacks-capital/fixtures";

const SCHEMA_VERSION = "1.0";
const STX = "stacks:mainnet:native:stx";
const USDCX = "stacks:mainnet:contract:SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx:usdcx-token";
const ROUTER = "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1";

function fixtureSwapCatalog() {
  return {
    items: [
      {
        key: "stx",
        assetId: STX,
        symbol: "STX",
        name: "Stacks",
        decimals: 6,
        providers: ["bitflow", "velar", "alex"],
      },
      {
        key: "usdcx",
        assetId: USDCX,
        symbol: "USDCx",
        name: "USDCx",
        decimals: 6,
        providers: ["bitflow", "velar"],
      },
    ],
    sources: {
      bitflow: { status: "ok", count: 2, reason: null },
      velar: { status: "ok", count: 2, reason: null },
      alex: { status: "ok", count: 1, reason: null },
    },
  };
}

function fixtureSwapComparison(input: {
  inputAsset: string;
  outputAsset: string;
  amount: string;
  owner: string;
  now: Date;
}) {
  const observedAt = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + 30_000).toISOString();
  return {
    assets: fixtureSwapCatalog().items,
    offers: [
      {
        provider: "velar",
        rank: 1,
        status: "quote_only",
        inputAsset: input.inputAsset,
        outputAsset: input.outputAsset,
        amountIn: input.amount,
        amountOut: "370000",
        minimumAmountOut: "368150",
        fee: null,
        priceImpactBps: 12,
        route: ["SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-core"],
        targetContract: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-core",
        observedAt,
        expiresAt,
        evidenceSource: "velar-fixture",
        executionReason: "fixture",
      },
      {
        provider: "bitflow",
        rank: 2,
        status: "quote_only",
        inputAsset: input.inputAsset,
        outputAsset: input.outputAsset,
        amountIn: input.amount,
        amountOut: "305000",
        minimumAmountOut: "304975",
        fee: null,
        priceImpactBps: 8,
        route: [ROUTER],
        targetContract: ROUTER,
        observedAt,
        expiresAt,
        evidenceSource: "bitflow-fixture",
        executionReason: "fixture",
        walletCall: {
          contractId: ROUTER,
          functionName: "swap-simple-multi",
          functionArgs: ["0x0b"],
          postConditions: [{ type: "stx-postcondition", address: input.owner, condition: "lte", amount: input.amount }],
          postConditionMode: "deny",
          network: "mainnet",
        },
      },
    ],
    unavailable: [{ provider: "alex", reason: "This pair is not listed" }],
  };
}

export type DemoServer = {
  url: string;
  close(): Promise<void>;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function errorJson(requestId: string, code: string, message: string) {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    requestId,
    error: { code, message },
  });
}

function asIntent(value: { action?: string; marketId?: string; amount?: string } | undefined): Intent | null {
  if (value?.action === undefined || value.marketId === undefined || value.amount === undefined) return null;
  return {
    action: value.action as Intent["action"],
    marketId: value.marketId,
    amount: value.amount,
  };
}

export async function startDemoCapitalApi(input: { live: boolean; now?: Date }): Promise<DemoServer> {
  const now = input.now ?? new Date();
  const reads: AdapterReads = input.live ? await loadServerReads({ network: "mainnet", now }) : MAINNET_READS;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const requestId = `req_demo_${Date.now()}`;
      const fail = (status: number, code: string, message: string) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(errorJson(requestId, code, message));
      };
      try {
        if (req.url === undefined) {
          fail(404, "NOT_FOUND", "No such route");
          return;
        }
        const requestUrl = new URL(req.url, "http://127.0.0.1");
        const path = requestUrl.pathname;
        const ok = (data: unknown) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              schemaVersion: SCHEMA_VERSION,
              requestId,
              network: "stacks:mainnet",
              data,
              context: {
                observedAt: now.toISOString(),
                stale: false,
                warnings: [],
              },
            }),
          );
        };
        if (req.method === "GET" && path === "/v1/swaps/markets") {
          if (requestUrl.searchParams.get("network") !== "mainnet") {
            fail(400, "INVALID_REQUEST", "network is required");
            return;
          }
          ok(fixtureSwapCatalog());
          return;
        }
        if (req.method !== "POST") {
          fail(404, "NOT_FOUND", "No such route");
          return;
        }
        const payload = JSON.parse(await readBody(req)) as {
          network?: StacksNetwork;
          owner?: string;
          action?: string;
          marketId?: string;
          amount?: string;
          inputAsset?: string;
          outputAsset?: string;
          slippageBps?: number;
          intent?: { action?: string; marketId?: string; amount?: string };
          quote?: QuoteWire;
        };
        if (payload.network !== "mainnet" || payload.owner === undefined || payload.owner === "") {
          fail(400, "INVALID_REQUEST", "network and owner are required");
          return;
        }
        if (path === "/v1/swaps/quotes") {
          if (payload.inputAsset === undefined || payload.outputAsset === undefined || payload.amount === undefined) {
            fail(400, "INVALID_REQUEST", "inputAsset, outputAsset and amount are required");
            return;
          }
          ok(
            fixtureSwapComparison({
              inputAsset: payload.inputAsset,
              outputAsset: payload.outputAsset,
              amount: payload.amount,
              owner: payload.owner,
              now,
            }),
          );
          return;
        }
        const engine = createExecutionEngine({
          network: payload.network,
          reads,
          owner: payload.owner,
          now,
        });
        let data: unknown;
        if (path === "/v1/quotes") {
          const intent = asIntent(payload);
          if (intent === null) {
            fail(400, "INVALID_REQUEST", "action, marketId and amount are required");
            return;
          }
          const minted = engine.quoteAndPlan(intent);
          data = {
            quote: serializeQuote(minted.quote),
            plan: serializePlan(minted.plan),
          };
        } else if (path === "/v1/plans") {
          const intent = asIntent(payload.intent);
          if (intent === null || payload.quote === undefined) {
            fail(400, "INVALID_REQUEST", "intent and quote are required");
            return;
          }
          data = serializePlan(engine.plan(parseQuote(payload.quote), intent));
        } else {
          fail(404, "NOT_FOUND", "No such route");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            requestId,
            network: "stacks:mainnet",
            data,
            context: {
              observedAt: now.toISOString(),
              stale: false,
              warnings: [],
            },
          }),
        );
      } catch (error) {
        if (isCapitalError(error)) {
          fail(400, error.code, error.message);
          return;
        }
        fail(500, "INTERNAL", "Unexpected error");
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("demo server did not bind a port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        // Node fetch keeps HTTP connections alive. Drain those idle sockets first so the
        // example test and a real embedding host can shut down deterministically.
        server.closeIdleConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
