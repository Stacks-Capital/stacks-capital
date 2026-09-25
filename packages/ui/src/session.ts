import type { CapitalClient, Session } from "@stacks-capital/client";
import { capitalError, type CapitalError, type StacksNetwork } from "@stacks-capital/core";
import { classifyWalletError, networkGuard, type WalletId } from "@stacks-capital/wallets";

export type ConnectedWallet = {
  id: WalletId;
  address: string;
  network: StacksNetwork;
  bitcoinAddress?: string;
  bitcoinPublicKey?: string;
  bitcoinWalletId?: WalletId;
};

/** Signs the exact text the API issued. The wallet, not this app, owns the key. */
export type MessageSigner = (message: string) => Promise<{ signature: string; publicKey: string }>;

export type SignInResult = { ok: true; session: Session } | { ok: false; error: CapitalError };

/**
 * Challenge, wallet signature, session. The wallet's network must match the client's, so a mainnet
 * wallet can never sign into a testnet app or the other way round (I02 finding).
 */
export async function signIn(
  client: CapitalClient,
  wallet: ConnectedWallet,
  sign: MessageSigner,
): Promise<SignInResult> {
  const mismatch = networkGuard(client.network, { stx: wallet.address });
  if (mismatch !== null) return { ok: false, error: mismatch };
  if (wallet.network !== client.network) {
    return { ok: false, error: capitalError("NETWORK_MISMATCH", `Wallet is on ${wallet.network}`) };
  }

  let message: string;
  let nonceId: string;
  try {
    const challenge = await client.challenge({ address: wallet.address });
    message = challenge.data.message;
    nonceId = challenge.data.nonceId;
  } catch (error) {
    return { ok: false, error: capitalError("PROVIDER_TIMEOUT", describe(error, "Could not start sign in")) };
  }

  let proof: { signature: string; publicKey: string };
  try {
    proof = await sign(message);
  } catch (error) {
    return { ok: false, error: capitalError(classifyWalletError(wallet.id, error), "The wallet did not sign") };
  }

  try {
    const verified = await client.verify({ nonceId, ...proof });
    return { ok: true, session: verified.data };
  } catch (error) {
    // A challenge is spent on the first attempt, so a failure here always means starting again.
    return { ok: false, error: capitalError("USER_REJECTED", describe(error, "Sign in was refused. Try again")) };
  }
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}
