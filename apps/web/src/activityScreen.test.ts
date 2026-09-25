import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyWorkflowGroup,
  enrichWorkflows,
  formatWorkflowAction,
  formatWorkflowStatus,
  groupWorkflows,
  resolveWorkflowRecovery,
} from "./activityState.ts";
import type { WorkflowSummary } from "@stacks-capital/client";

describe("Activity & Durable Workflows State (I38)", () => {
  const mockWorkflows: WorkflowSummary[] = [
    {
      id: "wf_btc_dep_1",
      network: "mainnet",
      state: "reclaimable",
      nextAction: "reclaim",
      quoteId: null,
      planId: null,
      action: "sbtc_deposit",
      createdAt: "2026-09-22T10:00:00Z",
      updatedAt: "2026-09-22T11:00:00Z",
      transitionCount: 4,
    },
    {
      id: "wf_swap_expired",
      network: "mainnet",
      state: "expired",
      nextAction: "requote",
      quoteId: "q_123",
      planId: "p_123",
      action: "bitflow_swap",
      createdAt: "2026-09-22T12:00:00Z",
      updatedAt: "2026-09-22T12:05:00Z",
      transitionCount: 2,
    },
    {
      id: "wf_borrow_active",
      network: "mainnet",
      state: "confirming",
      nextAction: "poll_receipt",
      quoteId: null,
      planId: "p_456",
      action: "granite_borrow",
      createdAt: "2026-09-22T14:00:00Z",
      updatedAt: "2026-09-22T14:02:00Z",
      transitionCount: 3,
    },
    {
      id: "wf_zest_completed",
      network: "mainnet",
      state: "reconciled",
      nextAction: "none",
      quoteId: null,
      planId: "p_789",
      action: "zest_supply",
      createdAt: "2026-09-21T09:00:00Z",
      updatedAt: "2026-09-21T09:15:00Z",
      transitionCount: 5,
    },
  ];

  describe("Workflow Classification & Grouping", () => {
    it("classifies workflows into active, recovery_needed, and completed", () => {
      assert.equal(classifyWorkflowGroup("confirming"), "active");
      assert.equal(classifyWorkflowGroup("submitted"), "active");
      assert.equal(classifyWorkflowGroup("awaiting_signature"), "active");

      assert.equal(classifyWorkflowGroup("broadcast_unknown"), "recovery_needed");
      assert.equal(classifyWorkflowGroup("user_rejected"), "completed");

      assert.equal(classifyWorkflowGroup("reclaimable"), "recovery_needed");
      assert.equal(classifyWorkflowGroup("delayed"), "recovery_needed");
      assert.equal(classifyWorkflowGroup("expired"), "recovery_needed");
      assert.equal(classifyWorkflowGroup("failed"), "recovery_needed");

      assert.equal(classifyWorkflowGroup("reconciled"), "completed");
      assert.equal(classifyWorkflowGroup("completed"), "completed");
    });

    it("enriches and groups workflow items correctly", () => {
      const enriched = enrichWorkflows(mockWorkflows, "mainnet");
      assert.equal(enriched.length, 4);

      const grouped = groupWorkflows(enriched);
      assert.equal(grouped.active.length, 1);
      assert.equal(grouped.active[0]?.id, "wf_borrow_active");

      assert.equal(grouped.recovery_needed.length, 2);
      assert.equal(
        grouped.recovery_needed.some((w) => w.id === "wf_btc_dep_1"),
        true,
      );
      assert.equal(
        grouped.recovery_needed.some((w) => w.id === "wf_swap_expired"),
        true,
      );

      assert.equal(grouped.completed.length, 1);
      assert.equal(grouped.completed[0]?.id, "wf_zest_completed");
    });
  });

  describe("Recovery Action Resolution", () => {
    it("provides reclaim action for reclaimable sBTC deposit", () => {
      const btcWf = mockWorkflows[0];
      assert.ok(btcWf);
      const actions = resolveWorkflowRecovery(btcWf, "mainnet");
      assert.equal(actions.length > 0, true);
      const reclaim = actions.find((a) => a.type === "reclaim");
      assert.ok(reclaim);
      assert.equal(reclaim.executable, true);
      assert.match(reclaim.description, /lock height reached without canonical Stacks mint/i);
    });

    it("provides requote action for expired quote", () => {
      const swapWf = mockWorkflows[1];
      assert.ok(swapWf);
      const actions = resolveWorkflowRecovery(swapWf, "mainnet");
      assert.equal(actions.length > 0, true);
      const requote = actions.find((a) => a.type === "requote");
      assert.ok(requote);
      assert.equal(requote.executable, true);
      assert.match(requote.description, /expired/i);
    });

    it("provides canonical proof explorer link for completed/reconciled workflows", () => {
      const completedWf = mockWorkflows[3];
      assert.ok(completedWf);
      const actions = resolveWorkflowRecovery(completedWf, "mainnet");
      assert.equal(actions.length, 1);
      const proof = actions[0];
      assert.ok(proof);
      assert.equal(proof.type, "view_proof");
      assert.match(proof.targetHref ?? "", /explorer\.hiro\.so/);
      assert.match(proof.targetHref ?? "", /wf_zest_completed/);
    });
  });

  describe("Formatting Helpers", () => {
    it("formats known protocol actions into clear human descriptions", () => {
      assert.equal(formatWorkflowAction("sbtc_deposit"), "Bitcoin Deposit (BTC → sBTC)");
      assert.equal(formatWorkflowAction("deposit_sbtc"), "Bitcoin Deposit (BTC → sBTC)");
      assert.equal(formatWorkflowAction("sbtc_withdrawal"), "Bitcoin Withdrawal (sBTC → BTC)");
      assert.equal(formatWorkflowAction("withdraw_sbtc"), "Bitcoin Withdrawal (sBTC → BTC)");
      assert.equal(formatWorkflowAction("zest_supply"), "Zest Earn Supply");
      assert.equal(formatWorkflowAction("granite_borrow"), "Granite Borrow (USDCx)");
      assert.equal(formatWorkflowAction("bitflow_swap"), "Bitflow Swap");
    });

    it("assigns appropriate status tones", () => {
      assert.equal(formatWorkflowStatus("reconciled").tone, "success");
      assert.equal(formatWorkflowStatus("confirming").tone, "neutral");
      assert.equal(formatWorkflowStatus("reclaimable").tone, "warning");
      assert.equal(formatWorkflowStatus("failed").tone, "danger");
    });
  });
});
