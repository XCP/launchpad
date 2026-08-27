import { describe, expect, it } from "vitest";
import { historicalXcpUsdAt } from "#api/integrations/price";

describe("historical XCP/USD baseline", () => {
  const history = [
    { day: "2026-08-01", usd: 2 },
    { day: "2026-08-03", usd: 3 },
  ];

  it("uses the last known rate at or before the launch day", () => {
    const augustSecond = Date.parse("2026-08-02T12:00:00Z") / 1000;
    expect(historicalXcpUsdAt(history, augustSecond)).toBe(2);
  });

  it("never borrows a future rate", () => {
    const july = Date.parse("2026-07-31T12:00:00Z") / 1000;
    expect(historicalXcpUsdAt(history, july)).toBeNull();
  });
});
