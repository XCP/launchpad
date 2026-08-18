/**
 * Whether moving art still moves by the time it reaches the channel.
 *
 * Both halves fail silently. A WEBP sniffer that reads the wrong bit warns on
 * every still or on none, and either way the upload succeeds and looks fine.
 * A send that picks sendPhoto for a GIF posts a real message with a real
 * caption — it is just frozen, and nothing anywhere reports an error.
 */
import { describe, expect, it } from "vitest";
import { isAnimatedWebp } from "@/lib/animated-webp";
import { playsAsAnimation } from "#api/telegram/send";

/**
 * A WEBP header, built rather than fixtured so the one byte under test is
 * visible in the test. RIFF/WEBP, then either the extended VP8X chunk whose
 * flags carry the animation bit, or a plain lossy VP8 still.
 */
function webpHeader({ vp8x, flags }: { vp8x: boolean; flags: number }): Uint8Array {
  const b = new Uint8Array(32);
  const put = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
  };
  put(0, "RIFF");
  put(8, "WEBP");
  put(12, vp8x ? "VP8X" : "VP8 ");
  if (vp8x) {
    b[16] = 10; // VP8X payload is always 10 bytes
    b[20] = flags;
  }
  return b;
}

describe("isAnimatedWebp", () => {
  it("finds the animation flag in an extended header", () => {
    expect(isAnimatedWebp(webpHeader({ vp8x: true, flags: 0x02 }))).toBe(true);
  });

  it("ignores the other extended-header flags", () => {
    // ICC | alpha | EXIF | XMP, every bit set except animation. A sniffer
    // testing truthiness of the byte rather than the bit warns on all of these.
    expect(isAnimatedWebp(webpHeader({ vp8x: true, flags: 0x3c }))).toBe(false);
  });

  it("reads a flag byte that carries animation alongside alpha", () => {
    expect(isAnimatedWebp(webpHeader({ vp8x: true, flags: 0x12 }))).toBe(true);
  });

  it("says no to a plain still", () => {
    expect(isAnimatedWebp(webpHeader({ vp8x: false, flags: 0 }))).toBe(false);
  });

  it("says no to something that is not WEBP at all", () => {
    // A PNG signature. The flag offset lands inside the IHDR either way, so a
    // detector that skips the container check answers from unrelated bytes.
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png[20] = 0x02;
    expect(isAnimatedWebp(png)).toBe(false);
  });

  it("says no to a truncated file rather than reading past it", () => {
    expect(isAnimatedWebp(new Uint8Array(8))).toBe(false);
  });
});

describe("playsAsAnimation", () => {
  it("sends a GIF as an animation", () => {
    expect(playsAsAnimation("image/gif")).toBe(true);
  });

  it("tolerates a charset parameter and odd casing", () => {
    expect(playsAsAnimation("IMAGE/GIF; charset=binary")).toBe(true);
  });

  it("leaves every other type on sendPhoto", () => {
    // Animated WEBP included, deliberately: sendAnimation takes GIF and MP4
    // only, and handing it a WEBP gets a file card instead of a picture.
    for (const t of ["image/png", "image/jpeg", "image/webp", null]) {
      expect(playsAsAnimation(t)).toBe(false);
    }
  });
});
