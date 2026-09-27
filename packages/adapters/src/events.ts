import { contract, FUNGIBLE_ASSET_NAME } from "@stacks-capital/config";
import {
  type ActivityEffect,
  type AssetId,
  integerField,
  type DecodedEvent,
  sip10,
  type StacksNetwork,
} from "@stacks-capital/core";

/**
 * Shared helpers for reading contract logs.
 *
 * Events name the asset by its contract principal only, never by ticker, so a principal is
 * resolved against the pinned registry. A principal that is not pinned resolves to nothing and the
 * amount is left off the activity, because an unrecognised asset is unknown, not zero.
 */

function stxToken(network: StacksNetwork): AssetId {
  // Bitflow routes native STX through a wrapper, so the pool reports it as a contract principal.
  return { chain: "stacks", network, identity: { kind: "native", symbol: "stx" } };
}

/** Resolves an asset by the contract principal an event reported it under. */
export function assetForPrincipal(network: StacksNetwork, principal: string | null): AssetId | null {
  if (principal === null) return null;
  const bare = principal.split("::")[0] ?? principal;

  const sbtc = contract("sbtc", "sbtc-token", network).contractId;
  if (bare === sbtc) return sip10(network, sbtc, FUNGIBLE_ASSET_NAME.sbtc);

  const usdcx = contract("usdcx", "usdcx", network).contractId;
  if (bare === usdcx) return sip10(network, usdcx, FUNGIBLE_ASSET_NAME.usdcx);

  const vault = contract("zest", "v0-vault-sbtc", network).contractId;
  if (bare === vault) return sip10(network, vault, FUNGIBLE_ASSET_NAME.zestShares);

  if (bare.endsWith(".token-stx-v-1-2")) return stxToken(network);

  return null;
}

/** Builds one effect, or nothing when the amount or the asset could not be read. */
export function effect(
  direction: ActivityEffect["direction"],
  asset: AssetId | null,
  quantity: bigint | null,
): ActivityEffect[] {
  if (asset === null || quantity === null || quantity < 0n) return [];
  return [{ direction, asset, quantity }];
}

/** Reads an amount by the first of several field names the protocol might use. */
export function amountField(event: DecodedEvent, ...names: readonly string[]): bigint | null {
  for (const name of names) {
    const value = integerField(event, name);
    if (value !== null) return value;
  }
  return null;
}
