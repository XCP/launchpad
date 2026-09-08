import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Separate processes exercise actual Intl defaults without changing a Vitest
// worker's timezone. Both sides of midnight expose server/browser date drift.
const script = buildSync({
  stdin: {
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    contents: `
      import { monthDay } from './apps/web/src/lib/chain-time.ts';
      const times = ['2026-08-19T00:00:00Z', '2026-08-19T23:30:00Z'].map(Date.parse);
      console.log(JSON.stringify({
        hostDates: times.map(time => new Date(time).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric',
        })),
        dates: times.map(time => monthDay(time)),
        hours: times.map(time => monthDay(time, 'en-US', true)),
        japanese: times.map(time => monthDay(time, 'ja-JP')),
      }));
    `,
  },
  alias: { "@": fileURLToPath(new URL("../apps/web/src", import.meta.url)) },
  bundle: true, write: false, platform: "node", format: "cjs",
}).outputFiles[0].text;

describe("UTC chart candle labels", () => {
  it.each([
    { zone: "UTC", hostDates: ["Aug 19", "Aug 19"] },
    { zone: "America/New_York", hostDates: ["Aug 18", "Aug 19"] },
    { zone: "Asia/Tokyo", hostDates: ["Aug 19", "Aug 20"] },
  ])("keeps daily and hourly labels stable in $zone", ({ zone, hostDates }) => {
    const actual = JSON.parse(execFileSync(process.execPath, ["-e", script], {
      env: { ...process.env, TZ: zone }, encoding: "utf8",
    }));

    // Prove each child really has the intended host-zone behavior.
    expect(actual.hostDates).toEqual(hostDates);
    expect(actual.dates).toEqual(["Aug 19", "Aug 19"]);
    expect(actual.hours).toEqual(["Aug 19, 12:00 AM", "Aug 19, 11:30 PM"]);
    expect(actual.japanese).toEqual(["8月19日", "8月19日"]);
  });
});
