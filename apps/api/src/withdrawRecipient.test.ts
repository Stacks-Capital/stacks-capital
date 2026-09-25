import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "./errors.ts";
import { liveQuoteRecipient } from "./execution.ts";

describe("live withdraw recipient", () => {
  it("keeps the Stacks owner as the fallback for non-withdraw quotes", () => {
    assert.equal(liveQuoteRecipient("deposit_sbtc", undefined, "SPOWNER"), "SPOWNER");
    assert.equal(liveQuoteRecipient("deposit_sbtc", "SPMINT", "SPOWNER"), "SPMINT");
  });

  it("refuses a burn Stacks address as the sBTC mint destination", () => {
    assert.throws(() => liveQuoteRecipient("deposit_sbtc", "SP000000000000000000002Q6VF78", "SPOWNER"));
    assert.throws(() => liveQuoteRecipient("deposit_sbtc", undefined, "SP000000000000000000002Q6VF78"));
  });

  it("refuses a missing, Stacks, or placeholder Bitcoin payout on withdraw", () => {
    assert.throws(
      () => liveQuoteRecipient("withdraw_sbtc", undefined, "SPOWNER"),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_REQUEST",
    );
    assert.throws(() => liveQuoteRecipient("withdraw_sbtc", "SPOWNER", "SPOWNER"));
    assert.throws(() =>
      liveQuoteRecipient("withdraw_sbtc", "04:00112233445566778899aabbccddeeff00112233", "SPOWNER"),
    );
    assert.equal(
      liveQuoteRecipient("withdraw_sbtc", "04:751e76e8199196d454941c45d1b3a323f1433bd6", "SPOWNER"),
      "04:751e76e8199196d454941c45d1b3a323f1433bd6",
    );
  });
});
