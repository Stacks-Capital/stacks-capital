import type { EarnOption, QuotedPlan, StartedWorkflow } from "@stacks-capital/client";
import { useCapital, useEarnOptions, useWorkflow } from "@stacks-capital/react";
import { createStacksCapital, parsePlan, parseQuote, type PlanWire, type QuoteWire } from "@stacks-capital/sdk";
import { useEffect, useMemo, useState } from "react";
import type { WalletId } from "@stacks-capital/wallets";
import {
  addRates,
  askWallet,
  attemptTxid,
  canSign,
  clearPending,
  compareEarn,
  contractOf,
  type ConnectedWallet,
  EmptyStateView,
  explorerTxUrl,
  FailedDelayedStateView,
  findProvider,
  formatRate,
  loadPending,
  messageFor,
  Panel,
  panelState,
  type Rate,
  ResponsiveTable,
  reviewQuote,
  ReviewStateView,
  savePending,
  simulateEarn,
  type SimulationHorizon,
  StaleDisputedStateView,
  stageFor,
  StateNote,
  SubmittedStateView,
  toWalletRequest,
} from "@stacks-capital/ui";

const idempotencyKey = () => `idem_${crypto.randomUUID()}`;
const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const rateOf = (value: string | null, scale: number | null): Rate | null =>
  value === null || scale === null ? null : { value, scale };

function sdkValidation(plan: QuotedPlan["plan"], quote: QuotedPlan["quote"], sender: string) {
  const os = createStacksCapital({ network: plan.network });
  return os.validate(parsePlan(plan as PlanWire), parseQuote(quote as QuoteWire), { sender });
}

export type EarnActionType = "supply" | "withdraw_supply";

export function Earn({
  wallet,
  signedIn,
  initialMarketId = null,
  initialAction = "supply",
}: {
  wallet: ConnectedWallet | null;
  signedIn: boolean;
  initialMarketId?: string | null;
  initialAction?: string;
}) {
  const { client } = useCapital();
  const earnOptions = useEarnOptions();

  // Screen modes & controls
  const [viewMode, setViewMode] = useState<"marketplace" | "simulator">("marketplace");
  const [assetFilter, setAssetFilter] = useState<string>("all");
  const [actionType, setActionType] = useState<EarnActionType>(
    initialAction === "withdraw" ? "withdraw_supply" : "supply",
  );
  const [marketId, setMarketId] = useState<string | null>(initialMarketId);
  const [amount, setAmount] = useState("");

  // Strategy Simulation State
  const [simulationPrincipal, setSimulationPrincipal] = useState("1.0");
  const [simulationHorizon, setSimulationHorizon] = useState<SimulationHorizon>(365);
  const [simulatedMarketId, setSimulatedMarketId] = useState<string | null>(null);

  // Quote & Workflow execution
  const [quoted, setQuoted] = useState<QuotedPlan | null>(null);
  const [started, setStarted] = useState<StartedWorkflow | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const network = wallet?.network ?? null;
  const address = wallet?.address ?? null;
  const scope = useMemo(() => (network === null || address === null ? null : { network, address }), [network, address]);
  const pending = useMemo(() => (scope === null ? null : loadPending(storage(), scope)), [scope]);
  const workflowId = started?.workflowId ?? pending?.workflowId ?? null;
  const workflow = useWorkflow(workflowId, { staleMs: 5_000 });
  const stage = stageFor(workflow.data?.data.state ?? (started === null ? null : started.state));
  const workflowState = workflow.data?.data.state ?? started?.state ?? "unknown";
  const txid = attemptTxid(workflow.data?.data.attempts ?? []);

  // Update selection if passed via initialMarketId prop
  useEffect(() => {
    if (initialMarketId) {
      setMarketId(initialMarketId);
      setSimulatedMarketId(initialMarketId);
    }
  }, [initialMarketId]);

  // A finished flow is not pending any more, so a reload starts fresh.
  useEffect(() => {
    if (scope !== null && (stage === "done" || stage === "recovery")) clearPending(storage(), scope);
    if (stage === "recovery" && started !== null) setStarted(null);
  }, [scope, stage, started]);

  const allOptions = earnOptions.data?.data.items ?? [];
  const comparison = useMemo(() => compareEarn(allOptions, new Date()), [allOptions]);

  // Set default simulated market if none selected
  useEffect(() => {
    if (!simulatedMarketId && allOptions.length > 0) {
      const firstActive = allOptions.find((o) => o.supply.state === "enabled") ?? allOptions[0];
      if (firstActive) setSimulatedMarketId(firstActive.marketId);
    }
    if (!marketId && allOptions.length > 0) {
      const firstActive = allOptions.find((o) => o.supply.state === "enabled") ?? allOptions[0];
      if (firstActive) setMarketId(firstActive.marketId);
    }
  }, [allOptions, simulatedMarketId, marketId]);

  const selectedOption: EarnOption | undefined = allOptions.find((o) => o.marketId === marketId);
  const selectedSimOption: EarnOption | undefined = allOptions.find((o) => o.marketId === simulatedMarketId);

  // Simulation calculation
  const simulationResult = useMemo(() => {
    if (!selectedSimOption) return null;
    const base = rateOf(selectedSimOption.baseRate, selectedSimOption.baseRateScale);
    const inc = rateOf(selectedSimOption.incentiveRate, selectedSimOption.incentiveRateScale);
    return simulateEarn({
      principal: simulationPrincipal,
      baseRate: base,
      incentiveRate: inc,
      horizonDays: simulationHorizon,
      marketId: selectedSimOption.marketId,
      assetId: selectedSimOption.suppliedAssetId ?? "sBTC",
      isStale: selectedSimOption.stale,
      confidence: selectedSimOption.evidence?.confidence,
      disagreement: selectedSimOption.evidence?.disagreement,
    });
  }, [selectedSimOption, simulationPrincipal, simulationHorizon]);

  async function getQuote() {
    if (marketId === null || wallet === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await client.quote({
        marketId,
        action: actionType,
        amount,
        owner: wallet.address,
      });
      setQuoted(result.data);
    } catch (error) {
      setProblem(messageFor(error).message);
    } finally {
      setBusy(false);
    }
  }

  // Asks the wallet for one step. A rejection leaves the workflow waiting, so the user can simply try again.
  async function requestSignature(start: StartedWorkflow, quote: QuotedPlan["quote"]) {
    if (wallet === null) return;
    const step = start.plan.steps[0];
    if (step === undefined) throw new Error("The plan has no step to sign");
    const provider = findProvider(wallet.id as WalletId);
    if (provider === null) throw new Error(`${wallet.id} is not available any more`);

    const validation = sdkValidation(start.plan, quote, wallet.address);
    const answer = await askWallet(provider, wallet.id as WalletId, toWalletRequest(step, validation), validation);
    if (answer.kind === "rejected") {
      setProblem(answer.message);
      return;
    }
    await client.recordSignature(start.workflowId, { stepId: step.id, walletResult: answer.result });
    await workflow.refresh();
  }

  async function signAndSubmit() {
    if (quoted === null || wallet === null || scope === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const start = await client.startWorkflow({
        quoteId: quoted.quote.id,
        idempotencyKey: idempotencyKey(),
      });
      setStarted(start.data);
      const step = start.data.plan.steps[0];
      if (step === undefined) throw new Error("The plan has no step to sign");
      savePending(storage(), scope, { workflowId: start.data.workflowId, stepId: step.id });
      await requestSignature(start.data, quoted.quote);
    } catch (error) {
      setProblem(messageFor(error).message);
    } finally {
      setBusy(false);
    }
  }

  async function askAgain() {
    if (started === null || quoted === null) return;
    setBusy(true);
    setProblem(null);
    try {
      await requestSignature(started, quoted.quote);
    } catch (error) {
      setProblem(messageFor(error).message);
    } finally {
      setBusy(false);
    }
  }

  if (wallet === null || !signedIn) {
    return (
      <Panel title="Earn Marketplace & Yield Strategies">
        <EmptyStateView
          state={{
            kind: "empty",
            instruction: "Connect a wallet and sign in to compare earn vaults and simulate strategy yields.",
          }}
        />
      </Panel>
    );
  }

  const view = quoted === null ? null : reviewQuote(quoted.quote, new Date());
  const optionsState = panelState(earnOptions, earnOptions.data?.context);

  // Filter groups by asset if selected
  const visibleGroups = comparison.groups.filter((group) => {
    if (assetFilter === "all") return true;
    return (group.suppliedAssetId ?? "").toLowerCase() === assetFilter.toLowerCase();
  });

  return (
    <>
      <StateNote state={optionsState} onRetry={() => void earnOptions.refresh()} />

      {/* Sub-Navigation: Marketplace vs Simulator */}
      <nav className="earn-subnav" aria-label="Earn Sub-navigation">
        <button
          type="button"
          className={`subnav-btn ${viewMode === "marketplace" ? "subnav-btn-active" : ""}`}
          onClick={() => setViewMode("marketplace")}
        >
          Earn Marketplace & Comparison
        </button>
        <button
          type="button"
          className={`subnav-btn ${viewMode === "simulator" ? "subnav-btn-active" : ""}`}
          onClick={() => setViewMode("simulator")}
        >
          Strategy Yield Simulator
        </button>
      </nav>

      {/* VIEW 1: EVIDENCE-GATED MARKETPLACE */}
      {viewMode === "marketplace" && (
        <Panel
          title="Where to Earn: Evidence-Gated Vaults"
          action={
            <button type="button" onClick={() => void earnOptions.refresh()}>
              Refresh Rates
            </button>
          }
        >
          <p className="muted">{comparison.note}</p>

          {/* Asset Filtering */}
          <div className="earn-filter-bar">
            <span>Filter by Supplied Asset:</span>
            <div className="button-group">
              {["all", "sBTC", "STX", "USDA", "USDCx"].map((asset) => (
                <button
                  key={asset}
                  type="button"
                  className={assetFilter === asset ? "button-active" : ""}
                  onClick={() => setAssetFilter(asset)}
                >
                  {asset.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {visibleGroups.length === 0 ? (
            <p className="muted">No opportunities found for the selected asset filter.</p>
          ) : (
            visibleGroups.map((group) => (
              <section key={group.suppliedAssetId ?? "unknown"} className="earn-group-section">
                <h3>Supplying {group.suppliedAssetId ?? "Unspecified Asset"}</h3>
                <ResponsiveTable
                  rows={group.rows}
                  rowKey={(row) => row.option.marketId}
                  rowSelected={(row) => marketId === row.option.marketId}
                  columns={[
                    {
                      header: "Rank",
                      cell: (row) =>
                        row.rank !== null ? (
                          <span className="badge badge-success">#{row.rank}</span>
                        ) : (
                          <span className="badge badge-neutral">Unranked</span>
                        ),
                    },
                    {
                      header: "Market & Protocol",
                      cell: (row) => (
                        <div>
                          <strong>{row.option.marketId}</strong>
                          <div className="muted font-small">{row.option.protocol}</div>
                        </div>
                      ),
                    },
                    {
                      header: "Base APY",
                      cell: (row) => formatRate(rateOf(row.option.baseRate, row.option.baseRateScale)),
                    },
                    {
                      header: "Incentive APY",
                      cell: (row) => formatRate(rateOf(row.option.incentiveRate, row.option.incentiveRateScale)),
                    },
                    {
                      header: "Combined APY",
                      cell: (row) => <strong>{formatRate(row.effectiveRate)}</strong>,
                    },
                    {
                      header: "Liquidity / Capacity",
                      cell: (row) => (
                        <div>
                          <div>{row.option.availableLiquidity ?? "unknown"}</div>
                          {row.option.capacity && <div className="muted font-small">Cap: {row.option.capacity}</div>}
                        </div>
                      ),
                    },
                    {
                      header: "Withdrawal",
                      cell: (row) => (
                        <span
                          className={`badge ${
                            row.option.withdrawal?.state === "enabled" ? "badge-success" : "badge-warning"
                          }`}
                        >
                          {row.option.withdrawal === null ? "None listed" : row.option.withdrawal.state}
                        </span>
                      ),
                    },
                    {
                      header: "Evidence",
                      cell: (row) => (
                        <div>
                          <span
                            className={`badge ${
                              row.option.stale
                                ? "badge-danger"
                                : row.option.evidence?.confidence === "high"
                                  ? "badge-success"
                                  : "badge-neutral"
                            }`}
                          >
                            {row.option.stale
                              ? "Stale"
                              : row.option.evidence?.confidence === "high"
                                ? "Verified Onchain"
                                : row.option.evidence?.confidence === "low"
                                  ? "Low Confidence"
                                  : "Active Read"}
                          </span>
                          {row.option.evidence?.disagreement === "mismatch" && (
                            <div className="danger-text font-small">Mismatch Alert</div>
                          )}
                        </div>
                      ),
                    },
                    {
                      header: "Action",
                      cell: (row) => (
                        <div className="button-group">
                          <button
                            type="button"
                            disabled={row.option.supply.state !== "enabled"}
                            onClick={() => {
                              setMarketId(row.option.marketId);
                              setActionType("supply");
                            }}
                          >
                            Supply
                          </button>
                          {row.option.withdrawal && (
                            <button
                              type="button"
                              disabled={row.option.withdrawal.state !== "enabled"}
                              onClick={() => {
                                setMarketId(row.option.marketId);
                                setActionType("withdraw_supply");
                              }}
                            >
                              Withdraw
                            </button>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />

                {/* Exclusions and unranked disclosures */}
                {group.rows
                  .filter((row) => row.notes.length > 0)
                  .map((row) => (
                    <p key={row.option.marketId} className="muted font-small">
                      <strong>{row.option.marketId} notes:</strong> {row.notes.join("; ")}
                    </p>
                  ))}
              </section>
            ))
          )}
        </Panel>
      )}

      {/* VIEW 2: INTERACTIVE STRATEGY SIMULATOR */}
      {viewMode === "simulator" && (
        <Panel title="Yield Strategy Simulation & Modeling">
          <p className="muted">
            Model prospective returns over varied time horizons using verified onchain rate telemetry. All projections
            use exact disclosed inputs without opaque compounding assumptions.
          </p>

          <div className="simulation-inputs-grid">
            <label>
              <strong>Target Strategy / Vault</strong>
              <select value={simulatedMarketId ?? ""} onChange={(e) => setSimulatedMarketId(e.target.value)}>
                {allOptions.map((opt) => (
                  <option key={opt.marketId} value={opt.marketId}>
                    {opt.marketId} ({opt.suppliedAssetId ?? "sBTC"})
                  </option>
                ))}
              </select>
            </label>

            <label>
              <strong>Deposit Principal</strong>
              <input
                type="text"
                value={simulationPrincipal}
                onChange={(e) => setSimulationPrincipal(e.target.value)}
                placeholder="e.g. 1.50"
              />
            </label>

            <label>
              <strong>Time Horizon</strong>
              <select
                value={simulationHorizon}
                onChange={(e) => setSimulationHorizon(Number(e.target.value) as SimulationHorizon)}
              >
                <option value={30}>30 Days (Short-term)</option>
                <option value={90}>90 Days (Quarterly)</option>
                <option value={180}>180 Days (Semi-annual)</option>
                <option value={365}>365 Days (1 Full Year)</option>
              </select>
            </label>
          </div>

          {/* Simulation Output Cards */}
          {simulationResult && (
            <div className="simulation-results-container">
              <div className="simulation-cards-grid">
                <div className="simulation-card">
                  <span className="simulation-card-label">Principal Amount</span>
                  <span className="simulation-card-value">
                    {simulationResult.principalAmount.toLocaleString()} {selectedSimOption?.suppliedAssetId ?? "sBTC"}
                  </span>
                  <span className="simulation-card-subtext">Initial capital commitment</span>
                </div>

                <div className="simulation-card">
                  <span className="simulation-card-label">Base Yield Gain</span>
                  <span className="simulation-card-value success-text">
                    +{simulationResult.baseYieldAmount.toFixed(6)} {selectedSimOption?.suppliedAssetId ?? "sBTC"}
                  </span>
                  <span className="simulation-card-subtext">
                    At {simulationResult.baseApyPercent.toFixed(2)}% Base APY
                  </span>
                </div>

                <div className="simulation-card">
                  <span className="simulation-card-label">Incentive Yield Gain</span>
                  <span className="simulation-card-value">
                    +{simulationResult.incentiveYieldAmount.toFixed(6)} {selectedSimOption?.suppliedAssetId ?? "sBTC"}
                  </span>
                  <span className="simulation-card-subtext">
                    At {simulationResult.incentiveApyPercent.toFixed(2)}% Incentive APY
                  </span>
                </div>

                <div className="simulation-card highlight">
                  <span className="simulation-card-label">Projected Ending Balance</span>
                  <span className="simulation-card-value">
                    {simulationResult.projectedEndingBalance.toFixed(6)} {selectedSimOption?.suppliedAssetId ?? "sBTC"}
                  </span>
                  <span className="simulation-card-subtext">
                    +{simulationResult.totalYieldAmount.toFixed(6)} total (
                    {simulationResult.effectiveApyPercent.toFixed(2)}% net APY)
                  </span>
                </div>
              </div>

              {/* Status & Disclosures */}
              <div className="simulation-disclosures-box">
                <div className="simulation-status-bar">
                  <span className={`badge ${simulationResult.isReliable ? "badge-success" : "badge-warning"}`}>
                    {simulationResult.isReliable ? "Verified Rate Model" : "Caution: Unverified / Stale Model"}
                  </span>
                </div>

                {simulationResult.warnings.map((warn) => (
                  <p key={warn} className="warn font-small">
                    <strong>Notice:</strong> {warn}
                  </p>
                ))}

                <ul className="muted font-small">
                  {simulationResult.disclosures.map((disc) => (
                    <li key={disc}>{disc}</li>
                  ))}
                </ul>

                {/* Pre-fill Action */}
                <div className="simulation-action-bar">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedSimOption) {
                        setMarketId(selectedSimOption.marketId);
                        setAmount(simulationPrincipal);
                        setActionType("supply");
                        setViewMode("marketplace");
                      }
                    }}
                  >
                    Supply Into This Strategy
                  </button>
                </div>
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* DUAL SUPPLY & WITHDRAWAL EXECUTION PANEL */}
      {pending !== null && started === null ? (
        <Panel title="Unfinished step">
          <p>
            A step from earlier is still open: <strong>{pending.workflowId}</strong>. It is shown below as it stands
            now.
          </p>
        </Panel>
      ) : null}

      {stage === "review" ? (
        <Panel title={`Execute Vault Action: ${actionType === "supply" ? "Supply" : "Withdrawal"}`}>
          <div className="earn-action-toggle">
            <button
              type="button"
              className={actionType === "supply" ? "button-active" : ""}
              onClick={() => {
                setActionType("supply");
                setQuoted(null);
              }}
            >
              Supply (Deposit)
            </button>
            <button
              type="button"
              className={actionType === "withdraw_supply" ? "button-active" : ""}
              onClick={() => {
                setActionType("withdraw_supply");
                setQuoted(null);
              }}
            >
              Withdraw from Vault
            </button>
          </div>

          <p className="muted">
            {actionType === "supply"
              ? "Supplying capital earns protocol yield and issues cryptographic receipt claims."
              : "Withdrawing burns vault receipt claims and returns underlying assets to your address."}
          </p>

          <div className="earn-form-grid">
            <label>
              <strong>Selected Market</strong>
              <select value={marketId ?? ""} onChange={(e) => setMarketId(e.target.value)}>
                {allOptions.map((opt) => (
                  <option key={opt.marketId} value={opt.marketId}>
                    {opt.marketId} ({opt.suppliedAssetId ?? "sBTC"})
                  </option>
                ))}
              </select>
            </label>

            <label>
              <strong>Amount in base units</strong>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="e.g. 100000000"
                inputMode="numeric"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={busy || marketId === null || amount.trim() === ""}
            onClick={() => void getQuote()}
          >
            {busy ? "Fetching Quote…" : `Get ${actionType === "supply" ? "Supply" : "Withdrawal"} Quote`}
          </button>

          {view === null || quoted === null ? null : (
            <div className="quote">
              <p className={view.expired ? "error" : "muted"}>
                {view.expired ? "This quote has expired. Ask for a new one." : `Valid for ${view.expiresInSeconds}s.`}
              </p>

              {view.expired ? (
                <StaleDisputedStateView
                  state={{
                    kind: "stale_disputed",
                    ageDescription: "past its expiry",
                    sources: quoted.quote.snapshots.length > 0 ? quoted.quote.snapshots : [quoted.quote.marketId],
                    onRequote: () => void getQuote(),
                  }}
                />
              ) : (
                <ReviewStateView
                  state={{
                    kind: "review",
                    giveAmount: view.input,
                    receiveAmount: view.expected,
                    fees: view.fees,
                    ...(view.minimumOutput === null ? {} : { minimumOutput: view.minimumOutput }),
                    protocol: quoted.quote.marketId,
                    contract: contractOf(quoted.plan.steps),
                    planValidated: canSign(view) && !busy,
                    ...(canSign(view)
                      ? {}
                      : { validationError: view.warnings.join(" ") || "This quote cannot be signed." }),
                    onConfirm: () => void signAndSubmit(),
                  }}
                />
              )}
              {view.warnings.length > 0 ? <p className="warn">{view.warnings.join(" ")}</p> : null}
              <p className="muted">{quoted.plan.reviewSummary}</p>
            </div>
          )}
        </Panel>
      ) : null}

      {stage === "signing" ? (
        <Panel title="Waiting for your wallet">
          <p>Approve the transaction in {wallet.id}. Nothing moves until you do.</p>
          {started === null ? null : (
            <button type="button" disabled={busy} onClick={() => void askAgain()}>
              Ask the wallet again
            </button>
          )}
        </Panel>
      ) : null}

      {stage === "confirming" ? (
        <Panel
          title="Confirming"
          action={
            <button type="button" onClick={() => void workflow.refresh()}>
              Check Status
            </button>
          }
        >
          {txid === null ? (
            <p>
              Submitted. State: <strong>{workflowState}</strong>. Next:{" "}
              {workflow.data?.data.nextAction ?? started?.nextAction}
            </p>
          ) : (
            <SubmittedStateView
              state={{
                kind: "submitted",
                txId: txid,
                explorerUrl: explorerTxUrl(txid, wallet.network),
                workflowState,
                nextAction: workflow.data?.data.nextAction ?? started?.nextAction ?? "Wait for confirmation.",
              }}
            />
          )}
        </Panel>
      ) : null}

      {stage === "recovery" ? (
        <Panel title="Needs a look">
          <FailedDelayedStateView
            state={{
              kind: "failed_delayed",
              cause:
                "The wallet did not return a transaction id, or the workflow needs attention. Nothing is retried automatically, because that could move your money twice.",
              fundsLocation:
                txid === null
                  ? `Whether anything was broadcast is unknown, so this workflow is being investigated rather than sent again. State ${workflowState}, workflow ${workflowId}.`
                  : `A transaction was broadcast as ${txid}. State ${workflowState}, workflow ${workflowId}.`,
              recovery: [
                {
                  type: "resume",
                  label: "Continue",
                  action: () => {
                    setQuoted(null);
                    setStarted(null);
                  },
                },
                {
                  type: "support",
                  label: "Copy workflow id",
                  action: () => void navigator.clipboard?.writeText(workflowId ?? ""),
                },
              ],
            }}
          />
        </Panel>
      ) : null}

      {stage === "done" ? (
        <Panel title="Done">
          <p>
            The {actionType === "supply" ? "supply" : "withdrawal"} completed successfully. Workflow {workflowId}.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuoted(null);
              setStarted(null);
              setAmount("");
            }}
          >
            Start Another Transaction
          </button>
        </Panel>
      ) : null}

      {problem === null ? null : (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}
