import { describe, expect, it } from "vitest";
import {
  btcSatsToXcp,
  continuousThresholds,
  coordinatedFirstExitPnlXcp,
  coordinatedFirstExitProceedsXcp,
  randomOrderExpectedPnlXcp,
  scenarioCashFlow,
  sequentialSellerProceedsXcp,
  totalSequentialExitProceedsXcp,
} from "@/app/research/_lib/economics";

describe("XCP-69 research economics", () => {
  it("reproduces the coordinated first-exit checkpoints", () => {
    expect(coordinatedFirstExitProceedsXcp(20)).toBeCloseTo(269.76424361, 8);
    expect(coordinatedFirstExitPnlXcp(20)).toBeCloseTo(69.76424361, 8);
    expect(coordinatedFirstExitPnlXcp(69)).toBeCloseTo(-214.64050976, 8);
  });

  it("finds the continuous optimum and nonzero break-even", () => {
    const { optimum, breakEven } = continuousThresholds();
    expect(optimum).toBeCloseTo(15.209604, 6);
    expect(breakEven).toBeCloseTo(37.844221, 6);
  });

  it("replays independent one-million-token exits in order", () => {
    expect(sequentialSellerProceedsXcp(1)).toBeCloseTo(21.45804031, 8);
    expect(sequentialSellerProceedsXcp(15)).toBeCloseTo(10.30170805, 8);
    expect(sequentialSellerProceedsXcp(16)).toBeCloseTo(9.8643869, 7);
    expect(sequentialSellerProceedsXcp(69)).toBeCloseTo(2.16231013, 8);
    expect(totalSequentialExitProceedsXcp()).toBeCloseTo(474.85557405, 8);
  });

  it("uses symmetry for the random-order expectation", () => {
    const expectedPerBag = totalSequentialExitProceedsXcp() / 69 - 10;
    expect(randomOrderExpectedPnlXcp(20)).toBeCloseTo(expectedPerBag * 20, 10);
  });

  it("keeps unsold inventory separate from cash recovery", () => {
    const result = scenarioCashFlow({
      controlledAddresses: 20,
      priorFullSellers: 0,
      sellShare: 0.5,
      overheadXcpPerAddress: 0,
    });
    expect(result.soldMillions).toBe(10);
    expect(result.retainedMillions).toBe(10);
    expect(result.capitalXcp).toBe(200);
    expect(result.proceedsXcp).toBeCloseTo(167.65567765, 8);
    expect(result.pnlXcpEquivalent).toBeCloseTo(-32.34432235, 8);
  });

  it("converts Bitcoin overhead through the frozen price ratio", () => {
    expect(btcSatsToXcp(700, 73_943.04, 1.7928632703560288)).toBeCloseTo(
      0.2887009225,
      9,
    );
  });
});
