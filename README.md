# Stacks Capital

One place to put Bitcoin capital to work on Stacks — without stitching five protocol apps together, and without trusting a dashboard that invents a rate.

Stacks Capital is a non-custodial application and a public SDK. Users move BTC into sBTC, **compare verified earn rates across DeFi protocols**, borrow, swap, and take capital back out. Partners embed the same quote → plan → sign → reconcile path. The wallet signs every transaction directly against the protocol. Stacks Capital never holds keys or funds.

**Unknown, stale and unsupported are explicit states, never zero.**

## The problem

Bitcoin on Stacks already has real yield, credit and markets: sBTC, Zest, Granite, Bitflow, and more coming. What it does not have is a single honest front door.

- Each protocol is its own app, wallet prompt and risk vocabulary.
- “Best APY” screens mix on-chain rates with marketing numbers, treat a missing incentive as 0%, and rank sBTC supply against a dollar vault as if they were the same product.
- A paused market, a dry vault, or a strategy you cannot exit still looks like an opportunity.
- Wallets and partners who want to offer Stacks DeFi have to re-implement every adapter, post-condition and recovery path themselves.

The cost is not just friction. Capital stays idle, or it is deployed on a number nobody can defend.

## Who this is for

| Audience | What they get |
| --- | --- |
| **Bitcoin holders** | Bridge BTC ↔ sBTC, then earn, borrow or swap without becoming a protocol expert. |
| **Allocators and funds** | Same-asset rate comparison with source, timestamp and confidence on every figure — listed, not ranked, when the evidence is not there. |
| **Wallets, neobanks and Stacks apps** | A public SDK that already does the hard part: reviewed contracts, integer amounts, deny-mode plans, durable workflows. |
| **The Stacks ecosystem** | One distribution surface that sends users *into* existing protocols instead of wrapping or pooling their capital. |

This repository is both the platform and consumer number one. The application imports only the public packages a partner would install. CI enforces that boundary.

## Compare DeFi rates, then deploy

Earn is a marketplace, not a single-protocol deposit button. `GET /v1/earn/options` serves one row per supply market. The app ranks them with `compareEarn` — the comparison is implemented, tested, and the only ranking path that exists.

**What you see for each market**

- Supplied asset and receipt (for example sBTC in, zsBTC out)
- Base rate from a live market snapshot; incentive rate from a reward snapshot
- Liquidity, capacity, pause state, and whether you can withdraw
- Source, observation time and evidence confidence

**How ranking works**

1. Options are grouped by the **asset you supply**. Zest sBTC is never ranked against a USDCx vault. The screen says so.
2. Inside a group, rank is **base + incentive**, added at the finer of the two scales. A missing incentive is **not treated as zero** — the option ranks on the base rate with the gap labelled.
3. An option is **listed but not ranked** when supply is off, the market is paused, withdrawal is missing or disabled, no rate has been read, the reading is stale or older than **300 seconds**, capacity or liquidity cannot be evidenced, or independent reads disagree.
4. A strategy you cannot leave is not ranked beside one you can. Exit conditions are a gate, not a footnote.
5. Fees belong on the quote for a specific amount, not on the comparison table. Rates are shown as the protocol reports them — no invented APY, no silent compounding.

That is the product edge for users: you can see Zest against the next certified supply market on the same asset, and you can see why a row is *not* a recommendation.

Adapters in this repo today:

| Protocol | What users can do | Earn comparison |
| --- | --- | --- |
| sBTC | BTC deposit, sBTC withdrawal | Bridge, not a yield row |
| Zest | Supply and withdraw (sBTC vault certified); credit surfaces exist | Live earn row when snapshots are fresh |
| Granite | Isolated sBTC collateral, USDCx borrow / repay | Collateral is not ranked as earn — it is not lent and does not pay a supply rate |
| Bitflow | Exact-input swaps | Swap, not a vault row; LP is not executable until pools are pinned |
| Hermetica | sUSDh vault | Documented unavailable — never shown as a ranked rate |
| Stacking | STX / PoX routes | Certified unavailable until lockup signing is verified |

Capabilities that do not exist appear as unavailable, with a reason. No rate is invented for them.

## The product edge

- **Non-custodial orchestration.** Your wallet signs the protocol call. There is no pooled vault and no discretionary manager.
- **Evidence-gated numbers.** On-chain rates are never mixed with a provider talking about itself. A stale or disputed price is withheld, not averaged.
- **Guarded plans.** A quote is informational. A plan binds the quote, registry version, adapter version, network and expiry. Minimum output is an on-chain argument *and* a deny-mode post-condition.
- **Integer money.** Amounts stay exact strings or bigints from quote through signing. JavaScript numbers do not decide a contract call.
- **Durable workflows.** Choose, quote, review, sign, submit, confirm, reconcile. A reload resumes. An uncertain broadcast is never blindly retried. A reorg rewinds the evidence that depended on it.
- **Signed capability registry.** Unreviewed contract principals cannot produce an executable plan. Writes can pause while exits stay on.

## The SDK edge

The public surface is `@stacks-capital/sdk`, `@stacks-capital/client`, `@stacks-capital/react`, `@stacks-capital/ui`, `@stacks-capital/wallets` and `@stacks-capital/core`.

Partners do not re-build Stacks DeFi from Hiro calls and a spreadsheet of APYs. They get:

- the same earn comparison and quote/plan types the first-party app uses;
- Leather and Xverse signing against a validated plan;
- typed financial errors, cache and React hooks;
- a sandbox entry/exit in [`apps/partner-example`](apps/partner-example) that is forbidden from importing private packages.

The packages are built and used here. They have **not been published to npm**.

## Value to Stacks

Stacks Capital does not launch a new money market. It makes the ones that already exist usable as a portfolio.

- **Distribution for protocols.** Zest, Granite, Bitflow and sBTC keep their contracts and liquidity. Users reach them through one reviewed path.
- **Less fragmented capital.** Comparison only happens when two markets are the same product (same asset, same action, evidenced exit). That is how Bitcoin on Stacks compounds instead of sitting in five disconnected balances.
- **A standard for wallets.** If the SDK is the integration, every partner inherits fail-closed prices, post-conditions and recovery — the ecosystem does not get a new class of “we averaged the oracle” accidents.
- **Honesty as infrastructure.** Publishing unavailable states and launch no-gos is part of the product. A green test suite is not a claim that mainnet funds have moved.

## Status

This is not launched. There is no deployed URL, and no user has moved mainnet funds through a production release of this app.

| Area | State |
| --- | --- |
| Production launch | **No-go**, recorded in [`docs/release/launch-decision.md`](docs/release/launch-decision.md) |
| Closed mainnet pilot | **No-go** until pilot blockers close |
| Certified on mainnet | None listed as certified. Sandbox Zest supply is the furthest executable earn path |
| Automated checks | Green across unit, integration and browser suites |
| Backup, restore, rollback | Drilled, passing |

Open blockers: [`docs/release/pilot-checklist.md`](docs/release/pilot-checklist.md).

## Run locally

Requirements: Node.js 24 (`.nvmrc`), pnpm 12, Docker (PostgreSQL and Redis).

```sh
nvm install && nvm use

cp .env.example .env.local
cp apps/web/.env.example apps/web/.env.local
cp apps/embed-example/.env.example apps/embed-example/.env.local

pnpm install
pnpm services:up      # Postgres and Redis, waits until healthy
pnpm db:migrate
pnpm fixtures:seed
pnpm dev
```

The application runs on `http://localhost:5173`. Full walkthrough: [`docs/guides/quickstart.md`](docs/guides/quickstart.md). Do not commit any `.env.local`.

Landing (product site): `pnpm landing:dev`.

## Verification

```sh
pnpm run ci
```

That is lint, boundaries, typecheck, unit, fixture and check tests, build, and the OpenAPI and error-document contracts.

```sh
pnpm typecheck
pnpm test:unit
pnpm boundaries          # architecture and dependency rules
pnpm adapters:certify    # adapter conformance report
pnpm test:integration    # requires PostgreSQL
pnpm test:browser        # Playwright, desktop and mobile
pnpm gate:k38            # live protocol, golden address and failure injection
pnpm gate:k39            # SDK release and compatibility
pnpm gate:k40            # pilot and go/no-go
```

## Repository map

```text
apps/
  api/                    Versioned HTTP API, earn options, quotes, workflows
  web/                    Stacks Capital application
  landing/                Public product site
  worker/                 Ingestion, projections, reconciliation
  e2e/                    Playwright journeys
  partner-example/        Partner integration on public packages only
  embed-example/          Embedded widget host
packages/
  core/                   Money, quotes, plans, workflows, risk
  config/                 Signed capability and deployment registry
  adapters/               sBTC, Zest, Granite, Bitflow, staking
  engine/                 Server-side quote and plan construction
  database/               Migrations, projections, workflows
  sdk/                    Public SDK surface
  client/                 Browser client and typed errors
  react/                  Hooks and embedded components
  ui/                     Shell, states, earn comparison and simulation
  wallets/                Leather and Xverse
  fixtures/               Recorded mainnet reads
docs/                     Architecture, runbooks, release evidence
```

## Safety status

- Stacks Capital holds no private keys and no user funds.
- There are no pooled or discretionary vaults.
- An unreviewed contract cannot produce an executable plan.
- Prices fail closed on quorum disagreement.
- Stale, unknown and unsupported states are explicit and never rendered as zero.
- Provider-reported returns stay labelled and cannot become verified by repetition.
- Projected earnings are hypothetical and disclose their exact inputs.
- Uncertain writes are never automatically retried.
- No protocol capability is certified on mainnet today.
- The codebase has not been audited by a third party.

## Documentation

- [`docs/README.md`](docs/README.md) — index
- [`docs/guides/quickstart.md`](docs/guides/quickstart.md) — clone to running locally
- [`docs/engineering/earn-comparison.md`](docs/engineering/earn-comparison.md) — rate comparison rules
- [`docs/guides/adapter-guide.md`](docs/guides/adapter-guide.md) — adding a protocol or an action
- [`docs/engineering/signed-registry.md`](docs/engineering/signed-registry.md) — reviewed contracts
- [`docs/guides/partner-integration.md`](docs/guides/partner-integration.md) — SDK entry and exit
- [`docs/release/pilot-checklist.md`](docs/release/pilot-checklist.md) — open blockers
- [`docs/release/launch-decision.md`](docs/release/launch-decision.md) — go/no-go record
