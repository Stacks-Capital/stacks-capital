import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkflowRecord } from "@stacks-capital/database";
import { decideAndApplySbtcBridge, parseWithdrawalRequestId } from "./sbtcBridgeAdvance.ts";

const STACKS_TX = "39bad76ef1201d0638be770cf29ec74acc61e941f404f32d4b9cf5eb84de75af";
const ACCEPT_TX = "848242a1c475a3a7898e9578250f0f78e70de2f973d57b6f5f39c665fc9b518e";
const BTC_TX = "9bb76461000d68f1f646151cc9236ca2efcd2611386994adba82d05fff783f50";
const SCRIPT = "001400112233445566778899aabbccddeeff00112233";

function submittedWithdraw(): WorkflowRecord {
  return {
    id: "wf_c58007714223e66",
    network: "mainnet",
    state: "SUBMITTED",
    nextAction: "WAIT",
    quoteId: "q_1",
    planId: "p_1",
    action: "withdraw_sbtc",
    ownerAddress: "SP3XHHZ1CXVCNYXK3FQ1FDGJ9NK6YBJBJK1AH9G05",
    createdAt: new Date("2026-09-24T12:13:46.113Z"),
    updatedAt: new Date("2026-09-24T12:14:02.000Z"),
    transitions: [],
    attempts: [
      {
        stepId: "s0",
        chain: "stacks",
        outcome: "BROADCAST",
        txid: STACKS_TX,
        recordedAt: "2026-09-24T12:14:02.000Z",
      },
    ],
  };
}

function emilyConfirmed() {
  return {
    requestId: 3422,
    stacksBlockHash: "aa".repeat(32),
    stacksBlockHeight: 9053397,
    recipient: SCRIPT,
    sender: "SP3XHHZ1CXVCNYXK3FQ1FDGJ9NK6YBJBJK1AH9G05",
    amount: 1840,
    lastUpdateHeight: 9053918,
    lastUpdateBlockHash: "bb".repeat(32),
    status: "confirmed",
    statusMessage: "Included in block",
    parameters: { maxFee: 1000 },
    fulfillment: {
      BitcoinTxid: BTC_TX,
      BitcoinTxIndex: 3,
      StacksTxid: ACCEPT_TX,
      BitcoinBlockHash: "cc".repeat(32),
      BitcoinBlockHeight: 968400,
      BtcFee: 77,
    },
    expectedFulfillmentInfo: { bitcoinBlockHeight: 968400, bitcoinTxid: BTC_TX },
    txid: STACKS_TX,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("sBTC bridge SUBMITTED to COMPLETED", () => {
  it("reads the withdrawal request id from the Stacks result", () => {
    assert.equal(parseWithdrawalRequestId({ tx_result: { repr: "(ok u3422)" } }), "3422");
    assert.equal(
      parseWithdrawalRequestId({
        events: [{ event_type: "smart_contract_log", contract_log: { value: { repr: "(tuple (request-id u3422))" } } }],
      }),
      "3422",
    );
  });

  it("completes a withdrawal only after Emily, Bitcoin output, and accept-withdrawal-request agree", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes(`/tx/${STACKS_TX}`)) {
        return jsonResponse({
          tx_id: STACKS_TX,
          tx_status: "success",
          canonical: true,
          tx_result: { repr: "(ok u3422)" },
        });
      }
      if (url.endsWith("/withdrawal/3422")) return jsonResponse(emilyConfirmed());
      if (url.includes(`/tx/${BTC_TX}`) && url.includes("mempool")) {
        return jsonResponse({
          vout: [{}, {}, {}, { value: 1840, scriptpubkey: SCRIPT }],
          status: { confirmed: true, block_height: 968400, block_hash: "cc".repeat(32) },
        });
      }
      if (url.includes(`/tx/${ACCEPT_TX}`)) {
        return jsonResponse({
          tx_status: "success",
          contract_call: { function_name: "accept-withdrawal-request" },
        });
      }
      return jsonResponse({}, 404);
    };

    const after = await decideAndApplySbtcBridge(submittedWithdraw(), fetchImpl);
    assert.equal(after.state, "COMPLETED");
    assert.equal(after.nextAction, "COMPLETE");
    assert.deepEqual(
      after.transitions.map((move) => move.to),
      ["CONFIRMING", "STEP_CONFIRMED", "RECONCILING", "COMPLETED"],
    );
  });

  it("does not complete from the Stacks request or Emily HTTP alone", async () => {
    const stacksOnly: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes(`/tx/${STACKS_TX}`)) {
        return jsonResponse({
          tx_id: STACKS_TX,
          tx_status: "success",
          canonical: true,
          tx_result: { repr: "(ok u3422)" },
        });
      }
      if (url.endsWith("/withdrawal/3422")) {
        return jsonResponse({ ...emilyConfirmed(), status: "pending", fulfillment: null });
      }
      return jsonResponse({}, 404);
    };

    const afterStacks = await decideAndApplySbtcBridge(submittedWithdraw(), stacksOnly);
    assert.equal(afterStacks.state, "STEP_CONFIRMED");

    const emilyOnly: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes(`/tx/${STACKS_TX}`)) {
        return jsonResponse({
          tx_id: STACKS_TX,
          tx_status: "success",
          canonical: true,
          tx_result: { repr: "(ok u3422)" },
        });
      }
      if (url.endsWith("/withdrawal/3422")) return jsonResponse(emilyConfirmed());
      if (url.includes("mempool")) return jsonResponse({}, 404);
      return jsonResponse({}, 404);
    };
    const afterEmily = await decideAndApplySbtcBridge(submittedWithdraw(), emilyOnly);
    assert.equal(afterEmily.state, "STEP_CONFIRMED");
  });
});
