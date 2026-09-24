import {
  canSubmitWrite,
  compareSwaps,
  createClient,
  createStacksCapital,
  executable,
  parsePlan,
  parseQuote,
  requireNetwork,
  type ComparedSwaps,
  type PlanWire,
  type QuoteWire,
  type SwapProvider,
} from "@stacks-capital/sdk";

const SCHEMA_VERSION = "1.0";

export type PartnerOptions = {
  apiBase: string;
  network: "mainnet" | "testnet";
  owner: string;
  /** Server API key. Never pass a browser `VITE_` value here. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export type PartnerSuccess = {
  action: "supply" | "withdraw_supply";
  quote: QuoteWire;
  plan: PlanWire;
  workflowState: "AWAITING_SIGNATURE";
  outputQuantity: string;
  outputAsset: string;
  /** Preserved for backwards compatibility with supply-only callers. */
  shares: string;
  /** Preserved for backwards compatibility with supply-only callers. */
  receiptAsset: string;
};

function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

async function postJson<T>(options: PartnerOptions, path: string, body: unknown): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.apiKey !== undefined && options.apiKey.length > 0) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }
  const response = await fetchImpl(`${options.apiBase}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as {
    error?: { code?: string; message?: string };
    data?: T;
    schemaVersion?: string;
  };
  if (!response.ok) {
    throw Object.assign(new Error(json.error?.message ?? `HTTP ${response.status}`), {
      code: json.error?.code ?? "UNCLASSIFIED",
      status: response.status,
    });
  }
  if (json.schemaVersion !== SCHEMA_VERSION || json.data === undefined) {
    throw new Error("Capital API envelope is missing schemaVersion or data");
  }
  return json.data;
}

/**
 * Partner write path (entry): Capital API mints the supply quote and plan;
 * the SDK validates against active registry and transitions workflow to AWAITING_SIGNATURE.
 * The host wallet signs and broadcasts.
 */
export async function runZestSupply(options: PartnerOptions): Promise<PartnerSuccess> {
  requireNetwork(options.network);
  const os = createStacksCapital({ network: options.network });
  const intent = { action: "supply" as const, marketId: "zest.sbtc.vault", amount: "100000000" };

  const minted = await postJson<{ quote: QuoteWire; plan: PlanWire }>(options, "/v1/quotes", {
    network: options.network,
    owner: options.owner,
    ...intent,
  });
  const { quote, plan } = minted;

  const checked = os.validate(parsePlan(plan), parseQuote(quote), { sender: options.owner });
  if (!checked.ok) throw new Error(`SDK rejected the plan: ${checked.reasons.join("; ")}`);

  let flow = os.startWorkflow({ id: "partner-example-supply", idempotencyKey: "partner-example-zest-supply" });
  flow = os.recordQuote(flow, parseQuote(quote));
  flow = os.recordPlan(flow, parsePlan(plan), parseQuote(quote), { sender: options.owner });
  if (flow.state !== "AWAITING_SIGNATURE" || !canSubmitWrite(flow.state)) {
    throw new Error(`workflow stopped at ${flow.state}, not AWAITING_SIGNATURE`);
  }

  let submitRefused = false;
  try {
    os.submit();
  } catch (error) {
    submitRefused = codeOf(error) === "UNSUPPORTED_ACTION";
    if (!submitRefused) throw error;
  }
  if (!submitRefused) throw new Error("SDK submit() must throw");

  const receipt = quote.expectedOutput[0];
  if (receipt === undefined) throw new Error("quote has no expected output");
  return {
    action: "supply",
    quote,
    plan,
    workflowState: "AWAITING_SIGNATURE",
    outputQuantity: receipt.quantity,
    outputAsset: receipt.asset,
    shares: receipt.quantity,
    receiptAsset: receipt.asset,
  };
}

/**
 * Partner write path (exit): Capital API mints the withdraw_supply / redeem quote and plan;
 * the SDK validates and transitions workflow to AWAITING_SIGNATURE.
 * The host wallet signs and broadcasts.
 */
export async function runZestWithdrawSupply(options: PartnerOptions, amount = "50000000"): Promise<PartnerSuccess> {
  requireNetwork(options.network);
  const os = createStacksCapital({ network: options.network });
  const intent = { action: "withdraw_supply" as const, marketId: "zest.sbtc.vault", amount };

  const minted = await postJson<{ quote: QuoteWire; plan: PlanWire }>(options, "/v1/quotes", {
    network: options.network,
    owner: options.owner,
    ...intent,
  });
  const { quote, plan } = minted;

  const checked = os.validate(parsePlan(plan), parseQuote(quote), { sender: options.owner });
  if (!checked.ok) throw new Error(`SDK rejected the exit plan: ${checked.reasons.join("; ")}`);

  let flow = os.startWorkflow({ id: "partner-example-exit", idempotencyKey: "partner-example-zest-withdraw" });
  flow = os.recordQuote(flow, parseQuote(quote));
  flow = os.recordPlan(flow, parsePlan(plan), parseQuote(quote), { sender: options.owner });
  if (flow.state !== "AWAITING_SIGNATURE" || !canSubmitWrite(flow.state)) {
    throw new Error(`workflow stopped at ${flow.state}, not AWAITING_SIGNATURE`);
  }

  let submitRefused = false;
  try {
    os.submit();
  } catch (error) {
    submitRefused = codeOf(error) === "UNSUPPORTED_ACTION";
    if (!submitRefused) throw error;
  }
  if (!submitRefused) throw new Error("SDK submit() must throw");

  const output = quote.expectedOutput[0];
  if (output === undefined) throw new Error("quote has no expected output");
  return {
    action: "withdraw_supply",
    quote,
    plan,
    workflowState: "AWAITING_SIGNATURE",
    outputQuantity: output.quantity,
    outputAsset: output.asset,
    shares: output.quantity,
    receiptAsset: output.asset,
  };
}

export const runZestExit = runZestWithdrawSupply;

export function stakingIsDisabled(): boolean {
  return executable("stake", "mainnet") === false;
}

export const PARTNER_SWAP_INPUT = "stacks:mainnet:native:stx";
export const PARTNER_SWAP_OUTPUT =
  "stacks:mainnet:contract:SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx:usdcx-token";
export const PARTNER_SWAP_AMOUNT = "1000000";

export type SwapCompareInput = {
  inputAsset: string;
  outputAsset: string;
  amount: string;
  slippageBps?: number;
  provider?: SwapProvider | null;
};

/**
 * Same live-catalog + ranked-quote path as Stacks Capital. CapitalOS picks the best guaranteed
 * minimum; the host may pass an optional provider override. The SDK never broadcasts.
 */
export async function runSwapCompare(options: PartnerOptions, input: SwapCompareInput): Promise<ComparedSwaps> {
  requireNetwork(options.network);
  if (options.network !== "mainnet") {
    throw new Error("Swap comparison is mainnet only");
  }
  const client = createClient({
    baseUrl: options.apiBase,
    network: options.network,
    ...(options.apiKey !== undefined && options.apiKey.length > 0
      ? { apiKey: options.apiKey }
      : { clientId: "pk_fixture_sandbox" }),
    ...(options.fetchImpl === undefined ? {} : { fetch: options.fetchImpl }),
  });
  return compareSwaps({
    client,
    inputAsset: input.inputAsset,
    outputAsset: input.outputAsset,
    amount: input.amount,
    ...(input.slippageBps === undefined ? {} : { slippageBps: input.slippageBps }),
    owner: options.owner,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
  });
}
