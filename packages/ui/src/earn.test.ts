import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanStep, Quote } from "@stacks-capital/client";
import { canSign, clearPending, loadPending, pendingKey, reviewQuote, savePending, stageFor } from "./earn.ts";
import { askWallet, askWalletCall, encodePostCondition, toWalletCallRequest, toWalletRequest } from "./signing.ts";

const SBTC = "stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token";
const NOW = new Date("2026-09-18T12:00:00.000Z");
const OWNER = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";

const QUOTE: Quote = {
  id: "q_1",
  action: "supply",
  marketId: "zest.sbtc.vault",
  network: "mainnet",
  input: [{ asset: SBTC, quantity: "100000" }],
  expectedOutput: [{ asset: SBTC, quantity: "99000" }],
  fees: [{ kind: "protocol", amount: { asset: SBTC, quantity: "1000" } }],
  snapshots: [],
  warnings: [],
  executable: true,
  expiresAt: "2026-09-18T12:01:00.000Z",
  registryVersion: "0.1.0",
  adapterVersion: "zest-earn@0.1.0",
};

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    size: () => map.size,
  };
}

describe("stages", () => {
  it("follow the workflow state, not the screen", () => {
    assert.equal(stageFor(null), "review");
    assert.equal(stageFor("QUOTED"), "review");
    assert.equal(stageFor("AWAITING_SIGNATURE"), "signing");
    assert.equal(stageFor("SUBMITTED"), "confirming");
    assert.equal(stageFor("CONFIRMING"), "confirming");
    assert.equal(stageFor("COMPLETED"), "done");
  });

  it("send anything needing a human to recovery, including states this app does not know", () => {
    for (const state of ["BROADCAST_UNKNOWN", "ACTION_REQUIRED", "MANUAL_REVIEW", "REORGED", "SOMETHING_NEW"]) {
      assert.equal(stageFor(state), "recovery", state);
    }
  });
});

describe("resuming after a reload", () => {
  const scope = { network: "mainnet", address: OWNER } as const;

  it("remembers the pending step per network and address", () => {
    const storage = memoryStorage();
    savePending(storage, scope, { workflowId: "wf_1", stepId: "step_1" });
    assert.deepEqual(loadPending(storage, scope), { workflowId: "wf_1", stepId: "step_1" });

    // Another address and another network are different keys, so neither sees it.
    assert.equal(loadPending(storage, { network: "mainnet", address: "SP_OTHER" }), null);
    assert.equal(loadPending(storage, { network: "testnet", address: OWNER }), null);
    assert.notEqual(pendingKey(scope), pendingKey({ network: "testnet", address: OWNER }));
  });

  it("isolates pending workflow by tenant, network and address", () => {
    const storage = memoryStorage();
    const tenantScope = { network: "mainnet" as const, address: OWNER, tenantId: "tenant_partner_1" };
    const otherTenantScope = { network: "mainnet" as const, address: OWNER, tenantId: "tenant_partner_2" };
    const defaultScope = { network: "mainnet" as const, address: OWNER };

    savePending(storage, tenantScope, { workflowId: "wf_tenant_1", stepId: "step_1" });
    assert.deepEqual(loadPending(storage, tenantScope), { workflowId: "wf_tenant_1", stepId: "step_1" });
    assert.equal(loadPending(storage, otherTenantScope), null);
    assert.equal(loadPending(storage, defaultScope), null);

    assert.equal(pendingKey(tenantScope), `stacks-capital:pending:tenant_partner_1:mainnet:${OWNER}`);
    assert.equal(pendingKey(otherTenantScope), `stacks-capital:pending:tenant_partner_2:mainnet:${OWNER}`);
    assert.equal(pendingKey(defaultScope), `stacks-capital:pending:mainnet:${OWNER}`);
  });

  it("forgets it when the flow is finished", () => {
    const storage = memoryStorage();
    savePending(storage, scope, { workflowId: "wf_1", stepId: "step_1" });
    clearPending(storage, scope);
    assert.equal(loadPending(storage, scope), null);
  });

  it("survives storage that is missing, broken or holds nonsense", () => {
    assert.equal(loadPending(null, scope), null);
    savePending(null, scope, { workflowId: "wf_1", stepId: "step_1" });

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    assert.equal(loadPending(broken, scope), null);
    savePending(broken, scope, { workflowId: "wf_1", stepId: "step_1" });
    clearPending(broken, scope);

    const nonsense = memoryStorage();
    nonsense.setItem(pendingKey(scope), "{not json");
    assert.equal(loadPending(nonsense, scope), null);
    nonsense.setItem(pendingKey(scope), JSON.stringify({ workflowId: 7 }));
    assert.equal(loadPending(nonsense, scope), null);
  });
});

describe("review", () => {
  it("shows amounts, fees and how long the quote has left", () => {
    const view = reviewQuote(QUOTE, NOW);
    assert.equal(view.input, `100000 ${SBTC}`);
    assert.equal(view.expected, `99000 ${SBTC}`);
    assert.deepEqual(view.fees, [{ kind: "protocol", amount: `1000 ${SBTC}` }]);
    assert.equal(view.expiresInSeconds, 60);
    assert.equal(view.expired, false);
    assert.equal(canSign(view), true);
  });

  it("refuses to sign an expired quote or one the market cannot execute", () => {
    const expired = reviewQuote(QUOTE, new Date("2026-09-18T12:01:30.000Z"));
    assert.equal(expired.expired, true);
    assert.equal(expired.expiresInSeconds, 0);
    assert.equal(canSign(expired), false);

    const blocked = reviewQuote({ ...QUOTE, executable: false, warnings: ["vault is paused"] }, NOW);
    assert.deepEqual(blocked.warnings, ["vault is paused"]);
    assert.equal(canSign(blocked), false);
  });
});

describe("what the wallet is asked to sign", () => {
  const allowed = { ok: true, reasons: [] as string[] };
  const step: PlanStep = {
    id: "step_1",
    payload: {
      kind: "stacks_contract_call",
      contractId: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc",
      functionName: "deposit",
      functionArgs: [
        { type: "uint", value: "100000" },
        { type: "principal", value: OWNER },
        { type: "some", value: { type: "uint", value: "1" } },
        { type: "none" },
      ],
      postConditions: [{ principal: OWNER, mode: "send_lte", amount: { asset: SBTC, quantity: "100000" } }],
      postConditionMode: "deny",
      network: "mainnet",
    },
    expectedAssetEffects: [],
    dependsOn: [],
  };

  it("passes the plan through unchanged, with encoded arguments", () => {
    const request = toWalletRequest(step, allowed);
    assert.equal(request.method, "stx_callContract");
    assert.equal(request.params.contract, "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc");
    assert.equal(request.params.functionName, "deposit");
    assert.equal(request.params.functionArgs.length, 4);
    assert.ok(request.params.functionArgs.every((argument) => /^0x[0-9a-f]+$/.test(argument)));
    assert.equal(request.params.postConditionMode, "deny");
    assert.ok(request.params.postConditions.every((condition) => /^[0-9a-f]+$/i.test(condition)));
  });

  it("keeps the post conditions that protect the user", () => {
    const [protection] = step.payload.postConditions as {
      principal: string;
      mode: "send_lte";
      amount: { asset: string; quantity: string };
    }[];
    assert.deepEqual(encodePostCondition(protection as never), {
      type: "ft-postcondition",
      address: OWNER,
      condition: "lte",
      amount: "100000",
      asset: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
    });
    assert.deepEqual(
      encodePostCondition({
        principal: OWNER,
        mode: "send_eq",
        amount: { asset: "stacks:mainnet:native:stx", quantity: "500" },
      }),
      { type: "stx-postcondition", address: OWNER, condition: "eq", amount: "500" },
    );
  });

  it("refuses a step it cannot sign rather than sending something else", () => {
    const bitcoin: PlanStep = { ...step, payload: { kind: "bitcoin_deposit" } };
    assert.throws(() => toWalletRequest(bitcoin, allowed), /only sign Stacks contract calls/);
  });

  it("refuses to build a wallet request when SDK validation failed", () => {
    assert.throws(() => toWalletRequest(step, { ok: false, reasons: ["tampered"] }), /failed SDK validation/);
  });
});

describe("asking the wallet", () => {
  const request = { method: "stx_callContract" as const, params: {} as never };
  const allowed = { ok: true, reasons: [] as string[] };

  it("passes an answer through", async () => {
    const answer = await askWallet({ request: async () => ({ txid: "0xabc" }) }, "leather", request, allowed);
    assert.deepEqual(answer, { kind: "answered", result: { txid: "0xabc" } });
  });

  it("treats Leather's 4001 and Xverse's -32000 as the user saying no, not as an unknown broadcast", async () => {
    const leather = await askWallet(
      {
        request: async () => {
          throw { code: 4001, message: "User rejected the request" };
        },
      },
      "leather",
      request,
      allowed,
    );
    assert.equal(leather.kind, "rejected");
    const xverse = await askWallet(
      {
        request: async () => {
          throw { error: { code: -32000, message: "User rejected" } };
        },
      },
      "xverse",
      request,
      allowed,
    );
    assert.equal(xverse.kind, "rejected");
  });

  it("records any other failure as unknown, because it cannot say whether anything was sent", async () => {
    const answer = await askWallet(
      {
        request: async () => {
          throw new Error("extension crashed");
        },
      },
      "leather",
      request,
      allowed,
    );
    assert.deepEqual(answer, { kind: "unknown", result: { error: "extension crashed" } });
  });

  it("reads Leather's nested error message instead of saying the wallet did not answer", async () => {
    const answer = await askWallet(
      {
        request: async () => {
          throw { error: { code: -32603, message: "Uint8Array list expected" } };
        },
      },
      "leather",
      request,
      allowed,
    );
    assert.deepEqual(answer, { kind: "unknown", result: { error: "Uint8Array list expected" } });
  });

  it("treats a resolved Leather error envelope as a failure", async () => {
    const answer = await askWallet(
      {
        request: async () => ({ error: { code: -32602, message: "Invalid params" } }),
      },
      "leather",
      request,
      allowed,
    );
    assert.deepEqual(answer, { kind: "unknown", result: { error: "Invalid params" } });
  });

  it("refuses to open the wallet when SDK validation failed", async () => {
    await assert.rejects(
      () =>
        askWallet({ request: async () => ({ txid: "0xabc" }) }, "leather", request, {
          ok: false,
          reasons: ["tampered"],
        }),
      /failed SDK validation/,
    );
  });
});

describe("asking the wallet for a provider swap call", () => {
  const call = {
    contractId: "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1",
    functionName: "swap-simple-multi",
    functionArgs: ["0x0b000000010c"],
    postConditions: [
      { type: "stx-postcondition" as const, address: OWNER, condition: "lte" as const, amount: "1000000" },
    ],
    postConditionMode: "deny" as const,
    network: "mainnet" as const,
  };

  it("opens the wallet without claiming registry validation", async () => {
    const request = toWalletCallRequest(call);
    assert.equal(request.method, "stx_callContract");
    assert.equal(request.params.contract, call.contractId);
    assert.ok(request.params.postConditions.every((condition) => /^[0-9a-f]+$/i.test(condition)));
    const answer = await askWalletCall({ request: async () => ({ result: { txid: "0xswap" } }) }, "leather", request);
    assert.deepEqual(answer, { kind: "answered", result: { txid: "0xswap" } });
  });

  it("treats a wallet decline as a rejection, not a broadcast", async () => {
    const answer = await askWalletCall(
      {
        request: async () => {
          throw { code: 4001, message: "User rejected the request" };
        },
      },
      "leather",
      toWalletCallRequest(call),
    );
    assert.equal(answer.kind, "rejected");
  });
});
