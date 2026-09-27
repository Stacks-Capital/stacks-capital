# Pilot and release checklist

| | |
|---|---|
| Task | I20 Pilot support and release checklist |
| Requirements | PMF-01, OPS-01 |
| Owner / reviewer | IBK / kenzman |
| Depends on | I18 end to end tests, I19 docs and runbooks |
| Feeds | [K20 pilot and launch decision](launch-decision.md) |
| Date | 2026-09-18, at commit `0e09f96`. Blockers rechecked 2026-09-22 at `fae05d5`: B1 still open, B2 narrowed, B7 added. Rechecked 2026-09-23 at `166d1c1`: B1 narrowed after PR #25. B1 then closed for the watched protocols; see the row below. |

Deliverable from the task page: run pilot checklist, classify failures, verify rollback/restore evidence and document outstanding issues for go/no-go.

This document records evidence. It does not make the go/no-go call; that is K20.

## Summary

| Area | State |
|---|---|
| Automated checks | All pass |
| Backup and restore | Drilled, passes |
| Rollback | Drilled, passes for targets at or after I17 |
| Release checklist (page 03) | 2 met, 3 partly met, 3 not met |
| Product definition of done (page 02) | 3 met, 3 partly met, 2 not met |
| Manual pilot checks | Written, not run yet |
| Pilot blockers found | 7 (see [Outstanding issues](#outstanding-issues)) |

## Automated evidence

| Check | Command | Result |
|---|---|---|
| Lint, boundaries, types, unit, fixtures, SDK check, build, OpenAPI and error docs | `pnpm run ci` | Pass. 270 unit tests (1 live test skipped), 13 fixture and failure drill tests, 6 gate tests, 10 SDK checks |
| Integration against Postgres | `pnpm test:integration` | Pass, 89 of 89 |
| Browser journeys and accessibility scan | `pnpm test:browser` | Pass, 18 of 18 (desktop and mobile, Chromium) |
| Secret scan | gitleaks in CI | Pass on PR #13 |
| Backup and restore | `pnpm db:restore-drill` | Pass. 31 tables, 99 rows, no differences, 2.8 s |
| Rollback | `pnpm release:rollback-drill` | Pass against `origin/main`. Fails against M3, as it should (see [rollback](../runbooks/rollback.md)) |
| CI workflow lint | actionlint | Clean |

## Release checklist (page 03)

| Item | State | Evidence or gap |
|---|---|---|
| Verified mainnet registry and independent address review | Partly | Contracts pinned with revisions in `packages/config` (K01). No independent review recorded. The Bitflow pool principal is not pinned, so swap runs on fixture routes only |
| No unresolved critical or high findings | Not met | Six pilot blockers below. No SEV-0 or SEV-1 defect found |
| Deposit/withdraw and borrow/repay end to end evidence | Partly | Browser tests cover the supply journey with a fake wallet. Borrow, repay and swap are covered by unit tests only (adapters, `ui` borrow and swap rules, K15 borrow safety), with no browser journey. No BTC to sBTC flow exists. Real wallet runs are manual checks M1 to M6 |
| Reorg, broadcast unknown and duplicate submission tests pass | Met | K18 drill (`packages/fixtures/src/failure-drill.test.ts`) and `packages/core/src/threat.test.ts`, in `pnpm run ci` |
| Backup restore and deployment rollback drilled | Met | Both drills above. There is no hosted deployment yet, so the rollback drill runs locally |
| Terms, privacy, risk disclosures and support ownership ready | Not met | Nothing in the repo. Needs owners outside engineering |
| On call owner and protocol emergency contacts documented | Not met | Runbooks exist ([incidents](../runbooks/incidents.md)); names and contacts do not |
| Clean partner integration passes certification | Partly | K19 gate (`pnpm sdk:compat`) passes: public exports, schemaVersion 1.0, packable source, no adapters in partner packages. Packages are not published to a registry (N9). Webhooks are not certified. |

## Product definition of done (page 02)

| Item | State | Evidence or gap |
|---|---|---|
| BTC holder completes BTC to sBTC to earn to withdraw to sBTC to BTC | Not met | sBTC deposit and withdraw adapters exist, but there is no screen, and Bitcoin and Emily are not ingested |
| Borrower completes collateral, borrow, repay, withdraw collateral | Partly | Screens and fail closed rules exist (I13, K15). Granite positions cannot be read from the registered contract, and the DIA USDC feed is unset, so borrow is blocked in practice |
| Swap enforces minimum output and handles expiry | Met | I14 and K13 unit tests. No browser journey. Live pool not pinned (see above) |
| Portfolio values reconcile and avoid claim double counting | Met | I09, I11, `buildPortfolio` tests |
| Workflow resumes after reload, wallet rejection, broadcast uncertainty and provider delay | Partly | Reload, rejection and broadcast unknown are covered in browser tests. A confirmed transaction is now recorded as confirmed (PR #25), but nothing reconciles it to `COMPLETED`, so the journey still has no success state (B1) |
| Every opportunity shows exact asset, source, timestamp, liquidity and risk | Met | I12 earn comparison, I15 risk panel |
| External partner example reproduces a journey using the public SDK only | Partly | Earn comparison, positions and activity reproduce. Borrow and swap widgets are not exported |
| Pilot users complete entry and exit without engineer intervention | Not met | Blocked by the workflow progress gap. Manual check M1 confirms it |

## Manual pilot checks

Run with real wallets on mainnet with the smallest amounts that work, on the local stack from the [quickstart](../guides/quickstart.md) with `pnpm worker:run` going. Record every result, including failures. A failure here is expected for some items and is still evidence.

| # | Check | Steps | Expected | Result | By, date |
|---|---|---|---|---|---|
| M1 | Earn round trip, Leather, Chrome | Connect Leather, sign in, supply the minimum sBTC to `zest.sbtc.vault`, wait for confirmation, then withdraw it | Each step shows a truthful state. The supply confirms on chain. Today the workflow is expected to stop at submitted | | |
| M2 | Earn round trip, Xverse | As M1 with Xverse | As M1 | | |
| M3 | Rejection in a real wallet | Start a supply and reject it in the wallet | Shows it was declined, nothing sent, offers to ask again | | |
| M4 | Wallet closed mid signing | Start a supply and close the wallet popup without answering | No resend. Shows the unknown state and next step | | |
| M5 | Swap | Quote the minimum sBTC to USDCx, let it expire, requote, sign | Expired quote refused. Minimum output shown and enforced | | |
| M6 | Borrow | Open borrow with a real address | Blocked with the reason (position unknown or price unknown), no plan offered | | |
| M7 | Operator switch seen by users | `pnpm ops:disable mainnet zest.sbtc.vault supply "pilot check"`, reload, then `ops:enable` | Supply shows as off with the reason, then returns | | |
| M8 | Screen reader | Orca, NVDA or VoiceOver through connect, sign in, earn comparison and one supply review | Every control is named, workflow status changes are announced, focus returns after the wallet closes | | |
| M9 | Other browsers | Firefox and Safari (or WebKit): connect, sign in, earn comparison | Works, or the gap is written down | | |
| M10 | Partner setup from scratch | Another engineer follows the quickstart and fills in the [reproduction record](../runbooks/incidents.md#reproduction-record) | All steps pass | | |

## Outstanding issues

Defects use the page 03 severity scale: SEV-0 active loss vector, SEV-1 wrong plan or risk or cross tenant exposure, SEV-2 stuck workflows or major mismatch, SEV-3 degraded read or UI. Gaps are missing scope rather than broken behaviour.

### Pilot blockers

| # | Issue | Kind | Effect on pilot | Source |
|---|---|---|---|---|
| B1 | Workflows now complete. The worker reconciles a confirmed final step against the amounts its transaction emitted and moves `STEP_CONFIRMED` to `RECONCILING` to `COMPLETED`, judged against `minimumOutput`, the floor the post conditions already bound the transaction to. Landing under the quote but above that floor completes with a note; landing under the floor goes to `ACTION_REQUIRED`; an unread amount waits rather than failing. **Not yet reached for Bitflow or sBTC**: ingestion still polls the router and the two sBTC entry contracts, which emit no logs of their own, so no amounts are attributed for them. Their events come from the pool core and `sbtc-registry`, and watching those needs the emitting contracts pinned in the registry | Closed for Zest and Granite, open for Bitflow and sBTC | The earn journey reaches a success state. Swap and the BTC round trip still stop at "waiting" | `apps/worker/src/reconciliation.ts`, `apps/worker/src/ingest.ts`, `apps/worker/test/integration/workflow-completion.test.ts` |
| B2 | No Bitcoin or Emily ingestion. The deposit and withdrawal screens shipped in I33, but nothing watches the L1 side | Gap | A deposit can be started and never observed, so the main BTC holder journey cannot finish | `docs/engineering/ingestion.md`, `apps/web/src/depositBtcScreen.tsx` |
| B3 | Granite positions cannot be read from the registered contract, and the DIA USDC feed is unset | Gap | Borrow stays blocked (safely) | `docs/engineering/positions.md` finding 3, `docs/discovery/borrow-ux-safety.md` |
| B4 | Terms, privacy, risk disclosures and support ownership | Gap | Cannot put users on mainnet funds without them | Page 03 release checklist |
| B5 | On call owner, protocol emergency contacts, a destination for alerts (they print to standard output only) | Gap | Nobody is paged when something breaks | Page 03, `docs/engineering/operations.md` |
| B6 | Independent address review, and the Bitflow pool principal pinned | Gap | Swap stays on fixture routes | Page 03, `packages/config` |
| B7 | No metrics surface to build dashboards on. The worker serves `/health`, `/readyz` and `/status` only; there is no exporter, dashboard or alert router in the repository | Gap | The P3 gate "dashboards, alerts, incident/support ownership active" cannot be evidenced. Distinct from B5, which is about who is paged rather than what is measured | `docs/engineering/e2e-accessibility-acceptance-i40.md` section 4.1, `apps/worker/src/health.ts` |

### Known issues, not blocking a closed pilot

| # | Issue | Kind | Note |
|---|---|---|---|
| N1 | A rollback to a release before I17 ignores operator switches | SEV-1 if done, prevented | Minimum rollback target documented, and the drill fails on it |
| N2 | `stale` is set when a projection is written, not from its age. Old data shows without a warning during an outage | SEV-3 defect | Quotes are safe: they use fresh server reads and fail with `ORACLE_STALE` |
| N3 | Adapters report a missing position read as `"0"` | SEV-3 defect | The worker works around it. Adapter owner to fix |
| N4 | No command to move a stuck workflow, and `ACTION_REQUIRED` has no stuck limit so it never alerts | Gap | Engineers resolve by reviewed SQL |
| N5 | Plans carry no hash. Page 03 asks for one binding quote, network, versions, inputs and expiry | Gap | Plans are bound to quote id, adapter and registry version today (K17). For the security review |
| N6 | One worker only, with no lease. Contract logs read 20 events per tick | Gap | A busy contract can leave a gap that reconciliation reports but does not repair |
| N7 | Wallet balances have no endpoint | Gap | Portfolio shows protocol positions only |
| N8 | The session is kept in memory. A reload signs the user out | Gap | The pending step is remembered |
| N9 | Packages are not published to a registry | Gap | External partners cannot install them yet. K19 |
| N10 | No partner webhooks | Gap | No task in the plan builds them |
| N11 | Backups are manual, with no schedule and no point in time recovery | Gap | Hosting decision |
| N12 | Alert thresholds are code defaults | Gap | Per deployment settings need a hosting target |
| N13 | Branch protection and two person approval cannot be enforced on the current GitHub plan | Gap | Page 03 production gate |
| N14 | Automated browser tests run on Chromium only | Gap | M9 covers the rest by hand |
| N15 | Requote errors use different statuses: `QUOTE_EXPIRED` 409, `ORACLE_STALE` and `CAP_REACHED` 400 | SEV-3 defect | Clients branch on the class, which is the same |

## Notes for the go/no-go

- Nothing found puts funds at risk: every failure found fails closed.
- A closed pilot of the earn journey needs B1, B4 and B5 resolved at least, with borrow and swap left switched off (`ops:disable`) until B3 and B6 are.
- The BTC holder round trip (B2) is out of reach for this pilot.
- Manual checks M1 to M10 should be run and recorded before the decision.
- K40 recorded five fixture sandbox entry/exit sessions and partner-example certification; production and closed earn remain **no-go**. See [launch decision](launch-decision.md) and `pnpm gate:k40`.
