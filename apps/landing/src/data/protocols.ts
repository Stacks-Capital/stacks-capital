export type Protocol = {
  name: string;
  /** Panel background and the text colour that reads on it. */
  bg: string;
  fg: string;
  capabilities: string;
  capNames: readonly string[];
};

export const PROTOCOLS: readonly Protocol[] = [
  {
    name: "sBTC",
    bg: "var(--color-purple)",
    fg: "var(--color-paper)",
    capabilities: "BTC deposit; sBTC withdrawal, via official deployed contracts and signer services.",
    capNames: ["Deposit"],
  },
  {
    name: "Zest",
    bg: "var(--color-orange)",
    fg: "var(--color-ink)",
    capabilities: "Supply, withdraw, collateral, borrow and repay against canonical reads.",
    capNames: ["Supply", "Borrow"],
  },
  {
    name: "Bitflow",
    bg: "var(--color-yellow)",
    fg: "var(--color-ink)",
    capabilities: "Exact-input swaps, add/remove liquidity and fee claims via allowlisted pools.",
    capNames: ["Swap", "Liquidity"],
  },
  {
    name: "Hermetica",
    bg: "var(--color-ink)",
    fg: "var(--color-paper)",
    capabilities: "Stake and unstake USDH/sUSDh with disclosed reward evidence.",
    capNames: ["Stake"],
  },
  {
    name: "Granite",
    bg: "var(--color-green-dark)",
    fg: "var(--color-paper)",
    capabilities: "Supported lending and borrowing lifecycle on deployed contracts.",
    capNames: ["Supply", "Borrow"],
  },
  {
    name: "Stacking providers",
    bg: "var(--color-purple-tint)",
    fg: "var(--color-ink)",
    capabilities: "STX stacking and verified staking routes via StackingDAO and other verified deployments.",
    capNames: ["Stake"],
  },
];
