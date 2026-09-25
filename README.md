# Stacks Capital

Stacks Capital is a non-custodial application for Bitcoin capital on Stacks. It moves BTC into sBTC, compares verified yield, borrows against Bitcoin collateral, swaps, provides liquidity, and takes capital back out, with the risk and the evidence behind every number visible before anything is signed.

This repository holds both halves: the platform, which is the protocol adapters, the signed capability registry, guarded plan construction, the durable workflow engine and the public SDK, and the application built on top of it. The application imports only the public packages a partner would install, enforced in CI. It is consumer number one, not a special case.

The product is designed around one operating rule: **unknown, stale and unsupported are explicit states, never zero, and the user's wallet signs every transaction directly against the protocol**. Stacks Capital never holds keys or funds, never pools capital, and never constructs a call to a contract it has not reviewed.

## Status

This is not launched. There is no deployed URL, and no user has moved mainnet funds through it.

| Area | State |
| --- | --- |
| Production launch | **No-go**, recorded in [`docs/release/launch-decision.md`](docs/release/launch-decision.md) |
| Closed mainnet pilot | **No-go** until pilot blockers B4, B5 and B7 close |
| Certified on mainnet | None. Every protocol capability is listed with the reason it is not certified |
| Automated checks | Green. More than 700 automated tests across unit, integration and browser suites |
| Backup, restore, rollback | Drilled, passing |

Open blockers are tracked in [`docs/release/pilot-checklist.md`](docs/release/pilot-checklist.md). We publish these rather than hide them, because a green test suite is not evidence that a product works. Two of the blockers were found by re-running commands and reading code after the suite was already green.

## What Stacks Capital provides

### Evidence-gated reads

Every price, rate, liquidity and capacity figure carries its source, its observation timestamp or block, and its confidence. From that:

- a rate read on chain is never mixed with a rate a provider reported about itself;
- a market whose deployable capacity cannot be evidenced is listed but never ranked or recommended;
- a reading older than 300 seconds cannot drive a ranking or an allocation;
- prices come from a quorum that withholds the price entirely when independent sources disagree beyond tolerance, rather than averaging them;
- a portfolio total discloses what it valued and what it could not, instead of coercing unpriced assets to zero.

### Signed capability registry

Reviewed assets, deployments, actions and adapter versions are held in an Ed25519-signed registry with a version, per network. From that:

- an unreviewed contract principal cannot produce an executable plan;
- capabilities carry activation, rollback and safe-exit-only states;
- read and exit capabilities survive a write pause, so a user can always leave a position even when entries are frozen;
- capabilities can be paused or disabled from an operations command without a deploy.

### Certified protocol adapters

Adapters are conformance tested against fixtures for reads, quotes, plans and reconciliation, and must declare their own semantics. An adapter cannot infer a field it did not read.

| Protocol | Actions | State |
| --- | --- | --- |
| sBTC | BTC deposit, sBTC withdrawal | Adapter and lifecycle built; no Bitcoin or Emily ingestion yet |
| Zest | Supply, withdraw, collateral, borrow, repay | Adapter and lifecycle built |
| Granite | Supply, withdraw, collateral, borrow, repay | Adapter built |
| Bitflow | Exact-input swaps | Swap adapter built; liquidity provision not built |
| Hermetica | Stake, unstake, rewards | Not built |
| Stacking providers | STX stacking, verified staking routes | Certified as unavailable only |

Capabilities that do not exist are surfaced as documented unavailable states with a reason. They are never shown as executable, and no rate is invented for them.

### Guarded plans and on-chain enforcement

A quote is informational. A plan binds the quote, the registry version, the adapter version, the network, the deployment and an expiry, and is validated locally before a wallet is ever opened. For a swap that means:

- the minimum output is bound as a contract argument **and** as a deny-mode post-condition, so the chain itself rejects a transaction returning less than the user was shown;
- asset identifiers are reconciled against the signed registry by exact principal, asset name and network, not by substring;
- an expired quote cannot reach signing;
- quantities stay integer base units as exact strings or bigints through quoting, plan construction and signing; no floating-point arithmetic decides an amount that reaches a contract call.

### Durable workflows

Every action runs the same lifecycle: choose, quote, review, wallet sign, submit, confirm, reconcile, receipt or recovery. Every state transition is persisted and append-only, enforced by a database trigger.

- A reload resumes at the exact step the user left.
- An uncertain broadcast is never blindly retried.
- A reorg rewinds affected evidence and the workflows that depended on it.
- A transaction that reverted on chain is recorded as failed, not as confirmed.

Workflows currently reach `STEP_CONFIRMED` from chain evidence. Completion requires canonical position reconciliation, which is not built yet, so nothing reaches `COMPLETED`.

### The application

Ten screens, each built only on public SDK exports, enforced in CI: Overview, Bridge, Earn, Borrow, Swap, Liquidity, Staking, Positions, Risk and Activity.

Eight canonical states are centralised rather than reinvented per screen: loading, empty, partial, unsupported, stale or disputed, review, submitted, failed or delayed. Risk is never communicated by colour alone, every amount carries its asset unit, tables become labelled cards below tablet width, and workflow progress is announced through live regions.

### Partner SDK

The public surface is `@stacks-capital/sdk`, `@stacks-capital/client`, `@stacks-capital/react`, `@stacks-capital/ui`, `@stacks-capital/wallets` and `@stacks-capital/core`. A partner application in [`apps/partner-example`](apps/partner-example) runs a sandbox entry and exit through public packages only, with the boundary enforced by an architecture check rather than by convention.

The packages are built and used by this repository. They have **not been published to npm**.

## Run locally

Requirements:

- Node.js 24 (see `.nvmrc`);
- pnpm 12;
- Docker, for PostgreSQL and Redis.

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

The application runs on `http://localhost:5173`. The full walkthrough, including running the API, worker and partner example separately, is in [`docs/guides/quickstart.md`](docs/guides/quickstart.md). Do not commit any `.env.local`.

## Verification

Core verification, which is what CI runs:

```sh
pnpm run ci
```

That is `lint`, `boundaries`, `typecheck`, unit, fixture and check tests, `build`, and the OpenAPI and error-document contracts.

Individual suites:

```sh
pnpm typecheck
pnpm test:unit
pnpm boundaries          # architecture and dependency rules
pnpm adapters:certify    # adapter conformance report
pnpm test:integration    # requires PostgreSQL
pnpm test:browser        # Playwright, desktop and mobile
```

Release gates and evidence:

```sh
pnpm gate:k38            # live protocol, golden address and failure injection
pnpm gate:k39            # SDK release and compatibility
pnpm gate:k40            # pilot and go/no-go
pnpm sdk:check
pnpm release:rollback-drill
pnpm db:restore-drill
```

## Repository map

```text
apps/
  api/                    Versioned HTTP API, tenant scopes, sessions, signed webhooks
  web/                    Stacks Capital application, ten screens
  worker/                 Ingestion, projections, reconciliation, confirmations, health
  e2e/                    Playwright journeys and accessibility scans
  partner-example/        External partner integration, public packages only
  embed-example/          Embedded widget host
packages/
  core/                   Money, assets, quotes, plans, workflows, risk, valuation
  config/                 Signed capability and deployment registry
  adapters/               sBTC, Zest, Granite, Bitflow and staking adapters
  engine/                 Server-side quote and plan construction
  database/               Migrations, projections, workflows, ingestion, fixtures
  sdk/                    Public SDK surface
  client/                 Browser client, cache and typed financial errors
  react/                  Hooks and embedded workflow components
  ui/                     Shell, canonical states, comparison and simulation
  wallets/                Leather and Xverse provider integration
  fixtures/               Recorded mainnet reads for deterministic tests
scripts/
  checks/                 Architecture boundaries and adapter certification
  gates/                  Release gates
  release/                Rollback drill and release tooling
docs/                     Architecture, engineering, runbooks, release evidence
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
- [`docs/guides/quickstart.md`](docs/guides/quickstart.md) — fresh clone to running locally
- [`docs/guides/adapter-guide.md`](docs/guides/adapter-guide.md) — adding a protocol or an action
- [`docs/engineering/signed-registry.md`](docs/engineering/signed-registry.md) — reviewed contracts, signatures, rollback
- [`docs/engineering/adapter-certification.md`](docs/engineering/adapter-certification.md) — conformance rules
- [`docs/engineering/workflow-recovery.md`](docs/engineering/workflow-recovery.md) — idempotency, recovery, reconciliation
- [`docs/reference/api-errors.md`](docs/reference/api-errors.md) — every error code, generated from the code
- [`docs/release/pilot-checklist.md`](docs/release/pilot-checklist.md) — open blockers
- [`docs/release/launch-decision.md`](docs/release/launch-decision.md) — the go/no-go record
