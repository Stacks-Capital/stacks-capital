import type React from "react";
import { useState } from "react";
import type {
  CanonicalState,
  EmptyState,
  FailedDelayedState,
  LoadingState,
  PartialState,
  ReviewState,
  StaleDisputedState,
  SubmittedState,
  UnsupportedState,
} from "./state.ts";

/** Every amount carries its unit. Amounts that were formatted with one already are left alone. */
function withUnit(amount: string, asset: string | undefined): string {
  return asset === undefined || asset === "" ? amount : `${amount} ${asset}`;
}

export function LoadingStateView({ state }: { state: LoadingState }) {
  return (
    <section className="state-card state-loading" role="status" aria-busy="true" aria-live="polite">
      <div className="state-header">
        <span className="state-spinner" aria-hidden="true" />
        <p className="state-title">Loading {state.what}…</p>
      </div>
      {state.priorVerified ? (
        <p className="state-prior-data">
          Prior verified data ({state.priorVerified.description}) as of{" "}
          <time dateTime={state.priorVerified.timestamp}>{state.priorVerified.timestamp}</time>.
        </p>
      ) : null}
      <div className="state-actions">
        {state.canCancel && state.onCancel ? (
          <button type="button" className="btn-secondary" onClick={state.onCancel}>
            Cancel
          </button>
        ) : null}
        {state.canRetry && state.onRetry ? (
          <button type="button" className="btn-secondary" onClick={state.onRetry}>
            Retry read
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function EmptyStateView({ state }: { state: EmptyState }) {
  const [address, setAddress] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (address.trim() && state.onAddressSubmit) {
      state.onAddressSubmit(address.trim());
    }
  };

  return (
    <section className="state-card state-empty" aria-label="Empty state">
      <div className="state-center-box">
        <p className="state-instruction">{state.instruction}</p>
        {state.allowAddressInput && state.onAddressSubmit ? (
          <form className="state-input-form" onSubmit={handleSubmit}>
            <label htmlFor="empty-state-address" className="sr-only">
              Stacks or Bitcoin address
            </label>
            <input
              id="empty-state-address"
              type="text"
              className="state-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Enter SP... or bc1... address"
            />
            <button type="submit" className="btn-primary">
              View address
            </button>
          </form>
        ) : null}
        <div className="state-actions">
          {state.onConnectWallet ? (
            <button type="button" className="btn-primary" onClick={state.onConnectWallet}>
              Connect wallet
            </button>
          ) : null}
          {state.nextAction ? (
            <button type="button" className="btn-secondary" onClick={state.nextAction.onClick}>
              {state.nextAction.label}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function PartialStateView({ state }: { state: PartialState }) {
  return (
    <section className="state-card state-partial" aria-label="Partial data state">
      <header className="state-header">
        <span className="badge badge-warning">Partial data</span>
        <p className="state-subtotal">
          Verified subtotal: <strong>{withUnit(state.verifiedSubtotal, state.assetUnit)}</strong>
        </p>
      </header>
      <p className="state-note">
        {state.notice ?? "Unrelated verified reads remain available. Unsafe write actions fail closed."}
      </p>
      <div className="state-excluded-section">
        <h4 className="state-subheading">Excluded positions ({state.excludedPositions.length})</h4>
        <ul className="state-excluded-list">
          {state.excludedPositions.map((item) => (
            <li key={item.name} className="state-excluded-item">
              <span className="item-name">{item.name}</span>
              <span className="item-reason muted">{item.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function UnsupportedStateView({ state }: { state: UnsupportedState }) {
  return (
    <section className="state-card state-unsupported" role="status" aria-label="Unsupported capability">
      <div className="state-badge-row">
        <span className="badge badge-neutral">Unsupported capability</span>
      </div>
      <h3 className="state-title">{state.assetOrProtocol}</h3>
      <p className="state-reason">{state.reason}</p>
      <p className="state-fail-closed muted">
        No mock or estimated figures are shown. Executable controls remain disabled.
      </p>
    </section>
  );
}

export function StaleDisputedStateView({ state }: { state: StaleDisputedState }) {
  return (
    <section className="state-card state-stale" role="alert" aria-live="polite">
      <div className="state-badge-row">
        <span className="badge badge-danger">{state.disagreement ? "Disputed evidence" : "Stale evidence"}</span>
      </div>
      <p className="state-age">
        Data age: <strong>{state.ageDescription}</strong>
      </p>
      <p className="state-sources">Sources: {state.sources.join(", ")}</p>
      {state.disagreement ? (
        <p className="state-disagreement">
          <strong>Disagreement:</strong> {state.disagreement}
        </p>
      ) : null}
      <p className="state-refresh-req muted">
        Quotes or rankings cannot be produced from this data. Please refresh or request a new quote.
      </p>
      <div className="state-actions">
        {state.onRefresh ? (
          <button type="button" className="btn-secondary" onClick={state.onRefresh}>
            Refresh sources
          </button>
        ) : null}
        {state.onRequote ? (
          <button type="button" className="btn-primary" onClick={state.onRequote}>
            Requote
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function ReviewStateView({ state }: { state: ReviewState }) {
  return (
    <section className="state-card state-review" aria-label="Transaction review">
      <h3 className="state-title">Review before signing</h3>
      <dl className="state-review-grid">
        <dt>You send</dt>
        <dd>
          <strong>{withUnit(state.giveAmount, state.giveAsset)}</strong>
        </dd>
        <dt>You receive (expected)</dt>
        <dd>
          <strong>{withUnit(state.receiveAmount, state.receiveAsset)}</strong>
        </dd>
        {state.minimumOutput ? (
          <>
            <dt>Minimum output</dt>
            <dd>{withUnit(state.minimumOutput, state.receiveAsset)}</dd>
          </>
        ) : null}
        {state.debtChange ? (
          <>
            <dt>Debt change</dt>
            <dd>{state.debtChange}</dd>
          </>
        ) : null}
        {state.healthFactor ? (
          <>
            <dt>Health factor</dt>
            <dd>
              <span>{state.healthFactor}</span>
            </dd>
          </>
        ) : null}
        <dt>Protocol</dt>
        <dd>{state.protocol}</dd>
        <dt>Contract</dt>
        <dd className="monospace">{state.contract}</dd>
      </dl>

      {state.fees.length > 0 ? (
        <div className="state-fees-section">
          <h4 className="state-subheading">Fees</h4>
          <ul className="state-fees-list">
            {state.fees.map((f) => (
              <li key={f.kind}>
                <span className="fee-kind">{f.kind}:</span>{" "}
                <span className="fee-amount">{withUnit(f.amount, f.asset)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!state.planValidated ? (
        <div className="state-validation-block" role="alert">
          <p className="state-val-error">
            {state.validationError ?? "Plan validation failed on server. Wallet signature cannot be requested."}
          </p>
        </div>
      ) : null}

      <div className="state-actions">
        <button type="button" className="btn-primary" disabled={!state.planValidated} onClick={state.onConfirm}>
          {state.planValidated ? (state.confirmLabel ?? "Sign in your wallet") : "Validation required"}
        </button>
      </div>
    </section>
  );
}

export function SubmittedStateView({ state }: { state: SubmittedState }) {
  return (
    <section className="state-card state-submitted" aria-label="Transaction submitted">
      <div className="state-badge-row">
        <span className="badge badge-status">{state.workflowState ?? "SUBMITTED"}</span>
      </div>
      <h3 className="state-title">Transaction submitted to network</h3>
      <p className="state-txid">
        Transaction ID:{" "}
        <a href={state.explorerUrl} target="_blank" rel="noopener noreferrer" className="monospace tx-link">
          {state.txId}
        </a>
      </p>
      <div className="state-reconciliation-box">
        <p className="state-recon-diff">
          <strong>Confirmed vs Reconciled:</strong>{" "}
          {state.differenceNote ??
            "Confirmed means the transaction is included in a Stacks block. Reconciled means our ingestion worker has independently verified event receipts and state updates against Hiro indexer proof."}
        </p>
      </div>
      {state.estimatedWait ? (
        <p className="state-timing">
          <strong>Typical time:</strong> {state.estimatedWait}
          {state.timingNote ? <span className="state-timing-note">{state.timingNote}</span> : null}
        </p>
      ) : null}
      {state.nextAction ? (
        <p className="state-next-action">
          <strong>Next step:</strong> {state.nextAction}
        </p>
      ) : null}
      <p className="state-no-auto-retry muted">
        Never auto-retry an uncertain write. If the broadcast is delayed, check the explorer link.
      </p>
    </section>
  );
}

export function FailedDelayedStateView({ state }: { state: FailedDelayedState }) {
  return (
    <section className="state-card state-failed-delayed" role="alert" aria-live="assertive">
      <div className="state-badge-row">
        <span className="badge badge-danger">Action failed or delayed</span>
      </div>
      <h3 className="state-title">Transaction attention required</h3>
      <p className="state-cause">
        <strong>Cause:</strong> {state.cause}
      </p>
      <div className="state-funds-location">
        <p>
          <strong>Where your funds are:</strong> {state.fundsLocation}
        </p>
      </div>
      <div className="state-recovery-section">
        <h4 className="state-subheading">Recovery options</h4>
        <div className="state-actions">
          {state.recovery.map((rec) => (
            <button
              key={`${rec.type}-${rec.label}`}
              type="button"
              className={rec.type === "reclaim" || rec.type === "resume" ? "btn-primary" : "btn-secondary"}
              onClick={rec.action}
            >
              {rec.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Centralized dispatcher for all eight states */
export function StateView({ state }: { state: CanonicalState }) {
  switch (state.kind) {
    case "loading":
      return <LoadingStateView state={state} />;
    case "empty":
      return <EmptyStateView state={state} />;
    case "partial":
      return <PartialStateView state={state} />;
    case "unsupported":
      return <UnsupportedStateView state={state} />;
    case "stale_disputed":
      return <StaleDisputedStateView state={state} />;
    case "review":
      return <ReviewStateView state={state} />;
    case "submitted":
      return <SubmittedStateView state={state} />;
    case "failed_delayed":
      return <FailedDelayedStateView state={state} />;
  }
}
