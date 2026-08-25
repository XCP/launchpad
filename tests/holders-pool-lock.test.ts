import { describe, expect, it } from "vitest";
import { poolLockStatus } from "@/lib/holders";

const BURN = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";

describe("poolLockStatus", () => {
  it("reports a fully burned pool as 100% locked", () => {
    // Every XCP-69 graduation: the protocol burns the LP, so the guarantee is real.
    const s = poolLockStatus(
      1_246_563_600_000_000n,
      [{ address: BURN, quantity: "14625320509308" }],
      [BURN],
    );
    expect(s.fullyLocked).toBe(true);
    expect(s.lockedPercent).toBe(100);
    expect(s.locked).toBe(1_246_563_600_000_000n);
  });

  it("reports the burned SHARE when someone deposits and keeps their LP", () => {
    // CAPTAINDAN as it actually stands: 146,253.205 burned at graduation,
    // 238,862.315 held by the depositor. The old hardcoded caption called this
    // 100% burned.
    const s = poolLockStatus(
      3_329_464_800_000_000n,
      [
        { address: BURN, quantity: "14625320509308" },
        { address: "bc1qx8tfd8jzad7gfpppy44zedavek88pkjynsznz5", quantity: "23886231474959" },
      ],
      [BURN],
    );
    expect(s.fullyLocked).toBe(false);
    expect(s.lockedPercent).toBe(37);
    expect(s.locked + s.unlocked).toBe(3_329_464_800_000_000n);
  });

  it("never rounds up to 100%", () => {
    // 99.6% locked. Rounding would manufacture the exact false guarantee this
    // function exists to prevent, three decimals further in.
    const s = poolLockStatus(1000n, [
      { address: BURN, quantity: "996" },
      { address: "1HolderXXXXXXXXXXXXXXXXXXXXXXXXXXX", quantity: "4" },
    ], [BURN]);
    expect(s.lockedPercent).toBe(99);
    expect(s.fullyLocked).toBe(false);
  });

  it("floors the locked amount so it never overstates the protected side", () => {
    const s = poolLockStatus(100n, [
      { address: BURN, quantity: "1" },
      { address: "1OtherXXXXXXXXXXXXXXXXXXXXXXXXXXXX", quantity: "2" },
    ], [BURN]);
    expect(s.locked).toBe(33n);
    expect(s.locked + s.unlocked).toBe(100n);
  });

  it("claims nothing when no LP is burned, or none is visible", () => {
    const none = poolLockStatus(999n, [{ address: "1SomeoneXXXXXXXXXXXXXXXXXXXXXXXXXX", quantity: "100" }], [BURN]);
    expect(none.lockedPercent).toBe(0);
    expect(none.locked).toBe(0n);
    // An unreachable or empty LP balance is not evidence of a burn.
    const blind = poolLockStatus(500n, [], [BURN]);
    expect(blind.fullyLocked).toBe(false);
    expect(blind.unlocked).toBe(500n);
  });

  it("ignores zero-balance rows", () => {
    const s = poolLockStatus(1000n, [
      { address: BURN, quantity: "50" },
      { address: "1ExitedXXXXXXXXXXXXXXXXXXXXXXXXXXX", quantity: "0" },
      { address: "1HolderXXXXXXXXXXXXXXXXXXXXXXXXXXX", quantity: "50" },
    ], [BURN]);
    expect(s.lockedPercent).toBe(50);
    expect(s.locked).toBe(500n);
  });
});
