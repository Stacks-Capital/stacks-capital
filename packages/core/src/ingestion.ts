import type { AssetId, WorkflowId } from "./ids.ts";
import type { StacksNetwork } from "./network.ts";

export type ChainBlock = {
  chain: "bitcoin" | "stacks";
  network: StacksNetwork;
  height: number;
  hash: string;
  parentHash: string;
  canonical: boolean;
  observedAt: string;
  source: string;
};

export type RawEvent = {
  id: string;
  chain: "bitcoin" | "stacks";
  network: StacksNetwork;
  blockHash: string;
  payload: string;
  canonical: boolean;
  observedAt: string;
  source: string;
};

export type IngestionCheckpoint = {
  chain: "bitcoin" | "stacks";
  network: StacksNetwork;
  height: number;
  hash: string;
};

/**
 * A Clarity value a contract logged, decoded into plain data.
 *
 * The worker owns decoding, because it is the only place with a Clarity library. Adapters own
 * meaning, and read these fields without knowing how the chain encodes them. That split is why
 * this type lives in core rather than in either of them.
 */
export type DecodedField =
  | { kind: "integer"; value: bigint }
  | { kind: "string"; value: string }
  | { kind: "principal"; value: string }
  | { kind: "buffer"; hex: string }
  | { kind: "other"; repr: string };

export type DecodedEvent = {
  id: string;
  blockHash: string;
  /** The contract that emitted the log, which is not always the one the plan called. */
  contractId: string;
  /**
   * Tuple fields. Protocols that wrap their payload in a `data` tuple are flattened into one map,
   * because every protocol we read puts the discriminator outside `data` and the amounts inside.
   * An outer field wins a name clash, and the inner one stays reachable as `data.<name>`.
   */
  fields: Readonly<Record<string, DecodedField>>;
};

/** One side of a movement an event recorded, from the owner's point of view. */
export type ActivityEffect = {
  direction: "in" | "out";
  asset: AssetId;
  quantity: bigint;
};

export type CanonicalActivity = {
  id: string;
  workflowId?: WorkflowId;
  kind: string;
  blockHash: string;
  canonical: boolean;
  /** The principal the movement belongs to, when the event names one. */
  owner?: string;
  /**
   * A protocol identifier this event can be joined on when the Stacks transaction is not the
   * user's own. An sBTC mint is broadcast by the signers and carries the Bitcoin transaction it
   * settles; a withdrawal is carried through its request id across three separate events.
   */
  reference?: string;
  /**
   * What moved. Empty means the adapter recognised the event but could not attribute amounts,
   * which is an explicit unknown and never the same as nothing having moved.
   */
  effects: readonly ActivityEffect[];
};

/** Reads a field only when it is an integer, so a renamed or retyped field reads as absent. */
export function integerField(event: DecodedEvent, name: string): bigint | null {
  const field = event.fields[name];
  return field?.kind === "integer" ? field.value : null;
}

/** Reads a field only when it is a principal, for the same reason. */
export function principalField(event: DecodedEvent, name: string): string | null {
  const field = event.fields[name];
  return field?.kind === "principal" ? field.value : null;
}

export function stringField(event: DecodedEvent, name: string): string | null {
  const field = event.fields[name];
  return field?.kind === "string" ? field.value : null;
}

export type IngestionState = {
  blocks: ChainBlock[];
  events: RawEvent[];
  checkpoint: IngestionCheckpoint | null;
  activities: CanonicalActivity[];
};

export function emptyIngestion(): IngestionState {
  return { blocks: [], events: [], checkpoint: null, activities: [] };
}

export function applyBlock(state: IngestionState, block: ChainBlock, events: RawEvent[]): IngestionState {
  if (state.checkpoint !== null && block.parentHash !== state.checkpoint.hash) {
    throw new Error(`Block ${block.hash} does not continue checkpoint ${state.checkpoint.hash}`);
  }
  return {
    blocks: [...state.blocks, { ...block, canonical: true }],
    events: [...state.events, ...events.map((event) => ({ ...event, canonical: true }))],
    checkpoint: {
      chain: block.chain,
      network: block.network,
      height: block.height,
      hash: block.hash,
    },
    activities: state.activities,
  };
}

export function applyReorg(state: IngestionState, commonAncestorHash: string): IngestionState {
  const ancestor = state.blocks.find((block) => block.hash === commonAncestorHash);
  if (ancestor === undefined) throw new Error(`Unknown ancestor ${commonAncestorHash}`);

  return {
    blocks: state.blocks.map((block) => (block.height > ancestor.height ? { ...block, canonical: false } : block)),
    events: state.events.map((event) => {
      const block = state.blocks.find((candidate) => candidate.hash === event.blockHash);
      if (block !== undefined && block.height > ancestor.height) return { ...event, canonical: false };
      return event;
    }),
    checkpoint: {
      chain: ancestor.chain,
      network: ancestor.network,
      height: ancestor.height,
      hash: ancestor.hash,
    },
    activities: state.activities.map((activity) => {
      const event = state.events.find((candidate) => candidate.id === activity.id);
      const block = event ? state.blocks.find((candidate) => candidate.hash === event.blockHash) : undefined;
      if (block !== undefined && block.height > ancestor.height) return { ...activity, canonical: false };
      return activity;
    }),
  };
}
