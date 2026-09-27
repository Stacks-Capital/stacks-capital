import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPTURED_MAINNET_EVENTS, type CapturedEvent } from "./capturedEvents.ts";

/**
 * Guards the captured mainnet payloads that the event decoders will be written against.
 *
 * These assertions read the `shape` and `repr` recorded beside each payload rather than decoding
 * the hex, because this package has no Clarity dependency on purpose. Decoding the hex and
 * checking it against these shapes belongs with the decoders, wherever they end up living.
 */

function find(protocol: string, action: string): CapturedEvent {
  const event = CAPTURED_MAINNET_EVENTS.find((item) => item.protocol === protocol && item.action === action);
  assert.ok(event !== undefined, `no captured event for ${protocol} ${action}; rerun pnpm capture:events`);
  return event;
}

function fields(event: CapturedEvent): Set<string> {
  return new Set(event.shape.split(" "));
}

/**
 * The amounts reconciliation reads, per action. This is the contract the decoders are written
 * against: if a protocol renames or drops one of these, a recapture fails here rather than a
 * decoder silently reporting nothing.
 */
const AMOUNTS: Readonly<Record<string, readonly string[]>> = {
  "zest deposit": ["amount", "shares-minted"],
  "zest redeem": ["amount-received", "shares-burned"],
  "granite borrow": ["amount", "scaled-debt-added"],
  "granite repay": ["amount-repaid", "scaled-debt-removed"],
  "granite collateral-add": ["amount", "updated-collateral-amount"],
  "granite collateral-remove": ["amount", "updated-collateral-amount"],
  "sbtc completed-deposit": ["amount"],
  "sbtc withdrawal-create": ["amount", "max-fee"],
  "sbtc withdrawal-accept": ["fee"],
  "bitflow swap-x-for-y": ["dx", "dy"],
  "bitflow swap-y-for-x": ["dx", "dy"],
};

/** The principal each action attributes the movement to, so an event can be tied to an owner. */
const OWNERS: Readonly<Record<string, string>> = {
  "zest deposit": "recipient",
  "zest redeem": "recipient",
  "granite borrow": "account",
  "granite repay": "account",
  "granite collateral-add": "account",
  "granite collateral-remove": "account",
  "sbtc withdrawal-create": "sender",
  "bitflow swap-x-for-y": "caller",
  "bitflow swap-y-for-x": "caller",
};

function split(key: string): [string, string] {
  const [protocol, ...rest] = key.split(" ");
  return [protocol as string, rest.join(" ")];
}

test("every action reconciliation needs has a captured mainnet event", () => {
  for (const key of Object.keys(AMOUNTS)) {
    const [protocol, action] = split(key);
    find(protocol, action);
  }
});

test("each capture carries the amounts reconciliation reads", () => {
  for (const [key, names] of Object.entries(AMOUNTS)) {
    const [protocol, action] = split(key);
    const present = fields(find(protocol, action));
    for (const name of names) {
      assert.ok(present.has(name), `${key} no longer carries ${name}`);
    }
  }
});

test("each capture names the principal the movement belongs to", () => {
  for (const [key, name] of Object.entries(OWNERS)) {
    const [protocol, action] = split(key);
    assert.ok(fields(find(protocol, action)).has(name), `${key} no longer carries ${name}`);
  }
});

test("each capture is real evidence: a txid, a payload and the action it renders to", () => {
  for (const event of CAPTURED_MAINNET_EVENTS) {
    assert.match(event.txid, /^0x[0-9a-f]{64}$/, `${event.protocol} ${event.action} has no usable txid`);
    assert.match(event.payloadHex, /^0x[0-9a-f]+$/, `${event.protocol} ${event.action} has no usable payload`);
    // sBTC discriminates on `topic`, the rest on `action`.
    const marker = event.protocol === "sbtc" ? "topic" : "action";
    assert.ok(
      event.repr.includes(`(${marker} "${event.action}")`),
      `${event.txid} does not render to ${marker} "${event.action}"`,
    );
  }
});

test("a withdrawal is only reconcilable by joining accept back to create on request-id", () => {
  // `withdrawal-accept` carries the fee and the Bitcoin txid but no amount, so the amount has to
  // come from the `withdrawal-create` that opened the same request.
  const create = find("sbtc", "withdrawal-create");
  const accept = find("sbtc", "withdrawal-accept");
  assert.ok(!fields(accept).has("amount"), "withdrawal-accept now carries an amount; the join may be unnecessary");
  assert.ok(fields(create).has("request-id") && fields(accept).has("request-id"));
  const idOf = (event: CapturedEvent) => /\(request-id u([0-9]+)\)/.exec(event.repr)?.[1];
  assert.equal(idOf(create), idOf(accept), "the captured pair should be the same withdrawal, so the join is exercised");
});

test("a deposit mint carries the Bitcoin transaction it settles, so matching it needs no Bitcoin node", () => {
  const present = fields(find("sbtc", "completed-deposit"));
  assert.ok(present.has("bitcoin-txid"));
  assert.ok(present.has("output-index"));
});

test("captures come from the contract that emits them, not the one the plan calls", () => {
  const emitters = new Map(CAPTURED_MAINNET_EVENTS.map((event) => [event.protocol, event.contractId]));
  assert.equal(emitters.get("sbtc"), "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry");
  assert.match(String(emitters.get("bitflow")), /dlmm-core/);
});
