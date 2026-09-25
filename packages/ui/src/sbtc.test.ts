import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeDeposit,
  assertSafeWithdrawPayout,
  bitcoinRecipientFromAddress,
  BURN_STACKS_RECIPIENTS,
  calculateDepositAccounting,
  calculateWithdrawalAccounting,
  findLatestSbtcWorkflow,
  loadIgnoredSbtcWorkflows,
  rememberIgnoredSbtcWorkflow,
  isAttemptBroadcastUnknown,
  isPlaceholderBtcRecipient,
  PLACEHOLDER_BTC_RECIPIENT,
  shouldResumeSbtcWorkflow,
  sbtcWorkflowBlocksComposer,
  stageForDeposit,
  stageForWithdrawal,
  depositStacksRecipientFromPlan,
  isPlaceholderStacksRecipient,
  validateBtcRecipient,
  withdrawRecipientFromPlan,
} from "./sbtc.ts";

describe("sBTC bridge and withdrawal UI utilities", () => {
  describe("stage mapping", () => {
    it("never badges incomplete deposit states as done", () => {
      assert.equal(stageForDeposit("SUBMITTED"), "confirming");
      assert.equal(stageForDeposit("CONFIRMING"), "confirming");
      assert.equal(stageForDeposit("SIGNER_PROCESSING"), "confirming");
      assert.equal(stageForDeposit("MINT_PENDING"), "confirming");
      assert.equal(stageForDeposit("RECLAIMABLE"), "reclaim");
      assert.equal(stageForDeposit("RECONCILING"), "confirming");
      assert.equal(stageForDeposit("RECONCILED"), "done");
      assert.equal(stageForDeposit("COMPLETED"), "done");
      assert.equal(stageForDeposit("BROADCAST_UNKNOWN"), "recovery");
      assert.equal(stageForDeposit("RECONCILIATION_FAILED"), "recovery");
    });

    it("maps withdrawal states correctly, treating signer failure as recovery", () => {
      assert.equal(stageForWithdrawal("AWAITING_SIGNATURE"), "signing");
      assert.equal(stageForWithdrawal("SUBMITTED"), "confirming");
      assert.equal(stageForWithdrawal("REQUEST_CONFIRMING"), "confirming");
      assert.equal(stageForWithdrawal("SIGNER_PROCESSING"), "confirming");
      assert.equal(stageForWithdrawal("PAYOUT_CONFIRMING"), "confirming");
      assert.equal(stageForWithdrawal("SIGNER_REJECTION_PENDING"), "recovery");
      assert.equal(stageForWithdrawal("RECONCILED"), "done");
      assert.equal(stageForWithdrawal("COMPLETED"), "done");
      assert.equal(stageForWithdrawal("BROADCAST_UNKNOWN"), "recovery");
      assert.equal(stageForWithdrawal("REJECTED"), "recovery");
    });
  });

  describe("recipient validation", () => {
    it("validates P2WPKH version 04 with 20-byte hash", () => {
      const valid = validateBtcRecipient("04:751e76e8199196d454941c45d1b3a323f1433bd6");
      assert.equal(valid.valid, true);
      assert.equal(valid.version, "04");
      assert.equal(valid.hashbytes, "751e76e8199196d454941c45d1b3a323f1433bd6");
    });

    it("validates P2TR version 06 with 32-byte hash", () => {
      const hash32 = "aa".repeat(32);
      const valid = validateBtcRecipient(`06:${hash32}`);
      assert.equal(valid.valid, true);
      assert.equal(valid.version, "06");
      assert.equal(valid.hashbytes, hash32);
    });

    it("rejects invalid versions or wrong length hashes", () => {
      assert.equal(validateBtcRecipient("").valid, false);
      assert.equal(validateBtcRecipient("not-a-recipient").valid, false);
      assert.equal(validateBtcRecipient("07:001122").valid, false); // version 07 not supported
      assert.equal(validateBtcRecipient("04:001122").valid, false); // too short for 04
      assert.equal(validateBtcRecipient("06:001122").valid, false); // too short for 06
    });

    it("encodes a connected P2WPKH address and refuses the fixture placeholder", () => {
      const encoded = bitcoinRecipientFromAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
      assert.ok(!("error" in encoded));
      assert.equal(encoded.recipient, "04:751e76e8199196d454941c45d1b3a323f1433bd6");
      assert.equal(validateBtcRecipient("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4").valid, true);
      assert.equal(validateBtcRecipient(PLACEHOLDER_BTC_RECIPIENT).valid, false);
      assert.equal(isPlaceholderBtcRecipient("bc1qqqgjyv6y24n80zye42aueh0wluqpzg3ndy2ehs"), true);
    });

    it("blocks signing when the plan payout is missing, placeholder, or not the address on screen", () => {
      const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
      const encoded = "04:751e76e8199196d454941c45d1b3a323f1433bd6";
      const plan = {
        steps: [
          {
            payload: {
              functionName: "initiate-withdrawal-request",
              functionArgs: [
                { type: "uint" },
                {
                  type: "tuple",
                  value: {
                    version: { type: "buff", hex: "04" },
                    hashbytes: { type: "buff", hex: "751e76e8199196d454941c45d1b3a323f1433bd6" },
                  },
                },
              ],
            },
          },
        ],
      };
      assert.deepEqual(withdrawRecipientFromPlan(plan), {
        version: "04",
        hashbytes: "751e76e8199196d454941c45d1b3a323f1433bd6",
      });
      assert.equal(
        assertSafeWithdrawPayout({
          encodedRecipient: encoded,
          destinationAddress: address,
          connectedBitcoinAddress: address,
          planRecipient: withdrawRecipientFromPlan(plan),
          confirmedForeignAddress: false,
        }).ok,
        true,
      );
      assert.equal(
        assertSafeWithdrawPayout({
          encodedRecipient: PLACEHOLDER_BTC_RECIPIENT,
          destinationAddress: PLACEHOLDER_BTC_RECIPIENT,
          connectedBitcoinAddress: address,
          planRecipient: { version: "04", hashbytes: "00112233445566778899aabbccddeeff00112233" },
          confirmedForeignAddress: true,
        }).ok,
        false,
      );
      assert.equal(
        assertSafeWithdrawPayout({
          encodedRecipient: encoded,
          destinationAddress: address,
          connectedBitcoinAddress: "bc1qdifferent",
          planRecipient: withdrawRecipientFromPlan(plan),
          confirmedForeignAddress: false,
        }).ok,
        false,
      );
    });

    it("blocks a deposit whose mint recipient or amount drifted from the connected wallet", () => {
      assert.equal(
        assertSafeDeposit({
          depositAddress: "bc1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq59t8w5",
          stacksRecipient: "SP123",
          preparedAmountSats: "1404",
          walletAddress: "SP123",
          amountSats: "1404",
          planRecipient: "SP123",
        }).ok,
        true,
      );
      assert.equal(
        assertSafeDeposit({
          depositAddress: "bc1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq59t8w5",
          stacksRecipient: "SPOTHER",
          preparedAmountSats: "1404",
          walletAddress: "SP123",
          amountSats: "1404",
        }).ok,
        false,
      );
      assert.equal(isPlaceholderStacksRecipient(BURN_STACKS_RECIPIENTS[0]), true);
      assert.equal(
        assertSafeDeposit({
          depositAddress: "bc1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq59t8w5",
          stacksRecipient: BURN_STACKS_RECIPIENTS[0],
          preparedAmountSats: "1404",
          walletAddress: BURN_STACKS_RECIPIENTS[0],
          amountSats: "1404",
        }).ok,
        false,
      );
      assert.equal(
        depositStacksRecipientFromPlan({
          steps: [{ payload: { kind: "bitcoin_deposit", stacksRecipient: "SP123" } }],
        }),
        "SP123",
      );
    });
  });

  describe("accounting calculations", () => {
    it("calculates deposit accounting accurately", () => {
      const acc = calculateDepositAccounting({ amountSats: "100000", maxFeeSats: "2000" });
      assert.equal(acc.depositAmountSats, "100000");
      assert.equal(acc.maxSignerFeeSats, "2000");
      assert.equal(acc.minExpectedSbtcSats, "98000");
    });

    it("shows a zero mint when the signer fee consumes the whole deposit", () => {
      const consumed = calculateDepositAccounting({ amountSats: "1000", maxFeeSats: "1000" });
      assert.equal(consumed.minExpectedSbtcSats, "0");
      const leftover = calculateDepositAccounting({ amountSats: "1000", maxFeeSats: "200" });
      assert.equal(leftover.minExpectedSbtcSats, "800");
    });

    it("calculates withdrawal accounting with initially locked and refund", () => {
      const acc = calculateWithdrawalAccounting({
        amountSats: "500000",
        maxFeeSats: "10000",
        actualFeeSats: "4000",
        bitcoinReceivedSats: "500000",
      });
      assert.equal(acc.withdrawalAmountSats, "500000");
      assert.equal(acc.maximumSignerFeeSats, "10000");
      assert.equal(acc.initiallyLockedSats, "510000");
      assert.equal(acc.actualSignerFeeSats, "4000");
      assert.equal(acc.finalSbtcDebitSats, "504000");
      assert.equal(acc.refundedSbtcSats, "6000");
      assert.equal(acc.bitcoinReceivedSats, "500000");
    });

    it("refuses negative fees or zero amounts", () => {
      assert.throws(() => calculateDepositAccounting({ amountSats: "0", maxFeeSats: "100" }), /positive/);
      assert.throws(() => calculateWithdrawalAccounting({ amountSats: "-1", maxFeeSats: "100" }), /positive/);
    });
  });

  describe("workflow discovery and broadcast safety", () => {
    it("finds the latest workflow by action", () => {
      const workflows = [
        {
          id: "wf_1",
          network: "mainnet" as const,
          state: "COMPLETED",
          nextAction: "DONE",
          quoteId: null,
          planId: null,
          action: "withdraw_sbtc",
          createdAt: "2026-09-20T10:00:00Z",
          updatedAt: "2026-09-20T11:00:00Z",
          transitionCount: 2,
        },
        {
          id: "wf_2",
          network: "mainnet" as const,
          state: "SUBMITTED",
          nextAction: "WAIT",
          quoteId: null,
          planId: null,
          action: "withdraw_sbtc",
          createdAt: "2026-09-21T10:00:00Z",
          updatedAt: "2026-09-21T11:00:00Z",
          transitionCount: 1,
        },
        {
          id: "wf_3",
          network: "mainnet" as const,
          state: "SUBMITTED",
          nextAction: "WAIT",
          quoteId: null,
          planId: null,
          action: "deposit_sbtc",
          createdAt: "2026-09-21T12:00:00Z",
          updatedAt: "2026-09-21T12:00:00Z",
          transitionCount: 1,
        },
      ];

      const latestWithdraw = findLatestSbtcWorkflow(workflows, "withdraw_sbtc");
      assert.equal(latestWithdraw?.id, "wf_2");

      const latestDeposit = findLatestSbtcWorkflow(workflows, "deposit_sbtc");
      assert.equal(latestDeposit?.id, "wf_3");
    });

    it("never resumes a prior workflow onto the bridge form, including failures", () => {
      for (const state of [
        "AWAITING_SIGNATURE",
        "QUOTED",
        "DRAFT",
        "SUBMITTED",
        "CONFIRMING",
        "SIGNER_PROCESSING",
        "COMPLETED",
        "RECONCILED",
        "BROADCAST_UNKNOWN",
        "RECLAIMABLE",
        "FAILED",
        "ACTION_REQUIRED",
      ]) {
        assert.equal(shouldResumeSbtcWorkflow(state), false, state);
        assert.equal(sbtcWorkflowBlocksComposer(state), false, state);
      }
      assert.equal(sbtcWorkflowBlocksComposer(null), false);
    });

    it("remembers a dismissed workflow id when sessionStorage is available", () => {
      const memory = new Map<string, string>();
      const previous = globalThis.sessionStorage;
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: {
          getItem: (key: string) => memory.get(key) ?? null,
          setItem: (key: string, value: string) => {
            memory.set(key, value);
          },
        },
      });
      try {
        rememberIgnoredSbtcWorkflow("wf_da27713688c");
        assert.deepEqual(loadIgnoredSbtcWorkflows(), ["wf_da27713688c"]);
      } finally {
        Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: previous });
      }
    });

    it("flags missing txid or unknown outcome as needing investigation", () => {
      assert.equal(isAttemptBroadcastUnknown(undefined), true);
      assert.equal(isAttemptBroadcastUnknown({ outcome: "UNKNOWN", txid: "0x123" }), true);
      assert.equal(isAttemptBroadcastUnknown({ outcome: "BROADCAST", txid: null }), true);
      assert.equal(isAttemptBroadcastUnknown({ outcome: "BROADCAST", txid: "" }), true);
      assert.equal(isAttemptBroadcastUnknown({ outcome: "BROADCAST", txid: "0xabc" }), false);
    });
  });
});
