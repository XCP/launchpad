import { describe, expect, it } from "vitest";
import {
  foldTrackedPosition,
  type TrackedActivityRow,
} from "#api/queries/address-summary";

const row = (
  block: number,
  token: bigint,
  xcp: bigint,
  kind: TrackedActivityRow["kind"],
): TrackedActivityRow => ({
  block_index: block,
  sort_index: block,
  id: String(block),
  token_delta: token.toString(),
  xcp_delta: xcp.toString(),
  kind,
});

describe("launchpad address hover accounting", () => {
  it("keeps average basis and realized PnL after a partial sale", () => {
    expect(
      foldTrackedPosition([
        row(1, 100n, -100n, "buy"),
        row(2, 100n, -300n, "buy"),
        row(3, -50n, 150n, "sell"),
      ]),
    ).toEqual({
      quantity: "150",
      cost_xcp: "300",
      realized_pnl_xcp: "50",
      complete: true,
    });
  });

  it("withholds PnL when a disposal needs an untracked acquisition", () => {
    expect(foldTrackedPosition([row(1, -10n, 20n, "sell")])).toMatchObject({
      quantity: "0",
      complete: false,
    });
  });

  it("marks a capped history incomplete", () => {
    expect(foldTrackedPosition([row(1, 10n, -5n, "mint")], true)).toEqual({
      quantity: "10",
      cost_xcp: "5",
      realized_pnl_xcp: "0",
      complete: false,
    });
  });
});
