import type { QuotedPlan, StartedWorkflow } from "@stacks-capital/client";
import { useCapital, useMarketRisk, useWorkflow } from "@stacks-capital/react";
import { createStacksCapital, parsePlan, parseQuote, type PlanWire, type QuoteWire } from "@stacks-capital/sdk";
import type { WalletId } from "@stacks-capital/wallets";
import { useEffect, useMemo, useState } from "react";
import {
  askWallet,
  attemptTxid,
  type BorrowAction,
  canSign,
  clearPending,
  type ConnectedWallet,
  contractOf,
  explorerTxUrl,
  FailedDelayedStateView,
  findProvider,
  loadPending,
  messageFor,
  nextBorrowStep,
  oracleProvenance,
  Panel,
  panelState,
  projectBorrow,
  quoteSafety,
  QUOTE_ACTION,
  reviewQuote,
  ReviewStateView,
  savePending,
  stageFor,
  StaleDisputedStateView,
  StateNote,
  SubmittedStateView,
  toWalletRequest,
} from "@stacks-capital/ui";
import {
  type BorrowViewMode,
  calculateBorrowAccounting,
  calculateDebtAccounting,
  calculateEasyRisk,
  isActionSafeToProceed,
  quotedBorrowFee,
} from "./borrowState.ts";

const MARKET = "granite.sbtc.isolated";
const ACTIONS: { id: BorrowAction; label: string; description: string }[] = [
  { id: "collateral_add", label: "Add Collateral", description: "Deposit sBTC as borrowing collateral" },
  { id: "borrow", label: "Borrow USDCx", description: "Borrow liquid stablecoins against your sBTC" },
  { id: "repay", label: "Repay Debt", description: "Pay down outstanding USDCx liability" },
  { id: "collateral_remove", label: "Withdraw Collateral", description: "Reclaim unencumbered sBTC collateral" },
];

const bps = (value: bigint | string | undefined | null) => {
  if (value === undefined || value === null) return "unknown";
  const num = typeof value === "bigint" ? value : BigInt(value);
  const whole = num / 100n;
  const frac = num % 100n;
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}%`;
};

const idempotencyKey = () => `idem_${crypto.randomUUID()}`;
const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

function sdkValidation(plan: QuotedPlan["plan"], quote: QuotedPlan["quote"], sender: string) {
  const os = createStacksCapital({ network: plan.network });
  return os.validate(parsePlan(plan as PlanWire), parseQuote(quote as QuoteWire), { sender });
}

export function Borrow({
  wallet,
  signedIn,
  initialAction = "collateral_add",
}: {
  wallet: ConnectedWallet | null;
  signedIn: boolean;
  initialAction?: string;
}) {
  const { client } = useCapital();
  const risk = useMarketRisk(signedIn ? MARKET : null, { staleMs: 15_000 });

  const [mode, setMode] = useState<BorrowViewMode>("easy");
  const [action, setAction] = useState<BorrowAction>(
    (ACTIONS.find((a) => a.id === initialAction)?.id as BorrowAction) ?? "collateral_add",
  );
  const [amount, setAmount] = useState("");
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

  // Update action if prop changes
  useEffect(() => {
    if (initialAction && ACTIONS.some((a) => a.id === initialAction)) {
      setAction(initialAction as BorrowAction);
      setQuoted(null);
    }
  }, [initialAction]);

  // Clean pending workflow on completion
  useEffect(() => {
    if (scope !== null && (stage === "done" || stage === "recovery")) clearPending(storage(), scope);
    if (stage === "recovery" && started !== null) setStarted(null);
  }, [scope, stage, started]);

  // Refresh risk state whenever switching actions
  const handleSelectAction = (nextAction: BorrowAction) => {
    setAction(nextAction);
    setQuoted(null);
    setAmount("");
    setProblem(null);
    void risk.refresh();
  };

  if (!signedIn || wallet === null) {
    return (
      <Panel title="Borrow & Credit">
        <p className="muted">Connect a wallet and sign in to manage collateral and borrow against your Bitcoin.</p>
      </Panel>
    );
  }

  const riskData = risk.data?.data ?? null;
  const debtBefore = riskData?.position.debt ? BigInt(riskData.position.debt) : 0n;
  const collateralBefore = riskData?.position.collateral ? BigInt(riskData.position.collateral) : 0n;

  // Project position changes
  const projection =
    riskData === null ? null : projectBorrow(riskData, { action, amount, walletBalance: null }, new Date());

  const easyRisk = calculateEasyRisk(projection?.health ?? null, riskData);
  const safetyCheck = isActionSafeToProceed(projection, riskData);

  // Repay & Borrow explicit accounting. The fee comes from the quote, so it is unknown until one exists.
  const repayAccounting = calculateDebtAccounting(debtBefore, amount);
  const borrowAccounting = calculateBorrowAccounting(
    debtBefore,
    amount,
    quoted === null ? null : quotedBorrowFee(quoted.quote),
  );

  async function getQuote() {
    if (!safetyCheck.canProceed) return;
    setBusy(true);
    setProblem(null);
    try {
      await risk.refresh();
      const quote = await client.quote({
        marketId: MARKET,
        action: QUOTE_ACTION[action],
        amount,
        ...(wallet ? { owner: wallet.address } : {}),
      });
      setQuoted(quote.data);

      const safety = quoteSafety(quote.data.quote);
      if (safety.blockers.length > 0) throw new Error(safety.blockers.join(" "));
    } catch (error) {
      setProblem(messageFor(error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signAndSubmit() {
    if (quoted === null || wallet === null || scope === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const view = reviewQuote(quoted.quote, new Date());
      if (!canSign(view)) throw new Error(view.warnings.join(" ") || "This quote cannot be signed.");

      const start = await client.startWorkflow({
        quoteId: quoted.quote.id,
        idempotencyKey: idempotencyKey(),
      });
      setStarted(start.data);
      const step = nextBorrowStep(start.data.plan, []);
      if (step === undefined) throw new Error("The plan has no step to sign");

      savePending(storage(), scope, { workflowId: start.data.workflowId, stepId: step.id });

      const provider = findProvider(wallet.id as WalletId);
      if (provider === null) throw new Error(`${wallet.id} is no longer available`);

      const validation = sdkValidation(start.data.plan, quoted.quote, wallet.address);
      const answer = await askWallet(provider, wallet.id as WalletId, toWalletRequest(step, validation), validation);

      if (answer.kind === "rejected") {
        setProblem(answer.message);
        return;
      }

      await client.recordSignature(start.data.workflowId, {
        stepId: step.id,
        walletResult: answer.result,
      });
      await workflow.refresh();
      await risk.refresh();
    } catch (error) {
      setProblem(messageFor(error).message);
    } finally {
      setBusy(false);
    }
  }

  const view = quoted === null ? null : reviewQuote(quoted.quote, new Date());
  const riskState = panelState(risk, risk.data?.context);

  return (
    <>
      <StateNote state={riskState} onRetry={() => void risk.refresh()} />

      {/* Action Selector & Easy/Advanced Mode Switcher */}
      <Panel
        title="Borrow, Repay & Collateral Management"
        action={
          <div className="borrow-controls-header">
            <div className="button-group">
              <button type="button" className={mode === "easy" ? "button-active" : ""} onClick={() => setMode("easy")}>
                Easy View
              </button>
              <button
                type="button"
                className={mode === "advanced" ? "button-active" : ""}
                onClick={() => setMode("advanced")}
              >
                Advanced Telemetry
              </button>
            </div>
            <button type="button" onClick={() => void risk.refresh()}>
              Refresh Oracles
            </button>
          </div>
        }
      >
        {/* Navigation Tabs */}
        <nav className="borrow-action-nav" aria-label="Borrow Action Selector">
          {ACTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`borrow-nav-btn ${action === entry.id ? "borrow-nav-btn-active" : ""}`}
              onClick={() => handleSelectAction(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <p className="muted font-small">
          {ACTIONS.find((a) => a.id === action)?.description}. Every action refreshes live oracle prices and verifies
          protocol liquidation safety buffers.
        </p>

        {/* EASY MODE VIEW */}
        {mode === "easy" && (
          <div className="borrow-easy-panel">
            <div className="risk-gauge-card">
              <div className="risk-gauge-header">
                <span className="risk-gauge-title">Credit Health Status</span>
                <span className={`badge ${easyRisk.badgeVariant}`}>{easyRisk.levelLabel}</span>
              </div>

              <p className="risk-gauge-explanation">{easyRisk.explanation}</p>

              <div className="easy-metrics-grid">
                <div className="metric-box">
                  <span className="metric-box-label">Liquidation Price Drop Buffer</span>
                  <span className="metric-box-value">
                    {easyRisk.liquidationPriceDropPercent !== null
                      ? `${easyRisk.liquidationPriceDropPercent.toFixed(1)}%`
                      : "N/A"}
                  </span>
                  <span className="metric-box-subtext">Before collateral breaches threshold</span>
                </div>

                <div className="metric-box">
                  <span className="metric-box-label">Max Safe Borrowing Capacity</span>
                  <span className="metric-box-value">
                    {easyRisk.maxSafeBorrowUsd !== null
                      ? `$${Math.floor(easyRisk.maxSafeBorrowUsd).toLocaleString()} USD`
                      : "N/A"}
                  </span>
                  <span className="metric-box-subtext">Within protocol safety buffer</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ADVANCED MODE VIEW */}
        {mode === "advanced" && (
          <div className="borrow-advanced-panel">
            <div className="advanced-metrics-grid">
              <div className="advanced-metric-card">
                <span className="metric-box-label">Collateral Value</span>
                <span className="metric-box-value">
                  {projection?.health
                    ? `$${(Number(projection.health.collateralUsd) / 1e8).toLocaleString()} USD`
                    : "Unknown"}
                </span>
                <span className="metric-box-subtext">{(Number(collateralBefore) / 1e8).toFixed(4)} sBTC active</span>
              </div>

              <div className="advanced-metric-card">
                <span className="metric-box-label">Debt Liabilities</span>
                <span className="metric-box-value danger-text">
                  {projection?.health ? `$${(Number(projection.health.debtUsd) / 1e8).toLocaleString()} USD` : "$0.00"}
                </span>
                <span className="metric-box-subtext">
                  {(Number(debtBefore) / 1e6).toLocaleString()} USDCx outstanding
                </span>
              </div>

              <div className="advanced-metric-card">
                <span className="metric-box-label">Projected LTV</span>
                <span className="metric-box-value">{bps(projection?.health?.currentLtvBps)}</span>
                <span className="metric-box-subtext">
                  Borrow Limit: {bps(riskData?.params?.ltvBorrowBps)} | Liq: {bps(riskData?.params?.ltvLiqBps)}
                </span>
              </div>

              <div className="advanced-metric-card">
                <span className="metric-box-label">Safety Buffer</span>
                <span className="metric-box-value">{bps(riskData?.params?.bufferBps)}</span>
                <span className="metric-box-subtext">
                  Status: {projection?.health?.withinBuffer ? "Within Buffer" : "Buffer Breached"}
                </span>
              </div>
            </div>

            {/* Oracle Provenance Telemetry */}
            {riskData && (
              <div className="oracle-provenance-box">
                <strong>Oracle Price Telemetry & Quorum Verification</strong>
                <ul>
                  {oracleProvenance(riskData).map((line) => (
                    <li key={line} className="muted font-small">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ACTION FORM & EXPLICIT ACCOUNTING */}
        <div className="borrow-action-form">
          <label>
            <strong>Amount to {ACTIONS.find((a) => a.id === action)?.label} (in base units)</strong>
            <div className="input-with-action">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={
                  action === "collateral_add" || action === "collateral_remove"
                    ? "e.g. 100000000 (1.0 sBTC)"
                    : "e.g. 1000000000 (1,000 USDCx)"
                }
                inputMode="numeric"
              />
              {action === "repay" && debtBefore > 0n && (
                <button type="button" onClick={() => setAmount(debtBefore.toString())} className="button-sm">
                  Repay Full Debt
                </button>
              )}
            </div>
          </label>

          {/* Explicit Repayment Accounting */}
          {action === "repay" && debtBefore > 0n && (
            <div className="debt-accounting-grid">
              <div className="debt-card">
                <span className="debt-card-label">Current Outstanding Debt</span>
                <span className="debt-card-value">{(Number(debtBefore) / 1e6).toLocaleString()} USDCx</span>
              </div>
              <div className="debt-card">
                <span className="debt-card-label">Amount Repaid</span>
                <span className="debt-card-value success-text">
                  -{(Number(repayAccounting.amountRepaid) / 1e6).toLocaleString()} USDCx
                </span>
              </div>
              <div className="debt-card highlight">
                <span className="debt-card-label">Remaining Debt Liability</span>
                <span className="debt-card-value">
                  {(Number(repayAccounting.remainingDebt) / 1e6).toLocaleString()} USDCx
                </span>
                <span className="debt-card-subtext">
                  {repayAccounting.isFullRepay
                    ? "100% Full Repayment (Zero Debt)"
                    : `${repayAccounting.debtReductionPercent.toFixed(1)}% Debt Paid Off`}
                </span>
              </div>
            </div>
          )}

          {/* Explicit Borrow Accounting */}
          {action === "borrow" && amount.trim() !== "" && (
            <div className="debt-accounting-grid">
              <div className="debt-card">
                <span className="debt-card-label">Requested Borrow</span>
                <span className="debt-card-value">
                  {(Number(borrowAccounting.requestedBorrow) / 1e6).toLocaleString()} USDCx
                </span>
              </div>
              <div className="debt-card">
                <span className="debt-card-label">Protocol Fee</span>
                <span className="debt-card-value muted">
                  {borrowAccounting.quotedFee === null
                    ? "Not known until quoted"
                    : `${(Number(borrowAccounting.quotedFee) / 1e6).toLocaleString()} USDCx`}
                </span>
              </div>
              <div className="debt-card">
                <span className="debt-card-label">Net USDCx Received</span>
                <span className="debt-card-value success-text">
                  {borrowAccounting.netReceived === null
                    ? "Not known until quoted"
                    : `${(Number(borrowAccounting.netReceived) / 1e6).toLocaleString()} USDCx`}
                </span>
              </div>
              <div className="debt-card highlight">
                <span className="debt-card-label">New Total Debt Liability</span>
                <span className="debt-card-value danger-text">
                  {(Number(borrowAccounting.newTotalDebt) / 1e6).toLocaleString()} USDCx
                </span>
              </div>
            </div>
          )}

          {/* Safety Blockers & Notes */}
          {(projection?.blockers ?? []).map((blocker) => (
            <p key={blocker} className="error" role="alert">
              <strong>Action Blocked:</strong> {blocker}
            </p>
          ))}
          {(projection?.notes ?? []).map((note) => (
            <p key={note} className="warn">
              {note}
            </p>
          ))}

          <button type="button" disabled={busy || !safetyCheck.canProceed} onClick={() => void getQuote()}>
            {busy ? "Fetching Quote…" : `Get ${ACTIONS.find((a) => a.id === action)?.label} Quote`}
          </button>
        </div>

        {/* QUOTE REVIEW & WORKFLOW EXECUTION */}
        {view !== null && quoted !== null && (
          <div className="quote">
            <p className={view.expired ? "error" : "muted"}>
              {view.expired
                ? "This quote has expired. Refresh before continuing."
                : `Valid for ${view.expiresInSeconds}s.`}
            </p>

            {view.expired ? (
              <StaleDisputedStateView
                state={{
                  kind: "stale_disputed",
                  ageDescription: "past its expiry window",
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
            {view.warnings.length > 0 && <p className="warn">{view.warnings.join(" ")}</p>}
            <p className="muted font-small">{quoted.plan.reviewSummary}</p>
          </div>
        )}
      </Panel>

      {/* CONFIRMING / RECOVERY / DONE STAGES */}
      {stage === "confirming" && (
        <Panel
          title="Confirming Transaction"
          action={
            <button type="button" onClick={() => void workflow.refresh()}>
              Refresh
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
      )}

      {stage === "recovery" && (
        <Panel title="Action Investigation Required">
          <FailedDelayedStateView
            state={{
              kind: "failed_delayed",
              cause:
                "The wallet did not return a transaction id or the transaction failed to confirm. To prevent duplicate fund movement, automatic write retries are disabled.",
              fundsLocation:
                txid === null
                  ? `Broadcast status is unknown. Workflow ${workflowId} in state ${workflowState}.`
                  : `Transaction broadcast as ${txid}. Workflow ${workflowId} in state ${workflowState}.`,
              recovery: [
                {
                  type: "resume",
                  label: "Continue",
                  action: () => {
                    setQuoted(null);
                    setStarted(null);
                    setAmount("");
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
      )}

      {stage === "done" && (
        <Panel title="Action Completed">
          <p>The {ACTIONS.find((a) => a.id === action)?.label} was successfully executed and confirmed.</p>
          <button
            type="button"
            onClick={() => {
              setQuoted(null);
              setStarted(null);
              setAmount("");
              void risk.refresh();
            }}
          >
            Start Another Action
          </button>
        </Panel>
      )}

      {problem !== null && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}
