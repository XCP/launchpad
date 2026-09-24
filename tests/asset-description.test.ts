import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { fetchAssetDescription } from "@/lib/api/asset-description";

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));

const stored = new Map<string, string>();
const bucketGet = vi.fn(async (key: string) => {
  const text = stored.get(key);
  return text === undefined ? null : { body: new Response(text).body };
});

const pointer = "https://ordinals.com/content/354f99d595b3c801b3744a57900470fe8a62e5aebc0b34ebc06c26d5d60ac72di0?.json";
const metadata = { asset: "FAKEBANG", description: "In the beginning..." };
const network = vi.fn();
const read = () => fetchAssetDescription("FAKEBANG", pointer, "text/plain", null);
const envelope = (json: unknown = metadata, url = pointer) => ({ result: { url, json, verified: false } });

beforeEach(() => {
  vi.stubGlobal("fetch", network.mockReset());
  stored.clear();
  bucketGet.mockClear();
  vi.mocked(getCloudflareContext).mockResolvedValue({ env: { METADATA: { get: bucketGet } }, ctx: {} } as never);
});
afterEach(() => vi.unstubAllGlobals());

describe("enhanced asset descriptions", () => {
  it("reads a JSON marker in the query through the explorer without contacting the issuer", async () => {
    network.mockResolvedValue(Response.json(envelope()));
    expect(await read()).toBe("In the beginning...");
    expect(network).toHaveBeenCalledExactlyOnceWith(
      "https://api.xcp.io/v2/assets/FAKEBANG/enhanced",
      expect.objectContaining({ next: { revalidate: 300 }, signal: expect.any(AbortSignal), redirect: "manual" }),
    );
  });

  it("works for another asset and keeps descriptions as plain text", async () => {
    network.mockResolvedValue(Response.json(envelope({ asset: "anothercoin", description: "Small <b>beginning</b>." }, "https://artist.example/card.json")));
    expect(await fetchAssetDescription("ANOTHERCOIN", "https://artist.example/card.json", undefined, null))
      .toBe("Small <b>beginning</b>.");
  });

  it.each([302, 307, 404, 500])("keeps fallback and releases the response for HTTP %s", async (status) => {
    const cancel = vi.fn();
    network.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status }));
    expect(await read()).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    { result: null },
    { result: { url: pointer, error: "source returned 404", json: metadata } },
    envelope(metadata, "https://artist.example/different.json"),
    envelope(null),
    envelope([metadata]),
    envelope({ description: "Unidentified document" }),
    envelope({ asset: "OTHERCOIN", description: "Someone else's words" }),
    envelope({ asset: "FAKEBANG" }),
    envelope({ asset: "FAKEBANG", description: null }),
    envelope({ asset: "FAKEBANG", description: 123 }),
    envelope({ asset: "FAKEBANG", description: "  " }),
  ])("does not display malformed or mismatched enhanced info: %j", async (body) => {
    network.mockResolvedValue(Response.json(body));
    expect(await read()).toBeNull();
  });

  it("tolerates invalid JSON, network errors, and timeouts without breaking the page", async () => {
    network.mockResolvedValueOnce(new Response("<html>Not JSON</html>"))
      .mockRejectedValueOnce(new Error("network failed"))
      .mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
    expect(await read()).toBeNull();
    expect(await read()).toBeNull();
    expect(await read()).toBeNull();
  });

  it("bounds streamed bodies even when Content-Length is absent", async () => {
    const cancel = vi.fn();
    network.mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1)); }, cancel,
    })));
    expect(await read()).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reads our hosted metadata from the bucket, never over HTTP to our own zone", async () => {
    stored.set("j/FAKEBANG", JSON.stringify({ asset: "FAKEBANG", description: " Crystallized bitcoin. " }));
    expect(await fetchAssetDescription("FAKEBANG", "https://xcp.fun/FAKEBANG.json", "text/plain", null))
      .toBe("Crystallized bitcoin.");
    expect(await fetchAssetDescription("FAKEBANG", "https://xcp.fun/j/FAKEBANG.json", undefined, null))
      .toBe("Crystallized bitcoin.");
    expect(bucketGet).toHaveBeenCalledWith("j/FAKEBANG");
    expect(network).not.toHaveBeenCalled();
  });

  it("retains hosted legacy metadata support and caps the displayed text", async () => {
    stored.set("j/FAKEBANG", JSON.stringify({ description: "x".repeat(2_001) }));
    expect(await fetchAssetDescription("FAKEBANG", "https://xcp.fun/FAKEBANG.json", undefined, null))
      .toHaveLength(2_000);
  });

  it.each([
    ["another asset's document", "https://xcp.fun/OTHERCOIN.json"],
    ["a non-metadata path", "https://xcp.fun/FAKEBANG"],
    ["a missing document", "https://xcp.fun/FAKEBANG.json"],
  ])("keeps the link fallback for %s", async (_, url) => {
    stored.set("j/OTHERCOIN", JSON.stringify({ asset: "OTHERCOIN", description: "Someone else's words" }));
    expect(await fetchAssetDescription("FAKEBANG", url, undefined, null)).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects a hosted document that names a different asset", async () => {
    stored.set("j/FAKEBANG", JSON.stringify({ asset: "OTHERCOIN", description: "Someone else's words" }));
    expect(await fetchAssetDescription("FAKEBANG", "https://xcp.fun/FAKEBANG.json", undefined, null)).toBeNull();
  });

  it("needs no metadata request for curated prose, on-chain prose, or inscription content", async () => {
    expect(await fetchAssetDescription("FAKEBANG", pointer, undefined, " Creator edit ")).toBe("Creator edit");
    expect(await fetchAssetDescription("FAKEBANG", "An ordinary description.", undefined, null)).toBe("An ordinary description.");
    expect(await fetchAssetDescription("FAKEBANG", "<html>Inscription</html>", "text/html", null)).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });
});
