import { CONTRACTS, executableContractIds, type ContractRef } from "@stacks-capital/config";
import {
  formatAssetId,
  type CanonicalActivity,
  type ClarityValue,
  type Intent,
  type Plan,
  type PostCondition,
  type Quote,
  type DecodedEvent,
} from "@stacks-capital/core";
import type { AdapterContext, Position, ProtocolAdapter } from "./types.ts";

export type ExpectedAmount = { asset: string; quantity: string };

export type QuoteExpectation = {
  action: Quote["action"];
  marketId: string;
  network: Quote["network"];
  input: readonly ExpectedAmount[];
  expectedOutput: readonly ExpectedAmount[];
  fees: readonly { kind: string; amount: ExpectedAmount; max?: ExpectedAmount }[];
  snapshots: readonly string[];
  executable: boolean;
  registryVersion: string;
  adapterVersion: string;
  minimumOutput?: ExpectedAmount;
};

export type PlanExpectation = {
  network: Plan["network"];
  registryVersion: string;
  adapterVersion: string;
  steps: readonly {
    id: string;
    dependsOn: readonly string[];
    expectedAssetEffects: readonly ExpectedAmount[];
    payload:
      | {
          kind: "bitcoin_deposit";
          amountSats: string;
          stacksRecipient: string;
          bitcoinNetwork: string;
          reclaimLockTime: number;
          maxSignerFeeSats: string;
          emilyNotifyPath: string;
        }
      | {
          kind: "stacks_contract_call";
          contractId: string;
          functionName: string;
          functionArgs: readonly ClarityValue[];
          postConditions: readonly {
            principal: string;
            mode: PostCondition["mode"];
            amount: ExpectedAmount;
          }[];
          postConditionMode: "deny" | "allow";
          network: Plan["network"];
        };
  }[];
};

export type AdapterCertificationFixture = {
  id: string;
  adapter: ProtocolAdapter;
  context: AdapterContext;
  intent: Intent;
  evidence: {
    deployment: string;
    deploymentRevision: string;
    blockHeight: number;
    blockHash: string;
    source: string;
  };
  read: {
    owner: string;
    expected: {
      value: readonly Position[];
      observedAt: string;
      source: string;
      stale: boolean;
      warnings: readonly string[];
    };
  };
  quote: QuoteExpectation;
  plan: PlanExpectation;
  events: {
    raw: readonly DecodedEvent[];
    expected: readonly CanonicalActivity[];
  };
  reconciliation: {
    expected: string;
    observed: string;
    mismatchedObserved: string;
  };
};

export type AdapterCertificationReport = {
  fixtureId: string;
  status: "fixture_conformant" | "failed";
  protocol: string;
  adapterVersion: string;
  registryVersion: string;
  network: AdapterContext["network"];
  deployment: string;
  deploymentRevision: string;
  blockHeight: number;
  blockHash: string;
  source: string;
  checks: readonly string[];
  failures: readonly string[];
};

function amountView(value: { asset: Parameters<typeof formatAssetId>[0]; quantity: bigint }): ExpectedAmount {
  return { asset: formatAssetId(value.asset), quantity: value.quantity.toString(10) };
}

function quoteView(quote: Quote): QuoteExpectation {
  return {
    action: quote.action,
    marketId: quote.marketId,
    network: quote.network,
    input: quote.input.map(amountView),
    expectedOutput: quote.expectedOutput.map(amountView),
    fees: quote.fees.map((fee) => ({
      kind: fee.kind,
      amount: amountView(fee.amount),
      ...(fee.max === undefined ? {} : { max: amountView(fee.max) }),
    })),
    snapshots: quote.snapshots,
    executable: quote.executable,
    registryVersion: quote.registryVersion,
    adapterVersion: quote.adapterVersion,
    ...(quote.minimumOutput === undefined ? {} : { minimumOutput: amountView(quote.minimumOutput) }),
  };
}

function postConditionView(condition: PostCondition) {
  return { principal: condition.principal, mode: condition.mode, amount: amountView(condition.amount) };
}

function planView(plan: Plan): PlanExpectation {
  return {
    network: plan.network,
    registryVersion: plan.registryVersion,
    adapterVersion: plan.adapterVersion,
    steps: plan.steps.map((step) => ({
      id: step.id,
      dependsOn: step.dependsOn,
      expectedAssetEffects: step.expectedAssetEffects.map(amountView),
      payload:
        step.payload.kind === "bitcoin_deposit"
          ? { ...step.payload }
          : {
              ...step.payload,
              functionArgs: step.payload.functionArgs,
              postConditions: step.payload.postConditions.map(postConditionView),
            },
    })),
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString(10));
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function matchingDeployment(fixture: AdapterCertificationFixture): ContractRef | undefined {
  return CONTRACTS.find(
    (item) =>
      item.network === fixture.context.network &&
      item.contractId === fixture.evidence.deployment &&
      item.revision === fixture.evidence.deploymentRevision,
  );
}

export function certifyAdapter(fixture: AdapterCertificationFixture): AdapterCertificationReport {
  const checks: string[] = [];
  const failures: string[] = [];
  const check = (name: string, condition: boolean, detail: string): void => {
    if (condition) checks.push(name);
    else failures.push(`${name}: ${detail}`);
  };

  const semantics = fixture.adapter.semantics;
  check(
    "semantic amount encoding",
    semantics.amountEncoding === "base_10_integer_base_units",
    semantics.amountEncoding,
  );
  check("unsupported fields omitted", semantics.unsupportedFieldPolicy === "omit", semantics.unsupportedFieldPolicy);
  check(
    "action semantics declared",
    semantics.actions.some((item) => item.action === fixture.intent.action),
    `${fixture.intent.action} is undeclared`,
  );
  check(
    "semantic units have exact decimals",
    semantics.assets.length > 0 &&
      semantics.assets.every((asset) => Number.isInteger(asset.decimals) && asset.decimals >= 0),
    "asset decimals must be non-negative integers",
  );
  check("registry deployment pinned", matchingDeployment(fixture) !== undefined, fixture.evidence.deployment);
  check(
    "canonical block evidence named",
    Number.isSafeInteger(fixture.evidence.blockHeight) &&
      fixture.evidence.blockHeight > 0 &&
      fixture.evidence.blockHash.length > 0 &&
      fixture.evidence.source.length > 0,
    "block height, hash, and source are required",
  );

  try {
    const read = fixture.adapter.readPositions(fixture.context, fixture.read.owner);
    check("read fixture exact", same(read, fixture.read.expected), "normalized position or evidence metadata differs");
  } catch (error) {
    failures.push(`read fixture exact: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const quote = fixture.adapter.quote(fixture.context, fixture.intent);
    check("quote fixture exact", same(quoteView(quote), fixture.quote), "quote amounts, units, or evidence differ");
    const plan = fixture.adapter.buildPlan(fixture.context, quote, fixture.intent);
    check("plan fixture exact", same(planView(plan), fixture.plan), "payload or exact post-conditions differ");
    const validation = fixture.adapter.validatePlan(fixture.context, plan, quote, {
      now: fixture.context.now,
      network: fixture.context.network,
      registryVersion: fixture.context.registryVersion,
      sender: fixture.context.owner ?? fixture.read.owner,
      allowedContracts: executableContractIds(fixture.context.network),
    });
    check("signing validation", validation.ok, validation.reasons.join("; "));
  } catch (error) {
    failures.push(`quote/plan conformance: ${error instanceof Error ? error.message : String(error)}`);
  }

  const decoded = fixture.adapter.decodeEvents(fixture.context, fixture.events.raw);
  check("event decoding exact", same(decoded, fixture.events.expected), "canonical activity differs");
  const matched = fixture.adapter.reconcile(
    fixture.context,
    fixture.reconciliation.expected,
    fixture.reconciliation.observed,
  );
  check("reconciliation match", matched.matched && matched.warnings.length === 0, matched.warnings.join("; "));
  const mismatch = fixture.adapter.reconcile(
    fixture.context,
    fixture.reconciliation.expected,
    fixture.reconciliation.mismatchedObserved,
  );
  check(
    "reconciliation mismatch fails closed",
    !mismatch.matched && mismatch.warnings.length > 0,
    "a mismatched observation was accepted or left unexplained",
  );

  return {
    fixtureId: fixture.id,
    status: failures.length === 0 ? "fixture_conformant" : "failed",
    protocol: fixture.adapter.protocol,
    adapterVersion: fixture.adapter.version,
    registryVersion: fixture.context.registryVersion,
    network: fixture.context.network,
    deployment: fixture.evidence.deployment,
    deploymentRevision: fixture.evidence.deploymentRevision,
    blockHeight: fixture.evidence.blockHeight,
    blockHash: fixture.evidence.blockHash,
    source: fixture.evidence.source,
    checks,
    failures,
  };
}

export function assertAdapterCertified(fixture: AdapterCertificationFixture): AdapterCertificationReport {
  const report = certifyAdapter(fixture);
  if (report.status === "failed") {
    throw new Error(`${fixture.id} adapter certification failed:\n${report.failures.join("\n")}`);
  }
  return report;
}
