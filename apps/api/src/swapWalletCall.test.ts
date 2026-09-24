import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bitflowWalletCall } from "./swapWalletCall.ts";

const OWNER = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const USDCx = "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx";
const POOL = "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.dlmm-pool-stx-usdcx-v-1-bps-10";
const ROUTER = "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1";
const STX = "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2";

describe("Bitflow wallet call encoding", () => {
  it("encodes swap-simple-multi and replaces tx-sender with the owner", () => {
    const call = bitflowWalletCall(
      {
        function_name: "swap-simple-multi",
        swap_contract: ROUTER,
        swap_parameters_typed: [
          {
            type: "tuple",
            value: {
              amount: { type: "uint", value: "1000000" },
              "max-steps": { type: "uint", value: "1" },
              "min-received": { type: "uint", value: "304975" },
              "pool-trait": { type: "contract", value: POOL },
              "x-for-y": { type: "true", value: "true" },
              "x-token-trait": { type: "contract", value: STX },
              "y-token-trait": { type: "contract", value: USDCx },
            },
          },
        ],
        post_conditions: [
          {
            post_condition_type: "standard_stx",
            condition_code: "less_than_or_equal_to",
            sender_address: "tx-sender",
            amount: "1000000",
          },
          {
            post_condition_type: "contract_fungible",
            condition_code: "greater_than_or_equal_to",
            sender_address: POOL,
            token_contract: USDCx,
            token_asset_name: "usdcx-token",
            amount: "304975",
          },
        ],
      },
      OWNER,
    );
    assert.equal(call.contractId, ROUTER);
    assert.equal(call.functionName, "swap-simple-multi");
    assert.equal(call.functionArgs.length, 1);
    assert.match(call.functionArgs[0] ?? "", /^0x[0-9a-f]+$/i);
    assert.deepEqual(call.postConditions, [
      { type: "stx-postcondition", address: OWNER, condition: "lte", amount: "1000000" },
      {
        type: "ft-postcondition",
        address: POOL,
        condition: "gte",
        amount: "304975",
        asset: `${USDCx}::usdcx-token`,
      },
    ]);
  });

  it("refuses an unnamed SIP-010 asset instead of guessing", () => {
    assert.throws(
      () =>
        bitflowWalletCall(
          {
            function_name: "swap-simple-multi",
            swap_contract: ROUTER,
            swap_parameters_typed: [
              {
                type: "tuple",
                value: {
                  amount: { type: "uint", value: "1" },
                  "max-steps": { type: "uint", value: "1" },
                  "min-received": { type: "uint", value: "1" },
                  "pool-trait": { type: "contract", value: POOL },
                  "x-for-y": { type: "true", value: "true" },
                  "x-token-trait": { type: "contract", value: STX },
                  "y-token-trait": { type: "contract", value: USDCx },
                },
              },
            ],
            post_conditions: [
              {
                post_condition_type: "contract_fungible",
                condition_code: "greater_than_or_equal_to",
                sender_address: POOL,
                token_contract: USDCx,
                token_asset_name: "unknown",
                amount: "1",
              },
            ],
          },
          OWNER,
        ),
      /exact SIP-010 asset/,
    );
  });
});
