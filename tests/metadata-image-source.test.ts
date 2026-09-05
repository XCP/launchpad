import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { GET as imageSource } from "@/app/image-source/[asset]/[version]/route";
import { GET as publicImage } from "@/app/i/[asset]/route";
import { GET as heroArt } from "@/app/art/[asset]/route";
import { metadataArtLocationCacheKey, metadataCacheKey } from "@/lib/metadata";

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));

type Stored = { etag?: string; contentType?: string; bytes: string };

/**
 * An R2 bucket and an edge cache with the semantics the routes lean on: a
 * conditional GET whose precondition fails returns metadata without a body,
 * and cache entries are keyed by URL.
 */
function fixture() {
  const objects = new Map<string, Stored>();
  const entries = new Map<string, Response>();
  const pending: Promise<unknown>[] = [];
  const bucket = {
    head: vi.fn(async (key: string) => {
      const value = objects.get(key);
      return value ? { etag: value.etag, httpMetadata: { contentType: value.contentType } } : null;
    }),
    get: vi.fn(async (key: string, options?: { onlyIf: { etagMatches: string } }) => {
      const value = objects.get(key);
      if (!value) return null;
      const meta = { etag: value.etag, httpMetadata: { contentType: value.contentType } };
      if (!options) return { ...meta, body: new Response(value.bytes).body! };
      // R2 returns metadata but no body when a conditional read fails.
      return value.etag === options.onlyIf.etagMatches
        ? { ...meta, body: new Response(value.bytes).body! }
        : meta;
    }),
  };
  const cache = {
    match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => {
      entries.set(key.url, response.clone());
    }),
    delete: vi.fn(async (key: Request) => entries.delete(key.url)),
  };
  vi.stubGlobal("caches", { default: cache });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  vi.mocked(getCloudflareContext).mockResolvedValue({
    env: { METADATA: bucket },
    ctx: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) },
  } as unknown as Awaited<ReturnType<typeof getCloudflareContext>>);
  const conditionalGets = () => bucket.get.mock.calls.filter(([, options]) => options).length;
  const plainGets = () => bucket.get.mock.calls.filter(([, options]) => !options).length;
  return {
    objects,
    entries,
    bucket,
    cache,
    conditionalGets,
    plainGets,
    flush: () => Promise.all(pending.splice(0)),
    /** The Cache API is best-effort storage: model the bytes being evicted
     *  while the shorter-lived location entry survives. */
    evictBytes: () => {
      for (const url of [...entries.keys()]) {
        if (url.includes("/_image-version/")) entries.delete(url);
      }
    },
  };
}

function source(asset = "COIN", version = "version-1") {
  return imageSource(new Request(`https://xcp.fun/image-source/${asset}/${version}`), {
    params: Promise.resolve({ asset, version }),
  });
}

function image(asset = "COIN", query = "") {
  return publicImage(new Request(`https://xcp.fun/i/${asset}${query}`), {
    params: Promise.resolve({ asset }),
  });
}

function art(asset = "COIN") {
  return heroArt(new Request(`https://xcp.fun/art/${asset}`), {
    params: Promise.resolve({ asset }),
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("versioned metadata image source", () => {
  it("serves twenty identical originals with one GET and no HEADs", async () => {
    const f = fixture();
    f.objects.set("i/COIN", { etag: "version-1", contentType: "image/png", bytes: "original" });
    for (let i = 0; i < 20; i++) {
      const response = await source(i % 2 ? "coin" : "COIN");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("original");
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("x-metadata-cache")).toBe(i ? "HIT" : "MISS");
      await f.flush();
    }
    expect(f.bucket.head).not.toHaveBeenCalled();
    expect(f.bucket.get).toHaveBeenCalledExactlyOnceWith("i/COIN", { onlyIf: { etagMatches: "version-1" } });
  });

  it("reuses mirrored bytes only when the original is absent", async () => {
    const f = fixture();
    f.objects.set("m/COIN", { etag: "version-1", contentType: "image/webp", bytes: "mirror" });
    expect(await (await source()).text()).toBe("mirror");
    await f.flush();
    expect(await (await source()).text()).toBe("mirror");
    expect(f.bucket.get.mock.calls.map(([key]) => key)).toEqual(["i/COIN", "m/COIN"]);
    expect(f.bucket.head).not.toHaveBeenCalled();
  });

  it("does not substitute a matching mirror for a different original version", async () => {
    const f = fixture();
    f.objects.set("i/COIN", { etag: "owner-edit", bytes: "owner" });
    f.objects.set("m/COIN", { etag: "version-1", bytes: "mirror" });
    const response = await source();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(f.bucket.get).toHaveBeenCalledTimes(1);
    expect(f.cache.put).not.toHaveBeenCalled();
  });

  it("fetches an owner edit under its new version while retaining immutable old bytes", async () => {
    const f = fixture();
    f.objects.set("m/COIN", { etag: "version-1", bytes: "mirror-before-edit" });
    expect(await (await source()).text()).toBe("mirror-before-edit");
    await f.flush();
    f.objects.set("i/COIN", { etag: "version-2", bytes: "new-owner-original" });
    expect(await (await source("COIN", "version-2")).text()).toBe("new-owner-original");
    await f.flush();
    expect(await (await source()).text()).toBe("mirror-before-edit");
    expect(await (await source("COIN", "version-2")).text()).toBe("new-owner-original");
    expect(f.bucket.get).toHaveBeenCalledTimes(3);
  });

  it("refuses a replaced object instead of caching new bytes under the old version", async () => {
    const f = fixture();
    f.objects.set("i/COIN", { etag: "version-2", bytes: "new" });
    expect((await source()).status).toBe(404);
    expect(f.cache.put).not.toHaveBeenCalled();
    expect(await (await source("COIN", "version-2")).text()).toBe("new");
  });

  it("ignores legacy byte-cache entries that were not version-validated", async () => {
    const f = fixture();
    f.entries.set(metadataCacheKey("/_image-object/COIN/version-1").url, new Response("wrong replacement"));
    f.objects.set("i/COIN", { etag: "version-1", bytes: "verified" });
    expect(await (await source()).text()).toBe("verified");
    expect(f.bucket.get).toHaveBeenCalledTimes(1);
  });

  it("does not persist missing, etag-less or provisional CDN responses", async () => {
    const f = fixture();
    expect((await source()).status).toBe(404);
    f.objects.set("i/COIN", { bytes: "unversioned" });
    expect((await source()).status).toBe(404);
    expect(f.cache.put).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves valid bytes if the edge cache is unavailable or fails", async () => {
    const f = fixture();
    f.objects.set("i/COIN", { etag: "version-1", bytes: "available" });
    f.cache.match.mockRejectedValue(new Error("read unavailable"));
    f.cache.put.mockRejectedValue(new Error("write unavailable"));
    expect(await (await source()).text()).toBe("available");
    await f.flush();
    vi.stubGlobal("caches", undefined);
    expect(await (await source()).text()).toBe("available");
  });

  it("keeps different assets with the same etag isolated", async () => {
    const f = fixture();
    f.objects.set("i/COIN", { etag: "version-1", bytes: "coin" });
    f.objects.set("i/OTHER", { etag: "version-1", bytes: "other" });
    expect(await (await source()).text()).toBe("coin");
    await f.flush();
    expect(await (await source("OTHER")).text()).toBe("other");
  });
});

describe("public image route", () => {
  it("resolves ownership once and reads the bytes once for repeated requests", async () => {
    const f = fixture();
    f.objects.set("i/COIN", { etag: "version-1", contentType: "image/png", bytes: "original" });
    for (let i = 0; i < 5; i++) {
      const response = await image();
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("original");
      expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=31536000");
      expect(response.headers.get("x-metadata-cache")).toBe(i ? "HIT" : "MISS");
      await f.flush();
    }
    expect(f.bucket.head).toHaveBeenCalledTimes(1);
    expect(f.conditionalGets()).toBe(1);
    expect(f.plainGets()).toBe(0);
  });

  it("shares one byte-cache entry between the public route and the transform source", async () => {
    const f = fixture();
    f.objects.set("i/COIN", { etag: "version-1", bytes: "original" });
    expect(await (await image()).text()).toBe("original");
    await f.flush();
    const response = await source();
    expect(await response.text()).toBe("original");
    expect(response.headers.get("x-metadata-cache")).toBe("HIT");
    expect(f.bucket.get).toHaveBeenCalledTimes(1);
  });

  it("serves a replacement this edge has not seen without filing it under the old version", async () => {
    const f = fixture();
    f.objects.set("i/COIN", { etag: "version-1", bytes: "before" });
    expect(await (await image()).text()).toBe("before");
    await f.flush();

    // An owner edits on another edge: the object moves on, this edge's
    // location entry still says version-1, and its byte entry has been evicted.
    f.objects.set("i/COIN", { etag: "version-2", bytes: "after" });
    f.evictBytes();
    const stale = await image();
    expect(await stale.text()).toBe("after");
    expect(stale.headers.get("x-metadata-cache")).toBeNull();
    await f.flush();
    expect(f.entries.has(metadataCacheKey("/_image-version/COIN/version-2").url)).toBe(false);
    expect(f.cache.delete).toHaveBeenCalledWith(metadataArtLocationCacheKey("COIN"));

    // The next request re-resolves and caches the new version properly.
    const fresh = await image();
    expect(await fresh.text()).toBe("after");
    expect(fresh.headers.get("x-metadata-cache")).toBe("MISS");
    await f.flush();
    expect(f.bucket.head).toHaveBeenCalledTimes(2);
    expect(f.plainGets()).toBe(1);
    expect(await (await image()).text()).toBe("after");
  });

  it("redirects to the CDN when the remembered object was deleted", async () => {
    const f = fixture();
    f.objects.set("i/COIN", { etag: "version-1", bytes: "before" });
    await image();
    await f.flush();
    f.objects.delete("i/COIN");
    f.evictBytes();
    const response = await image("COIN", "?fb=full");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://cdn.xcp.io/img/full/COIN");
    expect(f.cache.delete).toHaveBeenCalledWith(metadataArtLocationCacheKey("COIN"));
  });
});

describe("hero art route", () => {
  it("reuses versioned bytes instead of reading R2 on every request", async () => {
    const f = fixture();
    f.objects.set("m/COIN", { etag: "stage-4", contentType: "image/jpeg", bytes: "mirror" });
    for (let i = 0; i < 3; i++) {
      const response = await art();
      expect(await response.text()).toBe("mirror");
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
      expect(response.headers.get("x-metadata-cache")).toBe(i ? "HIT" : "MISS");
      await f.flush();
    }
    expect(f.conditionalGets()).toBe(1);
    expect(f.plainGets()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("defaults an untyped object to image/png and serves an unseen edit unversioned", async () => {
    const f = fixture();
    f.objects.set("i/COIN", { etag: "version-1", bytes: "before" });
    expect((await art()).headers.get("content-type")).toBe("image/png");
    await f.flush();
    f.objects.set("i/COIN", { etag: "version-2", bytes: "after" });
    f.evictBytes();
    const response = await art();
    expect(await response.text()).toBe("after");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(f.cache.delete).toHaveBeenCalledWith(metadataArtLocationCacheKey("COIN"));
    expect(f.plainGets()).toBe(1);
  });
});
