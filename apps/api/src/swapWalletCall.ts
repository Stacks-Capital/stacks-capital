import { Cl, cvToHex, type ClarityValue } from "@stacks/transactions";

export type SwapWalletPostCondition =
  | { type: "stx-postcondition"; address: string; condition: "lte" | "eq" | "gte"; amount: string }
  | { type: "ft-postcondition"; address: string; condition: "lte" | "eq" | "gte"; amount: string; asset: string };

export type SwapWalletCall = {
  contractId: string;
  functionName: string;
  functionArgs: string[];
  postConditions: SwapWalletPostCondition[];
  postConditionMode: "deny" | "allow";
  network: "mainnet";
};

const CONDITIONS: Record<string, SwapWalletPostCondition["condition"] | undefined> = {
  less_than_or_equal_to: "lte",
  equal: "eq",
  greater_than_or_equal_to: "gte",
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} was malformed`);
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} was missing`);
  return value;
}

function contractPrincipal(value: string, label: string): ClarityValue {
  const [address, name] = value.split(".");
  if (address === undefined || name === undefined) throw new Error(`${label} was not a contract identity`);
  return Cl.contractPrincipal(address, name);
}

function typedValue(value: unknown, label: string): ClarityValue {
  const item = record(value, label);
  const type = nonEmpty(item.type, `${label} type`);
  if (type === "uint") return Cl.uint(BigInt(nonEmpty(item.value, `${label} uint`)));
  if (type === "true" || (type === "bool" && item.value === "true")) return Cl.bool(true);
  if (type === "false" || (type === "bool" && item.value === "false")) return Cl.bool(false);
  if (type === "contract" || type === "principal") {
    return contractPrincipal(nonEmpty(item.value, `${label} contract`), label);
  }
  if (type === "tuple") {
    const fields = record(item.value, `${label} tuple`);
    return Cl.tuple(
      Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, typedValue(entry, `${label}.${key}`)])),
    );
  }
  if (type === "list" && Array.isArray(item.value)) {
    return Cl.list(item.value.map((entry, index) => typedValue(entry, `${label}[${String(index)}]`)));
  }
  throw new Error(`${label} uses unsupported Clarity type ${type}`);
}

export function bitflowWalletCall(swap: Record<string, unknown>, owner: string): SwapWalletCall {
  const functionName = nonEmpty(swap.function_name, "Bitflow function name");
  const typed = swap.swap_parameters_typed;
  if (!Array.isArray(typed) || typed.length === 0) throw new Error("Bitflow swap parameters were missing");
  const postConditions = swap.post_conditions;
  if (!Array.isArray(postConditions) || postConditions.length === 0) {
    throw new Error("Bitflow transaction post-conditions were missing");
  }
  return {
    contractId: nonEmpty(swap.swap_contract, "Bitflow swap contract"),
    functionName,
    functionArgs: [cvToHex(Cl.list(typed.map((item, index) => typedValue(item, `Bitflow arg ${String(index)}`))))],
    postConditions: postConditions.map((item, index) =>
      bitflowPostCondition(item, owner, `Bitflow PC ${String(index)}`),
    ),
    postConditionMode: "deny",
    network: "mainnet",
  };
}

function bitflowPostCondition(value: unknown, owner: string, label: string): SwapWalletPostCondition {
  const condition = record(value, label);
  const code = nonEmpty(condition.condition_code, `${label} condition`);
  const mapped = CONDITIONS[code];
  if (mapped !== "lte" && mapped !== "eq" && mapped !== "gte") {
    throw new Error(`${label} used an unsupported condition`);
  }
  const rawSender = nonEmpty(condition.sender_address, `${label} sender`);
  const address = rawSender === "tx-sender" ? owner : rawSender;
  const amount = nonEmpty(String(condition.amount ?? ""), `${label} amount`);
  if (!/^\d+$/.test(amount)) throw new Error(`${label} amount was not an integer`);
  const kind = nonEmpty(condition.post_condition_type, `${label} type`);
  if (kind === "standard_stx" || kind === "contract_stx") {
    return { type: "stx-postcondition", address, condition: mapped, amount };
  }
  const token = nonEmpty(condition.token_contract, `${label} token`);
  const assetName = nonEmpty(condition.token_asset_name, `${label} asset name`);
  if (assetName === "unknown") throw new Error(`${label} did not name the exact SIP-010 asset`);
  return { type: "ft-postcondition", address, condition: mapped, amount, asset: `${token}::${assetName}` };
}

export function sdkWalletCall(transaction: Record<string, unknown>, owner: string): SwapWalletCall | undefined {
  try {
    const contractAddress = nonEmpty(transaction.contractAddress, "SDK contract address");
    const contractName = nonEmpty(transaction.contractName, "SDK contract name");
    const functionName = nonEmpty(transaction.functionName, "SDK function name");
    const args = transaction.functionArgs;
    const rawConditions = transaction.postConditions;
    if (!Array.isArray(args) || args.length === 0 || !Array.isArray(rawConditions) || rawConditions.length === 0) {
      return undefined;
    }
    const postConditions = rawConditions.map((item, index) =>
      leatherPostCondition(item, owner, `SDK PC ${String(index)}`),
    );
    return {
      contractId: `${contractAddress}.${contractName}`,
      functionName,
      functionArgs: args.map((item, index) => encodeSdkArgument(item, `SDK arg ${String(index)}`)),
      postConditions,
      postConditionMode: transaction.postConditionMode === "allow" ? "allow" : "deny",
      network: "mainnet",
    };
  } catch {
    return undefined;
  }
}

function encodeSdkArgument(value: unknown, label: string): string {
  if (typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)) return value;
  if (typeof value === "object" && value !== null && "type" in value) return cvToHex(value as ClarityValue);
  throw new Error(`${label} was not encoded Clarity`);
}

function leatherPostCondition(value: unknown, owner: string, label: string): SwapWalletPostCondition {
  const condition = record(value, label);
  const mapped =
    condition.condition === "lte" || condition.condition === "eq" || condition.condition === "gte"
      ? condition.condition
      : (CONDITIONS[String(condition.condition ?? "")] ?? CONDITIONS[String(condition.conditionCode ?? "")]);
  if (mapped !== "lte" && mapped !== "eq" && mapped !== "gte") {
    throw new Error(`${label} used an unsupported condition`);
  }
  const rawAddress = condition.address ?? condition.principal ?? condition.sender_address;
  const address =
    rawAddress === "tx-sender" || rawAddress === undefined || rawAddress === "" ? owner : String(rawAddress);
  const amount = integerAmount(condition.amount, label);
  const kind = String(condition.type ?? "");
  if (kind === "stx-postcondition" || kind === "standard_stx" || kind === "contract_stx") {
    return { type: "stx-postcondition", address, condition: mapped, amount };
  }
  if (kind === "ft-postcondition" || kind === "fungible-postcondition") {
    const asset = nonEmpty(condition.asset, `${label} asset`);
    return { type: "ft-postcondition", address, condition: mapped, amount, asset };
  }
  throw new Error(`${label} used an unsupported post-condition type`);
}

function integerAmount(value: unknown, label: string): string {
  const text = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!/^\d+$/.test(text)) throw new Error(`${label} amount was not an integer`);
  return text;
}
