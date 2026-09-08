import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as upload, PUT as edit } from "@/app/api/launches/route";
import { POST as session } from "@/app/api/session/route";
import { getMetadataBucket } from "@/lib/metadata";
import { issueSession, sameOrigin } from "@/lib/session";
import { validateProof } from "@xcp/wallet-sdk";

vi.mock("@/lib/metadata", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/metadata")>(), getMetadataBucket: vi.fn(),
}));
vi.mock("@/lib/session", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/session")>(), issueSession: vi.fn(), sameOrigin: vi.fn(),
}));
vi.mock("@xcp/wallet-sdk", async importOriginal => ({
  ...await importOriginal<typeof import("@xcp/wallet-sdk")>(), validateProof: vi.fn(),
}));

const put = vi.fn();
const request = (body: BodyInit, method = "POST", headers?: HeadersInit) => new Request("https://xcp.fun/api/launches", { method, body, headers, duplex: "half" } as RequestInit);
function oversized(size: number) {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array(size)); },
    cancel,
  });
  return { stream, cancel };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: [] })));
  vi.mocked(getMetadataBucket).mockResolvedValue({ put } as unknown as Awaited<ReturnType<typeof getMetadataBucket>>);
  vi.mocked(sameOrigin).mockReturnValue(true);
  vi.mocked(issueSession).mockResolvedValue("session-token");
  vi.mocked(validateProof).mockResolvedValue({ valid: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("upload and session request boundaries", () => {
  it.each([["POST", upload], ["PUT", edit]] as const)("refuses a streamed oversized %s before parsing, storage or upstream reads", async (method, handler) => {
    const f = oversized(4 * 1024 * 1024 + 64 * 1024 + 1);
    const res = await handler(request(f.stream, method, { "content-type": "multipart/form-data; boundary=test" }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Request body too large" });
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(getMetadataBucket).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([["POST", upload], ["PUT", edit]] as const)("returns 400 for malformed multipart on %s", async (method, handler) => {
    const res = await handler(request("broken form", method, { "content-type": "multipart/form-data" }));
    expect(res.status).toBe(400);
    expect(getMetadataBucket).not.toHaveBeenCalled();
  });

  it("keeps the complete 4 MiB image allowance plus UTF-8 form fields", async () => {
    const form = new FormData();
    form.set("asset", "TOKEN"); form.set("description", "😊".repeat(500));
    form.set("image", new File([new Uint8Array(4 * 1024 * 1024)], "art.png", { type: "image/png" }));
    const res = await upload(request(form));
    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0][1].byteLength).toBe(4 * 1024 * 1024);
  });

  it("still rejects an image above its 4 MiB limit within the envelope budget", async () => {
    const form = new FormData();
    form.set("asset", "TOKEN");
    form.set("image", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "art.png", { type: "image/png" }));
    const res = await upload(request(form));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Image too large (max 4 MB)" });
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses oversized proof JSON before cryptographic verification", async () => {
    const f = oversized(64 * 1024 + 1);
    const res = await session(request(f.stream));
    expect(res.status).toBe(413);
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(validateProof).not.toHaveBeenCalled();
    expect(issueSession).not.toHaveBeenCalled();
  });

  it("keeps valid proofs and malformed JSON behavior", async () => {
    const valid = await session(request(JSON.stringify({ proof: { address: "address", message: "message", signature: "signature" } })));
    expect(valid.status).toBe(200);
    expect(issueSession).toHaveBeenCalledExactlyOnceWith("address");
    const malformed = await session(request("not JSON"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Malformed body" });
  });

  it("retains the origin refusal before consuming a proof body", async () => {
    vi.mocked(sameOrigin).mockReturnValue(false);
    const read = vi.fn();
    const body = new ReadableStream({ pull() { read(); } }, { highWaterMark: 0 });
    expect((await session(request(body))).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });
});
