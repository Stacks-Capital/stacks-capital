import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AwaitingReconciliation, StoredEffect } from "@stacks-capital/database";
import { reconciliationDecision } from "./reconciliation.ts";

const SBTC = "stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token";
const ZSBTC = "stacks:mainnet:contract:SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc:zft";
const OWNER = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";

function workflow(overrides: Partial<AwaitingReconciliation> = {}): AwaitingReconciliation {
  return {
    workflowId: "wf_1",
    network: "mainnet",
    state: "STEP_CONFIRMED",
    transitionCount: 4,
    owner: OWNER,
    expectedOutput: [{ asset: ZSBTC, quantity: "1000" }],
    minimumOutput: { asset: ZSBTC, quantity: "990" },
    ...overrides,
  };
}

function credited(quantity: string, asset = ZSBTC, owner: string | null = OWNER): StoredEffect {
  return { kind: "zest_deposit", owner, direction: "in", assetId: asset, quantity };
}

describe("completing a workflow from what the chain emitted", () => {
  it("completes when the received amount is at or above the minimum the user signed", () => {
    const decision = reconciliationDecision({ workflow: workflow(), effects: [credited("1000")] });
    assert.equal(decision.result?.matched, true);
    assert.match(String(decision.result?.evidence), /received 1000/);
  });

  it("completes below the quote but above the floor, and says so rather than calling it a mismatch", () => {
    // The whole reason reconciliation cannot compare against the quote: a real execution lands
    // inside the band, not on the number.
    const decision = reconciliationDecision({ workflow: workflow(), effects: [credited("995")] });
    assert.equal(decision.result?.matched, true);
    assert.match(String(decision.result?.evidence), /under the 1000 quoted/);
  });

  it("refuses to complete below the signed minimum", () => {
    const decision = reconciliationDecision({ workflow: workflow(), effects: [credited("989")] });
    assert.equal(decision.result?.matched, false);
    assert.match(String(decision.result?.evidence), /below the signed minimum 990/);
  });

  it("waits rather than failing when no amounts have been attributed yet", () => {
    // An absent read is not evidence that nothing arrived.
    const decision = reconciliationDecision({ workflow: workflow(), effects: [] });
    assert.equal(decision.result, null);
    assert.match(decision.reason, /no attributed effects/);
  });

  it("does not accept a different asset as the expected output", () => {
    const decision = reconciliationDecision({ workflow: workflow(), effects: [credited("5000", SBTC)] });
    assert.equal(decision.result?.matched, false);
    assert.match(String(decision.result?.evidence), /no .* credited/);
  });

  it("ignores a credit that belongs to someone else", () => {
    const stranger = "SP3DYX83AXCQCRBV13B0R37N3TEYFA9J2D1JGGZ3S";
    const decision = reconciliationDecision({
      workflow: workflow(),
      effects: [credited("5000", ZSBTC, stranger)],
    });
    assert.equal(decision.result?.matched, false);
  });

  it("does not treat an outgoing amount as if it had been received", () => {
    const paid: StoredEffect = {
      kind: "zest_deposit",
      owner: OWNER,
      direction: "out",
      assetId: ZSBTC,
      quantity: "5000",
    };
    const decision = reconciliationDecision({ workflow: workflow(), effects: [paid] });
    assert.equal(decision.result?.matched, false);
  });

  it("adds up several credits of the same asset", () => {
    const decision = reconciliationDecision({
      workflow: workflow(),
      effects: [credited("600"), credited("400")],
    });
    assert.equal(decision.result?.matched, true);
  });

  it("records the quote as evidence when no minimum was signed, without enforcing it", () => {
    const decision = reconciliationDecision({
      workflow: workflow({ minimumOutput: null }),
      effects: [credited("10")],
    });
    assert.equal(decision.result?.matched, true);
    assert.match(String(decision.result?.evidence), /no signed minimum/);
  });

  it("waits when the quote records no expected output to check against", () => {
    const decision = reconciliationDecision({ workflow: workflow({ expectedOutput: [] }), effects: [credited("1")] });
    assert.equal(decision.result, null);
  });
});
