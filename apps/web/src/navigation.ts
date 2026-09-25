import type { StacksNetwork } from "@stacks-capital/core";
import type { WalletId } from "@stacks-capital/wallets";

export const NAV_TABS = [
  "Overview",
  "Bridge",
  "Earn",
  "Borrow",
  "Swap",
  "Liquidity",
  "Staking",
  "Positions",
  "Risk",
  "Activity",
] as const;

export type NavTab = (typeof NAV_TABS)[number] | "Portfolio";

export const STORAGE_TAB_KEY = "stacks-capital:active_tab";
export const STORAGE_SESSION_PREFIX = "stacks-capital:session:";

const LEGACY_NAV_TABS: Record<string, NavTab> = {
  "Deposit BTC": "Bridge",
};

function resolveTab(value: string | null): NavTab | null {
  if (value === null) return null;
  if (NAV_TABS.includes(value as (typeof NAV_TABS)[number]) || value === "Portfolio") return value as NavTab;
  return LEGACY_NAV_TABS[value] ?? null;
}

export function getInitialTab(urlSearch?: string, storage?: { getItem: (k: string) => string | null }): NavTab {
  try {
    const search = urlSearch ?? (typeof window !== "undefined" ? window.location.search : "");
    const fromUrl = resolveTab(new URLSearchParams(search).get("tab"));
    if (fromUrl !== null) return fromUrl;
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    const fromStore = resolveTab(store?.getItem(STORAGE_TAB_KEY) ?? null);
    if (fromStore !== null) return fromStore;
  } catch {
    // Storage unavailable in private browsing
  }
  return "Overview";
}

export type StoredSession = {
  address: string;
  token: string;
  walletId: WalletId;
  bitcoinAddress?: string;
  bitcoinPublicKey?: string;
  bitcoinWalletId?: WalletId;
};

export function getInitialSession(
  network: StacksNetwork,
  storage?: { getItem: (k: string) => string | null },
): StoredSession | null {
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    const raw = store?.getItem(`${STORAGE_SESSION_PREFIX}${network}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore storage read failures
  }
  return null;
}
