import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.CAPITALOS_PLAN_ROOT ? path.resolve(process.env.CAPITALOS_PLAN_ROOT) : path.resolve(here, "..");
const outDir = path.join(root, "docs");
const htmlPath = path.join(outDir, "everything-stacks-production-plan.html");
const pdfPath = path.join(outDir, "everything-stacks-production-plan.pdf");

const refs = {
  hq: "https://app.notion.com/p/3d61193693958152aae3f2c5fb82920b?pvs=204",
  architecture: "https://app.notion.com/p/3d611936939581ad9321eb68bd1a1828?pvs=204",
  product: "https://app.notion.com/p/3d6119369395810b8f26e44d6f490b6a?pvs=204",
  security: "https://app.notion.com/p/3d61193693958163bf0ef960cc8ff0a3?pvs=204",
  milestones: "https://app.notion.com/p/3d611936939581b09d68da3c4c09a870?pvs=204",
  journeys: "https://app.notion.com/p/3d6119369395817d98d3d3cd0b30bc4d?pvs=204",
  partner: "https://app.notion.com/p/3d61193693958167ab7ac5eebf29de4d?pvs=204",
  adapters: "https://app.notion.com/p/3d611936939581709b36f7aa2f5ac6ec?pvs=204",
  traceability: "https://app.notion.com/p/3d6119369395817db5e2d375ee4c852e?pvs=204",
};

const ibk = [
  [
    "I21",
    "Reset the delivery ledger and release baseline",
    "Release",
    "P0",
    "1 day",
    "None",
    [
      "Reclassify unsupported Done tasks to their evidenced state",
      "Record the current build, test, data and backfill baseline",
    ],
    [
      "Every active task has an owner, reviewer, dependency and evidence target",
      "No task is Done without a reproducible PR and acceptance artifact",
      "Baseline captures the stale-evidence allocation regression and API type failure",
    ],
  ],
  [
    "I22",
    "Ship production database migrations and worker topology",
    "Platform",
    "P0",
    "2 days",
    "I21, K21",
    [
      "Package migrations, queues, locks and worker entrypoints for deployment",
      "Define one-shot backfill, continuous ingestion, observer and reconciliation processes",
    ],
    [
      "Workers restart idempotently without duplicate financial events",
      "Health endpoints expose lag, checkpoint and failure state",
      "Runbook proves database restore and worker catch-up",
    ],
  ],
  [
    "I23",
    "Operate registry backfill and canonical history continuously",
    "Platform",
    "P0",
    "2 days",
    "I22, K23",
    ["Complete all signed-registry checkpoints", "Schedule canonical snapshots and reorg-safe portfolio observations"],
    [
      "Projection audit passes with every checkpoint complete",
      "A new block advances projections without manual commands",
      "Reorg replay removes orphaned evidence and rebuilds affected state",
    ],
  ],
  [
    "I24",
    "Persist market, rate, liquidity and capacity evidence",
    "Platform",
    "P0",
    "2 days",
    "I22, K24",
    ["Store source-tagged protocol snapshots", "Expose evidence age, block, confidence and disagreement through APIs"],
    [
      "Missing evidence is null plus a warning, never numeric zero",
      "Stale rate or capacity cannot drive allocation",
      "Independent and provider-reported observations remain distinguishable",
    ],
  ],
  [
    "I25",
    "Harden price and oracle quorum valuation",
    "Portfolio & Risk",
    "P0",
    "2 days",
    "I24",
    [
      "Reconcile supported assets across independent price sources",
      "Label unsupported assets without withholding unrelated verified values",
    ],
    [
      "Every valuation carries asset ID, price, source set and timestamp",
      "Quorum disagreement fails closed for actions",
      "Partial portfolio totals disclose valued and unvalued coverage",
    ],
  ],
  [
    "I26",
    "Complete canonical portfolio and debt accounting",
    "Portfolio & Risk",
    "P0",
    "2 days",
    "I23, I25, K27, K28",
    [
      "Normalize wallet, supplied, LP, collateral, debt and locked capital",
      "Prevent receipt-token and underlying-claim double counting",
    ],
    [
      "Golden addresses reconcile against explorer and protocol reads",
      "Assets minus debt equals displayed net subtotal exactly",
      "Borrowed token is visibly linked to its collateral position",
    ],
  ],
  [
    "I27",
    "Attribute earned yield, rewards and historical performance",
    "Earn",
    "P0",
    "2 days",
    "I23, I24, I26",
    [
      "Reconcile deposits, withdrawals, fees, rewards and share-rate changes",
      "Separate realized earnings, accrued estimate and forward projection",
    ],
    [
      "No balance increase is called yield without cash-flow attribution",
      "Thirty-day projections require current verified rates",
      "History charts use two or more canonical observations and never synthetic points",
    ],
  ],
  [
    "I28",
    "Finalize versioned API, authentication and webhook surface",
    "Partner SDK",
    "P0",
    "2 days",
    "I22, K22, K35",
    [
      "Serve capabilities, markets, positions, quotes, plans and workflows",
      "Enforce tenant scopes, sessions, idempotency and signed webhooks",
    ],
    [
      "Runtime schemas and OpenAPI agree",
      "Problem responses are typed and actionable",
      "Webhook retry and deduplication are demonstrated",
    ],
  ],
  [
    "I29",
    "Publish browser SDK client and typed financial errors",
    "Partner SDK",
    "P0",
    "2 days",
    "I28, K34",
    [
      "Expose public read, quote, plan, workflow and validation clients",
      "Ship typed errors and safe bigint/fixed-point serialization",
    ],
    [
      "SDK has no dependency on internal adapters or web application code",
      "A clean consumer compiles in browser and server environments",
      "All public methods document evidence and failure semantics",
    ],
  ],
  [
    "I30",
    "Publish React SDK hooks and embedded workflow components",
    "Partner SDK",
    "P1",
    "2 days",
    "I29, K35",
    [
      "Provide wallet, portfolio, market, quote and workflow hooks",
      "Provide optional review, progress, recovery and receipt components",
    ],
    [
      "Cache keys isolate tenant, network and address",
      "Workflow state resumes after reload",
      "Everything Stacks consumes the same public package exports as partners",
    ],
  ],
  [
    "I31",
    "Implement the Everything Stacks shell and design system",
    "Product",
    "P0",
    "2 days",
    "I30",
    [
      "Build responsive navigation, wallet/network header and workflow drawer",
      "Centralize empty, loading, degraded, unsupported and toast states",
    ],
    [
      "Desktop and mobile match the wireframe contract",
      "Financial values never overlap or truncate ambiguously",
      "Keyboard, focus, live-region and reduced-motion behavior pass",
    ],
  ],
  [
    "I32",
    "Build Overview and Positions production screens",
    "Product",
    "P0",
    "2 days",
    "I26, I27, I31",
    [
      "Render assets, debt, net value, deployment and yield with coverage",
      "Expose position details and only supported position actions",
    ],
    [
      "Partial data is explicit and internally consistent",
      "Receipt tokens are not double-counted",
      "Address state persists across routes and reloads",
    ],
  ],
  [
    "I33",
    "Build BTC deposit and withdrawal screens",
    "Product",
    "P0",
    "2 days",
    "I31, K25, K26",
    [
      "Implement BTC to sBTC deposit and sBTC to BTC withdrawal journeys",
      "Show confirmations, signer state, fees, reclaim/recovery and receipts",
    ],
    [
      "Pending BTC is distinct from spendable sBTC",
      "Closing the UI does not lose workflow state",
      "Happy path and delayed/reclaim path are reproducible",
    ],
  ],
  [
    "I34",
    "Build Earn marketplace and strategy simulation screens",
    "Product",
    "P0",
    "2 days",
    "I24, I27, I31, K27, K31, K32",
    [
      "Compare same-asset opportunities and evidence-gated allocations",
      "Show base yield, incentives, capacity, liquidity, fees and risks separately",
    ],
    [
      "No provider-only or stale value is presented as verified",
      "Projected earnings use exact disclosed inputs",
      "Deposit and withdrawal review use public SDK plans",
    ],
  ],
  [
    "I35",
    "Build Borrow, repay and collateral management screens",
    "Product",
    "P0",
    "2 days",
    "I31, K28, K36",
    [
      "Implement collateral, borrow, partial/full repay and collateral withdrawal",
      "Provide Easy and Advanced health/risk explanations",
    ],
    [
      "Every action refreshes oracle, debt and protocol limits",
      "Fees, debt paid and debt remaining are explicit",
      "Unsafe or stale states block plan creation",
    ],
  ],
  [
    "I36",
    "Build exact-input Swap screen",
    "Product",
    "P0",
    "1.5 days",
    "I31, K29",
    ["Render routes, expected/minimum output, impact, fees and expiry", "Support requote and recovery states"],
    [
      "Expired quotes cannot reach signing",
      "Minimum output is enforced by the plan/contract call",
      "Asset identifiers and decimals reconcile exactly",
    ],
  ],
  [
    "I37",
    "Build liquidity provision and staking screens",
    "Product",
    "P1",
    "2 days",
    "I31, K30, K31, K32, K33",
    [
      "Implement LP add/remove/fee collection interfaces",
      "Implement verified staking/unstaking/claim interfaces and unavailable states",
    ],
    [
      "LP screens disclose range/bin, IL exposure and exit liquidity",
      "Staking distinguishes Bitcoin, STX and protocol receipt staking",
      "Unsupported capabilities never appear executable",
    ],
  ],
  [
    "I38",
    "Build Risk, Alerts and Activity screens",
    "Product",
    "P0",
    "2 days",
    "I31, K36",
    ["Provide plain-language and advanced risk modes", "Group activity by durable workflows with recovery actions"],
    [
      "Risk numbers expose meaning, source, timestamp and calculation version",
      "BTC stress scenarios state assumptions and coverage",
      "Alerts disclose delivery limitations and consent",
    ],
  ],
  [
    "I39",
    "Deliver external partner example and integration documentation",
    "Partner SDK",
    "P0",
    "2 days",
    "I29, I30, K39",
    [
      "Create a clean partner application using public packages only",
      "Document install, auth, wallet, quote, plan, workflow, webhook and recovery",
    ],
    [
      "A new developer completes one sandbox entry and exit without internal imports",
      "Disposable test credentials are isolated and revocable",
      "Compatibility matrix and migration guide are published",
    ],
  ],
  [
    "I40",
    "Run product E2E, accessibility and operational acceptance",
    "Release",
    "P0",
    "2 days",
    "I32-I39, K37, K38",
    [
      "Automate happy, rejection, expiry, outage, reload and partial-data journeys",
      "Verify monitoring dashboards, alerts and production runbooks",
    ],
    [
      "Supported wallet/browser matrix passes",
      "No unresolved critical or high accessibility defect",
      "Evidence bundle links tests, workflows, transactions and known limitations",
    ],
  ],
];

const kenzman = [
  [
    "K21",
    "Restore a green, safety-preserving release baseline",
    "Release",
    "P0",
    "1 day",
    "None",
    ["Fix API strict-TypeScript failure", "Fix stale-market evidence allocation regression"],
    [
      "Typecheck, unit tests and production build pass",
      "301-second-old evidence receives zero allocation",
      "Regression tests cover boundary, future timestamps and cache expiry",
    ],
  ],
  [
    "K22",
    "Enforce public SDK and application architecture boundaries",
    "Core SDK",
    "P0",
    "2 days",
    "K21",
    [
      "Create the documented core, SDK, wallets and adapter package boundaries",
      "Remove application access to internal transaction builders",
    ],
    [
      "Everything Stacks builds through public SDK exports only",
      "Dependency rules fail CI on forbidden imports",
      "Canonical identifiers and exact-number types are shared",
    ],
  ],
  [
    "K23",
    "Complete signed capability and deployment registry",
    "Core SDK",
    "P0",
    "2 days",
    "K22",
    [
      "Register reviewed assets, deployments, actions and adapter versions",
      "Implement activation, rollback and safe-exit-only states",
    ],
    [
      "Unknown contracts cannot produce executable plans",
      "Registry signatures and network targets are verified",
      "Read and exit capabilities survive write-action pauses",
    ],
  ],
  [
    "K24",
    "Build protocol adapter certification harness",
    "Core SDK",
    "P0",
    "2 days",
    "K22, K23",
    [
      "Define fixtures and conformance tests for reads, quotes, plans and reconciliation",
      "Require protocol-specific semantic declarations",
    ],
    [
      "Adapters cannot infer unsupported fields",
      "Exact decimals/post-conditions are fixture-tested",
      "Certification report names deployment, block and adapter version",
    ],
  ],
  [
    "K25",
    "Certify sBTC deposit integration",
    "sBTC",
    "P0",
    "2 days",
    "K23, K24",
    [
      "Use deployed sBTC contracts and signer status services",
      "Construct deposit metadata, recovery evidence and watchers",
    ],
    [
      "BTC transaction through reconciled sBTC is demonstrated",
      "Timeout cannot cause duplicate transfer",
      "Fee, confirmations and reclaim states are exposed",
    ],
  ],
  [
    "K26",
    "Certify sBTC withdrawal integration",
    "sBTC",
    "P0",
    "2 days",
    "K25",
    ["Build withdrawal request and Bitcoin payout tracking", "Handle signer delay, rejection and recovery"],
    [
      "sBTC debit and BTC payout reconcile",
      "Request remains resumable across reload",
      "Unsupported environment returns a truthful unavailable state",
    ],
  ],
  [
    "K27",
    "Certify Zest supply and withdrawal lifecycle",
    "Earn",
    "P0",
    "2 days",
    "K23, K24",
    [
      "Read Zest markets, rates, caps, balances and receipt claims",
      "Build supply, withdraw and rewards/interest reconciliation",
    ],
    [
      "Live sandbox/mainnet-shadow supply and exit evidence exists",
      "Supply APR semantics are protocol-correct",
      "Receipt-token valuation does not double count underlying",
    ],
  ],
  [
    "K28",
    "Certify Zest collateral, borrow and repay lifecycle",
    "Borrow",
    "P0",
    "2 days",
    "K27",
    [
      "Read collateral, debt, APR, health and liquidation parameters",
      "Build collateralize, borrow, partial/full repay and withdraw plans",
    ],
    [
      "Accrued debt and repay-all semantics match protocol state",
      "Oracle/cap/pause/liquidity boundaries are tested",
      "Every plan has enforceable post-conditions",
    ],
  ],
  [
    "K29",
    "Certify Bitflow swap routing",
    "Swap",
    "P0",
    "2 days",
    "K23, K24",
    ["Discover allowlisted routes and current quotes", "Build exact-input plans with enforced minimum output"],
    [
      "Quote expiry and route changes force requote",
      "All route contracts are registry-approved",
      "Output, fees and deltas reconcile after confirmation",
    ],
  ],
  [
    "K30",
    "Certify Bitflow liquidity lifecycle",
    "Earn",
    "P1",
    "2 days",
    "K29",
    [
      "Support allowlisted LP pools, add/remove liquidity and fee claims",
      "Normalize pool range/bin, TVL, capacity and exit evidence",
    ],
    [
      "Provider observations never masquerade as independent evidence",
      "LP token/claim accounting reconciles",
      "Impermanent-loss inputs and limitations are exposed",
    ],
  ],
  [
    "K31",
    "Certify Hermetica staking and reward lifecycle",
    "Earn",
    "P1",
    "2 days",
    "K23, K24",
    [
      "Integrate USDH/sUSDh stake, unstake and claim capabilities",
      "Read exchange/share rate, rewards, lock and liquidity evidence",
    ],
    [
      "Correct Hermetica contracts and asset identifiers are allowlisted",
      "Principal, claim and rewards reconcile",
      "Rate provenance and exit conditions are explicit",
    ],
  ],
  [
    "K32",
    "Certify Granite lending and borrowing lifecycle",
    "Borrow",
    "P1",
    "2 days",
    "K23, K24",
    [
      "Integrate supported Granite supply, withdraw, collateral, borrow and repay actions",
      "Normalize Granite-specific limits and interest semantics",
    ],
    [
      "No Zest assumptions are copied without evidence",
      "Supported markets have live read and action fixtures",
      "Unsupported Granite capabilities fail closed",
    ],
  ],
  [
    "K33",
    "Certify stacking and staking capability routes",
    "Earn",
    "P1",
    "2 days",
    "K23, K24",
    [
      "Evaluate StackingDAO, STX stacking and any verified Bitcoin-staking provider",
      "Implement only capabilities with deployed contracts and wallet support",
    ],
    [
      "Native Bitcoin staking is distinct from sBTC DeFi",
      "Lock, unlock, rewards and custody assumptions are disclosed",
      "Unavailable routes return documented capability reasons",
    ],
  ],
  [
    "K34",
    "Harden quotes, plans, exact arithmetic and post-conditions",
    "Core SDK",
    "P0",
    "2 days",
    "K25-K33",
    [
      "Bind plans to quote, registry, deployment, adapter, network and expiry",
      "Validate amounts, recipients, contract calls and expected effects locally",
    ],
    [
      "No JavaScript number represents token quantities",
      "Tampered, stale or cross-network plans are rejected",
      "Wallet opens only after SDK validation passes",
    ],
  ],
  [
    "K35",
    "Harden workflow idempotency, recovery and reconciliation",
    "Core SDK",
    "P0",
    "2 days",
    "K34, I22",
    [
      "Persist every state transition and next action",
      "Handle rejection, broadcast uncertainty, reorg and provider outage",
    ],
    [
      "Uncertain writes are never blindly retried",
      "Reload resumes at every wait/sign state",
      "Completion requires canonical position reconciliation",
    ],
  ],
  [
    "K36",
    "Complete risk engine and protective action semantics",
    "Portfolio & Risk",
    "P0",
    "2 days",
    "K28, K30-K33, I25",
    [
      "Model protocol-native health and portfolio concentration/liquidity",
      "Produce evidence-backed scenarios and safe supported actions",
    ],
    [
      "Health factor has a tested protocol-specific interpretation",
      "Stress scenarios never invent prices or unsupported values",
      "Calculation version, inputs and limitations accompany outputs",
    ],
  ],
  [
    "K37",
    "Complete transaction and economic threat-model review",
    "Release",
    "P0",
    "2 days",
    "K34-K36",
    [
      "Review signing, allowlists, slippage, oracle, reorg, adapter and tenant boundaries",
      "Track findings to closure or explicit launch block",
    ],
    [
      "No unresolved critical/high finding",
      "Every financial write path has abuse and failure tests",
      "Scope remains non-custodial with no pooled discretionary vault",
    ],
  ],
  [
    "K38",
    "Run live protocol, golden-address and failure-injection gates",
    "Release",
    "P0",
    "2 days",
    "K25-K37, I23",
    [
      "Execute reproducible mainnet-shadow and sandbox matrices",
      "Inject provider, database, webhook, wallet and reorg failures",
    ],
    [
      "Golden addresses reconcile independently",
      "Backup restore and registry pause drills pass",
      "Evidence contains environment, versions, tx/workflow IDs and limitations",
    ],
  ],
  [
    "K39",
    "Publish and compatibility-test SDK releases",
    "Partner SDK",
    "P0",
    "2 days",
    "K22, K38, I29",
    [
      "Version browser, server, React, wallet and UI packages",
      "Test supported Node/browser/wallet combinations and migrations",
    ],
    [
      "Clean installs build from published artifacts",
      "Breaking changes have migration notes",
      "Partner example passes against release candidates",
    ],
  ],
  [
    "K40",
    "Own pilot, production go/no-go and rollback decision",
    "Release",
    "P0",
    "2 days",
    "K37-K39, I40",
    [
      "Run pilot entry/exit and partner certification",
      "Record launch decision, limitations, owners and rollback triggers",
    ],
    [
      "At least five pilot users attempt entry and exit",
      "One external partner completes sandbox integration",
      "Go-live requires all P0 gates and named support/incident ownership",
    ],
  ],
];

const phases = [
  [
    "P0 — Stabilize",
    "I21–I23, K21–K24",
    "Green build; trustworthy task ledger; deployable workers; registry and adapter certification spine.",
  ],
  [
    "P1 — Evidence and SDK",
    "I24–I30, K25–K36",
    "Verified data, complete protocol lifecycles, public SDK, workflows and risk semantics.",
  ],
  [
    "P2 — Everything Stacks",
    "I31–I38",
    "All user journeys implemented through the public SDK and the shared transaction pattern.",
  ],
  [
    "P3 — Production gate",
    "I39–I40, K37–K40",
    "Partner certification, security, live evidence, operations, pilots and explicit go/no-go.",
  ],
];

const protocolRows = [
  ["sBTC", "BTC deposit; sBTC withdrawal", "Official deployed contracts and signer services", "K25–K26 / I33"],
  ["Zest", "Supply; withdraw; collateral; borrow; repay", "Zest contracts and canonical reads", "K27–K28 / I34–I35"],
  [
    "Bitflow",
    "Exact-input swaps; add/remove LP; fee claims",
    "Bitflow routing and allowlisted pools",
    "K29–K30 / I34, I36–I37",
  ],
  ["Hermetica", "Stake/unstake USDH/sUSDh; rewards", "Hermetica deployed contracts", "K31 / I34, I37"],
  ["Granite", "Supported lending and borrowing lifecycle", "Granite deployed contracts", "K32 / I34–I35"],
  [
    "Stacking providers",
    "STX stacking and verified staking routes",
    "StackingDAO/other verified deployments",
    "K33 / I37",
  ],
];

const wireframes = [
  [
    "Global shell",
    `┌───────────────┬────────────────────────────────────────────────────────────┐
│ EVERYTHING    │ Network  Evidence freshness  Pending action  Wallet      │
│ STACKS        ├────────────────────────────────────────────────────────────┤
│ Overview      │ Page title + plain-language purpose + Easy/Advanced      │
│ Deposit BTC   │                                                            │
│ Earn          │ Main workspace                                             │
│ Borrow        │                                                            │
│ Swap          │ Evidence / disclosure / recovery panel                     │
│ Liquidity     │                                                            │
│ Staking       ├────────────────────────────────────────────────────────────┤
│ Positions     │ Global workflow drawer: Quote → Review → Sign → Confirm   │
│ Risk          │ → Reconcile → Receipt / Recovery                          │
│ Activity      │                                                            │
└───────────────┴────────────────────────────────────────────────────────────┘`,
  ],
  [
    "Overview",
    `┌ Net value ────┬ Gross assets ┬ Debt ───────┬ Data coverage ┐
├ Where capital sits ────┬ What it earns ─┬ What can go wrong ┤
├ Portfolio history (canonical observations; no synthetic points) ┤
├ Borrowed tokens against collateral ┬ Fees and lending yield ───┤
├ Asset allocation ┬ Deployed/idle ┬ Protocol exposure ──────────┤
└ Primary actions: Deposit | Earn | Borrow | Swap | LP | Stake ───┘`,
  ],
  [
    "Earn and strategy allocation",
    `┌ Asset + capital + horizon + objective ─────────────────────────┐
├ Verified opportunity cards: protocol | APY parts | liquidity   ┤
│ capacity | evidence age | risk | entry/exit terms              │
├ Recommended split (only evidence-eligible markets)             ┤
├ Projected gross earnings + known fees + excluded assumptions   ┤
└ Simulate → Review exact plan → Sign → Reconcile position ──────┘`,
  ],
  [
    "Borrow",
    `┌ Collateral asset/amount ┬ Debt asset/amount ───────────────────┐
├ Plain meaning: health, buffer, liquidation condition             ┤
├ Advanced: oracle/time | LTV | threshold | APR | caps | liquidity ┤
├ Before/after: debt paid, debt remaining, fees, resulting health  ┤
└ Add collateral | Borrow | Partial repay | Repay all | Withdraw ──┘`,
  ],
  [
    "Swap",
    `┌ You pay ───────────────────┬ You receive ──────────────────────┐
├ Route legs | expected output | minimum output | impact           ┤
├ Provider fees | network fees | expiry | evidence snapshot        ┤
└ Requote if changed/expired → Review → Sign → Reconcile deltas ───┘`,
  ],
  [
    "Liquidity",
    `┌ Pair/pool | amount ratio | range/bin | pool liquidity ───────┐
├ Fee APR evidence | incentives | IL scenarios | exit liquidity     ┤
├ Expected LP claim and known entry/exit costs                      ┤
└ Add liquidity | Remove | Collect fees | Rebalance if supported ───┘`,
  ],
  [
    "Staking",
    `┌ Route type: Bitcoin staking | STX stacking | receipt staking ───┐
├ Provider/validator | reward evidence | lock/unlock | liquidity     ┤
├ Custody/signing assumptions | claim/exit path | capability status  ┤
└ Stake | Unstake | Claim — or evidence-backed Unavailable ─────────┘`,
  ],
  [
    "Positions, Risk and Activity",
    `┌ Position: principal | claim | debt | earnings | health | actions ┐
├ Risk Easy: meaning | affected capital | urgency | safest action    ┤
├ Risk Advanced: inputs | oracle | equations | scenarios | version   ┤
├ Activity: workflow | steps | signatures | txids | errors | receipt ┤
└ Alerts: threshold | channel | consent | delivery limitation ──────┘`,
  ],
];

const mockupCss = `
  *{box-sizing:border-box} body{margin:0;background:#dcd9d1;font-family:"Avenir Next",Inter,Arial,sans-serif;color:#17171d}
  .app{width:1440px;height:900px;background:#f4f1e9;overflow:hidden;position:relative}
  .top{height:76px;background:#17171d;color:white;display:flex;align-items:center;padding:0 34px;gap:24px;border-bottom:4px solid #ff7048}
  .brand{font-size:22px;font-weight:900;letter-spacing:-.8px;white-space:nowrap}.brand b{color:#ff7048}.brand small{font-size:9px;letter-spacing:1.5px;margin-left:8px;color:#a8a7b2}
  .nav{display:flex;gap:3px;align-items:center}.nav span{padding:10px 11px;border-radius:999px;font-weight:700;font-size:11px;color:#b9b8c2;white-space:nowrap}.nav .on{background:#fff;color:#17171d}.nav .off{opacity:.9}
  .address,.chip,.btn{border:1px solid #d6d1c6;background:#fff;border-radius:999px;padding:10px 15px;font-size:11px;font-weight:800}.address{min-width:170px;color:#17171d}.chip{border-color:#45434d;background:#292830;color:#d9d8df}.spacer{flex:1}.btn.primary{background:#ff7048;color:#17171d;border-color:#ff7048;padding-inline:20px}.top .btn:not(.primary){background:transparent;border-color:#55535e;color:#fff}
  .main{padding:24px 34px 30px;overflow:hidden}.headline{display:flex;align-items:end;margin:2px 0 18px}.headline h1{font-family:Georgia,"Times New Roman",serif;font-size:36px;letter-spacing:-1.2px;margin:0;line-height:1}.headline p{margin:8px 0 0;color:#6c6964;font-size:13px}.mode{margin-left:auto;display:flex;border:1px solid #cac4b8;background:#e7e2d8;border-radius:999px;padding:3px}.mode span{padding:7px 13px;font-size:10px;border-radius:999px}.mode .active{background:#17171d;color:#fff;font-weight:800}
  .grid{display:grid;gap:14px}.g4{grid-template-columns:repeat(4,1fr)}.g3{grid-template-columns:repeat(3,1fr)}.g2{grid-template-columns:1.35fr 1fr}.panel{background:#fffdf8;border:1px solid #cdc7bc;border-radius:20px;padding:17px;min-width:0;box-shadow:3px 4px 0 #17171d0c}.panel.accent{background:#ff7048;color:#17171d;border-color:#17171d}.panel.dark{background:#17171d;color:white;border-color:#17171d}.panel.violet{background:#ddd5ff;border-color:#9686e8}.panel h3{margin:0 0 11px;font-size:14px}.label{font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#79746c;font-weight:800}.dark .label{color:#aaa8b3}.value{font-family:"Avenir Next",Inter,sans-serif;font-size:25px;font-weight:900;margin:4px 0;letter-spacing:-.6px}.sub{font-size:10px;color:#746f68}.dark .sub{color:#aaa8b3}.green{color:#087d60}.red{color:#dc3853}.orange{color:#c7512e}.violettext{color:#6c55d9}.row{display:flex;align-items:center;gap:9px}.between{justify-content:space-between}.pill{font-size:9px;font-weight:800;padding:5px 9px;border-radius:20px;background:#dff4eb;color:#087357}.pill.warn{background:#ffe4a8;color:#784600}.pill.risk{background:#ffdce1;color:#b8243d}
  .chart{height:160px;position:relative;border-left:1px solid #c5bfb3;border-bottom:1px solid #c5bfb3;margin:15px 5px 3px;background:repeating-linear-gradient(to top,transparent 0,transparent 39px,#e7e1d7 40px)}.line{position:absolute;height:4px;background:#6c55d9;left:8px;right:8px;top:72px;transform:skewY(-4deg);box-shadow:0 0 0 1px #fff}.barrow{height:125px;display:flex;align-items:end;gap:11px;padding:10px 6px}.bar{background:linear-gradient(#ff9a79,#ff7048);border-radius:7px 7px 0 0;flex:1}.list{display:grid;gap:9px}.item{border:1px solid #d8d1c5;border-radius:14px;padding:11px;display:grid;grid-template-columns:1.3fr .8fr .8fr .8fr;align-items:center;gap:8px;font-size:10px;background:#fff}.item strong{font-size:12px}.logo{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:#ddd5ff;color:#4c35bb;font-weight:900}.warnbox{background:#fff0c9;border:1px solid #dfb85f;border-radius:12px;padding:10px;font-size:10px;color:#704919}.infobox{background:#e7defe;border:1px solid #c5b6f4;border-radius:12px;padding:10px;font-size:10px;color:#403275}.field{border:1px solid #c9c2b7;border-radius:13px;background:#fff;padding:13px;margin-top:5px;font-weight:800}.steps{display:flex;align-items:center;gap:7px}.step{width:27px;height:27px;border-radius:9px;display:grid;place-items:center;background:#e5ded3;font-size:10px}.step.on{background:#6c55d9;color:white}.divider{height:1px;background:#ddd6ca;margin:11px 0}.alloc{height:15px;border-radius:20px;overflow:hidden;display:flex;background:#ded8cd}.alloc i:nth-child(1){width:44%;background:#17171d}.alloc i:nth-child(2){width:31%;background:#6c55d9}.alloc i:nth-child(3){width:17%;background:#ff7048}.alloc i:nth-child(4){width:8%;background:#ffd166}
  .review{display:grid;grid-template-columns:1fr 28px 1fr;align-items:center;gap:9px}.arrow{font-size:23px;color:#6c55d9;text-align:center}.metric{padding:8px 0;border-bottom:1px dashed #ddd6ca;display:flex;justify-content:space-between;font-size:11px}.metric:last-child{border:0}.riskring{width:142px;height:142px;border-radius:50%;background:conic-gradient(#ff7048 0 22%,#eadfd4 22%);display:grid;place-items:center;margin:10px auto}.riskring:after{content:'22 / 100';width:102px;height:102px;border-radius:50%;background:#fffdf8;display:grid;place-items:center;font:800 18px ui-monospace}.flow{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:14px}.flow .node{width:120px;text-align:center;border:1px solid #c9c2b7;border-radius:13px;padding:10px;background:#fff;font-size:10px}.flow b{color:#624dcc}.table{display:grid}.tr{display:grid;grid-template-columns:1.25fr 1fr 1fr .85fr .8fr;padding:10px 9px;border-bottom:1px solid #ded7cb;font-size:10px;align-items:center}.tr.head{background:#e6dfd4;font-weight:800;color:#554f49;border-radius:10px}.tx{border-left:4px solid #ff7048;padding-left:10px}.footerline{margin-top:12px;font-size:9px;color:#777068}
  .landing{height:900px;background:#17171d;color:white;overflow:hidden;position:relative}.landing:before{content:'';position:absolute;width:620px;height:620px;border-radius:50%;background:#6c55d9;right:-170px;top:110px;filter:blur(2px)}.landing:after{content:'';position:absolute;width:340px;height:340px;border-radius:50%;background:#ff7048;right:230px;bottom:-170px}.landing-nav{height:82px;padding:0 54px;display:flex;align-items:center;border-bottom:1px solid #ffffff22;position:relative;z-index:2}.landing-links{display:flex;gap:27px;margin-left:70px;color:#bbb9c4;font-size:12px;font-weight:700}.landing-actions{margin-left:auto;display:flex;gap:10px}.hero{position:relative;z-index:2;padding:82px 55px 0;max-width:800px}.kicker{color:#ffd166;font-weight:900;letter-spacing:1.4px;text-transform:uppercase;font-size:11px}.hero h1{font-family:Georgia,"Times New Roman",serif;font-size:68px;line-height:.98;letter-spacing:-3px;margin:18px 0 20px}.hero h1 em{font-style:normal;color:#ff7048}.hero p{font-size:18px;line-height:1.5;color:#c5c3cd;max-width:660px}.hero-actions{display:flex;gap:12px;margin-top:28px}.hero-proof{display:flex;gap:40px;margin-top:58px}.proof b{display:block;font-size:18px;color:white}.proof span{font-size:10px;color:#aaa7b3}.floating{position:absolute;z-index:3;right:72px;top:205px;width:365px;background:#fffdf8;color:#17171d;border-radius:24px;padding:20px;transform:rotate(3deg);box-shadow:0 20px 80px #0008}.floatrow{display:grid;grid-template-columns:1fr auto;padding:11px 0;border-bottom:1px solid #ddd6ca;font-size:11px}.floatrow:last-child{border:0}.floatbar{height:11px;border-radius:20px;background:linear-gradient(90deg,#6c55d9 0 58%,#ff7048 58% 83%,#ffd166 83%);margin:12px 0}
`;

const navItems = [
  "Overview",
  "Deposit BTC",
  "Earn",
  "Borrow",
  "Swap",
  "Liquidity",
  "Staking",
  "Positions",
  "Risk",
  "Activity",
];
const shell = (active, title, subtitle, content, advanced = false) => `
<div class="app"><header class="top"><div class="brand">everything<b>.</b>stacks<small>MAINNET</small></div><nav class="nav">${navItems.map((item) => `<span class="${item === active ? "on" : "off"}">${item}</span>`).join("")}</nav><div class="spacer"></div><div class="chip">● block 9,003,231</div><div class="address">SPJN63…EQ8CR</div><button class="btn primary">Connect</button></header>
<main class="main"><div class="headline"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="mode"><span class="${advanced ? "" : "active"}">Simple</span><span class="${advanced ? "active" : ""}">Pro</span></div></div>${content}</main></div>`;

const mockupScreens = [
  {
    file: "00-landing.png",
    title: "Landing page",
    note: "A consumer-first introduction to the product, its supported actions and its evidence promise.",
    html: `
    <div class="landing"><header class="landing-nav"><div class="brand">everything<b>.</b>stacks</div><div class="landing-links"><span>Explore</span><span>How it works</span><span>Protocols</span><span>Developers</span><span>Security</span></div><div class="landing-actions"><button class="btn">Read the docs</button><button class="btn primary">Launch app ↗</button></div></header>
    <section class="hero"><div class="kicker">One place for Bitcoin DeFi on Stacks</div><h1>Put your Bitcoin<br>capital to <em>work.</em></h1><p>Move from BTC to verified on-chain opportunities without stitching together five different apps. Compare yield, borrow, swap, provide liquidity and track risk—while your wallet stays in control.</p><div class="hero-actions"><button class="btn primary">Explore opportunities →</button><button class="btn" style="background:#292830;color:white;border-color:#55535e">See how verification works</button></div><div class="hero-proof"><div class="proof"><b>Non-custodial</b><span>Your wallet signs every action</span></div><div class="proof"><b>Evidence labeled</b><span>Rates, limits and risks show their source</span></div><div class="proof"><b>Built on Stacks</b><span>sBTC, Zest, Bitflow, Hermetica and Granite</span></div></div></section>
    <aside class="floating"><div class="row between"><div><div class="label">Example allocation</div><div class="value">1.00 sBTC</div></div><span class="pill">4 verified routes</span></div><div class="floatbar"></div><div class="floatrow"><span><b>Zest lending</b><br><span class="sub">variable supply rate</span></span><b>40%</b></div><div class="floatrow"><span><b>Bitflow liquidity</b><br><span class="sub">fees + range risk</span></span><b>25%</b></div><div class="floatrow"><span><b>Hermetica rewards</b><br><span class="sub">current reward evidence</span></span><b>20%</b></div><div class="floatrow"><span><b>Available balance</b><br><span class="sub">ready for the next move</span></span><b>15%</b></div><div class="warnbox" style="margin-top:13px"><b>Every recommendation is explainable.</b><br>Unsupported or stale data never becomes a number.</div></aside></div>`,
  },
  {
    file: "01-overview.png",
    title: "Overview",
    note: "Portfolio, debt, verified earnings, canonical history and next actions.",
    html: shell(
      "Overview",
      "Your Bitcoin capital",
      "Where it sits, what it earns, what can go wrong, and what you can safely do next.",
      `
    <div class="grid g4"><div class="panel"><div class="label">Verified net value</div><div class="value">$5,867.49</div><div class="sub">8 positions · 92% valued</div></div><div class="panel"><div class="label">Deployed capital</div><div class="value green">$4,341.48</div><div class="sub">74.0% of valued assets</div></div><div class="panel"><div class="label">Borrowed</div><div class="value">$833.13</div><div class="sub">USDCx against zsBTC</div></div><div class="panel"><div class="label">Risk status</div><div class="value green">Healthy</div><div class="sub">0 urgent findings</div></div></div>
    <div class="grid g2" style="margin-top:12px"><div class="panel"><div class="row between"><h3>Portfolio history</h3><span class="pill">30 days · canonical</span></div><div class="chart"><i class="line"></i></div><div class="row between sub"><span>$5,214</span><span>Net contributions +$420</span><span>$5,867</span></div></div><div class="panel"><h3>What needs attention</h3><div class="infobox"><b>No urgent protective action.</b><br>Health and exit liquidity are within current policy.</div><div class="divider"></div><div class="metric"><span>Earned to date</span><b>$42.18</b></div><div class="metric"><span>Accrued estimate</span><b>$8.32</b></div><div class="metric"><span>Projected 30 days</span><b class="green">$31.44</b></div><button class="btn primary" style="width:100%;margin-top:11px">Explore verified opportunities →</button></div></div>
    <div class="grid g3" style="margin-top:12px"><div class="panel"><h3>Borrowed tokens</h3><div class="item" style="grid-template-columns:1fr 1fr"><span><b>833.13 USDCx</b><br><span class="sub">against 0.0351 zsBTC</span></span><span><b>Health 1.48</b><br><span class="green">Buffer present</span></span></div></div><div class="panel"><h3>Capital allocation</h3><div class="alloc"><i></i><i></i><i></i><i></i></div><div class="footerline">Zest 44% · Stacks 31% · Hermetica 17% · idle 8%</div></div><div class="panel"><h3>Data coverage</h3><div class="metric"><span>Verified</span><b class="green">7</b></div><div class="metric"><span>Estimated</span><b class="orange">1</b></div><div class="metric"><span>Unsupported</span><b>0</b></div></div></div>`,
    ),
  },
  {
    file: "02-earn.png",
    title: "Earn marketplace",
    note: "Evidence-gated protocol comparison and automatic capital allocation.",
    html: shell(
      "Earn",
      "Explore verified yield",
      "Compare like-for-like opportunities; rates and capacity must both pass evidence gates.",
      `
    <div class="panel"><div class="grid g3"><div><div class="label">Capital to allocate</div><div class="field">$ 100,000</div></div><div><div class="label">Asset</div><div class="field">sBTC ▾</div></div><div><div class="label">Horizon</div><div class="field">90 days ▾</div></div></div></div>
    <div class="grid g2" style="margin-top:12px"><div class="panel"><div class="row between"><h3>Recommended allocation</h3><span class="pill">4 eligible markets</span></div><div class="alloc" style="height:22px"><i></i><i></i><i></i><i></i></div><div class="list" style="margin-top:12px"><div class="item"><span><b>Zest · sBTC lending</b><br><span class="sub">on-chain + corroborated</span></span><b>$40,000</b><b>5.82% APR</b><b class="green">+$574</b></div><div class="item"><span><b>Hermetica · USDH staking</b><br><span class="sub">reward evidence</span></span><b>$30,000</b><b>4.90% APY</b><b class="green">+$359</b></div><div class="item"><span><b>Bitflow · sBTC/USDCx</b><br><span class="sub">LP capacity capped</span></span><b>$18,000</b><b>3.12% fee APR</b><b class="green">+$138</b></div><div class="item"><span><b>Granite · sBTC supply</b><br><span class="sub">on-chain market state</span></span><b>$12,000</b><b>2.64% APR</b><b class="green">+$78</b></div></div></div><div class="panel"><h3>Projection summary</h3><div class="value green">$1,149.32</div><div class="sub">projected gross earnings over 90 days</div><div class="divider"></div><div class="metric"><span>Known entry/network fees</span><b>$18.40</b></div><div class="metric"><span>Capacity utilized</span><b>22.7%</b></div><div class="metric"><span>Evidence confidence</span><b>91%</b></div><div class="warnbox" style="margin-top:10px"><b>Not promised profit.</b><br>Rates can change. LP projections exclude future range changes and impermanent loss.</div><button class="btn primary" style="width:100%;margin-top:11px">Review allocation plan →</button></div></div>`,
    ),
  },
  {
    file: "03-borrow.png",
    title: "Borrow",
    note: "Plain-language safety first, with protocol parameters available in Advanced mode.",
    html: shell(
      "Borrow",
      "Borrow without losing sight of risk",
      "Choose collateral and debt, then review what changes before signing.",
      `
    <div class="grid g2"><div class="panel"><h3>Borrow setup</h3><div class="label">Collateral</div><div class="field">0.035128 zsBTC &nbsp; · &nbsp; $2,793.88</div><div class="label" style="margin-top:10px">Borrow amount</div><div class="field">800 USDCx</div><div class="label" style="margin-top:10px">Safety target</div><div class="field">Safer · keep health above 1.50</div><div class="warnbox" style="margin-top:11px"><b>Health means your liquidation buffer.</b><br>Above 1.50 is currently comfortable. At 1.00, the protocol may liquidate collateral.</div><button class="btn primary" style="width:100%;margin-top:11px">Simulate borrow →</button></div><div class="panel"><div class="row between"><h3>Before and after</h3><span class="pill">Oracle fresh · 28s</span></div><div class="review"><div><div class="label">Current</div><div class="value">1.78</div><div class="metric"><span>Debt</span><b>73.07 USDCx</b></div><div class="metric"><span>LTV</span><b>12.3%</b></div></div><div class="arrow">→</div><div><div class="label">Projected</div><div class="value green">1.51</div><div class="metric"><span>Debt</span><b>873.07 USDCx</b></div><div class="metric"><span>LTV</span><b>41.8%</b></div></div></div><div class="divider"></div><div class="metric"><span>You receive</span><b>800.00 USDCx</b></div><div class="metric"><span>Network + protocol fees</span><b>1.42 USDCx</b></div><div class="metric"><span>Variable borrow APR</span><b>4.26%</b></div><div class="metric"><span>Illustrative BTC shock at health 1.0</span><b class="red">−43.8%</b></div></div></div>
    <div class="panel" style="margin-top:12px"><div class="flow"><div class="node"><b>1</b><br>Fresh oracle</div>→<div class="node"><b>2</b><br>Unsigned plan</div>→<div class="node"><b>3</b><br>Wallet review</div>→<div class="node"><b>4</b><br>Canonical debt</div></div></div>`,
    ),
  },
  {
    file: "04-swap.png",
    title: "Swap",
    note: "Executable exact-input route with enforced minimum output and quote expiry.",
    html: shell(
      "Swap",
      "Know the minimum you will receive",
      "Every route is quoted from allowlisted Bitflow contracts and revalidated before signing.",
      `
    <div class="grid g2"><div class="panel"><div class="label">You pay</div><div class="field row between"><span>0.010000 sBTC</span><b>≈ $796.24</b></div><div style="text-align:center;font-size:22px;color:#059669;margin:9px">⇅</div><div class="label">You receive</div><div class="field row between"><span>789.42 USDCx</span><b>Minimum 785.10</b></div><div class="row between" style="margin-top:12px"><span class="pill">Quote valid 24s</span><span class="sub">Pinned at block 9,003,231</span></div><button class="btn primary" style="width:100%;margin-top:14px">Review swap →</button></div><div class="panel"><h3>Best executable route</h3><div class="flow"><div class="node"><b>sBTC</b><br>0.010000</div>→<div class="node"><b>Bitflow</b><br>sBTC/USDCx</div>→<div class="node"><b>USDCx</b><br>789.42</div></div><div class="divider"></div><div class="metric"><span>Price impact</span><b>0.21%</b></div><div class="metric"><span>Pool fee</span><b>0.30%</b></div><div class="metric"><span>Network fee estimate</span><b>0.18 STX</b></div><div class="metric"><span>Slippage limit</span><b>0.55%</b></div><div class="infobox" style="margin-top:10px"><b>Minimum output is enforced on-chain.</b><br>If the quote expires or the route changes, signing is disabled until requoted.</div></div></div>`,
    ),
  },
  {
    file: "05-liquidity.png",
    title: "Liquidity provision",
    note: "Pool capacity, fee evidence, impermanent-loss scenarios and exit liquidity.",
    html: shell(
      "Liquidity",
      "Provide liquidity with the trade-offs visible",
      "Fees are variable; range changes and impermanent loss are shown separately.",
      `
    <div class="grid g2"><div class="panel"><h3>Provide to sBTC / USDCx</h3><div class="grid g2"><div><div class="label">sBTC</div><div class="field">0.0200</div></div><div><div class="label">USDCx</div><div class="field">1,586.40</div></div></div><div class="label" style="margin-top:11px">Position range</div><div class="field">$72,000 — $86,000 per sBTC</div><div class="alloc" style="margin-top:13px"><i style="width:17%"></i><i style="width:61%"></i><i style="width:22%"></i></div><div class="row between sub"><span>Below range</span><span>Current $79,312</span><span>Above range</span></div><button class="btn primary" style="width:100%;margin-top:13px">Simulate liquidity position →</button></div><div class="panel"><h3>Expected position</h3><div class="value green">3.12%</div><div class="sub">current fee APR · protocol-reported, corroborated</div><div class="divider"></div><div class="metric"><span>Pool TVL</span><b>$1.84m</b></div><div class="metric"><span>Your share</span><b>0.17%</b></div><div class="metric"><span>Projected 30-day fees</span><b>$8.11</b></div><div class="metric"><span>Estimated entry fees</span><b>$2.38</b></div><div class="warnbox" style="margin-top:10px"><b>Impermanent-loss scenario</b><br>If sBTC falls 20% while USDCx holds, modeled position value trails simple holding by approximately 0.62%. This is a scenario, not a forecast.</div></div></div>`,
    ),
  },
  {
    file: "06-staking.png",
    title: "Staking",
    note: "Clearly separated Bitcoin, STX and protocol receipt-token staking routes.",
    html: shell(
      "Staking",
      "Choose a verified staking route",
      "Lock terms, reward evidence, custody assumptions and exit paths are never hidden.",
      `
    <div class="grid g3"><div class="panel"><div class="row"><div class="logo">₿</div><div><h3>Bitcoin staking</h3><span class="pill warn">Unavailable</span></div></div><p class="sub">No verified production capability with supported wallet execution.</p><div class="warnbox">Visible for coverage; no simulated action or rate.</div></div><div class="panel"><div class="row"><div class="logo">S</div><div><h3>STX stacking</h3><span class="pill">Verified</span></div></div><div class="value green">7.10%</div><div class="sub">current reward APY · 2-cycle lock</div><button class="btn primary" style="width:100%;margin-top:13px">Review stacking →</button></div><div class="panel"><div class="row"><div class="logo">H</div><div><h3>Hermetica USDH</h3><span class="pill">Verified</span></div></div><div class="value green">4.90%</div><div class="sub">sUSDh reward APY · liquid exit</div><button class="btn primary" style="width:100%;margin-top:13px">Review staking →</button></div></div>
    <div class="panel" style="margin-top:12px"><h3>Before you stake</h3><div class="grid g4"><div><div class="label">You provide</div><div class="value" style="font-size:17px">5,000 STX</div></div><div><div class="label">Estimated rewards</div><div class="value green" style="font-size:17px">≈ 29.6 STX</div></div><div><div class="label">Lock</div><div class="value" style="font-size:17px">2 cycles</div></div><div><div class="label">Custody</div><div class="value" style="font-size:17px">User signed</div></div></div><div class="infobox" style="margin-top:12px">Rewards are variable and shown from current verified evidence. Unlock availability follows the selected route’s protocol rules.</div></div>`,
    ),
  },
  {
    file: "07-risk.png",
    title: "Risk monitor",
    note: "Easy interpretation with auditable advanced inputs and scenario coverage.",
    html: shell(
      "Risk",
      "Understand what can go wrong",
      "Easy mode explains urgency and impact; Advanced mode exposes protocol inputs and equations.",
      `
    <div class="grid g2"><div class="panel"><div class="row between"><h3>Portfolio risk posture</h3><span class="pill">As of block 9,003,231</span></div><div class="riskring"></div><div style="text-align:center"><b>Low risk</b><br><span class="sub">No immediate action required from current evidence</span></div></div><div class="panel"><h3>What the numbers mean</h3><div class="infobox"><b>Health factor 1.48</b><br>Your collateral is worth enough above the protocol’s liquidation threshold to provide a buffer. At 1.00, liquidation can begin.</div><div class="metric"><span>Current debt</span><b>833.13 USDCx</b></div><div class="metric"><span>Collateral</span><b>0.0351 zsBTC</b></div><div class="metric"><span>Oracle age</span><b>28 seconds</b></div><div class="metric"><span>Model confidence</span><b>92%</b></div><button class="btn primary" style="width:100%;margin-top:11px">Review protective options →</button></div></div>
    <div class="panel" style="margin-top:12px"><div class="row between"><h3>BTC stress scenarios</h3><span class="sub">Other assumptions held fixed · valued positions only</span></div><div class="grid g4"><div><div class="label">Unchanged</div><div class="value" style="font-size:17px">$5,867</div><span class="pill">Health 1.48</span></div><div><div class="label">BTC −10%</div><div class="value" style="font-size:17px">$5,294</div><span class="pill">Health 1.34</span></div><div><div class="label">BTC −20%</div><div class="value orange" style="font-size:17px">$4,721</div><span class="pill warn">Health 1.19</span></div><div><div class="label">BTC −35%</div><div class="value red" style="font-size:17px">$3,862</div><span class="pill risk">Health 0.98</span></div></div></div>`,
    ),
  },
  {
    file: "08-activity.png",
    title: "Activity and recovery",
    note: "Durable workflow history rather than a disconnected transaction list.",
    html: shell(
      "Activity",
      "Every action, state and recovery step",
      "Track intent through signing, chain confirmation and final position reconciliation.",
      `
    <div class="panel"><div class="tr head"><span>Workflow</span><span>State</span><span>Amount</span><span>Updated</span><span>Action</span></div><div class="tr"><span class="tx"><b>Supply sBTC to Zest</b><br><span class="sub">wf_8fa… · 2 transactions</span></span><span><span class="pill">Reconciled</span></span><span><b>0.0100 sBTC</b></span><span>2 min ago</span><span class="green"><b>Receipt →</b></span></div><div class="tr"><span class="tx"><b>Swap STX → USDCx</b><br><span class="sub">wf_72d… · quote expired</span></span><span><span class="pill warn">Action required</span></span><span><b>2,000 STX</b></span><span>18 min ago</span><span class="orange"><b>Requote →</b></span></div><div class="tr"><span class="tx"><b>Withdraw sBTC to Bitcoin</b><br><span class="sub">wf_19c… · signer observing</span></span><span><span class="pill">Confirming</span></span><span><b>0.0042 sBTC</b></span><span>43 min ago</span><span class="green"><b>Track →</b></span></div></div>
    <div class="grid g2" style="margin-top:12px"><div class="panel"><h3>Swap workflow · action required</h3><div class="steps"><span class="step on">✓</span> Quote <span>—</span><span class="step on">✓</span> Review <span>—</span><span class="step">3</span> Sign <span>—</span><span class="step">4</span> Reconcile</div><div class="warnbox" style="margin-top:13px"><b>Your quote expired before signing.</b><br>No transaction was broadcast and your funds did not move. Request a fresh route before continuing.</div><button class="btn primary" style="margin-top:11px">Get a fresh quote</button></div><div class="panel"><h3>Reconciled receipt</h3><div class="metric"><span>Transaction</span><b class="green">0x7ac…921 ↗</b></div><div class="metric"><span>You supplied</span><b>0.0100 sBTC</b></div><div class="metric"><span>Position received</span><b>0.00998 zsBTC</b></div><div class="metric"><span>Network fee</span><b>0.21 STX</b></div><div class="metric"><span>Canonical block</span><b>9,003,212</b></div></div></div>`,
    ),
  },
];

await mkdir(outDir, { recursive: true });
const mockupDir = path.join(outDir, "everything-stacks-ui-mockups");
await mkdir(mockupDir, { recursive: true });
const mockupBrowser = await chromium.launch({ headless: true });
const mockupImages = [];
try {
  const page = await mockupBrowser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  for (const mockup of mockupScreens) {
    await page.setContent(`<style>${mockupCss}</style>${mockup.html}`, { waitUntil: "load" });
    const imageBuffer = await page.locator(".app, .landing").first().screenshot({ type: "png" });
    await writeFile(path.join(mockupDir, mockup.file), imageBuffer);
    mockupImages.push({ ...mockup, dataUri: `data:image/png;base64,${imageBuffer.toString("base64")}` });
  }
} finally {
  await mockupBrowser.close();
}

const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char],
  );
const list = (items) => `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
const taskCards = (tasks, owner, reviewer) =>
  tasks
    .map(
      ([id, name, epic, priority, effort, deps, deliverables, acceptance]) => `
  <article class="task">
    <div class="task-head"><span class="task-id">${id}</span><h3>${esc(name)}</h3><span class="priority ${priority.toLowerCase()}">${priority}</span></div>
    <div class="meta"><b>Owner:</b> ${owner} · <b>Reviewer:</b> ${reviewer} · <b>Track:</b> ${epic} · <b>Estimate:</b> ${effort} · <b>Depends on:</b> ${esc(deps)}</div>
    <div class="task-cols"><div><h4>Deliverables</h4>${list(deliverables)}</div><div><h4>Acceptance evidence</h4>${list(acceptance)}</div></div>
  </article>`,
    )
    .join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Everything Stacks — Production Completion Plan</title>
<style>
  :root{--ink:#17171d;--green:#6c55d9;--mint:#e7defe;--pale:#f4f1e9;--line:#d6cec1;--orange:#ff7048;--red:#e5485d;--muted:#6c6964;--navy:#17171d}
  *{box-sizing:border-box} html{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);font-size:10.2pt;line-height:1.42}
  body{margin:0;background:white} a{color:#5a45c3;text-decoration:none} h1,h2,h3,h4{margin:0 0 .42rem;line-height:1.16} h1{font-family:Georgia,"Times New Roman",serif;font-size:29pt;letter-spacing:-1.3px} h2{font-family:Georgia,"Times New Roman",serif;font-size:18pt;border-bottom:3px solid var(--orange);padding-bottom:7px;margin-top:0} h3{font-size:12pt} h4{font-size:9.2pt;text-transform:uppercase;letter-spacing:.5px;color:#5a45c3} p{margin:.35rem 0 .7rem}.muted{color:var(--muted)}
  .page{padding:15mm 14mm 14mm;min-height:267mm;page-break-after:always}.page:last-child{page-break-after:auto}.cover{background:radial-gradient(circle at 88% 18%,#6c55d9 0 19%,transparent 19.2%),radial-gradient(circle at 78% 94%,#ff7048 0 17%,transparent 17.2%),#17171d;color:white;display:flex;flex-direction:column;justify-content:space-between;padding:21mm 18mm}.eyebrow{text-transform:uppercase;letter-spacing:1.8px;font-size:9pt;font-weight:800;color:#ffd166}.cover h1{font-size:39pt;max-width:155mm}.cover .subtitle{font-size:16pt;max-width:140mm;color:#d6d3dc}.cover-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.cover-stat{border:1px solid #ffffff44;background:#ffffff0d;border-radius:18px;padding:12px}.cover-stat b{display:block;font-size:20pt;color:#ff8a69}.callout{background:var(--mint);border-left:4px solid var(--green);padding:11px 13px;border-radius:10px;margin:10px 0}.warn{background:#fff2d5;border-left-color:var(--orange)}.danger{background:#fff0f2;border-left-color:var(--red)}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.card{border:1px solid var(--line);border-radius:10px;padding:12px;background:white}.card b.big{font-size:18pt;display:block;color:var(--green)}
  table{width:100%;border-collapse:collapse;margin:8px 0 14px;font-size:8.7pt}th{background:#eaf7f2;text-align:left}th,td{border:1px solid var(--line);padding:7px;vertical-align:top}tr:nth-child(even) td{background:#fbfdfc}
  ul,ol{margin:.28rem 0 .55rem;padding-left:18px}li{margin:2px 0}.task{border:1px solid var(--line);border-radius:10px;padding:11px;margin:0 0 9px;break-inside:avoid}.task-head{display:flex;align-items:center;gap:9px}.task-head h3{flex:1;margin:0}.task-id{background:var(--ink);color:white;font-weight:800;border-radius:20px;padding:4px 8px}.priority{font-size:8pt;font-weight:800;border-radius:20px;padding:3px 7px}.p0{background:#ffe3e7;color:#a71d32}.p1{background:#fff0cc;color:#8b5600}.meta{font-size:8.4pt;color:var(--muted);margin:5px 0 7px;border-top:1px solid #e5efeb;padding-top:5px}.task-cols{display:grid;grid-template-columns:1fr 1fr;gap:13px;font-size:8.7pt}.task-cols ul{margin-bottom:0}
  .wire{break-inside:avoid;border:1px solid var(--line);border-radius:10px;margin:10px 0;padding:12px;background:#fbfdfc}.wire pre{font:8.4pt/1.28 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;margin:7px 0 0;color:#153c32}.visual-page{page-break-after:always}.visual-page:last-child{page-break-after:auto}.visual-page h3{font-size:16pt;margin-top:8px}.visual-page p{color:var(--muted)}.screen-image{display:block;width:100%;border:1px solid var(--line);border-radius:10px;box-shadow:0 7px 24px #0b302718}.tag{display:inline-block;border-radius:999px;background:var(--mint);padding:3px 8px;font-weight:700;margin:2px}.toc li{margin:5px 0}.footer-note{font-size:8pt;color:var(--muted)}.break-before{page-break-before:always}.avoid{break-inside:avoid}
  @page{size:A4;margin:0} @media print{.page{height:auto}}
</style></head><body>
<section class="page cover">
  <div><div class="eyebrow">CapitalOS platform · Everything Stacks product</div><h1>Everything Stacks<br>Production Completion Plan</h1><p class="subtitle">A standalone delivery plan for the CapitalOS SDK and the Everything Stacks application: external protocol integrations, product screens, evidence integrity and release gates.</p></div>
  <div class="cover-grid"><div class="cover-stat"><b>40</b>new executable tasks</div><div class="cover-stat"><b>20 / 20</b>IBK / Kenzman split</div><div class="cover-stat"><b>SDK first</b>Everything Stacks is consumer #1</div></div>
  <div><div class="eyebrow">Prepared 19 September 2026</div><p>Scope: swaps, yield strategies, staking, lending, borrowing, liquidity provision, portfolio, risk, activity, partner SDK and production operations.</p></div>
</section>

<section class="page"><h2>Executive decision</h2>
  <div class="callout warn"><b>Project boundary:</b> this document covers only the CapitalOS platform and its Everything Stacks consumer application. Its backlog, architecture and frontend direction are derived from the CapitalOS repository and specifications; no external project is used as its implementation baseline.</div>
  <div class="callout"><b>Build orchestration, evidence and user experience—not replacement DeFi infrastructure.</b> CapitalOS integrates verified deployments of sBTC, Zest, Bitflow, Hermetica, Granite and supported stacking providers. User wallets sign direct protocol transactions. Everything Stacks consumes the same public SDK shipped to partners.</div>
  <div class="grid2"><div class="card"><h3>In scope</h3>${list(["Protocol adapters and capability registry", "Evidence-gated reads, quotes and unsigned plans", "Durable workflow/recovery and canonical reconciliation", "Everything Stacks production frontend", "Partner SDK, hooks, components and example", "Security, accessibility, observability and release operations"])}</div><div class="card"><h3>Explicitly out of scope</h3>${list(["Pooled custodial strategy vaults", "Private-key custody or unrestricted signing", "Invented rates, prices, liquidity or history", "Guaranteed APY or liquidation prevention", "Permissionless arbitrary contract routing", "Automatic retry of uncertain writes"])}</div></div>
  <h3 style="margin-top:14px">Current-state audit that drives this tranche</h3>
  <table><tr><th>Area</th><th>Observed state</th><th>Required outcome</th></tr>
  <tr><td>Build</td><td>Web bundle builds; API strict-TypeScript build fails in HTTP retry response construction.</td><td>All checks green and reproducible in CI.</td></tr>
  <tr><td>Financial safety</td><td>One integration test allocates capital from stale market evidence.</td><td>Stale, future or incomplete evidence can never drive an allocation or plan.</td></tr>
  <tr><td>Data foundation</td><td>Canonical projections exist, but one Bitflow checkpoint remains running.</td><td>Continuous deployed ingestion, reconciliation and complete checkpoints.</td></tr>
  <tr><td>Delivery evidence</td><td>Many existing tasks are marked Done without acceptance evidence.</td><td>PR + tests/live evidence + reviewer reproduction required for Done.</td></tr>
  <tr><td>Architecture</td><td>CapitalOS has core financial primitives and protocol foundations; the complete public SDK and consumer-product boundary still requires production closure.</td><td>Everything Stacks imports public CapitalOS SDK surfaces only.</td></tr>
  </table>
  <h3>Source specifications</h3><p class="footer-note">This document operationalizes the existing Notion specifications:</p>
  <p><a href="${refs.hq}">Engineering HQ</a> · <a href="${refs.architecture}">SDK architecture</a> · <a href="${refs.product}">Product specification</a> · <a href="${refs.journeys}">User journeys</a> · <a href="${refs.adapters}">Adapter contracts</a> · <a href="${refs.security}">Security and operations</a> · <a href="${refs.partner}">Partner SDK guide</a> · <a href="${refs.traceability}">Traceability catalogue</a></p>
</section>

<section class="page"><h2>Architecture and responsibility boundaries</h2>
  <div class="grid3"><div class="card"><h3>Protocol source of truth</h3><p>Deployed contracts and canonical chain evidence define balances, positions and action outcomes.</p></div><div class="card"><h3>CapitalOS</h3><p>Normalizes evidence, builds guarded unsigned plans, persists workflows and reconciles results.</p></div><div class="card"><h3>Everything Stacks</h3><p>Explains, simulates, reviews and invokes public SDK commands; it never constructs protocol calls.</p></div></div>
  <h3 style="margin-top:14px">Protocol integration matrix</h3>
  <table><tr><th>Protocol</th><th>Capabilities</th><th>Infrastructure reused</th><th>Delivery tasks</th></tr>${protocolRows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>
  <h3>Non-negotiable financial-data rules</h3>${list(["Unknown, unsupported, stale and disputed are explicit states—not zero.", "Every amount has a canonical asset ID and integer/base-unit representation.", "Every price/rate/liquidity datum carries source, timestamp/block and confidence/evidence state.", "Provider-reported returns remain labeled and cannot become verified through repetition.", "Recommendations require both usable return evidence and deployable-capacity evidence.", "Historical charts contain canonical observations only; earned yield requires reconciled cash flows.", "Quotes are informational; plans bind expiry, network, registry, adapter and deployment versions.", "A workflow is complete only after canonical position reconciliation."])}
  <h3>Shared action lifecycle</h3><p><span class="tag">Choose</span> → <span class="tag">Quote</span> → <span class="tag">Review</span> → <span class="tag">Wallet sign</span> → <span class="tag">Submit</span> → <span class="tag">Confirm</span> → <span class="tag">Reconcile</span> → <span class="tag">Receipt / recovery</span></p>
</section>

<section class="page"><h2>Delivery phases and operating model</h2>
  <table><tr><th>Phase</th><th>Tasks</th><th>Exit outcome</th></tr>${phases.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>
  <div class="grid2"><div class="card"><h3>IBK focus</h3><p>Platform data services, public clients/hooks, Everything Stacks frontend, partner experience, E2E and operations.</p><p><b>Reviewer:</b> Kenzman</p></div><div class="card"><h3>Kenzman focus</h3><p>Core SDK boundaries, protocol adapters, guarded transaction construction, workflows, risk, security and launch gate.</p><p><b>Reviewer:</b> IBK</p></div></div>
  <h3 style="margin-top:14px">Definition of Ready</h3>${list(["Dependencies and protocol access are available.", "Exact deployment, asset identifiers and evidence requirements are named.", "Acceptance evidence and reviewer are defined.", "Unknown product/financial semantics are resolved before implementation."])}
  <h3>Definition of Done</h3>${list(["Acceptance checklist is complete and reviewer reproduced the result.", "PR references task and requirement IDs.", "Unit/integration/E2E or live-transaction evidence is linked as appropriate.", "Data source, network, registry, adapter and calculation versions are recorded.", "Failure, stale, partial, rejection and reload behavior are covered.", "Documentation, telemetry and rollback/recovery instructions are updated."])}
  <div class="callout warn"><b>No schedule promise is implied.</b> Estimates are focused engineering days. One implementation task and one review maximum per engineer; tasks exceeding two days must be split.</div>
</section>

<section class="page"><h2>IBK production backlog · I21–I40</h2>${taskCards(ibk, "IBK", "Kenzman")}</section>
<section class="page"><h2>Kenzman production backlog · K21–K40</h2>${taskCards(kenzman, "Kenzman", "IBK")}</section>

<section class="page"><h2>Frontend visual direction and screen contract</h2>
  <div class="callout"><b>Rendered Everything Stacks wireframes:</b> the following nine images—including the public landing page—define the intended information hierarchy, density, visual language and financial disclosures. They are deliberately distinct from other products. Values are illustrative UI copy, not live protocol evidence. Final implementation may refine styling, but it must preserve the states, evidence labels and shared transaction lifecycle shown here.</div>
  ${mockupImages.map(({ title, note, dataUri }) => `<figure class="visual-page"><h3>${esc(title)}</h3><p>${esc(note)}</p><img class="screen-image" src="${dataUri}" alt="Everything Stacks ${esc(title)} frontend mockup"></figure>`).join("")}
</section>

<section class="page"><h2>Frontend state matrix</h2>
  <table><tr><th>State</th><th>User-facing requirement</th><th>Action policy</th></tr>
  <tr><td>Loading</td><td>Single-line purpose-specific message, stable layout and cancellable/retryable reads.</td><td>No signing; preserve prior verified data if clearly timestamped.</td></tr>
  <tr><td>Empty</td><td>Centered instruction with address input or wallet connection.</td><td>Offer the next valid read-only or setup action.</td></tr>
  <tr><td>Partial</td><td>Show verified subtotal and explicitly name excluded positions.</td><td>Unrelated verified reads remain available; unsafe writes fail closed.</td></tr>
  <tr><td>Unsupported</td><td>Name the asset/protocol capability and why it is unsupported.</td><td>No invented value or executable control.</td></tr>
  <tr><td>Stale/disputed</td><td>Show age, sources and disagreement.</td><td>Require refresh/requote; cannot rank or recommend.</td></tr>
  <tr><td>Review</td><td>Give/receive, fees, minimum output, debt change, health, protocol and contract.</td><td>Wallet invocation only after SDK plan validation.</td></tr>
  <tr><td>Submitted</td><td>Txid, explorer, confirmation/reconciliation distinction and next action.</td><td>Never auto-retry uncertain writes.</td></tr>
  <tr><td>Failed/delayed</td><td>Plain-language cause, funds status and recovery path.</td><td>Resume, requote, switch network, provide fee, reclaim or contact support.</td></tr>
  </table>
  <h3>Responsive and accessibility contract</h3>${list(["Keyboard-complete action flows and visible focus.", "Focus returns correctly after wallet/error modals.", "Workflow progress uses live regions; risk is never communicated by color alone.", "Every amount includes its asset unit; addresses truncate safely and remain copyable.", "Tables become labeled cards below tablet width.", "No overlapping chart labels, clipped identifiers or ambiguous negative-number formatting."])}
</section>

<section class="page"><h2>Production release gates</h2>
  <div class="grid2"><div class="card"><h3>Code and SDK</h3>${list(["Typecheck, unit, integration, E2E and production build green", "Published-package clean-install test", "OpenAPI/runtime schema agreement", "No forbidden application-to-adapter imports"])}</div><div class="card"><h3>Financial integrity</h3>${list(["Projection/backfill audit complete", "Golden-address and independent reconciliation pass", "Stale/partial/unsupported gates proven", "Exact arithmetic and post-conditions audited"])}</div><div class="card"><h3>Security and recovery</h3>${list(["No unresolved critical/high finding", "Wallet rejection, expiry, reorg and broadcast uncertainty tested", "Registry pause and safe-exit-only behavior proven", "Backup restore and provider-outage drills complete"])}</div><div class="card"><h3>Product and operations</h3>${list(["All entry and exit journeys pass", "Accessibility and wallet/browser matrix pass", "Dashboards, alerts, incident/support ownership active", "Five pilot users and one partner certification complete"])}</div></div>
  <h3 style="margin-top:14px">Required launch evidence bundle</h3>
  <table><tr><th>Artifact</th><th>Must contain</th></tr>
  <tr><td>Release manifest</td><td>Git SHA, package versions, registry version, adapter versions, migrations and feature flags.</td></tr>
  <tr><td>Protocol certification</td><td>Deployment, block/snapshot, fixtures, live workflow/transaction IDs and known limitations.</td></tr>
  <tr><td>Product acceptance</td><td>Desktop/mobile captures, E2E runs, accessibility report and recovery demonstrations.</td></tr>
  <tr><td>Data integrity</td><td>Golden-address comparison, pricing quorum, projection audit, backfill completeness and reconciliation.</td></tr>
  <tr><td>Security and operations</td><td>Threat model, findings, restore/outage drill, monitors, alert routes and incident owners.</td></tr>
  <tr><td>Go/no-go record</td><td>Pilot results, partner certification, exclusions, rollback triggers and accountable approvers.</td></tr></table>
  <div class="callout danger"><b>Launch stop conditions:</b> stale evidence can influence a recommendation; an unapproved contract can be called; a signed action can be duplicated; portfolio/debt cannot reconcile; an entry path lacks a tested exit; or any critical/high security finding remains open.</div>
  <p class="footer-note">Generated from the CapitalOS repository audit and product specifications. This PDF is a delivery artifact, not financial advice and not evidence that any protocol capability is currently available.</p>
</section>
</body></html>`;

await mkdir(outDir, { recursive: true });
await writeFile(htmlPath, html, "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate:
      '<div style="width:100%;font-size:7px;color:#6b7f78;padding:0 14mm;display:flex;justify-content:space-between"><span>Everything Stacks · Production Completion Plan</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    margin: { top: "0", right: "0", bottom: "8mm", left: "0" },
  });
} finally {
  await browser.close();
}
console.log(JSON.stringify({ htmlPath, pdfPath }));
