import { bitcoinExplorerTxUrl, explorerTxUrl } from "./shell.ts";
import { describeWorkflowArrival, workflowArrivalKind, workflowStateLabel } from "./workflowTiming.ts";

export function WorkflowArrivalView({
  action,
  state,
  createdAt,
  nextAction,
  nowMs,
  txid,
  network = "mainnet",
}: {
  action?: string | null | undefined;
  state: string;
  createdAt?: string | null | undefined;
  nextAction?: string | null | undefined;
  nowMs: number;
  txid?: string | null | undefined;
  network?: "mainnet" | "testnet";
}) {
  const arrival = describeWorkflowArrival({ action, state, createdAt, nowMs });
  const kind = workflowArrivalKind(action);
  const cleanTxid = typeof txid === "string" && txid.length > 0 ? txid.replace(/^0x/i, "") : null;
  const explorerHref =
    cleanTxid === null
      ? null
      : kind === "deposit"
        ? bitcoinExplorerTxUrl(cleanTxid, network)
        : explorerTxUrl(cleanTxid, network);
  const explorerLabel = kind === "deposit" ? "Bitcoin send" : "Stacks transaction";
  const clockLabel = arrival.phase === "arrived" ? "Time left" : arrival.phase === "stopped" ? "Status" : "Time left";

  return (
    <section className={`workflow-arrival phase-${arrival.phase}`} aria-label={`${arrival.title} status`}>
      <header className="workflow-arrival-head">
        <div>
          <p className="workflow-arrival-kind">{arrival.title}</p>
          <p className="workflow-arrival-headline">{arrival.headline}</p>
        </div>
        <p className="workflow-arrival-clock">
          <span className="workflow-arrival-clock-label">{clockLabel}</span>
          <strong>{arrival.remaining}</strong>
        </p>
      </header>

      <p className="workflow-arrival-state">
        Machine state <span className="badge badge-status">{state}</span>
        <span className="workflow-arrival-state-label">{workflowStateLabel(state)}</span>
      </p>
      <p>
        Destination: <strong>{arrival.destination}</strong>
      </p>
      {explorerHref !== null ? (
        <p>
          {explorerLabel}:{" "}
          <a href={explorerHref} target="_blank" rel="noreferrer" className="wf-explorer-link">
            <span className="monospace">{cleanTxid}</span>
          </a>
        </p>
      ) : null}

      {arrival.steps.length > 0 ? (
        <ol className="workflow-follow" aria-label="Follow-along stages">
          {arrival.steps.map((step, index) => (
            <li key={step.id} data-status={step.status}>
              <span className="workflow-follow-index" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <strong>
                  {step.label.replace(/^\d+\.\s*/, "")}
                  {step.status === "current" ? <span className="workflow-follow-now">Now</span> : null}
                  {step.status === "done" ? <span className="workflow-follow-done">Done</span> : null}
                </strong>
                <span>{step.detail}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="workflow-arrival-meta">
        Typical wait: <strong>{arrival.typicalWait}</strong>
        {arrival.elapsed ? (
          <>
            {" "}
            · Elapsed: <strong>{arrival.elapsed}</strong>
          </>
        ) : null}
      </p>
      <p className="muted">{arrival.note}</p>
      {nextAction ? (
        <p>
          Next: <code>{nextAction}</code>
        </p>
      ) : null}
    </section>
  );
}
