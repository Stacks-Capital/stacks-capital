import { type CapitalClient, createClient } from "@stacks-capital/client";
import type { CapitalError, StacksNetwork } from "@stacks-capital/core";
import { CapitalProvider, useCapital, useMarkets, useWorkflows } from "@stacks-capital/react";
import {
  type ConnectedWallet,
  connectBitcoinWallet,
  connectWallet,
  installedWallets,
  messageSigner,
  PositionsSummary,
  ScreenHeader,
  SHELL_NAV_TABS,
  ShellHeader,
  ShellNavigation,
  signIn,
  UnsupportedStateView,
  type ViewMode,
  WorkflowAnnouncer,
  WorkflowDrawer,
} from "@stacks-capital/ui";
import type { WalletId } from "@stacks-capital/wallets";
import { useEffect, useMemo, useState } from "react";
import { Borrow } from "./borrowScreen.tsx";
import { NETWORKS, testnetNote, type WebConfig } from "./config.ts";
import { DepositBtcScreen } from "./depositBtcScreen.tsx";
import { Earn } from "./earnScreen.tsx";
import { PositionsScreen } from "./positionsScreen.tsx";
import { Risk } from "./riskScreen.tsx";
import { Activity, Markets, Portfolio } from "./screens.tsx";
import { Swap } from "./swapScreen.tsx";
import { LiquidityScreen } from "./liquidityScreen.tsx";
import { StakingScreen } from "./stakingScreen.tsx";
import { WalletManager } from "./walletManager.tsx";

import {
  getInitialSession,
  getInitialTab,
  NAV_TABS,
  type NavTab,
  type StoredSession,
  STORAGE_SESSION_PREFIX,
  STORAGE_TAB_KEY,
} from "./navigation.ts";

function walletFromStored(session: StoredSession, network: StacksNetwork): ConnectedWallet {
  return {
    id: session.walletId,
    address: session.address,
    network,
    ...(session.bitcoinAddress === undefined || session.bitcoinPublicKey === undefined
      ? {}
      : {
          bitcoinAddress: session.bitcoinAddress,
          bitcoinPublicKey: session.bitcoinPublicKey,
          ...(session.bitcoinWalletId === undefined ? {} : { bitcoinWalletId: session.bitcoinWalletId }),
        }),
  };
}

function AppShell({
  network,
  setNetwork,
  tab,
  setTab,
  wallet,
  setWallet,
  sessionToken,
  setSessionToken,
  problem,
  setProblem,
  wallets,
  client,
}: {
  network: StacksNetwork;
  setNetwork: (n: StacksNetwork) => void;
  tab: NavTab;
  setTab: (t: NavTab) => void;
  wallet: ConnectedWallet | null;
  setWallet: (w: ConnectedWallet | null) => void;
  sessionToken: string | null;
  setSessionToken: (s: string | null) => void;
  problem: CapitalError | Error | null;
  setProblem: (p: CapitalError | Error | null) => void;
  wallets: readonly WalletId[];
  client: CapitalClient;
}) {
  const { client: sessionClient } = useCapital();
  const [mode, setMode] = useState<ViewMode>("simple");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [walletManagerOpen, setWalletManagerOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [pendingBitcoin, setPendingBitcoin] = useState<{
    walletId: WalletId;
    address: string;
    publicKey: string;
  } | null>(null);
  const signedIn = sessionToken !== null;

  // Read block height from market data context
  const marketsQuery = useMarkets({ limit: 5 });
  const blockHeight = marketsQuery.data?.context?.blockHeight;

  // Workflows belong to a signed in address, so asking before sign in is refused. Same rule as positions.
  const workflowsQuery = useWorkflows({ limit: 10, enabled: signedIn });
  const recentWorkflows = (workflowsQuery.data?.items ?? []).map((wf) => ({
    id: wf.id,
    action: wf.action,
    state: wf.state,
    updatedAt: wf.updatedAt,
    createdAt: wf.createdAt,
    nextAction: wf.nextAction,
    txId: wf.lastTxid,
  }));

  async function cancelUnsignedWorkflow(workflowId: string) {
    setCancellingId(workflowId);
    setProblem(null);
    try {
      await sessionClient.cancelWorkflow(workflowId);
      await workflowsQuery.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error : new Error("Could not cancel the unsigned workflow"));
    } finally {
      setCancellingId(null);
    }
  }

  function selectNetwork(next: StacksNetwork) {
    if (next === network) return;
    setNetwork(next);
    const sessionForNext = getInitialSession(next);
    if (sessionForNext) {
      setWallet(walletFromStored(sessionForNext, next));
      setSessionToken(sessionForNext.token);
    } else {
      setWallet(null);
      setSessionToken(null);
    }
    setProblem(null);
  }

  async function connect(id: WalletId) {
    setProblem(null);
    try {
      const connected = await connectWallet(id, network);
      const inheritedAddress = connected.bitcoinAddress ?? wallet?.bitcoinAddress ?? pendingBitcoin?.address;
      const inheritedKey = connected.bitcoinPublicKey ?? wallet?.bitcoinPublicKey ?? pendingBitcoin?.publicKey;
      const inheritedWalletId = connected.bitcoinWalletId ?? wallet?.bitcoinWalletId ?? pendingBitcoin?.walletId;
      const withBitcoin =
        inheritedAddress === undefined || inheritedKey === undefined
          ? connected
          : {
              ...connected,
              bitcoinAddress: inheritedAddress,
              bitcoinPublicKey: inheritedKey,
              ...(inheritedWalletId === undefined ? {} : { bitcoinWalletId: inheritedWalletId }),
            };
      setWallet(withBitcoin);
      setPendingBitcoin(null);
      setSessionToken(null);
      const result = await signIn(client, withBitcoin, messageSigner(id));
      if (result.ok) {
        setSessionToken(result.session.token);
      } else {
        setProblem(result.error);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async function connectBitcoin(id: WalletId) {
    setProblem(null);
    try {
      const bitcoin = await connectBitcoinWallet(id, network);
      if (wallet === null) {
        setPendingBitcoin({ walletId: bitcoin.walletId, address: bitcoin.address, publicKey: bitcoin.publicKey });
        return;
      }
      setWallet({
        ...wallet,
        bitcoinAddress: bitcoin.address,
        bitcoinPublicKey: bitcoin.publicKey,
        bitcoinWalletId: bitcoin.walletId,
      });
    } catch (error) {
      setProblem(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function disconnectBitcoin() {
    setPendingBitcoin(null);
    if (wallet !== null) {
      setWallet({ id: wallet.id, address: wallet.address, network: wallet.network });
    }
  }

  function disconnect() {
    setWallet(null);
    setSessionToken(null);
    setProblem(null);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(`${STORAGE_SESSION_PREFIX}${network}`);
      } catch {}
    }
  }

  const testnet = testnetNote(network);

  return (
    <div className="app-container">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <WorkflowAnnouncer workflows={recentWorkflows} />
      <ShellHeader
        network={network}
        networks={NETWORKS}
        onSelectNetwork={(n) => selectNetwork(n as StacksNetwork)}
        blockHeight={blockHeight}
        address={wallet?.address ?? null}
        signedIn={signedIn}
        wallets={wallets}
        onConnect={(id) => void connect(id as WalletId)}
        onDisconnect={disconnect}
        onOpenDrawer={() => setDrawerOpen(true)}
        drawerBadgeCount={recentWorkflows.length}
        onOpenWalletManager={() => setWalletManagerOpen(true)}
      />

      <ShellNavigation
        tabs={NAV_TABS}
        activeTab={tab === "Portfolio" ? "Overview" : tab}
        onSelectTab={(selected) => setTab(selected as NavTab)}
      />

      {testnet === null ? null : (
        <aside className="panel panel-notice panel-notice-warn">
          <p className="warn">
            <strong>Testnet notice:</strong> {testnet}
          </p>
        </aside>
      )}

      {problem === null ? null : (
        <div className="panel panel-notice panel-notice-error" role="alert">
          <p className="error">{problem.message}</p>
        </div>
      )}

      <main id="main-content">
        {(tab === "Overview" || tab === "Portfolio") && (
          <>
            <ScreenHeader
              title="Your Bitcoin capital"
              subtitle="Where it sits, what it earns, what can go wrong, and what you can safely do next."
              mode={mode}
              onModeChange={setMode}
            />
            <Portfolio
              address={wallet?.address ?? null}
              signedIn={signedIn}
              onNavigate={(dest) => setTab(dest as NavTab)}
            />
            {/* The nav is fixed at the ten wireframe tabs, so the capability table lives under Overview. */}
            <Markets />
          </>
        )}

        {tab === "Bridge" && (
          <>
            <ScreenHeader
              title="Bridge"
              subtitle="Official sBTC: native Bitcoin to Stacks, or sBTC back to Bitcoin."
              mode={mode}
              onModeChange={setMode}
            />
            <DepositBtcScreen
              wallet={wallet}
              signedIn={signedIn}
              onOpenWalletManager={() => setWalletManagerOpen(true)}
            />
          </>
        )}

        {tab === "Earn" && (
          <>
            <ScreenHeader
              title="Earn marketplace"
              subtitle="Evidence-gated protocol comparison and vault supply."
              mode={mode}
              onModeChange={setMode}
            />
            <Earn wallet={wallet} signedIn={signedIn} />
          </>
        )}

        {tab === "Borrow" && (
          <>
            <ScreenHeader
              title="Borrow & Credit"
              subtitle="Isolated sBTC collateral and USDCx debt."
              mode={mode}
              onModeChange={setMode}
            />
            <Borrow wallet={wallet} signedIn={signedIn} />
          </>
        )}

        {tab === "Swap" && (
          <>
            <ScreenHeader
              title="Swap assets"
              subtitle="Bitflow routing and quote verification."
              mode={mode}
              onModeChange={setMode}
            />
            <Swap wallet={wallet} signedIn={signedIn} />
          </>
        )}

        {tab === "Liquidity" && (
          <>
            <ScreenHeader
              title="Liquidity provision"
              subtitle="Bitflow DLMM pool deposits, IL exposure and exit liquidity."
              mode={mode}
              onModeChange={setMode}
            />
            <LiquidityScreen wallet={wallet} signedIn={signedIn} />
          </>
        )}

        {tab === "Staking" && (
          <>
            <ScreenHeader
              title="Bitcoin Staking"
              subtitle="Native Bitcoin, STX stacking and protocol receipt staking routes."
              mode={mode}
              onModeChange={setMode}
            />
            <StakingScreen wallet={wallet} signedIn={signedIn} />
          </>
        )}

        {tab === "Positions" && (
          <>
            <ScreenHeader
              title="Verified positions"
              subtitle="Decoded protocol positions across vaults and markets."
              mode={mode}
              onModeChange={setMode}
            />
            <PositionsScreen wallet={wallet} signedIn={signedIn} onNavigate={(dest) => setTab(dest as NavTab)} />
          </>
        )}

        {tab === "Risk" && (
          <>
            <ScreenHeader
              title="Risk & Scenarios"
              subtitle="Concentration, stress testing, and liquidation buffers."
              mode={mode}
              onModeChange={setMode}
            />
            <Risk wallet={wallet} signedIn={signedIn} mode={mode} />
          </>
        )}

        {tab === "Activity" && (
          <>
            <ScreenHeader
              title="Activity & Workflows"
              subtitle="Recent transactions, workflow states, and recovery receipts."
              mode={mode}
              onModeChange={setMode}
            />
            <Activity signedIn={signedIn} wallet={wallet} network={network} />
          </>
        )}
      </main>

      <WorkflowDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        workflows={recentWorkflows}
        onCancelWorkflow={(id) => void cancelUnsignedWorkflow(id)}
        cancellingId={cancellingId}
      />
      <WalletManager
        open={walletManagerOpen}
        network={network}
        installed={wallets}
        stacksAddress={wallet?.address ?? null}
        stacksWalletId={wallet?.id ?? null}
        bitcoinAddress={wallet?.bitcoinAddress ?? pendingBitcoin?.address ?? null}
        bitcoinWalletId={wallet?.bitcoinWalletId ?? pendingBitcoin?.walletId ?? null}
        onClose={() => setWalletManagerOpen(false)}
        onConnectStacks={(id) => void connect(id)}
        onConnectBitcoin={(id) => void connectBitcoin(id)}
        onDisconnectBitcoin={disconnectBitcoin}
      />
    </div>
  );
}

export function App({ config }: { config: WebConfig }) {
  const [tab, setTabState] = useState<NavTab>(() => getInitialTab());
  const [network, setNetwork] = useState<StacksNetwork>(config.network);
  const initialSession = useMemo(() => getInitialSession(config.network), [config.network]);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(
    initialSession ? walletFromStored(initialSession, config.network) : null,
  );
  const [sessionToken, setSessionToken] = useState<string | null>(initialSession?.token ?? null);
  const [problem, setProblem] = useState<CapitalError | Error | null>(null);
  const wallets = useMemo(() => installedWallets(), []);

  const setTab = (nextTab: NavTab) => {
    setTabState(nextTab);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_TAB_KEY, nextTab);
        const url = new URL(window.location.href);
        url.searchParams.set("tab", nextTab);
        window.history.replaceState({}, "", url.toString());
      } catch {}
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        if (sessionToken && wallet) {
          window.localStorage.setItem(
            `${STORAGE_SESSION_PREFIX}${network}`,
            JSON.stringify({
              address: wallet.address,
              token: sessionToken,
              walletId: wallet.id,
              ...(wallet.bitcoinAddress === undefined ? {} : { bitcoinAddress: wallet.bitcoinAddress }),
              ...(wallet.bitcoinPublicKey === undefined ? {} : { bitcoinPublicKey: wallet.bitcoinPublicKey }),
              ...(wallet.bitcoinWalletId === undefined ? {} : { bitcoinWalletId: wallet.bitcoinWalletId }),
            }),
          );
        } else if (sessionToken === null) {
          window.localStorage.removeItem(`${STORAGE_SESSION_PREFIX}${network}`);
        }
      } catch {}
    }
  }, [network, wallet, sessionToken]);

  const base = useMemo(
    () => createClient({ baseUrl: config.apiBaseUrl, network, clientId: config.clientId }),
    [config, network],
  );

  const client: CapitalClient = useMemo(
    () => (sessionToken === null ? base : base.withSession(sessionToken)),
    [base, sessionToken],
  );

  return (
    <CapitalProvider client={client} address={wallet?.address ?? null}>
      <AppShell
        network={network}
        setNetwork={setNetwork}
        tab={tab}
        setTab={setTab}
        wallet={wallet}
        setWallet={setWallet}
        sessionToken={sessionToken}
        setSessionToken={setSessionToken}
        problem={problem}
        setProblem={setProblem}
        wallets={wallets}
        client={base}
      />
    </CapitalProvider>
  );
}
