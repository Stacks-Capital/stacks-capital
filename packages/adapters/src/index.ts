export type {
  ActionSemantics,
  AdapterSemantics,
  AdapterContext,
  Intent,
  Market,
  Position,
  ProtocolAdapter,
  Reconciliation,
  RiskExplanation,
  SemanticAsset,
} from "./types.ts";
export type {
  AdapterCertificationFixture,
  AdapterCertificationReport,
  ExpectedAmount,
  PlanExpectation,
  QuoteExpectation,
} from "./certification.ts";
export { assertAdapterCertified, certifyAdapter } from "./certification.ts";
export { ADAPTER_CERTIFICATION_FIXTURES, certifyBuiltinAdapters } from "./certificationFixtures.ts";
export type {
  AdapterReads,
  EmilyLimits,
  OracleSnapshot,
  PositionSnapshot,
  RiskParamSnapshot,
  SwapSnapshot,
  VaultSnapshot,
} from "./reads.ts";
export { createSbtcDepositAdapter, SBTC_DEPOSIT_VERSION, SBTC_MARKET_DEPOSIT } from "./sbtc/deposit.ts";
export {
  createEmilyDepositNotification,
  EMILY_DEPOSIT_STATUSES,
  evaluateSbtcDeposit,
  fetchEmilyDeposit,
  parseEmilyDeposit,
  sbtcDepositTransferId,
} from "./sbtc/depositLifecycle.ts";
export type {
  BitcoinDepositObservation,
  CanonicalDepositMint,
  EmilyDeposit,
  EmilyDepositStatus,
  EmilyFetch,
  SbtcDepositLifecycle,
  SbtcDepositMetadata,
  SbtcDepositState,
} from "./sbtc/depositLifecycle.ts";
export {
  createSbtcWithdrawAdapter,
  SBTC_MARKET_WITHDRAW,
  SBTC_WITHDRAW_VERSION,
  WITHDRAWAL_DUST,
} from "./sbtc/withdraw.ts";
export {
  EMILY_WITHDRAWAL_STATUSES,
  evaluateSbtcWithdrawal,
  fetchEmilyWithdrawal,
  parseEmilyWithdrawal,
  sbtcWithdrawalAvailability,
  sbtcWithdrawalTransferId,
  withdrawalRecipientScript,
} from "./sbtc/withdrawalLifecycle.ts";
export type {
  BitcoinPayoutObservation,
  CanonicalWithdrawalCompletion,
  CanonicalWithdrawalRequest,
  EmilyWithdrawal,
  EmilyWithdrawalStatus,
  SbtcWithdrawalLifecycle,
  SbtcWithdrawalMetadata,
  SbtcWithdrawalState,
} from "./sbtc/withdrawalLifecycle.ts";
export { createZestEarnAdapter, ZEST_EARN_VERSION, ZEST_MARKET_SBTC } from "./zest/earn.ts";
export {
  assetsForShares,
  evaluateZestEarn,
  sharesForAssets,
  valueZestReceipt,
  vaultMarketFromSnapshot,
  zestEarnTransferId,
  zestSupplyApr,
  ZEST_RATE_SCALE,
} from "./zest/earnLifecycle.ts";
export type {
  CanonicalVaultSettlement,
  ObservedShareBalance,
  ZestEarnAction,
  ZestEarnIntent,
  ZestEarnLifecycle,
  ZestEarnState,
  ZestReceiptValuation,
  ZestSupplyApr,
  ZestVaultMarketEvidence,
} from "./zest/earnLifecycle.ts";
export {
  evaluateZestCredit,
  zestCreditAvailability,
  zestCreditTransferId,
  ZEST_CREDIT_ACTIONS,
} from "./zest/creditLifecycle.ts";
export type {
  ZestCreditAction,
  ZestCreditAvailability,
  ZestCreditLifecycle,
} from "./zest/creditLifecycle.ts";
export { createGraniteCreditAdapter, GRANITE_CREDIT_VERSION, GRANITE_MARKET_ISOLATED } from "./granite/credit.ts";
export {
  evaluateGraniteCredit,
  graniteContracts,
  graniteCreditTransferId,
  marketFromReads,
  settleGraniteRepay,
  GRANITE_RATE_SCALE,
} from "./granite/creditLifecycle.ts";
export type {
  CanonicalGraniteSettlement,
  GraniteCreditAction,
  GraniteCreditIntent,
  GraniteCreditLifecycle,
  GraniteCreditState,
  GraniteMarketEvidence,
  GranitePositionEvidence,
} from "./granite/creditLifecycle.ts";
export {
  createBitflowSwapAdapter,
  BITFLOW_MARKET_SBTC_USDCX,
  BITFLOW_SWAP_VERSION,
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
} from "./bitflow/swap.ts";
export {
  assertBitflowRoute,
  bitflowSwapTransferId,
  evaluateBitflowSwap,
  previewBitflowMinOut,
  BITFLOW_DEFAULT_SLIPPAGE_BPS,
} from "./bitflow/swapLifecycle.ts";
export type {
  BitflowSwapIntent,
  BitflowSwapLifecycle,
  BitflowSwapState,
  CanonicalBitflowSettlement,
} from "./bitflow/swapLifecycle.ts";
export { evaluateStaking, stakingAvailability, STAKING_ACTIONS } from "./staking/lifecycle.ts";
export type { StakingAction, StakingAvailability, StakingLifecycle } from "./staking/lifecycle.ts";

export { eventDecodingAdapters } from "./eventDecoders.ts";
export { assetForPrincipal } from "./events.ts";
