/**
 * Illustrative fixtures for the app preview. Every number here is mock data behind a typed
 * interface, so it can be swapped for real SDK reads without touching the components.
 */

export type AppTab = { name: string; desc: string };

export const APP_TABS: readonly AppTab[] = [
  { name: "Overview", desc: "Portfolio, debt, verified earnings, canonical history and next actions." },
  {
    name: "Earn",
    desc: "Evidence-gated protocol comparison and automatic capital allocation. Drag the slider.",
  },
  {
    name: "Borrow",
    desc: "Plain-language safety first, with protocol parameters available in Advanced mode. Drag to see risk change.",
  },
  {
    name: "Swap",
    desc: "Executable exact-input route with enforced minimum output and quote expiry. Type an amount.",
  },
];

export const WALLET_CHIP = "SP2J…X9K4";

export const NET_VALUE = 5867.49;

export type HistoryBar = { id: string; height: number };

/** Bar heights as percentages. The last bar is the current observation. */
export const HISTORY_BARS: readonly HistoryBar[] = [42, 45, 44, 50, 53, 51, 58, 60, 57, 64, 68, 66, 72, 78].map(
  (height, index) => ({ id: `obs-${index + 1}`, height }),
);

export type Position = { name: string; sub: string; value: string; color: string };

export const POSITIONS: readonly Position[] = [
  { name: "Zest supply", sub: "0.05 sBTC · verified", value: "$3,000.00", color: "var(--color-purple)" },
  { name: "Bitflow LP", sub: "sBTC/STX · in range", value: "$1,850.12", color: "var(--color-orange)" },
  {
    name: "Hermetica sUSDh",
    sub: "provider-reported rewards",
    value: "$1,017.37",
    color: "var(--color-yellow)",
  },
];

export type AllocationRow = { name: string; rate: string; weight: number; apy: number; color: string };

export const EARN_ALLOCATION: readonly AllocationRow[] = [
  { name: "Zest lending", rate: "4.2%", weight: 0.5, apy: 0.042, color: "var(--color-purple)" },
  { name: "Bitflow liquidity", rate: "6.1%", weight: 0.3, apy: 0.061, color: "var(--color-orange)" },
  { name: "Hermetica rewards", rate: "7.8% · reported", weight: 0.2, apy: 0.078, color: "var(--color-yellow)" },
];

/** The BTC price the projection is illustrated against. */
export const BTC_PRICE = 60_000;

/** The sBTC to STX rate the swap preview is illustrated against. */
export const SWAP_RATE = 38_500;

/** Collateral value in USD, used to derive the illustrated health factor. */
export const COLLATERAL_USD = 1233;

export type HealthBand = { title: string; text: string; color: string; bg: string };

/** Ordered from safest. The first band whose floor the health factor clears is the one shown. */
export const HEALTH_BANDS: readonly (HealthBand & { floor: number })[] = [
  {
    floor: 1.4,
    title: "Comfortable",
    text: "Your collateral comfortably covers this loan. A moderate BTC price drop would not put you at risk.",
    color: "var(--color-green-dark)",
    bg: "rgba(31,157,85,0.1)",
  },
  {
    floor: 1.15,
    title: "Getting tight",
    text: "A sharp BTC price drop could push this position toward liquidation. Consider borrowing less.",
    color: "var(--color-amber-text)",
    bg: "rgba(255,209,102,0.25)",
  },
  {
    floor: 0,
    title: "At risk",
    text: "This loan is close to the liquidation threshold. stacks.capital will warn before you sign.",
    color: "var(--color-red-text)",
    bg: "rgba(229,72,77,0.12)",
  },
];

export type HeroAllocation = { name: string; sub: string; pct: string; color: string };

export const HERO_ALLOCATION: readonly HeroAllocation[] = [
  { name: "Zest lending", sub: "variable supply rate", pct: "40%", color: "var(--color-purple)" },
  { name: "Bitflow liquidity", sub: "fees + range risk", pct: "25%", color: "var(--color-orange)" },
  { name: "Hermetica rewards", sub: "current reward evidence", pct: "20%", color: "var(--color-yellow)" },
  { name: "Available balance", sub: "ready for the next move", pct: "15%", color: "var(--color-neutral-bar)" },
];

export const IN_SCOPE: readonly string[] = [
  "Protocol adapters and capability registry",
  "Evidence-gated reads, quotes and unsigned plans",
  "Durable workflow/recovery and canonical reconciliation",
  "Stacks Capital production frontend",
  "Partner SDK, hooks, components and example",
  "Security, accessibility, observability and release operations",
];

export const OUT_OF_SCOPE: readonly string[] = [
  "Pooled custodial strategy vaults",
  "Private-key custody or unrestricted signing",
  "Invented rates, prices, liquidity or history",
  "Guaranteed APY or liquidation prevention",
  "Permissionless arbitrary contract routing",
  "Automatic retry of uncertain writes",
];
