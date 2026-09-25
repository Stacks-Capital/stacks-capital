import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  depositOutputAddress,
  depositOutputSats,
  fetchBitcoinTxHex,
  normalizeBitcoinTxHex,
  notifySbtcDeposit,
  p2wpkhSpendPublicKey,
  prepareSbtcDeposit,
  safeSatsNumber,
  schnorrPublicKey,
  SBTC_DEPOSIT_RECLAIM_LOCK_TIME,
  type SbtcDepositBridge,
} from "./sbtcDeposit.ts";

const OWNER = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const X_ONLY = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const COMPRESSED = `02${X_ONLY}`;
const SIGNERS = "3920f589c2b367400732d2dd61d11b300ad95b2b1bbf008eabcf8cddfee0c12c";

function fixtureEmily(status = "pending") {
  return {
    bitcoinTxid: "11".repeat(32),
    bitcoinTxOutputIndex: 0,
    recipient: OWNER,
    amount: "100000",
    lastUpdateHeight: 1,
    lastUpdateBlockHash: "22".repeat(32),
    status,
    statusMessage: "accepted for tracking",
    parameters: { lockTime: 144, maxFee: "1000" },
    reclaimScript: "ac",
    depositScript: "51",
    fulfillment: null,
    replacedByTx: null,
  };
}

function bridge(overrides: Partial<SbtcDepositBridge> = {}): SbtcDepositBridge {
  return {
    fetchSignersPublicKey: async () => SIGNERS,
    fetchTxHex: async () => "00",
    notifyEmily: async () => fixtureEmily(),
    ...overrides,
  };
}

describe("sBTC deposit construction", () => {
  it("reads the spend key and first output from a recovered Bitcoin deposit", () => {
    const tx = {
      vin: [{ witness: ["30", "020522f4a71f1913c18738f9c620db7d96b44998e633b54c4b1be5dddc11d076a4"] }],
      vout: [{ value: 1018, scriptpubkey_address: "bc1pjjdy7cp482t96s5ue06733t3t6s04hpn4m9rk8h04m8hka56kz8q624kqc" }],
    };
    assert.equal(p2wpkhSpendPublicKey(tx), "020522f4a71f1913c18738f9c620db7d96b44998e633b54c4b1be5dddc11d076a4");
    assert.equal(depositOutputSats(tx), "1018");
    assert.equal(depositOutputAddress(tx), "bc1pjjdy7cp482t96s5ue06733t3t6s04hpn4m9rk8h04m8hka56kz8q624kqc");
  });

  it("normalises compressed and x-only reclaim keys", () => {
    assert.equal(schnorrPublicKey(COMPRESSED), X_ONLY);
    assert.equal(schnorrPublicKey(`0x${X_ONLY}`), X_ONLY);
    assert.throws(() => schnorrPublicKey("zz"), /reclaim key/);
  });

  it("refuses the burn Stacks address as a mint destination", async () => {
    await assert.rejects(
      () =>
        prepareSbtcDeposit({
          network: "mainnet",
          stacksRecipient: "SP000000000000000000002Q6VF78",
          amountSats: "100000",
          maxSignerFeeSats: "1000",
          reclaimPublicKey: X_ONLY,
        }),
      /burn or test/,
    );
  });

  it("refuses testnet construction and notify", async () => {
    await assert.rejects(
      () =>
        prepareSbtcDeposit({
          network: "testnet",
          stacksRecipient: OWNER,
          amountSats: "100000",
          maxSignerFeeSats: "1000",
          reclaimPublicKey: X_ONLY,
        }),
      /mainnet only/,
    );
    await assert.rejects(
      () =>
        notifySbtcDeposit({
          network: "testnet",
          bitcoinTxid: "11".repeat(32),
          transactionHex: "00",
          depositScript: "51",
          reclaimScript: "ac",
          stacksRecipient: OWNER,
          amountSats: "100000",
          maxSignerFeeSats: "1000",
        }),
      /mainnet only/,
    );
  });

  it("builds a mainnet P2TR address from the official constructor and live-shaped signer key", async () => {
    const prepared = await prepareSbtcDeposit(
      {
        network: "mainnet",
        stacksRecipient: OWNER,
        amountSats: "100000",
        maxSignerFeeSats: "1000",
        reclaimPublicKey: COMPRESSED,
      },
      bridge(),
    );
    assert.equal(prepared.address.startsWith("bc1p"), true);
    assert.match(prepared.depositScript, /^[0-9a-f]+$/);
    assert.match(prepared.reclaimScript, /^[0-9a-f]+$/);
    assert.equal(prepared.signersPublicKey, SIGNERS);
    assert.equal(prepared.reclaimLockTime, SBTC_DEPOSIT_RECLAIM_LOCK_TIME);
    assert.equal(prepared.emilyNotifyPath, "/deposit");
    assert.equal(prepared.bitcoinNetwork, "mainnet");
  });

  it("notifies Emily with the certified payload and does not treat accepted as minted", async () => {
    let posted: unknown;
    const result = await notifySbtcDeposit(
      {
        network: "mainnet",
        bitcoinTxid: `0x${"11".repeat(32)}`,
        transactionHex: "00",
        depositScript: "51",
        reclaimScript: "ac",
        stacksRecipient: OWNER,
        amountSats: "100000",
        maxSignerFeeSats: "1000",
      },
      bridge({
        notifyEmily: async (body) => {
          posted = body;
          return fixtureEmily("accepted");
        },
      }),
    );
    assert.deepEqual(posted, {
      bitcoinTxid: "11".repeat(32),
      bitcoinTxOutputIndex: 0,
      reclaimScript: "ac",
      depositScript: "51",
      transactionHex: "00",
    });
    assert.equal(result.status, "accepted");
    assert.equal(result.fulfillment, null);
  });

  it("fails closed when Emily rejects the notify", async () => {
    await assert.rejects(
      () =>
        notifySbtcDeposit(
          {
            network: "mainnet",
            bitcoinTxid: "11".repeat(32),
            transactionHex: "00",
            depositScript: "51",
            reclaimScript: "ac",
            stacksRecipient: OWNER,
            amountSats: "100000",
            maxSignerFeeSats: "1000",
          },
          bridge({
            notifyEmily: async () => {
              throw new Error("Emily notify failed with HTTP 400");
            },
          }),
        ),
      /HTTP 400/,
    );
  });

  it("accepts mempool hex with a trailing newline and retries until the tx is visible", async () => {
    assert.equal(normalizeBitcoinTxHex("  0xAa\n"), "aa");
    assert.equal(normalizeBitcoinTxHex("Transaction not found"), null);
    const attempts: string[] = [];
    const hex = await fetchBitcoinTxHex("11".repeat(32), async (url) => {
      attempts.push(String(url));
      if (attempts.length < 2) {
        return new Response("Transaction not found", { status: 404 });
      }
      return new Response("00ff\n", { status: 200 });
    }, [0, 1]);
    assert.equal(hex, "00ff");
    assert.equal(attempts.length >= 2, true);
  });

  it("notifies Emily after fetching a padded hex from the bridge", async () => {
    const result = await notifySbtcDeposit(
      {
        network: "mainnet",
        bitcoinTxid: "11".repeat(32),
        depositScript: "51",
        reclaimScript: "ac",
        stacksRecipient: OWNER,
        amountSats: "100000",
        maxSignerFeeSats: "1000",
      },
      bridge({
        fetchTxHex: async () => "00FF\n",
      }),
    );
    assert.equal(result.bitcoinTxid, "11".repeat(32));
  });

  it("refuses to coerce an unsafe satoshi count into a JS number", () => {
    assert.equal(safeSatsNumber("1000", "amount"), 1000);
    assert.throws(() => safeSatsNumber("0", "amount"), /positive/);
    assert.throws(() => safeSatsNumber((BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(10), "amount"), /integer range/);
  });
});
