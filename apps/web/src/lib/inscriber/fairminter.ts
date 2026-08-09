/**
 * Launchpad extension to the inscriber: XCP-69 fairminters as ordinals
 * commit/reveal inscriptions.
 *
 * Wire format (core fairminter.py compose/unpack_new, message ID 90): the ord
 * path pops content + mime_type from the envelope and re-appends them to the
 * metadata array, so the `xcp` array carries every field through lp_asset_id
 * and the image itself becomes the on-chain description (the stamp pattern).
 * Pool fields sit between `divisible` and the tail by protocol design so this
 * works with no fairminter-specific special casing.
 */

import { nameToAssetId } from "./counterparty";
import { prepareCommit } from "./transactions";
import type { InscriptionData, PreparedInscriptionCommit } from "./types";
import { XCP69 } from "@/lib/xcp69";

export const CP_FAIRMINTER_ID = 90;

/** Numeric assets (A…) carry their id in the name; named assets encode base-26. */
export function assetNameToId(name: string): bigint {
  if (/^A\d+$/.test(name)) return BigInt(name.slice(1));
  return nameToAssetId(name);
}

export interface FairminterInscriptionParams {
  asset: string;
  lpAsset: string;
  /** future block minting opens at — the pre-announcement window */
  startBlock: number;
  /** startBlock + XCP69.DEADLINE_BLOCKS, exactly */
  softCapDeadlineBlock: number;
  /** hosted CIP-25 JSON — rides in the ord metadata for ecosystem parsers */
  jsonUrl: string;
  imageData: Uint8Array;
  mimeType: string;
  feeRate: number;
}

export function buildFairminterInscriptionMetadata(
  params: FairminterInscriptionParams,
): Record<string, unknown> {
  // Field order is consensus-critical; mirrors compose() exactly. The decoder
  // appends [mime_type, content] from the envelope to complete the message.
  const xcp: unknown[] = [
    CP_FAIRMINTER_ID,
    assetNameToId(params.asset),
    BigInt(0), // asset_parent_id
    BigInt(XCP69.PRICE),
    BigInt(XCP69.QUANTITY_BY_PRICE),
    BigInt(XCP69.MAX_MINT_PER_TX),
    BigInt(XCP69.MAX_MINT_PER_ADDRESS),
    BigInt(XCP69.HARD_CAP),
    BigInt(0), // premint_quantity
    BigInt(params.startBlock),
    BigInt(0), // end_block
    BigInt(XCP69.SOFT_CAP),
    BigInt(params.softCapDeadlineBlock),
    BigInt(0), // minted_asset_commission_int
    false, // burn_payment
    true, // lock_description
    true, // lock_quantity
    true, // divisible
    BigInt(XCP69.POOL_QUANTITY),
    assetNameToId(params.lpAsset),
  ];

  return {
    asset: params.asset,
    name: params.asset,
    description: params.jsonUrl,
    xcp,
  };
}

export function prepareFairminterInscriptionPsbt(
  params: FairminterInscriptionParams,
  pubkey: Uint8Array,
): PreparedInscriptionCommit {
  const data: InscriptionData = {
    contentType: params.mimeType,
    body: params.imageData,
    metaprotocol: "xcp",
    metadata: buildFairminterInscriptionMetadata(params),
  };
  return prepareCommit(pubkey, data, params.feeRate);
}
