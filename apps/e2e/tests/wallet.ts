import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { hashMessage } from "@stacks/encryption";
import {
  getAddressFromPublicKey,
  privateKeyToPublic,
  publicKeyToHex,
  randomPrivateKey,
  signMessageHashRsv,
} from "@stacks/transactions";

/*
 * A stand in for Leather that behaves the way the real one did in I02. The browser sees
 * `window.LeatherProvider.request`, exactly where the app looks for Leather. Signing happens here,
 * in the test process, with a real key, so the API verifies a genuine signature.
 */

export type TransactionMode = "approve" | "reject" | "hang" | "no-txid";

export type FakeWallet = {
  address: string;
  /** What the next contract call answers with. */
  transactions: TransactionMode;
  /** Whether signing the sign in message is approved. */
  signIn: "approve" | "reject";
  calls: string[];
  /** Replaces the key, which is how a test switches to a different wallet. */
  switchAccount(): void;
};

// Leather's rejection, recorded in I02.
const REJECTED = { code: 4001, message: "User rejected the request" };

function newAccount() {
  const privateKey = randomPrivateKey();
  const publicKey = publicKeyToHex(privateKeyToPublic(privateKey));
  return { privateKey, publicKey, address: getAddressFromPublicKey(publicKey, "mainnet") };
}

export async function installWallet(page: Page): Promise<FakeWallet> {
  let account = newAccount();
  const wallet: FakeWallet = {
    get address() {
      return account.address;
    },
    transactions: "approve",
    signIn: "approve",
    calls: [],
    switchAccount() {
      account = newAccount();
    },
  };

  await page.exposeFunction("__capitalFakeWallet", async (method: string, params: { message?: string }) => {
    wallet.calls.push(method);
    if (method === "getAddresses") {
      return {
        addresses: [
          { symbol: "STX", address: account.address, publicKey: account.publicKey },
          {
            symbol: "BTC",
            type: "p2wpkh",
            address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
            publicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          },
        ],
      };
    }
    if (method === "stx_signMessage") {
      if (wallet.signIn === "reject") return { __error: REJECTED };
      const messageHash = Buffer.from(hashMessage(params.message ?? "")).toString("hex");
      return {
        signature: signMessageHashRsv({ messageHash, privateKey: account.privateKey }),
        publicKey: account.publicKey,
      };
    }
    if (method === "sendTransfer") {
      if (wallet.transactions === "reject") return { __error: REJECTED };
      if (wallet.transactions === "hang") return { __hang: true };
      if (wallet.transactions === "no-txid") return { transaction: `0x${randomBytes(16).toString("hex")}` };
      return { txid: randomBytes(32).toString("hex") };
    }
    if (method === "stx_callContract") {
      if (wallet.transactions === "reject") return { __error: REJECTED };
      // Hang in the page, not here. A never-settling exposeFunction call blocks the next
      // getAddresses after reload (seen on Pixel 7 as "leather returned no Stacks address").
      if (wallet.transactions === "hang") return { __hang: true };
      if (wallet.transactions === "no-txid") return { transaction: `0x${randomBytes(16).toString("hex")}` };
      return { txid: `0x${randomBytes(32).toString("hex")}` };
    }
    return { __error: { code: -32601, message: `Method not supported: ${method}` } };
  });

  await page.addInitScript(() => {
    const bridge = (window as unknown as { __capitalFakeWallet: (method: string, params: unknown) => Promise<unknown> })
      .__capitalFakeWallet;
    (window as unknown as Record<string, unknown>).LeatherProvider = {
      async request(method: string, params: unknown) {
        const answer = (await bridge(method, params)) as { __error?: unknown; __hang?: boolean } | null;
        if (answer !== null && typeof answer === "object" && "__error" in answer) throw answer.__error;
        if (answer !== null && typeof answer === "object" && "__hang" in answer) return new Promise(() => {});
        return answer;
      },
    };
  });

  return wallet;
}
