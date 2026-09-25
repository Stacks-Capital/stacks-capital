import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  arrivalPhase,
  canCancelUnsignedWorkflow,
  describeWorkflowArrival,
  formatElapsedSince,
  typicalWaitLabel,
  workflowArrivalKind,
} from "./workflowTiming.ts";

describe("workflow arrival timing", () => {
  it("maps official sBTC actions to the destination chain", () => {
    assert.equal(workflowArrivalKind("deposit_sbtc"), "deposit");
    assert.equal(workflowArrivalKind("sbtc_deposit"), "deposit");
    assert.equal(workflowArrivalKind("withdraw_sbtc"), "withdraw");
    assert.equal(workflowArrivalKind("sbtc_withdrawal"), "withdraw");
    assert.equal(workflowArrivalKind("bitflow_swap"), "stacks");
    assert.equal(typicalWaitLabel("withdraw"), "1–3 hours");
    assert.equal(typicalWaitLabel("deposit"), "15–60 minutes");
  });

  it("does not start the arrival clock before a signature", () => {
    const arrival = describeWorkflowArrival({
      action: "deposit_sbtc",
      state: "AWAITING_SIGNATURE",
      createdAt: "2026-09-23T10:23:32.367Z",
      nowMs: Date.parse("2026-09-24T12:00:00.000Z"),
    });
    assert.equal(arrivalPhase("AWAITING_SIGNATURE"), "not_started");
    assert.equal(arrival.destination, "Stacks (sBTC)");
    assert.match(arrival.remaining, /after signing/i);
  });

  it("counts remaining time for a submitted withdrawal", () => {
    const started = Date.parse("2026-09-24T12:13:46.113Z");
    const arrival = describeWorkflowArrival({
      action: "withdraw_sbtc",
      state: "SUBMITTED",
      createdAt: "2026-09-24T12:13:46.113Z",
      nowMs: started + 30 * 60_000,
    });
    assert.equal(arrival.destination, "Bitcoin (BTC)");
    assert.equal(arrival.elapsed, "30 minutes");
    assert.match(arrival.remaining, /about 1h 30m remaining/);
    assert.match(arrival.note, /Stacks txid is not a payout/);
    assert.equal(arrival.steps[0]?.status, "current");
    assert.match(arrival.steps[1]?.label ?? "", /Bitcoin confirmations/);
    assert.equal(arrival.title, "sBTC → BTC withdraw");
    assert.match(arrival.headline, /Step 1 of 3/);
  });

  it("moves a withdrawal to Bitcoin confirmations after the Stacks request confirms", () => {
    const arrival = describeWorkflowArrival({
      action: "withdraw_sbtc",
      state: "STEP_CONFIRMED",
      createdAt: "2026-09-24T12:13:46.113Z",
      nowMs: Date.parse("2026-09-24T12:43:46.113Z"),
    });
    assert.equal(arrival.steps[0]?.status, "done");
    assert.equal(arrival.steps[1]?.status, "current");
    assert.equal(arrival.typicalWait, "1–3 hours");
    assert.match(arrival.headline, /Step 2 of 3/);
  });

  it("moves a deposit to mint after Bitcoin is confirmed", () => {
    const arrival = describeWorkflowArrival({
      action: "deposit_sbtc",
      state: "STEP_CONFIRMED",
      createdAt: "2026-09-25T10:00:39.080Z",
      nowMs: Date.parse("2026-09-25T10:28:00.000Z"),
    });
    assert.equal(arrival.steps[0]?.status, "done");
    assert.equal(arrival.steps[1]?.status, "done");
    assert.equal(arrival.steps[2]?.status, "current");
    assert.match(arrival.headline, /sBTC minted/i);
  });

  it("names deposit and withdraw stages in user language", () => {
    const deposit = describeWorkflowArrival({
      action: "deposit_sbtc",
      state: "SUBMITTED",
      createdAt: "2026-09-25T10:00:00.000Z",
      nowMs: Date.parse("2026-09-25T10:10:00.000Z"),
    });
    assert.equal(deposit.title, "BTC → sBTC deposit");
    assert.match(deposit.headline, /Bitcoin sent/i);
    assert.equal(deposit.steps[0]?.status, "current");
    const payout = describeWorkflowArrival({
      action: "withdraw_sbtc",
      state: "PAYOUT_CONFIRMING",
      createdAt: "2026-09-25T10:00:00.000Z",
      nowMs: Date.parse("2026-09-25T10:40:00.000Z"),
    });
    assert.equal(payout.steps[1]?.status, "current");
    assert.match(payout.stageTitle, /Bitcoin confirmations/i);
  });

  it("closes the clock once reconciled", () => {
    const arrival = describeWorkflowArrival({
      action: "withdraw_sbtc",
      state: "RECONCILED",
      createdAt: "2026-09-24T10:00:00.000Z",
      nowMs: Date.parse("2026-09-24T13:00:00.000Z"),
    });
    assert.equal(arrival.remaining, "Arrived — no remaining wait");
    assert.equal(arrival.phase, "arrived");
  });

  it("explains broadcast unknown instead of inventing an arrival clock", () => {
    const arrival = describeWorkflowArrival({
      action: "deposit_sbtc",
      state: "BROADCAST_UNKNOWN",
      createdAt: "2026-09-25T08:53:48.000Z",
      nowMs: Date.parse("2026-09-25T11:00:00.000Z"),
    });
    assert.equal(arrival.phase, "stopped");
    assert.match(arrival.remaining, /never returned a txid/i);
    assert.match(arrival.headline, /check Leather/i);
    assert.match(arrival.note, /Do not send again/);
    assert.equal(canCancelUnsignedWorkflow("BROADCAST_UNKNOWN"), false);
    assert.equal(canCancelUnsignedWorkflow("AWAITING_SIGNATURE"), true);
  });

  it("formats elapsed durations", () => {
    assert.equal(formatElapsedSince("2026-09-24T12:00:00.000Z", Date.parse("2026-09-24T12:00:20.000Z")), "less than a minute");
    assert.equal(formatElapsedSince("2026-09-24T12:00:00.000Z", Date.parse("2026-09-24T14:10:00.000Z")), "2 hours 10 min");
  });
});
