import type { PreparedSbtcDeposit, QuotedPlan, StartedWorkflow } from "@stacks-capital/client";
import { useCapital, usePortfolio, usePrices, useWorkflow, useWorkflows } from "@stacks-capital/react";
import {
  assertPreparedSbtcDeposit,
  createStacksCapital,
  parsePlan,
  parseQuote,
  type PlanWire,
  type QuoteWire,
} from "@stacks-capital/sdk";
import type { WalletId } from "@stacks-capital/wallets";
import { useEffect, useState, type ReactNode } from "react";
import {
  askBitcoinTransfer,
  askWallet,
  assertSafeDeposit,
  assertSafeWithdrawPayout,
  attemptTxid,
  depositStacksRecipientFromPlan,
  bitcoinTransferTxid,
  waitForBitcoinDepositTxid,
  calculateDepositAccounting,
  calculateWithdrawalAccounting,
  type ConnectedWallet,
  EmptyStateView,
  FailedDelayedStateView,
  findLatestSbtcWorkflow,
  findProvider,
  loadIgnoredSbtcWorkflows,
  rememberIgnoredSbtcWorkflow,
  sbtcWorkflowBlocksComposer,
  shouldResumeSbtcWorkflow,
  messageFor,
  type SbtcBridgeMode,
  stageForDeposit,
  stageForWithdrawal,
  toBitcoinTransferRequest,
  typicalWaitLabel,
  toWalletRequest,
  truncateAddress,
  UnsupportedStateView,
  WorkflowArrivalView,
  validateBtcRecipient,
  withdrawRecipientFromPlan,
} from "@stacks-capital/ui";
import {
  bitcoinDepositBalanceError,
  bitcoinMinerFeeReserve,
  countConfirmedUtxos,
  formatSpotUsd,
  formatUsdFromBase,
  formatUsdFromDisplay,
  fromBaseUnits,
  type HiroAccountBalances,
  maxBridgePaySats,
  parseRecommendedFeeRate,
  SBTC_MAINNET_ASSET_ID,
  spendableBtcSats,
  spendableHiroQuantity,
  toBaseUnits,
  usdHint,
  walletEntryQuantity,
} from "./swapState.ts";
import { pickUsdQuote, usePublicSpotQuotes } from "./spotPrices.ts";

const HIRO_BALANCES_URL = "https://api.hiro.so/extended/v1/address";
const MEMPOOL_ADDRESS_URL = "https://mempool.space/api/address";
const MEMPOOL_FEES_URL = "https://mempool.space/api/v1/fees/recommended";

async function loadHiroBalances(address: string): Promise<HiroAccountBalances> {
  const response = await fetch(`${HIRO_BALANCES_URL}/${address}/balances`);
  if (!response.ok) throw new Error(`Hiro balances ${response.status}`);
  return (await response.json()) as HiroAccountBalances;
}

async function loadBtcSats(address: string): Promise<{ sats: string | null; utxos: number }> {
  const response = await fetch(`${MEMPOOL_ADDRESS_URL}/${address}/utxo`);
  if (!response.ok) throw new Error(`Mempool UTXOs ${response.status}`);
  const utxos = (await response.json()) as { value?: number | string; status?: { confirmed?: boolean } }[];
  return { sats: spendableBtcSats(utxos), utxos: countConfirmedUtxos(utxos) };
}

async function loadBtcFeeRate(): Promise<number> {
  const response = await fetch(MEMPOOL_FEES_URL);
  if (!response.ok) throw new Error(`Mempool fees ${response.status}`);
  return parseRecommendedFeeRate(await response.json());
}

function leatherDepositError(detail: string): string {
  if (/InsufficientFunds/i.test(detail)) {
    return "Leather needs more leftover bitcoin for the miner fee than this send leaves. Use Max or lower the amount.";
  }
  return detail;
}

type PendingEmilyNotify = {
  bitcoinTxid: string;
  depositScript: string;
  reclaimScript: string;
  stacksRecipient: string;
  amountSats: string;
  maxSignerFeeSats: string;
};

const PENDING_EMILY_NOTIFY_KEY = "stacks-capital:pending-emily-notify";

function loadPendingEmilyNotify(): PendingEmilyNotify | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(PENDING_EMILY_NOTIFY_KEY);
    if (raw === null || raw === undefined) return null;
    const parsed = JSON.parse(raw) as PendingEmilyNotify;
    if (typeof parsed.bitcoinTxid !== "string" || parsed.bitcoinTxid.length !== 64) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePendingEmilyNotify(pending: PendingEmilyNotify | null): void {
  try {
    if (pending === null) globalThis.sessionStorage?.removeItem(PENDING_EMILY_NOTIFY_KEY);
    else globalThis.sessionStorage?.setItem(PENDING_EMILY_NOTIFY_KEY, JSON.stringify(pending));
  } catch {
    /* Private mode must not block notify retry. */
  }
}

function balanceCopy(
  quantity: string | null,
  status: "idle" | "loading" | "ready" | "failed",
  symbol: string,
  usd: string | null,
): string {
  const dollar = usd === null ? "" : ` · ${usdHint(usd)}`;
  if (quantity !== null) return `Balance: ${fromBaseUnits(quantity, BTC_DECIMALS)} ${symbol}${dollar}`;
  if (status === "loading") return "Balance: loading…";
  return "Balance: unavailable";
}

const idempotencyKey = () => `idem_${crypto.randomUUID()}`;
const BTC_DECIMALS = 8;
const MIN_BRIDGE_SATS = 1000n;
const MIN_BRIDGE_BTC = "0.00001";
const OFFICIAL_SBTC_SIGNERS = [
  "Asigna",
  "Billion Dollar Cat",
  "Bima",
  "Bitflow",
  "Hermetica",
  "Ducat",
  "Leather",
  "Liquidium",
  "Pontis",
] as const;

function sdkValidation(plan: QuotedPlan["plan"], quote: QuotedPlan["quote"], sender: string) {
  const os = createStacksCapital({ network: plan.network });
  return os.validate(parsePlan(plan as PlanWire), parseQuote(quote as QuoteWire), { sender });
}

function satsFromBtc(display: string): string | null {
  const trimmed = display.trim();
  if (trimmed === "" || trimmed === "." || trimmed.endsWith(".")) return null;
  try {
    return toBaseUnits(trimmed, BTC_DECIMALS);
  } catch {
    return null;
  }
}

function formatBtc(sats: string): string {
  try {
    return fromBaseUnits(sats, BTC_DECIMALS);
  } catch {
    return "0";
  }
}

function BridgeShell({ children }: { children: ReactNode }) {
  return (
    <section className="bridge-card" aria-label="Official sBTC bridge">
      <header className="bridge-card-head">
        <h2>Bridge</h2>
        <div className="bridge-official">
          <span>Official sBTC</span>
          <button
            type="button"
            className="bridge-switch"
            role="switch"
            aria-checked="true"
            aria-label="Official sBTC"
            disabled
          />
        </div>
      </header>
      {children}
    </section>
  );
}

function BridgeSigners() {
  return (
    <section className="bridge-signers" aria-label="Official sBTC signers">
      <h3>Signers</h3>
      <ul>
        {OFFICIAL_SBTC_SIGNERS.map((name) => (
          <li key={name}>
            <span className="bridge-signer-dot" aria-hidden="true" />
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BridgeAssetChip({ kind }: { kind: "btc" | "sbtc" }) {
  if (kind === "btc") {
    return (
      <div className="bridge-asset">
        <span className="bridge-asset-icon bridge-asset-icon-btc" aria-hidden="true">
          ₿
        </span>
        <div>
          <strong>Bitcoin</strong>
        </div>
      </div>
    );
  }
  return (
    <div className="bridge-asset">
      <span className="bridge-asset-icon bridge-asset-icon-sbtc" aria-hidden="true">
        ◉
      </span>
      <div>
        <strong>sBTC</strong>
        <small>SIP-10</small>
      </div>
    </div>
  );
}

export function DepositBtcScreen({
  wallet,
  signedIn,
  onOpenWalletManager,
}: {
  wallet: ConnectedWallet | null;
  signedIn: boolean;
  onOpenWalletManager?: () => void;
}) {
  const { client } = useCapital();
  const portfolio = usePortfolio({ enabled: signedIn && wallet?.network === "mainnet" });
  const prices = usePrices({ staleMs: 15_000 });
  const spots = usePublicSpotQuotes(prices.data?.data.items);
  const [mode, setMode] = useState<SbtcBridgeMode>("deposit");
  const [hiroBalances, setHiroBalances] = useState<HiroAccountBalances | null>(null);
  const [btcSats, setBtcSats] = useState<string | null>(null);
  const [btcUtxos, setBtcUtxos] = useState(1);
  const [btcFeeRate, setBtcFeeRate] = useState(2);
  const [sbtcStatus, setSbtcStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [btcStatus, setBtcStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  const [displayAmount, setDisplayAmount] = useState("0.001");
  const [displayFee, setDisplayFee] = useState("0.000002");
  const [recipient, setRecipient] = useState("");

  const [quoted, setQuoted] = useState<QuotedPlan | null>(null);
  const [prepared, setPrepared] = useState<PreparedSbtcDeposit | null>(null);
  const [started, setStarted] = useState<StartedWorkflow | null>(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [ignoredWorkflowId, setIgnoredWorkflowId] = useState<string | null>(
    () => loadIgnoredSbtcWorkflows()[0] ?? null,
  );
  const [quoting, setQuoting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [confirmForeignPayout, setConfirmForeignPayout] = useState(false);
  const [editPayoutAddress, setEditPayoutAddress] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pendingEmily, setPendingEmily] = useState<PendingEmilyNotify | null>(() => loadPendingEmilyNotify());
  const [notifying, setNotifying] = useState(false);
  const [followTxid, setFollowTxid] = useState<string | null>(null);
  const [recoverHint, setRecoverHint] = useState<{
    fromAddress: string;
    toAddress: string;
    amountSats: string;
  } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const amount = satsFromBtc(displayAmount) ?? "";
  const maxFee = satsFromBtc(displayFee) ?? "";
  const amountSats = amount === "" ? 0n : BigInt(amount);
  const belowMinimum = amount === "" || amountSats < MIN_BRIDGE_SATS;

  const userWorkflows = useWorkflows({ enabled: signedIn, limit: 20 });
  const currentAction = mode === "deposit" ? "deposit_sbtc" : "withdraw_sbtc";
  const stacksAddress = wallet?.address;
  const bitcoinAddress = wallet?.bitcoinAddress;

  useEffect(() => {
    if (bitcoinAddress === undefined) return;
    setRecipient((current) => (current === "" ? bitcoinAddress : current));
  }, [bitcoinAddress]);
  const destinationAddress = recipient.trim() !== "" ? recipient.trim() : (bitcoinAddress ?? "");
  const recipientCheck = mode === "withdraw" ? validateBtcRecipient(destinationAddress) : { valid: true as const };
  const encodedRecipient = recipientCheck.valid ? recipientCheck.encoded : undefined;

  useEffect(() => {
    if (!signedIn || wallet?.network !== "mainnet" || stacksAddress === undefined) {
      setHiroBalances(null);
      setSbtcStatus("idle");
      return;
    }
    let cancelled = false;
    setSbtcStatus("loading");
    void loadHiroBalances(stacksAddress)
      .then((data) => {
        if (cancelled) return;
        setHiroBalances(data);
        setSbtcStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setHiroBalances(null);
        setSbtcStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, wallet?.network, stacksAddress]);

  useEffect(() => {
    if (!signedIn || wallet?.network !== "mainnet" || bitcoinAddress === undefined) {
      setBtcSats(null);
      setBtcUtxos(1);
      setBtcStatus("idle");
      return;
    }
    let cancelled = false;
    setBtcStatus("loading");
    void Promise.all([loadBtcSats(bitcoinAddress), loadBtcFeeRate().catch(() => 2)])
      .then(([walletSpend, rate]) => {
        if (cancelled) return;
        setBtcSats(walletSpend.sats);
        setBtcUtxos(walletSpend.utxos < 1 ? 1 : walletSpend.utxos);
        setBtcFeeRate(rate);
        setBtcStatus(walletSpend.sats === null ? "failed" : "ready");
      })
      .catch(() => {
        if (cancelled) return;
        setBtcSats(null);
        setBtcStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, wallet?.network, bitcoinAddress]);

  useEffect(() => {
    setConfirmForeignPayout(false);
  }, [destinationAddress]);

  useEffect(() => {
    if (!signedIn || wallet === null || wallet.network !== "mainnet") return;
    if (belowMinimum || amount === "" || maxFee === "") {
      setQuoted(null);
      setPrepared(null);
      return;
    }
    if (mode === "withdraw" && (encodedRecipient === undefined || !recipientCheck.valid)) {
      setQuoted(null);
      return;
    }
    if (mode === "deposit" && wallet.bitcoinPublicKey === undefined) {
      setQuoted(null);
      setPrepared(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setQuoting(true);
        setProblem(null);
        try {
          if (mode === "deposit") {
            const result = await client.quote({
              marketId: "sbtc.deposit",
              action: "deposit_sbtc",
              amount,
              maxFee,
              owner: wallet.address,
              recipient: wallet.address,
            });
            if (wallet.bitcoinPublicKey === undefined) {
              throw new Error("Reconnect Leather or Xverse so it can share a Bitcoin payment key for reclaim.");
            }
            const payload = result.data.plan.steps[0]?.payload;
            const built = await client.prepareSbtcDeposit({
              stacksRecipient: wallet.address,
              amountSats: amount,
              maxSignerFeeSats: maxFee,
              reclaimPublicKey: wallet.bitcoinPublicKey,
              ...(payload?.kind === "bitcoin_deposit" && typeof payload.reclaimLockTime === "number"
                ? { reclaimLockTime: payload.reclaimLockTime }
                : {}),
            });
            if (cancelled) return;
            setQuoted(result.data);
            setPrepared(assertPreparedSbtcDeposit(built.data));
          } else {
            if (encodedRecipient === undefined) {
              throw new Error("Connect a Bitcoin wallet so payout can go to an address you control.");
            }
            const result = await client.quote({
              marketId: "sbtc.withdraw",
              action: "withdraw_sbtc",
              amount,
              maxFee,
              recipient: encodedRecipient,
              owner: wallet.address,
            });
            if (cancelled) return;
            setQuoted(result.data);
          }
        } catch (error) {
          if (cancelled) return;
          setQuoted(null);
          setPrepared(null);
          setProblem(messageFor(error).message);
        } finally {
          if (!cancelled) setQuoting(false);
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    signedIn,
    wallet,
    client,
    mode,
    amount,
    maxFee,
    encodedRecipient,
    recipientCheck.valid,
    belowMinimum,
  ]);

  useEffect(() => {
    if (activeWorkflowId !== null || !userWorkflows.data?.items) return;
    const latest = findLatestSbtcWorkflow(userWorkflows.data.items, currentAction, wallet?.network);
    if (latest === null || latest.id === ignoredWorkflowId || loadIgnoredSbtcWorkflows().includes(latest.id)) {
      return;
    }
    if (!shouldResumeSbtcWorkflow(latest.state)) return;
    setActiveWorkflowId(latest.id);
  }, [activeWorkflowId, ignoredWorkflowId, userWorkflows.data, currentAction, wallet?.network]);

  const workflowQuery = useWorkflow(activeWorkflowId, { staleMs: 5_000 });
  const workflowData = workflowQuery.data?.data ?? null;

  const workflowState = workflowData?.state ?? started?.state ?? null;
  const stage = mode === "deposit" ? stageForDeposit(workflowState) : stageForWithdrawal(workflowState);
  const waitingOnWallet = stage === "signing" && signing;
  const showComposer = !waitingOnWallet && !sbtcWorkflowBlocksComposer(workflowState);
  const trackedTxid = followTxid ?? attemptTxid(workflowData?.attempts ?? []);
  const showProgress =
    trackedTxid !== null ||
    (workflowState !== null &&
      ["SUBMITTED", "CONFIRMING", "STEP_CONFIRMED", "RECONCILING", "BROADCAST_UNKNOWN"].includes(workflowState));

  function dismissWorkflow(id: string | null) {
    if (id === null) return;
    rememberIgnoredSbtcWorkflow(id);
    setIgnoredWorkflowId(id);
    if (activeWorkflowId === id) setActiveWorkflowId(null);
    setStarted(null);
    setFollowTxid(null);
    setRecoverHint(null);
  }

  useEffect(() => {
    if (stage !== "done" || activeWorkflowId === null) return;
    dismissWorkflow(activeWorkflowId);
  }, [stage, activeWorkflowId]);

  useEffect(() => {
    if (!showProgress) return undefined;
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
      void userWorkflows.refresh();
      void workflowQuery.refresh();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [showProgress]);

  useEffect(() => {
    if (mode !== "deposit" || recoverHint === null || activeWorkflowId === null) return;
    if (workflowState !== "AWAITING_SIGNATURE" && workflowState !== "BROADCAST_UNKNOWN") return;
    let cancelled = false;
    void waitForBitcoinDepositTxid(recoverHint).then(async (found) => {
      if (cancelled || found === null) return;
      try {
        await client.attachFoundBroadcast(activeWorkflowId, { txid: found });
        setFollowTxid(found);
        await userWorkflows.refresh();
        await workflowQuery.refresh();
      } catch {
        /* The send may already be attached, or this workflow is a different quote. */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode, recoverHint, activeWorkflowId, workflowState, client]);

  function resetForm() {
    dismissWorkflow(activeWorkflowId);
    setQuoted(null);
    setPrepared(null);
    setStarted(null);
    setActiveWorkflowId(null);
    setProblem(null);
    setEditPayoutAddress(false);
    setConfirmForeignPayout(false);
  }

  function flipDirection() {
    setMode((current) => (current === "deposit" ? "withdraw" : "deposit"));
    resetForm();
  }

  const fromKind = mode === "deposit" ? "btc" : "sbtc";
  const toKind = mode === "deposit" ? "sbtc" : "btc";
  const fromChain = mode === "deposit" ? "Bitcoin" : "Stacks";
  const toChain = mode === "deposit" ? "Stacks" : "Bitcoin";

  const depositAcc =
    mode === "deposit" && amountSats > 0n
      ? calculateDepositAccounting({ amountSats: amount, maxFeeSats: maxFee || "0" })
      : null;
  const withdrawAcc =
    mode === "withdraw" && amountSats > 0n
      ? calculateWithdrawalAccounting({ amountSats: amount, maxFeeSats: maxFee || "0" })
      : null;
  const receiveDisplay =
    mode === "deposit"
      ? formatBtc(depositAcc?.minExpectedSbtcSats ?? "0")
      : formatBtc(withdrawAcc?.withdrawalAmountSats ?? (amount || "0"));
  const feeConsumesDeposit =
    mode === "deposit" && depositAcc !== null && BigInt(depositAcc.minExpectedSbtcSats) === 0n;
  const portfolioEntries = portfolio.data?.data.entries ?? [];
  const sbtcSpendable =
    hiroBalances !== null
      ? spendableHiroQuantity(SBTC_MAINNET_ASSET_ID, hiroBalances)
      : walletEntryQuantity(portfolioEntries, SBTC_MAINNET_ASSET_ID);
  const paySpendable = mode === "deposit" ? btcSats : sbtcSpendable;
  const receiveSpendable = mode === "deposit" ? sbtcSpendable : btcSats;
  const payStatus = mode === "deposit" ? btcStatus : sbtcStatus;
  const receiveStatus = mode === "deposit" ? sbtcStatus : btcStatus;
  const minerReserveSats = bitcoinMinerFeeReserve(btcFeeRate, btcUtxos);
  const maxPaySats =
    paySpendable === null
      ? "0"
      : maxBridgePaySats(mode, paySpendable, maxFee, MIN_BRIDGE_SATS.toString(), minerReserveSats);
  const canUseMax = maxPaySats !== "0";
  const maxUnavailableReason =
    mode === "deposit" && paySpendable !== null && BigInt(paySpendable) > 0n && !canUseMax
      ? `Max is unavailable. Leather needs about ${fromBaseUnits(minerReserveSats, BTC_DECIMALS)} bitcoin leftover for the miner fee, which leaves less than the ${MIN_BRIDGE_BTC} deposit minimum.`
      : null;
  const btcQuote = pickUsdQuote("BTC/USD", prices.data?.data.items, spots.items);
  const usdLoading = prices.isLoading || spots.loading;
  const sendUsd = formatUsdFromDisplay(displayAmount, BTC_DECIMALS, btcQuote);
  const receiveUsd = belowMinimum ? null : formatUsdFromDisplay(receiveDisplay, BTC_DECIMALS, btcQuote);
  const feeUsd = formatUsdFromDisplay(displayFee, BTC_DECIMALS, btcQuote);
  const payBalanceUsd =
    paySpendable === null ? null : formatUsdFromBase(paySpendable, BTC_DECIMALS, btcQuote);
  const receiveBalanceUsd =
    receiveSpendable === null ? null : formatUsdFromBase(receiveSpendable, BTC_DECIMALS, btcQuote);
  const btcSpot = formatSpotUsd(btcQuote);
  const matchesConnectedWallet =
    wallet?.bitcoinAddress !== undefined &&
    destinationAddress.toLowerCase() === wallet.bitcoinAddress.toLowerCase();
  const mintDestination = prepared?.stacksRecipient ?? wallet?.address ?? "";
  const depositMatchesWallet =
    wallet?.address !== undefined && mintDestination !== "" && mintDestination === wallet.address;
  let overBalance: string | null = null;
  try {
    if (paySpendable !== null && amount !== "") {
      if (mode === "withdraw" && maxFee !== "") {
        if (BigInt(amount) + BigInt(maxFee) > BigInt(paySpendable)) {
          overBalance = "Amount plus max signer fee is more than your sBTC balance";
        }
      } else if (mode === "deposit") {
        overBalance = bitcoinDepositBalanceError(amount, paySpendable, minerReserveSats);
      }
    }
  } catch {
    overBalance = null;
  }
  const planRecipient = quoted === null ? null : withdrawRecipientFromPlan(quoted.plan);
  const payoutSafe =
    mode === "withdraw" && encodedRecipient !== undefined && quoted !== null
      ? assertSafeWithdrawPayout({
          encodedRecipient,
          destinationAddress,
          ...(wallet?.bitcoinAddress === undefined ? {} : { connectedBitcoinAddress: wallet.bitcoinAddress }),
          planRecipient,
          confirmedForeignAddress: confirmForeignPayout,
        })
      : { ok: true as const, matchesConnectedWallet: true };
  const depositPlanRecipient = quoted === null ? null : depositStacksRecipientFromPlan(quoted.plan);
  const depositSafe =
    mode === "deposit" && prepared !== null && wallet !== null
      ? assertSafeDeposit({
          depositAddress: prepared.address,
          stacksRecipient: prepared.stacksRecipient,
          preparedAmountSats: prepared.amountSats,
          walletAddress: wallet.address,
          amountSats: amount,
          planRecipient: depositPlanRecipient,
        })
      : { ok: true as const };

  function renderComposer(options: { interactive: boolean; cta: ReactNode }) {
    return (
      <>
        <div className="bridge-leg">
          <div className="bridge-leg-meta">
            <span>From {fromChain}</span>
            <span className="bridge-leg-actions">
              You send
              {options.interactive && canUseMax ? (
                <button
                  type="button"
                  className="swap-max-btn"
                  aria-label="Use maximum spendable amount"
                  onClick={() => {
                    setDisplayAmount(formatBtc(maxPaySats));
                  }}
                >
                  Max
                </button>
              ) : null}
            </span>
          </div>
          <div className="bridge-leg-row">
            <BridgeAssetChip kind={fromKind} />
            <input
              aria-label="You send"
              inputMode="decimal"
              value={displayAmount}
              disabled={!options.interactive}
              onChange={(event) => {
                setDisplayAmount(event.target.value);
              }}
            />
          </div>
          <p className="token-usd">{usdHint(sendUsd, usdLoading)}</p>
          <small>
            {balanceCopy(paySpendable, payStatus, mode === "deposit" ? "BTC" : "sBTC", payBalanceUsd)}
            {mode === "deposit"
              ? wallet?.bitcoinAddress
                ? ` · ${truncateAddress(wallet.bitcoinAddress)}`
                : " · Bitcoin payment address is shared when the wallet connects"
              : ` · ${truncateAddress(wallet?.address)}`}
          </small>
        </div>

        <button
          type="button"
          className="bridge-flip"
          aria-label="Switch bridge direction"
          disabled={!options.interactive}
          onClick={flipDirection}
        >
          ↓
        </button>

        <div className="bridge-leg">
          <div className="bridge-leg-meta">
            <span>To {toChain}</span>
            <span>You receive</span>
          </div>
          <div className="bridge-leg-row">
            <BridgeAssetChip kind={toKind} />
            <output aria-label="You receive">{belowMinimum || feeConsumesDeposit ? "0" : receiveDisplay}</output>
          </div>
          <p className="token-usd">{usdHint(receiveUsd, usdLoading)}</p>
          <small>
            {balanceCopy(receiveSpendable, receiveStatus, mode === "deposit" ? "sBTC" : "BTC", receiveBalanceUsd)}
          </small>
        </div>

        {mode === "withdraw" && options.interactive && (!matchesConnectedWallet || editPayoutAddress) ? (
          <label className="bridge-recipient">
            Bitcoin payout address
            <input
              value={recipient}
              onChange={(event) => {
                setRecipient(event.target.value);
              }}
              placeholder="bc1… address from your Bitcoin wallet"
            />
          </label>
        ) : null}
        {mode === "withdraw" && options.interactive && matchesConnectedWallet && !editPayoutAddress ? (
          <button type="button" className="bridge-edit-payout" onClick={() => setEditPayoutAddress(true)}>
            Use a different Bitcoin address
          </button>
        ) : null}

        <label className="bridge-fee">
          Maximum signer fee
          <input
            aria-label="Maximum signer fee"
            inputMode="decimal"
            value={displayFee}
            disabled={!options.interactive}
            onChange={(event) => {
              setDisplayFee(event.target.value);
            }}
          />
          <span>BTC</span>
        </label>
        <p className="token-usd bridge-fee-usd">{usdHint(feeUsd, usdLoading)}</p>

        {options.interactive ? (
          <section className="bridge-preview" aria-label="Bridge preview">
            <span className="eyebrow">Preview</span>
            {quoting ? <p>Updating preview…</p> : null}
            {!belowMinimum ? (
              <dl>
                <div>
                  <dt>You send</dt>
                  <dd>
                    {displayAmount} {mode === "deposit" ? "BTC" : "sBTC"} · {usdHint(sendUsd, usdLoading)}
                  </dd>
                </div>
                <div>
                  <dt>You receive</dt>
                  <dd>
                    {receiveDisplay} {mode === "deposit" ? "sBTC" : "BTC"} · {usdHint(receiveUsd, usdLoading)}
                  </dd>
                </div>
                {mode === "withdraw" && withdrawAcc !== null ? (
                  <>
                    <div>
                      <dt>Requested Bitcoin output</dt>
                      <dd>{withdrawAcc.withdrawalAmountSats} satoshis</dd>
                    </div>
                    <div>
                      <dt>sBTC locked</dt>
                      <dd>{formatBtc(withdrawAcc.initiallyLockedSats)} sBTC (amount + max fee)</dd>
                    </div>
                  </>
                ) : null}
                <div>
                  <dt>Destination</dt>
                  <dd>
                    {mode === "deposit" ? (
                      depositMatchesWallet ? (
                        "Matches connected wallet"
                      ) : mintDestination !== "" ? (
                        <>
                          Does not match connected wallet · <code>{mintDestination}</code>
                        </>
                      ) : (
                        "Connect a Stacks wallet"
                      )
                    ) : matchesConnectedWallet ? (
                      "Matches connected wallet"
                    ) : destinationAddress !== "" ? (
                      <>
                        Does not match connected wallet · <code>{destinationAddress}</code>
                      </>
                    ) : (
                      "Connect a Bitcoin wallet"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Typical time</dt>
                  <dd>
                    {mode === "deposit"
                      ? `${typicalWaitLabel("deposit")} · 1–3 Bitcoin blocks, then signers mint`
                      : `${typicalWaitLabel("withdraw")} · 6 Bitcoin blocks (~60 min), then signer sweep`}
                  </dd>
                </div>
              </dl>
            ) : (
              <p>Enter at least {MIN_BRIDGE_BTC} to preview</p>
            )}
            {mode === "withdraw" && quoted !== null && !matchesConnectedWallet && recipientCheck.valid ? (
              <label className="bridge-foreign-confirm">
                <input
                  type="checkbox"
                  checked={confirmForeignPayout}
                  onChange={(event) => setConfirmForeignPayout(event.target.checked)}
                />
                I control this Bitcoin address. Funds sent to the wrong address cannot be recovered.
              </label>
            ) : null}
            {feeConsumesDeposit ? (
              <p className="error">
                Maximum signer fee would consume this entire deposit, so the minimum mint is 0 sBTC. Raise the amount or
                lower the fee.
              </p>
            ) : null}
            {payoutSafe.ok ? null : <p className="error">{payoutSafe.error}</p>}
            {depositSafe.ok ? null : <p className="error">{depositSafe.error}</p>}
          </section>
        ) : null}

        <p className="bridge-min">
          You must send at least {MIN_BRIDGE_BTC} bitcoin. The signer fee is taken from that amount, so send more than
          the fee. Leather needs about {fromBaseUnits(minerReserveSats, BTC_DECIMALS)} bitcoin leftover for the miner fee
          {btcSpot === null ? "" : ` · 1 BTC ≈ ${btcSpot}`}
        </p>
        {options.cta}
      </>
    );
  }

  if (wallet?.network === "testnet") {
    return (
      <div className="bridge-stage">
        <BridgeShell>
          {renderComposer({
            interactive: false,
            cta: (
              <button type="button" className="bridge-cta" disabled>
                Testnet bridge is disabled
              </button>
            ),
          })}
          <UnsupportedStateView
            state={{
              kind: "unsupported",
              assetOrProtocol:
                mode === "deposit" ? "Bitcoin (BTC) to sBTC Deposit" : "sBTC to Bitcoin (BTC) Withdrawal",
              reason:
                mode === "deposit"
                  ? "Emily beta does not track public Stacks testnet. Leather has no Bitcoin regtest (I01 F2)."
                  : "Same testnet signer/Emily mismatch as deposit (I01 F2).",
            }}
          />
        </BridgeShell>
        <BridgeSigners />
      </div>
    );
  }

  if (!signedIn || wallet === null) {
    return (
      <div className="bridge-stage">
        <BridgeShell>
          {renderComposer({
            interactive: false,
            cta: (
              <button
                type="button"
                className="bridge-cta"
                onClick={onOpenWalletManager}
                disabled={onOpenWalletManager === undefined}
              >
                Connect wallet on Stacks
              </button>
            ),
          })}
          <EmptyStateView
            state={{
              kind: "empty",
              instruction: "Connect a wallet and sign in to deposit or withdraw Bitcoin.",
            }}
          />
        </BridgeShell>
        <BridgeSigners />
      </div>
    );
  }

  async function signAndSubmit() {
    if (quoted === null || wallet === null) return;
    if (mode === "withdraw") {
      if (encodedRecipient === undefined) {
        setProblem("Connect a Bitcoin wallet so payout can go to an address you control.");
        return;
      }
      const payout = assertSafeWithdrawPayout({
        encodedRecipient,
        destinationAddress,
        ...(wallet.bitcoinAddress === undefined ? {} : { connectedBitcoinAddress: wallet.bitcoinAddress }),
        planRecipient: withdrawRecipientFromPlan(quoted.plan),
        confirmedForeignAddress: confirmForeignPayout,
      });
      if (!payout.ok) {
        setProblem(payout.error);
        return;
      }
    }
    if (mode === "deposit") {
      if (prepared === null) {
        setProblem("The deposit address is not ready yet");
        return;
      }
      const deposit = assertSafeDeposit({
        depositAddress: prepared.address,
        stacksRecipient: prepared.stacksRecipient,
        preparedAmountSats: prepared.amountSats,
        walletAddress: wallet.address,
        amountSats: amount,
        planRecipient: depositStacksRecipientFromPlan(quoted.plan),
      });
      if (!deposit.ok) {
        setProblem(deposit.error);
        return;
      }
    }
    setSigning(true);
    setProblem(null);
    let startedId: string | null = null;
    try {
      const start = await client.startWorkflow({
        quoteId: quoted.quote.id,
        idempotencyKey: idempotencyKey(),
      });
      startedId = start.data.workflowId;
      setStarted(start.data);
      setActiveWorkflowId(start.data.workflowId);

      const step = start.data.plan.steps[0];
      if (step === undefined) throw new Error("The plan has no step to sign");
      const signingWalletId = (mode === "deposit" ? (wallet.bitcoinWalletId ?? wallet.id) : wallet.id) as WalletId;
      const provider = findProvider(signingWalletId);
      if (provider === null) throw new Error(`${signingWalletId} is not available any more`);

      if (mode === "deposit") {
        if (prepared === null) throw new Error("The deposit address is not ready yet");
        if (wallet.bitcoinAddress !== undefined) {
          setRecoverHint({
            fromAddress: wallet.bitcoinAddress,
            toAddress: prepared.address,
            amountSats: prepared.amountSats,
          });
        }
        const answer = await askBitcoinTransfer(
          provider,
          signingWalletId,
          toBitcoinTransferRequest(prepared.address, amount, signingWalletId),
        );
        if (answer.kind === "rejected") {
          setProblem(answer.message);
          try {
            await client.cancelWorkflow(startedId);
          } catch {
            /* Local dismiss still clears the form. */
          }
          dismissWorkflow(startedId);
          return;
        }
        if (answer.kind === "unknown") {
          const detail =
            typeof answer.result === "object" &&
            answer.result !== null &&
            "error" in answer.result &&
            typeof answer.result.error === "string" &&
            answer.result.error.trim() !== ""
              ? answer.result.error
              : "The wallet could not send bitcoin.";
          setProblem(leatherDepositError(detail));
        }
        let sentTxid = answer.kind === "answered" ? bitcoinTransferTxid(answer.result) : null;
        if (sentTxid === null && wallet.bitcoinAddress !== undefined) {
          sentTxid = await waitForBitcoinDepositTxid({
            fromAddress: wallet.bitcoinAddress,
            toAddress: prepared.address,
            amountSats: prepared.amountSats,
          });
        }
        if (sentTxid === null) {
          if (answer.kind === "answered") {
            await client.recordSignature(start.data.workflowId, {
              stepId: step.id,
              walletResult: answer.result,
            });
          }
          setProblem("Looking for the Bitcoin send on the network. Do not send again.");
          await userWorkflows.refresh();
          return;
        }
        const pendingNotify: PendingEmilyNotify = {
          bitcoinTxid: sentTxid,
          depositScript: prepared.depositScript,
          reclaimScript: prepared.reclaimScript,
          stacksRecipient: prepared.stacksRecipient,
          amountSats: prepared.amountSats,
          maxSignerFeeSats: prepared.maxSignerFeeSats,
        };
        savePendingEmilyNotify(pendingNotify);
        setPendingEmily(pendingNotify);
        setFollowTxid(sentTxid);
        await client.recordSignature(start.data.workflowId, {
          stepId: step.id,
          walletResult: { txid: sentTxid },
        });
        await client.notifySbtcDeposit(pendingNotify);
        savePendingEmilyNotify(null);
        setPendingEmily(null);
      } else {
        const validation = sdkValidation(start.data.plan, quoted.quote, wallet.address);
        const answer = await askWallet(provider, wallet.id as WalletId, toWalletRequest(step, validation), validation);
        if (answer.kind === "rejected") {
          setProblem(answer.message);
          dismissWorkflow(startedId);
          return;
        }
        await client.recordSignature(start.data.workflowId, {
          stepId: step.id,
          walletResult: answer.result,
        });
      }
      setQuoted(null);
      await userWorkflows.refresh();
      await workflowQuery.refresh();
    } catch (error) {
      setProblem(leatherDepositError(messageFor(error).message));
      dismissWorkflow(startedId);
    } finally {
      setSigning(false);
    }
  }

  async function retryEmilyNotify() {
    if (pendingEmily === null) return;
    setNotifying(true);
    setProblem(null);
    try {
      await client.notifySbtcDeposit(pendingEmily);
      savePendingEmilyNotify(null);
      setPendingEmily(null);
      await userWorkflows.refresh();
    } catch (error) {
      setProblem(
        `${leatherDepositError(messageFor(error).message)} Bitcoin txid ${pendingEmily.bitcoinTxid}. Do not send again.`,
      );
    } finally {
      setNotifying(false);
    }
  }

  return (
    <div className="bridge-stage">
      <BridgeShell>
        <p className="bridge-notice">
          Pending BTC and in-flight transactions are held strictly distinct from spendable sBTC. They are never combined
          into a single balance.
        </p>

        {showComposer && (
          <>
            {renderComposer({
              interactive: true,
              cta:
                (mode === "deposit" || mode === "withdraw") && wallet.bitcoinAddress === undefined ? (
                  <button
                    type="button"
                    className="bridge-cta"
                    onClick={onOpenWalletManager}
                    disabled={onOpenWalletManager === undefined}
                  >
                    Connect Bitcoin wallet
                  </button>
                ) : (
                  <button
                    type="button"
                    className="bridge-cta"
                    disabled={
                      quoting ||
                      signing ||
                      belowMinimum ||
                      feeConsumesDeposit ||
                      overBalance !== null ||
                      amount === "" ||
                      quoted === null ||
                      (mode === "withdraw" && !recipientCheck.valid) ||
                      (mode === "withdraw" && !payoutSafe.ok) ||
                      (mode === "deposit" && (prepared === null || !depositSafe.ok)) ||
                      quoted.quote.executable !== true
                    }
                    onClick={() => void signAndSubmit()}
                  >
                    {signing
                      ? "Opening your wallet…"
                      : quoting
                        ? "Updating preview…"
                        : mode === "deposit"
                          ? "Deposit Bitcoin"
                          : "Withdraw to Bitcoin"}
                  </button>
                ),
            })}

            {mode === "withdraw" && !recipientCheck.valid && destinationAddress !== "" && (
              <p className="error" style={{ fontSize: "0.85rem" }}>
                {recipientCheck.error}
              </p>
            )}
            {overBalance !== null && <p className="error" style={{ fontSize: "0.85rem" }}>{overBalance}</p>}
            {maxUnavailableReason !== null && (
              <p className="error" style={{ fontSize: "0.85rem" }}>
                {maxUnavailableReason}
              </p>
            )}

            {mode === "deposit" && prepared !== null && (
              <p className="muted" style={{ marginTop: "0.8rem", fontSize: "0.85rem" }}>
                {depositMatchesWallet
                  ? "Destination matches connected wallet. Emily is notified after broadcast. A Bitcoin txid is not a mint."
                  : `Destination does not match connected wallet: ${mintDestination}. A Bitcoin txid is not a mint.`}
              </p>
            )}
            {mode === "withdraw" && quoted !== null ? (
              <p className={matchesConnectedWallet ? "muted" : "warn"} style={{ marginTop: "0.8rem", fontSize: "0.85rem" }}>
                {matchesConnectedWallet
                  ? "Destination matches connected wallet. A Stacks txid is not a payout. Workflow completes only after signer acceptance and the Bitcoin payout."
                  : `Destination does not match connected wallet: ${destinationAddress}. A Stacks txid is not a payout.`}
              </p>
            ) : null}
          </>
        )}

        {waitingOnWallet && (
          <div className="bridge-status">
            <h3>Waiting for wallet signature</h3>
            <p>Please approve the transaction in {wallet.id}. Nothing moves until approved.</p>
          </div>
        )}

        {stage === "reclaim" && (
          <div className="bridge-status">
            <h3>Deposit reclaim available</h3>
            <p className="warn">
              The Bitcoin tip has reached Emily's reclaim lock height without a canonical mint. Your deposit funds are
              reclaimable.
            </p>
            <FailedDelayedStateView
              state={{
                kind: "failed_delayed",
                cause: "Deposit was not minted by signers before the reclaim lock height expired.",
                fundsLocation: "Funds remain safely locked in the Bitcoin deposit script address awaiting reclaim.",
                recovery: [
                  {
                    type: "resume",
                    label: "Continue bridging",
                    action: () => dismissWorkflow(activeWorkflowId),
                  },
                  {
                    type: "reclaim",
                    label: "Reclaim Bitcoin deposit",
                    action: () => {
                      alert("Reclaim transaction can be broadcast using the reclaim script on Bitcoin.");
                    },
                  },
                  {
                    type: "support",
                    label: "Copy workflow id",
                    action: () => void navigator.clipboard?.writeText(activeWorkflowId ?? ""),
                  },
                ],
              }}
            />
          </div>
        )}

        {stage === "recovery" && (
          <FailedDelayedStateView
            state={{
              kind: "failed_delayed",
              cause:
                workflowState === "SIGNER_REJECTION_PENDING"
                  ? "Signers rejected the withdrawal request. Funds remain locked in the contract until the canonical registry records the rejection status."
                  : workflowState === "RECONCILIATION_FAILED"
                    ? "Evidence mismatch detected during independent reconciliation. The transaction requires investigation."
                    : "Transaction requires attention or failed on-chain. Never retried automatically to prevent moving funds twice.",
              fundsLocation:
                workflowState === "SIGNER_REJECTION_PENDING"
                  ? "Locked in sBTC withdrawal contract pending registry confirmation of signer rejection. Funds return atomically upon rejection recording."
                  : `Workflow ${activeWorkflowId} in state ${workflowState}.`,
              recovery: [
                {
                  type: "resume",
                  label: "Continue bridging",
                  action: () => dismissWorkflow(activeWorkflowId),
                },
                {
                  type: "support",
                  label: "Copy workflow id",
                  action: () => void navigator.clipboard?.writeText(activeWorkflowId ?? ""),
                },
              ],
            }}
          />
        )}

        {showProgress ? (
          <div className="bridge-status" style={{ marginTop: "1rem" }}>
            <WorkflowArrivalView
              action={currentAction}
              state={workflowState ?? "SUBMITTED"}
              createdAt={workflowData?.createdAt}
              nextAction={workflowData?.nextAction ?? started?.nextAction}
              nowMs={nowMs}
              txid={trackedTxid}
              network="mainnet"
            />
          </div>
        ) : null}

        {pendingEmily !== null && (
          <div className="bridge-status" style={{ marginTop: "1rem" }}>
            <p className="warn">
              Bitcoin was sent as {pendingEmily.bitcoinTxid}. Emily still needs that transaction hex. Do not send again.
            </p>
            <button type="button" className="bridge-cta" disabled={notifying} onClick={() => void retryEmilyNotify()}>
              {notifying ? "Notifying Emily…" : "Notify Emily again"}
            </button>
          </div>
        )}
        {problem !== null && (
          <p className="error" role="alert" style={{ marginTop: "1rem" }}>
            {problem}
          </p>
        )}
      </BridgeShell>
      <BridgeSigners />
    </div>
  );
}
