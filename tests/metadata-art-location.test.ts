import { describe, expect, it } from "vitest";
import {
  resolveMetadataArtLocation,
  type R2Bucket,
} from "@/lib/metadata";

function edgeCache() {
  const entries = new Map<string, Response>();
  return {
    cache: {
      match: async (key: Request) => entries.get(key.url)?.clone(),
      put: async (key: Request, value: Response) => {
        entries.set(key.url, value.clone());
      },
    } as unknown as Cache,
    entries,
  };
}

function context() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) },
    flush: () => Promise.all(pending.splice(0)),
  };
}

describe("metadata art location cache", () => {
  it("negative-caches missing art instead of repeating two R2 heads", async () => {
    let heads = 0;
    const bucket = {
      head: async () => {
        heads++;
        return null;
      },
    } as unknown as R2Bucket;
    const { cache } = edgeCache();
    const { ctx, flush } = context();

    expect(await resolveMetadataArtLocation(bucket, cache, ctx, "missing")).toBeNull();
    await flush();
    expect(await resolveMetadataArtLocation(bucket, cache, ctx, "MISSING")).toBeNull();
    expect(heads).toBe(2);
  });

  it("caches whether the object is an original or mirror together with its etag", async () => {
    let heads = 0;
    const bucket = {
      head: async (key: string) => {
        heads++;
        return key === "m/FOREIGN" ? { etag: "stage-4" } : null;
      },
    } as unknown as R2Bucket;
    const { cache } = edgeCache();
    const { ctx, flush } = context();

    const expected = { kind: "mirror", key: "m/FOREIGN", etag: "stage-4" };
    expect(await resolveMetadataArtLocation(bucket, cache, ctx, "foreign")).toEqual(expected);
    await flush();
    expect(await resolveMetadataArtLocation(bucket, cache, ctx, "FOREIGN")).toEqual(expected);
    expect(heads).toBe(2);
  });
});
