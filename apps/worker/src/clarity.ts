import type { DecodedEvent, DecodedField } from "@stacks-capital/core";
import { Cl, cvToHex, cvToJSON, hexToCV } from "@stacks/transactions";

export function encodeAscii(value: string): string {
  return cvToHex(Cl.stringAscii(value));
}

type ClarityJson = { type: string; value: unknown };

/**
 * Turns a logged Clarity value into plain data an adapter can read.
 *
 * The worker owns this because it is the only package with a Clarity library. Adapters get named
 * fields and never see an encoding, which is what keeps protocol meaning and chain format apart.
 */
function toField(json: ClarityJson): DecodedField {
  if (json.type === "uint" || json.type === "int") return { kind: "integer", value: BigInt(json.value as string) };
  if (json.type === "principal") return { kind: "principal", value: String(json.value) };
  if (json.type.startsWith("(string")) return { kind: "string", value: String(json.value) };
  if (json.type.startsWith("(buff")) return { kind: "buffer", hex: String(json.value) };
  return { kind: "other", repr: `${json.type}` };
}

function isTuple(json: ClarityJson): boolean {
  return json.type.startsWith("(tuple");
}

/**
 * Flattens the payload into one map of fields.
 *
 * Every protocol read here puts its discriminator at the top and its amounts inside a `data`
 * tuple, so one flat map reads the same for all of them. An outer name wins a clash and the inner
 * value stays reachable under `data.<name>`, so nothing is silently lost.
 */
export function decodeEventFields(hex: string): Record<string, DecodedField> {
  let json: ClarityJson;
  try {
    json = cvToJSON(hexToCV(hex)) as ClarityJson;
  } catch {
    return {};
  }
  if (!isTuple(json)) return {};

  const top = json.value as Record<string, ClarityJson>;
  const fields: Record<string, DecodedField> = {};
  const nested: Record<string, ClarityJson> = {};

  for (const [name, value] of Object.entries(top)) {
    if (name === "data" && isTuple(value)) {
      Object.assign(nested, value.value as Record<string, ClarityJson>);
      continue;
    }
    fields[name] = toField(value);
  }

  for (const [name, value] of Object.entries(nested)) {
    if (name in fields) {
      fields[`data.${name}`] = toField(value);
      continue;
    }
    fields[name] = toField(value);
  }

  return fields;
}

export function decodeEvent(input: { id: string; blockHash: string; contractId: string; hex: string }): DecodedEvent {
  return {
    id: input.id,
    blockHash: input.blockHash,
    contractId: input.contractId,
    fields: decodeEventFields(input.hex),
  };
}
