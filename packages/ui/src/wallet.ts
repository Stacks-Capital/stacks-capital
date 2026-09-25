import { stacksAddressNetwork, type StacksNetwork } from "@stacks-capital/core";
import type { WalletId } from "@stacks-capital/wallets";
import type { ConnectedWallet, MessageSigner } from "./session.ts";

export type WalletProvider = { request(method: string, params?: unknown): Promise<unknown> };

// I02: Xverse answers Stacks methods on BitcoinProvider, and its wallet_connect only accepts capitalised networks.
const XVERSE_NETWORK: Record<StacksNetwork, string> = { mainnet: "Mainnet", testnet: "Testnet" };

export function findProvider(id: WalletId, root: Record<string, unknown> = globalThis as never): WalletProvider | null {
  const candidate =
    id === "leather"
      ? (root.LeatherProvider ?? (root.btc as Record<string, unknown> | undefined))
      : ((root.XverseProviders as Record<string, unknown> | undefined)?.BitcoinProvider ?? root.XverseProviders);
  return typeof (candidate as WalletProvider | undefined)?.request === "function"
    ? (candidate as WalletProvider)
    : null;
}

export function installedWallets(root?: Record<string, unknown>): WalletId[] {
  return (["leather", "xverse"] as const).filter((id) => findProvider(id, root) !== null);
}

/** Wallets answer in several shapes, so the Stacks address is found by what it is, not by where it sits. */
export function findStacksAddress(payload: unknown, seen = new Set<unknown>()): string | null {
  if (typeof payload === "string") return stacksAddressNetwork(payload) === null ? null : payload;
  if (typeof payload !== "object" || payload === null || seen.has(payload)) return null;
  seen.add(payload);
  for (const value of Object.values(payload as Record<string, unknown>)) {
    const found = findStacksAddress(value, seen);
    if (found !== null) return found;
  }
  return null;
}

export async function connectWallet(
  id: WalletId,
  network: StacksNetwork,
  provider: WalletProvider | null = findProvider(id),
): Promise<ConnectedWallet> {
  if (provider === null) throw new Error(`${id} is not installed`);
  const answer =
    id === "xverse"
      ? await provider.request("wallet_connect", {
          addresses: ["stacks", "bitcoin"],
          network: XVERSE_NETWORK[network],
        })
      : await provider.request("getAddresses", { network });

  const address = findStacksAddress(answer);
  if (address === null) throw new Error(`${id} returned no Stacks address`);
  const walletNetwork = stacksAddressNetwork(address);
  if (walletNetwork === null) throw new Error(`${id} returned an address this app cannot read`);
  if (walletNetwork !== network) {
    throw new Error(`${id} is on ${walletNetwork}. Switch the wallet to ${network} and connect again.`);
  }
  const bitcoin = findBitcoinPayment(answer);
  return {
    id,
    address,
    network: walletNetwork,
    ...(bitcoin === null
      ? {}
      : { bitcoinAddress: bitcoin.address, bitcoinPublicKey: bitcoin.publicKey, bitcoinWalletId: id }),
  };
}

export async function connectBitcoinWallet(
  id: WalletId,
  network: StacksNetwork,
  provider: WalletProvider | null = findProvider(id),
): Promise<BitcoinPayment & { walletId: WalletId }> {
  if (provider === null) throw new Error(`${id} is not installed`);
  const answer =
    id === "xverse"
      ? await provider.request("wallet_connect", {
          addresses: ["bitcoin"],
          network: XVERSE_NETWORK[network],
        })
      : await provider.request("getAddresses", { network });
  const bitcoin = findBitcoinPayment(answer);
  if (bitcoin === null) {
    throw new Error(`${id} returned no Bitcoin payment address. Approve Bitcoin access in the wallet and try again.`);
  }
  return { ...bitcoin, walletId: id };
}

export type BitcoinPayment = { address: string; publicKey: string };

const BTC_ADDRESS = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,90}$/;
const BTC_PUBLIC_KEY = /^(?:0x)?(?:0[23][0-9a-fA-F]{64}|[0-9a-fA-F]{64})$/;

function asBitcoinPayment(record: Record<string, unknown>): BitcoinPayment | null {
  const address = typeof record.address === "string" ? record.address : null;
  const publicKey = typeof record.publicKey === "string" ? record.publicKey : null;
  if (address === null || publicKey === null) return null;
  if (!BTC_ADDRESS.test(address) || !BTC_PUBLIC_KEY.test(publicKey)) return null;
  const symbol = typeof record.symbol === "string" ? record.symbol.toUpperCase() : "";
  const purpose = typeof record.purpose === "string" ? record.purpose : "";
  if (symbol !== "" && symbol !== "BTC") return null;
  if (purpose !== "" && purpose !== "payment") return null;
  return { address, publicKey };
}

function bitcoinPaymentRank(record: Record<string, unknown>): number {
  const purpose = typeof record.purpose === "string" ? record.purpose : "";
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  if (purpose === "payment" || type === "p2wpkh") return 0;
  if (type === "p2tr") return 1;
  return 2;
}

function collectBitcoinPayments(payload: unknown, seen = new Set<unknown>()): Array<BitcoinPayment & { rank: number }> {
  if (typeof payload !== "object" || payload === null || seen.has(payload)) return [];
  seen.add(payload);
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => collectBitcoinPayments(item, seen));
  }
  const record = payload as Record<string, unknown>;
  const own = asBitcoinPayment(record);
  const rest = Object.values(record).flatMap((value) => collectBitcoinPayments(value, seen));
  return own === null ? rest : [{ ...own, rank: bitcoinPaymentRank(record) }, ...rest];
}

/** Finds the Bitcoin payment address and reclaim public key without inventing one. */
export function findBitcoinPayment(payload: unknown): BitcoinPayment | null {
  const found = collectBitcoinPayments(payload).sort((left, right) => left.rank - right.rank)[0];
  return found === undefined ? null : { address: found.address, publicKey: found.publicKey };
}

export function messageSigner(id: WalletId, provider: WalletProvider | null = findProvider(id)): MessageSigner {
  return async (message: string) => {
    if (provider === null) throw new Error(`${id} is not installed`);
    const answer = (await provider.request("stx_signMessage", { message })) as {
      signature?: string;
      publicKey?: string;
      result?: { signature?: string; publicKey?: string };
    };
    const signature = answer.signature ?? answer.result?.signature;
    const publicKey = answer.publicKey ?? answer.result?.publicKey;
    if (signature === undefined || publicKey === undefined) throw new Error(`${id} returned no signature`);
    return { signature, publicKey };
  };
}
