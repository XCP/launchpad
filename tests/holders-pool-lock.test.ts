import { describe, expect, it } from "vitest";
import { splitPoolByLock } from "@/lib/holders";

const BURN = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";

describe("splitPoolByLock", () => {
  it("reports a fully burned pool as entirely locked", () => {
    // Every XCP-69 graduation today: the protocol burns the LP, so the whole
    // pool really is unpullable and the caption is earned.
    const { locked, unlocked } = splitPoolByLock(
      1_246_563_600_000_000n,
      [{ address: BURN, quantity: "14625320509308" }],
      [BURN],
    );
    expect(locked).toBe(1_246_563_600_000_000n);
    expect(unlocked).toBe(0n);
  });

  it("splits on the burned SHARE when someone deposits without burning", () => {
    // The case the old hardcoded caption got wrong: a depositor takes 62% of
    // the LP and keeps it. 38% is locked; 62% can walk.
    const { locked, unlocked } = splitPoolByLock(
      1_000_000n,
      [
        { address: BURN, quantity: "380" },
        { address: "1DepositorXXXXXXXXXXXXXXXXXXXXXXXX", quantity: "620" },
      ],
      [BURN],
    );
    expect(locked).toBe(380_000n);
    expect(unlocked).toBe(620_000n);
  });

  it("never claims more locked than is actually burned", () => {
    const { locked, unlocked } = splitPoolByLock(
      999n,
      [{ address: "1SomeoneElseXXXXXXXXXXXXXXXXXXXXXX", quantity: "100" }],
      [BURN],
    );
    expect(locked).toBe(0n);
    expect(unlocked).toBe(999n);
  });

  it("sums to the pool exactly, with rounding dust on the unlocked side", () => {
    // 1/3 burned against a pool that does not divide evenly. The claim that
    // matters is the locked one, so it must never round UP.
    const { locked, unlocked } = splitPoolByLock(
      100n,
      [
        { address: BURN, quantity: "1" },
        { address: "1OtherXXXXXXXXXXXXXXXXXXXXXXXXXXXX", quantity: "2" },
      ],
      [BURN],
    );
    expect(locked).toBe(33n);
    expect(locked + unlocked).toBe(100n);
  });

  it("claims nothing when no LP supply is visible", () => {
    // An unreachable or empty LP balance is not evidence of a burn.
    const { locked, unlocked } = splitPoolByLock(500n, [], [BURN]);
    expect(locked).toBe(0n);
    expect(unlocked).toBe(500n);
  });

  it("ignores zero and negative balance rows", () => {
    const { locked } = splitPoolByLock(
      1000n,
      [
        { address: BURN, quantity: "50" },
        { address: "1ExitedHolderXXXXXXXXXXXXXXXXXXXXX", quantity: "0" },
        { address: "1AlsoExitedXXXXXXXXXXXXXXXXXXXXXXX", quantity: "50" },
      ],
      [BURN],
    );
    expect(locked).toBe(500n);
  });
});
