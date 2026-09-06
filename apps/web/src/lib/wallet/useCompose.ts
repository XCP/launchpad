"use client";

import type { Quantity } from "@xcp/wallet-sdk";
import { useCompose as useSdkCompose } from "@xcp/wallet-sdk/react";

export type { ComposeState, ComposeStatus } from "@xcp/wallet-sdk/react";

/** The SDK pipeline plus the one message only this site composes. */
export function useCompose() {
  const compose = useSdkCompose();

  /**
   * An XCP-69 launch. Every value below the description is the standard's
   * fixed choice, not an option. The compose API rejects a start at or below
   * the current block; pass `fee_rate` for a tight lead that must confirm
   * well before its start block.
   */
  const composeFairminter = (params: {
    asset: string;
    price: Quantity;
    quantity_by_price: Quantity;
    hard_cap: Quantity;
    soft_cap: Quantity;
    start_block: number;
    soft_cap_deadline_block: number;
    max_mint_per_tx: Quantity;
    max_mint_per_address: Quantity;
    pool_quantity: Quantity;
    lp_asset: string;
    description: string;
    fee_rate?: number;
  }) =>
    compose.compose(
      "fairminter",
      {
        asset: params.asset,
        price: params.price,
        quantity_by_price: params.quantity_by_price,
        hard_cap: params.hard_cap,
        soft_cap: params.soft_cap,
        start_block: params.start_block,
        soft_cap_deadline_block: params.soft_cap_deadline_block,
        max_mint_per_tx: params.max_mint_per_tx,
        max_mint_per_address: params.max_mint_per_address,
        pool_quantity: params.pool_quantity,
        lp_asset: params.lp_asset,
        description: params.description,
        premint_quantity: 0,
        minted_asset_commission: 0,
        burn_payment: "false",
        lock_description: "true",
        lock_quantity: "true",
        divisible: "true",
        end_block: 0,
      },
      params.fee_rate,
    );

  return { ...compose, composeFairminter };
}
