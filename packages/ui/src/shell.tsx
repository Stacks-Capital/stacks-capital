import { useEffect, useRef, useState } from "react";
import {
  bitcoinExplorerTxUrl,
  explorerTxUrl,
  formatBlockHeight,
  SHELL_NAV_TABS,
  type ShellNavTab,
  truncateAddress,
  type ViewMode,
  workflowAnnouncement,
  type WorkflowProgress,
} from "./shell.ts";
import { WorkflowArrivalView } from "./workflowArrival.tsx";
import {
  canCancelUnsignedWorkflow,
  describeWorkflowArrival,
  workflowActionTitle,
  workflowArrivalKind,
} from "./workflowTiming.ts";

export {
  bitcoinExplorerTxUrl,
  explorerTxUrl,
  formatBlockHeight,
  SHELL_NAV_TABS,
  type ShellNavTab,
  truncateAddress,
  type ViewMode,
  workflowAnnouncement,
  type WorkflowProgress,
};

/**
 * Always mounted, so workflow progress actually reaches assistive tech. A live region that appears with
 * its text already inside it is not announced, which is why this does not live in the drawer.
 */
export function WorkflowAnnouncer({ workflows }: { workflows: readonly WorkflowProgress[] }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {workflowAnnouncement(workflows)}
    </p>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function AddressChip({ address, onCopySuccess }: { address: string; onCopySuccess?: () => void }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(address);
      }
      setCopied(true);
      onCopySuccess?.();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className="address-chip" title={address}>
      <button
        type="button"
        className="address-chip-btn"
        onClick={() => void handleCopy()}
        aria-label={`Copy address ${address}`}
      >
        <span className="address-text">{truncateAddress(address)}</span>
        <span className="copy-icon" aria-hidden="true">
          {copied ? "✓" : "⎘"}
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Address copied to clipboard" : ""}
      </span>
    </div>
  );
}

export function BlockHeightChip({ height }: { height: number | null | undefined }) {
  const formatted = formatBlockHeight(height);
  return (
    <div className="block-height-chip" role="status" aria-label={`Current block height ${formatted}`}>
      <span className="block-indicator" aria-hidden="true" />
      <span className="block-label">block</span>
      <span className="block-number">{formatted}</span>
    </div>
  );
}

export function SimpleProToggle({ mode, onChange }: { mode: ViewMode; onChange: (next: ViewMode) => void }) {
  return (
    <fieldset className="simple-pro-toggle">
      <legend className="sr-only">View density toggle</legend>
      <button
        type="button"
        className={`toggle-btn ${mode === "simple" ? "active" : ""}`}
        aria-pressed={mode === "simple"}
        onClick={() => onChange("simple")}
      >
        Simple
      </button>
      <button
        type="button"
        className={`toggle-btn ${mode === "pro" ? "active" : ""}`}
        aria-pressed={mode === "pro"}
        onClick={() => onChange("pro")}
      >
        Pro
      </button>
    </fieldset>
  );
}

export function ShellNavigation({
  tabs = SHELL_NAV_TABS,
  activeTab,
  onSelectTab,
}: {
  tabs?: readonly string[];
  activeTab: string;
  onSelectTab: (tab: string) => void;
}) {
  return (
    <nav className="shell-nav" aria-label="Main application navigation">
      <ul className="nav-list">
        {tabs.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <li key={tab} className="nav-item">
              <button
                type="button"
                className={`nav-link ${isActive ? "active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelectTab(tab)}
              >
                {tab}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function ShellHeader({
  network,
  networks,
  onSelectNetwork,
  blockHeight,
  address,
  signedIn,
  wallets,
  onConnect,
  onDisconnect,
  onOpenDrawer,
  drawerBadgeCount = 0,
  onOpenWalletManager,
}: {
  network: string;
  networks: readonly string[];
  onSelectNetwork: (net: string) => void;
  blockHeight?: number | null | undefined;
  address: string | null;
  signedIn: boolean;
  wallets: readonly string[];
  onConnect: (walletId: string) => void;
  onDisconnect: () => void;
  onOpenDrawer?: () => void;
  drawerBadgeCount?: number;
  onOpenWalletManager?: () => void;
}) {
  const [connectMenuOpen, setConnectMenuOpen] = useState(false);
  const connectRef = useRef<HTMLDivElement | null>(null);
  const [soleWallet] = wallets;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (connectRef.current && !connectRef.current.contains(event.target as Node)) {
        setConnectMenuOpen(false);
      }
    }
    if (connectMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
    return undefined;
  }, [connectMenuOpen]);

  return (
    <header className="shell-header">
      <div className="shell-brand-group">
        <span className="brand-title">
          stacks<strong>.capital</strong>
        </span>
        <fieldset className="network-pill-group">
          <legend className="sr-only">Network selector</legend>
          {networks.map((name) => (
            <button
              key={name}
              type="button"
              className={`network-badge ${network === name ? "active" : ""}`}
              aria-pressed={network === name}
              onClick={() => onSelectNetwork(name)}
            >
              {name.toUpperCase()}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="shell-actions-group">
        <BlockHeightChip height={blockHeight} />

        {onOpenWalletManager ? (
          <button type="button" className="drawer-trigger-btn" onClick={onOpenWalletManager}>
            Wallet Manager
          </button>
        ) : null}

        {onOpenDrawer ? (
          <button
            type="button"
            className="drawer-trigger-btn"
            onClick={onOpenDrawer}
            aria-label={`Open workflows drawer, ${drawerBadgeCount} active`}
          >
            <span aria-hidden="true">⚡</span> Workflows
            {drawerBadgeCount > 0 ? <span className="badge-count">{drawerBadgeCount}</span> : null}
          </button>
        ) : null}

        {address ? (
          <div className="wallet-connected-box">
            <AddressChip address={address} />
            <span className="signin-indicator muted">{signedIn ? "signed in" : "not signed in"}</span>
            <button type="button" className="btn-secondary btn-sm" onClick={onDisconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="connect-wrapper" ref={connectRef}>
            {/* No wallet is a real answer, not a button that fails. */}
            {soleWallet === undefined ? (
              <span className="muted no-wallet-note">No Stacks wallet found. Install Leather or Xverse.</span>
            ) : wallets.length === 1 ? (
              <button type="button" className="btn-primary" onClick={() => onConnect(soleWallet)}>
                Connect {soleWallet}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  aria-expanded={connectMenuOpen}
                  aria-haspopup="true"
                  onClick={() => setConnectMenuOpen(!connectMenuOpen)}
                >
                  Connect
                </button>
                {connectMenuOpen ? (
                  <div className="connect-dropdown" role="menu">
                    {wallets.map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="menuitem"
                        className="dropdown-item"
                        onClick={() => {
                          setConnectMenuOpen(false);
                          onConnect(id);
                        }}
                      >
                        Connect {id}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export type WorkflowDrawerItem = {
  id: string;
  action?: string | null | undefined;
  state: string;
  updatedAt: string;
  createdAt?: string | null | undefined;
  nextAction?: string | null | undefined;
  txId?: string | null | undefined;
};

export function WorkflowDrawer({
  open,
  onClose,
  workflows = [],
  onCancelWorkflow,
  cancellingId = null,
}: {
  open: boolean;
  onClose: () => void;
  workflows?: WorkflowDrawerItem[];
  onCancelWorkflow?: (workflowId: string) => void;
  cancellingId?: string | null;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Focus moves into the drawer on open and returns to whatever opened it on close.
  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      return;
    }
    const live = workflows.find((wf) =>
      ["SUBMITTED", "CONFIRMING", "STEP_CONFIRMED", "RECONCILING"].includes(wf.state.toUpperCase()),
    );
    setSelectedId((current) => current ?? live?.id ?? null);
  }, [open, workflows]);

  useEffect(() => {
    if (!open) return undefined;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [open]);

  // aria-modal only tells assistive tech the rest is inert. Tab has to be held inside too.
  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (panel === null) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-overlay">
      {/* Escape and the close button are the keyboard paths, so the backdrop stays out of the a11y tree. */}
      <button type="button" className="drawer-backdrop" onClick={onClose} tabIndex={-1} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="workflow-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Workflows and recovery drawer"
      >
        <header className="drawer-header">
          <h3>Workflows & Activity</h3>
          <button
            ref={closeButtonRef}
            type="button"
            className="drawer-close-btn"
            onClick={onClose}
            aria-label="Close workflow drawer"
          >
            ✕
          </button>
        </header>

        <section className="drawer-body" aria-label="Recent workflows" aria-live="polite">
          {workflows.length === 0 ? (
            <p className="muted">No recent workflows in this session.</p>
          ) : (
            <>
            <p className="muted drawer-select-hint">
              Click a transaction to see its stages and time remaining.
            </p>
            <ul className="drawer-workflow-list">
              {workflows.map((wf) => {
                const arrival = describeWorkflowArrival({
                  action: wf.action,
                  state: wf.state,
                  createdAt: wf.createdAt,
                  nowMs,
                });
                const isSelected = wf.id === selectedId;
                return (
                  <li key={wf.id} className="drawer-workflow-item">
                    <button
                      type="button"
                      className={`drawer-workflow-card phase-${arrival.phase}${isSelected ? " selected" : ""}`}
                      aria-pressed={isSelected}
                      aria-expanded={isSelected}
                      onClick={() => setSelectedId(isSelected ? null : wf.id)}
                    >
                      <div className="wf-card-header">
                        <strong>{workflowActionTitle(workflowArrivalKind(wf.action))}</strong>
                        <span className="badge badge-status">{wf.state}</span>
                      </div>
                      {wf.action ? <p className="wf-action-code">{wf.action}</p> : null}
                      <p className="wf-card-remaining">
                        Time left: <strong>{arrival.remaining}</strong>
                      </p>
                      <p className="wf-card-stage">{arrival.headline}</p>
                      <p className="monospace wf-id">{wf.id}</p>
                      {wf.txId ? (
                        <p className="wf-txid">
                          Tx: <span className="monospace">{truncateAddress(wf.txId, 10, 8)}</span>
                        </p>
                      ) : null}
                      <small className="muted">{wf.updatedAt}</small>
                    </button>
                    {canCancelUnsignedWorkflow(wf.state) && onCancelWorkflow ? (
                      <button
                        type="button"
                        className="button-secondary wf-cancel-btn"
                        disabled={cancellingId === wf.id}
                        onClick={() => onCancelWorkflow(wf.id)}
                      >
                        {cancellingId === wf.id ? "Cancelling…" : "Cancel unsigned"}
                      </button>
                    ) : null}
                    {isSelected ? (
                      <WorkflowArrivalView
                        action={wf.action}
                        state={wf.state}
                        createdAt={wf.createdAt}
                        nextAction={wf.nextAction}
                        nowMs={nowMs}
                        txid={wf.txId}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  mode,
  onModeChange,
}: {
  title: string;
  subtitle?: string;
  mode: ViewMode;
  onModeChange: (next: ViewMode) => void;
}) {
  return (
    <div className="screen-header">
      <div className="screen-title-group">
        <h1 className="screen-title">{title}</h1>
        {subtitle ? <p className="screen-subtitle muted">{subtitle}</p> : null}
      </div>
      <SimpleProToggle mode={mode} onChange={onModeChange} />
    </div>
  );
}

export { ScreenHeader as PageHeader };
