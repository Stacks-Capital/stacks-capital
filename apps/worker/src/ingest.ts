import {
  type CheckpointRow,
  findCanonicalBlock,
  findWorkflowByTxid,
  insertBlock,
  insertRawEvent,
  markReorg,
  type NetworkName,
  type ProjectionTarget,
  rawEventExists,
  readCheckpoint,
  recordActivity,
  recordBlock,
  type Sql,
} from "@stacks-capital/database";
import type { Hiro } from "./hiro.ts";
import { decodeEvent } from "./clarity.ts";
import { CALCULATION_VERSION } from "./markets.ts";
import { eventDecodingAdapters, type AdapterContext } from "@stacks-capital/adapters";
import { REGISTRY_VERSION } from "@stacks-capital/config";
import { formatAssetId, stringField } from "@stacks-capital/core";

/** Built once: decoding reads nothing, so one set serves every tick. */
const decoders = eventDecodingAdapters();

export const BLOCK_SOURCE = "hiro-blocks";
export const EVENT_SOURCE = "hiro-events";
const CHAIN = "stacks" as const;

export type IngestDeps = {
  sql: Sql;
  hiro: Hiro;
  network: NetworkName;
  at: Date;
  maxBlocks?: number;
  maxRewind?: number;
};

export type ReorgResult = { ancestorHash: string; blocks: number; events: number; activities: number };
export type BlockResult = {
  tipHeight: number;
  blocks: number;
  reorg: ReorgResult | null;
  checkpoint: CheckpointRow | null;
};

// Walks back from the checkpoint until stored evidence and the chain agree. That block is the common ancestor.
async function findCommonAncestor(deps: IngestDeps, fromHeight: number): Promise<string> {
  const maxRewind = deps.maxRewind ?? 50;
  for (let height = fromHeight - 1; height > fromHeight - 1 - maxRewind && height >= 0; height -= 1) {
    const stored = await findCanonicalBlock(deps.sql, { chain: CHAIN, network: deps.network, height });
    if (stored === null) continue;
    const chainBlock = await deps.hiro.blockAt(height);
    if (chainBlock.hash === stored.hash) return stored.hash;
  }
  throw new Error(`No common ancestor within ${maxRewind} blocks of height ${fromHeight}`);
}

export async function ingestBlocks(deps: IngestDeps): Promise<BlockResult> {
  const maxBlocks = deps.maxBlocks ?? 10;
  const tip = await deps.hiro.latestBlock();
  const checkpoint = await readCheckpoint(deps.sql, CHAIN, deps.network);

  const asRow = (block: { height: number; hash: string; parentHash: string }) => ({
    chain: CHAIN,
    network: deps.network,
    height: block.height,
    hash: block.hash,
    parentHash: block.parentHash,
    source: BLOCK_SOURCE,
    observedAt: deps.at,
  });

  if (checkpoint === null) {
    await recordBlock(deps.sql, asRow(tip), []);
    return { tipHeight: tip.height, blocks: 1, reorg: null, checkpoint: { height: tip.height, hash: tip.hash } };
  }

  // The checkpoint hash no longer being the canonical block at that height is the definition of a reorg (K05).
  const atCheckpoint = await deps.hiro.blockAt(checkpoint.height);
  if (atCheckpoint.hash !== checkpoint.hash) {
    const ancestorHash = await findCommonAncestor(deps, checkpoint.height);
    const marked = await markReorg(deps.sql, {
      chain: CHAIN,
      network: deps.network,
      ancestorHash,
      at: deps.at,
    });
    return {
      tipHeight: tip.height,
      blocks: 0,
      reorg: { ancestorHash, ...marked },
      checkpoint: await readCheckpoint(deps.sql, CHAIN, deps.network),
    };
  }

  let parentHash = checkpoint.hash;
  let blocks = 0;
  const last = Math.min(tip.height, checkpoint.height + maxBlocks);
  for (let height = checkpoint.height + 1; height <= last; height += 1) {
    const block = await deps.hiro.blockAt(height);
    // A block that does not continue the chain we stored means a reorg landed mid walk. The next tick rewinds.
    if (block.parentHash !== parentHash) break;
    await recordBlock(deps.sql, asRow(block), []);
    parentHash = block.hash;
    blocks += 1;
  }

  return {
    tipHeight: tip.height,
    blocks,
    reorg: null,
    checkpoint: await readCheckpoint(deps.sql, CHAIN, deps.network),
  };
}

export type EventResult = { events: number; activities: number; blocks: number };

// Contract logs are the raw evidence. They are stored before they are interpreted (K05 invariant).
export async function ingestEvents(
  deps: IngestDeps & { targets: ProjectionTarget[]; perContract?: number },
): Promise<EventResult> {
  const perContract = deps.perContract ?? 20;
  const seenContracts = new Set<string>();
  const result: EventResult = { events: 0, activities: 0, blocks: 0 };

  for (const target of deps.targets) {
    if (seenContracts.has(target.contractId)) continue;
    seenContracts.add(target.contractId);

    const events = await deps.hiro.contractEvents(target.contractId, perContract);
    for (const event of events) {
      const id = `${event.txId}:${event.eventIndex}`;
      // Events arrive newest first, so the first one already stored means the rest of this page is stored too.
      if (await rawEventExists(deps.sql, id)) break;

      const tx = await deps.hiro.transaction(event.txId);
      if (!tx.canonical || tx.blockHeight === null) continue;
      const block = await deps.hiro.blockAt(tx.blockHeight);
      if (block.hash !== tx.blockHash) continue;

      const inserted = await insertBlock(deps.sql, {
        chain: CHAIN,
        network: deps.network,
        height: block.height,
        hash: block.hash,
        parentHash: block.parentHash,
        source: BLOCK_SOURCE,
        observedAt: deps.at,
      });
      if (inserted) result.blocks += 1;

      await insertRawEvent(deps.sql, deps.network, CHAIN, {
        id,
        blockHash: block.hash,
        payload: event.payloadHex,
        source: EVENT_SOURCE,
        observedAt: deps.at,
      });
      result.events += 1;

      // An activity that cannot be traced to the workflow that caused it is why nothing ever moved
      // past SUBMITTED (pilot blocker B1). The transaction id is the link, and it is already here.
      const origin = await findWorkflowByTxid(deps.sql, { network: deps.network, txid: event.txId });

      // The worker decodes the payload because it owns the Clarity library; the adapter that
      // recognises the event says what the fields mean. An event no adapter claims still records a
      // generic activity, so nothing is lost because a decoder has not been written yet.
      const decoded = decodeEvent({
        id,
        blockHash: block.hash,
        contractId: event.contractId,
        hex: event.payloadHex,
      });
      const context: AdapterContext = {
        network: deps.network,
        now: deps.at,
        registryVersion: REGISTRY_VERSION,
      };
      const claimed = decoders.flatMap((adapter) => adapter.decodeEvents(context, [decoded]))[0];
      const fallbackAction = stringField(decoded, "action") ?? stringField(decoded, "topic") ?? "unknown";

      const recorded = await recordActivity(deps.sql, {
        id: `act_${id}`,
        rawEventId: id,
        kind: claimed?.kind ?? `${target.protocol}.${fallbackAction}`,
        chain: CHAIN,
        network: deps.network,
        blockHash: block.hash,
        workflowId: origin?.workflowId ?? null,
        owner: claimed?.owner ?? null,
        reference: claimed?.reference ?? null,
        effects: (claimed?.effects ?? []).map((item) => ({
          direction: item.direction,
          assetId: formatAssetId(item.asset),
          quantity: item.quantity.toString(10),
        })),
        adapterVersion: target.adapterVersion,
        calculationVersion: CALCULATION_VERSION,
      });
      if (recorded) result.activities += 1;
    }
  }

  return result;
}
