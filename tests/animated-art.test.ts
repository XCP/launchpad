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
import { isProvisionalArt, playsAsAnimation } from "#api/telegram/send";
import { stampArtVersion } from "#api/telegram/art";

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

describe("isProvisionalArt", () => {
  it("knows the CDN's not-yet-ingested placeholder by its own header", () => {
    // cdn.xcp.io answers for an asset it has never seen with a 48x48 grey
    // square marked private — the one thing that distinguishes it from art.
    expect(isProvisionalArt("private, max-age=60")).toBe(true);
    expect(isProvisionalArt("Private, max-age=60")).toBe(true);
  });

  it("leaves everything this site serves alone", () => {
    // Our own original, our mirror of somebody else's art, and the CDN's
    // ingested copy. All three are the launch's real picture.
    for (const cc of [
      "public, max-age=3600, s-maxage=31536000",
      "public, max-age=300",
      "public, max-age=31536000, immutable",
      null,
    ]) {
      expect(isProvisionalArt(cc)).toBe(false);
    }
  });

  it("does not read the word out of a longer directive", () => {
    // A substring match on "private" would fire on this and drop the picture
    // from every announcement that carried it.
    expect(isProvisionalArt("public, no-transform, privately-held=1")).toBe(false);
  });
});

describe("stampArtVersion", () => {
  const bucket = (etags: Record<string, string>) =>
    ({
      head: async (key: string) => (etags[key] ? { etag: etags[key] } : null),
    }) as unknown as R2Bucket;

  const announcement = { text: "minted", photo: "https://xcp.fun/full/A?fb=full", asset: "A" };

  it("names the version of the art it is actually showing", async () => {
    const a = await stampArtVersion(bucket({ "i/A": "v1" }), announcement);
    expect(a.photo).toBe("https://xcp.fun/full/A?fb=full&v=v1");
  });

  it("moves to a URL Telegram has never seen when the art is replaced", async () => {
    // The whole point. Telegram re-sends the file it cached against a URL
    // rather than fetching it again, so a stage change that kept the URL
    // would keep showing the previous stage forever.
    const before = await stampArtVersion(bucket({ "m/A": "stage3" }), announcement);
    const after = await stampArtVersion(bucket({ "m/A": "stage4" }), announcement);
    expect(before.photo).not.toBe(after.photo);
  });

  it("prefers our own upload to our mirror of somebody else's", async () => {
    const a = await stampArtVersion(bucket({ "i/A": "ours", "m/A": "theirs" }), announcement);
    expect(a.photo).toContain("v=ours");
  });

  it("leaves a foreign launch's CDN art unstamped", async () => {
    // Nothing of ours to version, and the CDN's copy is immutable anyway.
    expect((await stampArtVersion(bucket({}), announcement)).photo).toBe(announcement.photo);
  });

  it("does not lose an announcement to a failing bucket", async () => {
    const broken = {
      head: async () => {
        throw new Error("R2 is having a day");
      },
    } as unknown as R2Bucket;
    expect((await stampArtVersion(broken, announcement)).photo).toBe(announcement.photo);
  });

  it("leaves a message with no picture alone", async () => {
    const text = { text: "the queue got long", photo: null, asset: null };
    expect(await stampArtVersion(bucket({ "i/A": "v1" }), text)).toEqual(text);
  });
});
