import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPreparedSbtcDeposit, emilyDepositIsComplete, schnorrPublicKey } from "./sbtcDeposit.ts";

describe("sBTC deposit SDK helpers", () => {
  it("normalises reclaim keys and refuses a missing P2TR address", () => {
    assert.equal(
      schnorrPublicKey("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    );
    const prepared = {
      address: "bc1pt6aahs3cxh5xs3sj4v72ep8ntgau5gw9p2cfqqkxw42hkq890g8s9edjwf",
      depositScript: "51",
      reclaimScript: "ac",
      signersPublicKey: "11".repeat(32),
      reclaimLockTime: 144,
      amountSats: "100000",
      maxSignerFeeSats: "1000",
      stacksRecipient: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
      bitcoinNetwork: "mainnet" as const,
      emilyNotifyPath: "/deposit" as const,
    };
    assert.equal(assertPreparedSbtcDeposit(prepared).address, prepared.address);
    assert.throws(() => assertPreparedSbtcDeposit({ ...prepared, address: "bc1qnottaproot" }), /P2TR/);
    assert.equal(
      emilyDepositIsComplete({
        bitcoinTxid: "22".repeat(32),
        bitcoinTxOutputIndex: 0,
        recipient: prepared.stacksRecipient,
        amount: "100000",
        status: "confirmed",
        statusMessage: "tracked",
        complete: false,
        parameters: { lockTime: 144, maxFee: "1000" },
      }),
      false,
    );
  });
});
