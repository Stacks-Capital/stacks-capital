export function truncateAddress(address: string | null | undefined, lead = 6, tail = 4): string {
  if (!address) return "";
  if (address.length <= lead + tail) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function formatBlockHeight(height: number | null | undefined): string {
  if (height === null || height === undefined || height <= 0) return "syncing…";
  return height.toLocaleString("en-US");
}

export type ViewMode = "simple" | "pro";

export const SHELL_NAV_TABS = [
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

export type ShellNavTab = (typeof SHELL_NAV_TABS)[number];

export type WorkflowProgress = { id: string; action?: string | null | undefined; state: string };

/**
 * One sentence for the live region. Reading every open workflow on every change is noise, so only the
 * newest one is announced, and an empty list announces nothing at all.
 */
export function workflowAnnouncement(workflows: readonly WorkflowProgress[]): string {
  const latest = workflows[0];
  if (latest === undefined) return "";
  const state = latest.state.toLowerCase().replaceAll("_", " ");
  return `${latest.action ?? "Workflow"} ${latest.id} is ${state}.`;
}

/**
 * A link the user can check the broadcast against themselves. The txid is never trusted as proof of
 * anything by the app, so this is a place to look, not a claim that the write landed.
 */
export function explorerTxUrl(txid: string, network: "mainnet" | "testnet"): string {
  return `https://explorer.hiro.so/txid/${encodeURIComponent(txid)}?chain=${network}`;
}

export function bitcoinExplorerTxUrl(txid: string, network: "mainnet" | "testnet"): string {
  const clean = txid.replace(/^0x/i, "");
  return network === "mainnet" ? `https://mempool.space/tx/${clean}` : `https://mempool.space/testnet/tx/${clean}`;
}
