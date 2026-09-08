import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { GET, POST } from "@/app/api/chat/route";
import { chatIdentity } from "@/lib/chat-identity";
import { issueSession, SESSION_COOKIE } from "@/lib/session";

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));

const address = "bc1qtest-wallet-address";
const secret = "chat-test-secret-0123456789abcdef0123456789";
const publish = vi.fn();
const env = {
  SESSION_SECRET: "session-test-secret-0123456789abcdef",
  CHAT_HANDLE_SECRET: secret,
  CHAT_ROOM: { idFromName: vi.fn(() => "global"), get: vi.fn(() => ({ publish })) },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCloudflareContext).mockResolvedValue({ env } as unknown as Awaited<ReturnType<typeof getCloudflareContext>>);
  publish.mockImplementation(async (post) => ({
    ok: true,
    message: { id: "message-1", authorId: post.authorId, handle: post.handle, text: post.text, createdAt: Date.now() },
  }));
});

async function request(body: unknown = { address, text: "hello", requestId: "request-123" }, options: { origin?: string; token?: string; raw?: string; contentType?: string } = {}) {
  const token = options.token ?? await issueSession(address);
  return new Request("https://xcp.fun/api/chat", {
    method: "POST",
    headers: {
      origin: options.origin ?? "https://xcp.fun",
      "content-type": options.contentType ?? "application/json",
      cookie: `${SESSION_COOKIE}=${token}`,
    },
    body: options.raw ?? JSON.stringify(body),
  });
}

describe("authenticated chat publishing", () => {
  it("derives the author from the signed cookie and forwards no address or supplied identity", async () => {
    const response = await POST(await request({ address, text: "  hello 日本語  ", requestId: "request-123", authorId: "impersonator", handle: "SomeoneElse" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const identity = await chatIdentity(address, secret);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ ...identity, requestId: "request-123", text: "hello 日本語" });
    expect(JSON.stringify(await response.json())).not.toContain(address);
    expect(env.CHAT_ROOM.idFromName).toHaveBeenCalledWith("global");
  });

  it("refuses forged cookies, absent origin and cross-origin writes", async () => {
    for (const options of [{ token: "forged.cookie" }, { origin: "https://attacker.example" }, { origin: "" }]) {
      expect((await POST(await request(undefined, options))).status).toBe(options.token ? 401 : 403);
    }
    expect(publish).not.toHaveBeenCalled();
  });

  it("refuses a different selected wallet even when the cookie itself is valid", async () => {
    const response = await POST(await request({ address: "wallet-B", text: "my message", requestId: "request-123" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "session_mismatch" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("bounds actual request bytes and validates the message and retry key", async () => {
    for (const body of [null, [], { address, text: " ", requestId: "request-123" }, { address, text: "x".repeat(281), requestId: "request-123" }, { address, text: "hello", requestId: "bad" }]) {
      expect((await POST(await request(body))).status).toBe(400);
    }
    expect((await POST(await request(undefined, { raw: JSON.stringify({ address, text: "x", requestId: "request-123", extra: "🧡".repeat(1100) }) }))).status).toBe(400);
    expect((await POST(await request(undefined, { raw: "{broken" }))).status).toBe(400);
    expect((await POST(await request(undefined, { contentType: "text/plain" }))).status).toBe(415);
    expect(publish).not.toHaveBeenCalled();
  });

  it("counts astral characters as codepoints and preserves message content", async () => {
    const text = "🐸".repeat(280);
    expect((await POST(await request({ address, text, requestId: "request-123" }))).status).toBe(200);
    expect(publish.mock.calls[0][0].text).toBe(text);
  });

  it("returns authoritative cooldowns and refuses unavailable posting", async () => {
    publish.mockResolvedValueOnce({ ok: false, error: "rate_limited", retryAfter: 3 });
    const limited = await POST(await request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3");
    expect(await limited.json()).toEqual({ error: "rate_limited", retryAfter: 3 });
    publish.mockRejectedValueOnce(new Error("internal detail with a wallet address"));
    const failed = await POST(await request());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "unavailable" });
  });

  it("fails closed when the chat identity secret is absent", async () => {
    const req = await request();
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: { ...env, CHAT_HANDLE_SECRET: undefined } } as unknown as Awaited<ReturnType<typeof getCloudflareContext>>);
    expect((await POST(req)).status).toBe(503);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("chat pseudonyms", () => {
  it("returns the signed-in browser's handle without querying or publishing to the room", async () => {
    const req = await request();
    const response = await GET(new Request("https://xcp.fun/api/chat", { headers: { cookie: req.headers.get("cookie")! } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ address, ...await chatIdentity(address, secret), isAdmin: false });
    expect(env.CHAT_ROOM.get).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect((await GET(new Request("https://xcp.fun/api/chat"))).status).toBe(401);
  });
  it("is stable for the same wallet and secret, with separate identities for different wallets or secrets", async () => {
    const first = await chatIdentity(address, secret);
    expect(await chatIdentity(address, secret)).toEqual(first);
    expect(await chatIdentity("wallet-B", secret)).not.toEqual(first);
    expect(await chatIdentity(address, `${secret}-rotated`)).not.toEqual(first);
    expect(first.authorId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.handle).toMatch(/^[A-Za-z]+[A-Z2-7]{4}$/);
    expect(first.handle.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(first)).not.toContain(address);
    await expect(chatIdentity(address, "short")).rejects.toThrow();
  });
});
