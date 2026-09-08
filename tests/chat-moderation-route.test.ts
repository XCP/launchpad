import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { GET, POST } from "@/app/api/chat/moderation/route";
import { GET as identityGET } from "@/app/api/chat/route";
import { chatIdentity } from "@/lib/chat-identity";
import { issueSession, SESSION_COOKIE } from "@/lib/session";

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));
const admin = "19QWXpMXeLkoEKEJv2xo9rn8wkPCyxACSX";
const other = "another-verified-wallet";
const target = "a".repeat(64);
const secret = "chat-test-secret-0123456789abcdef0123456789";
const listBans = vi.fn();
const setBan = vi.fn();
const env = {
  SESSION_SECRET: "session-test-secret-0123456789abcdef",
  CHAT_HANDLE_SECRET: secret,
  CHAT_ADMIN_ADDRESSES: admin,
  CHAT_ROOM: { idFromName: vi.fn(() => "global"), get: vi.fn(() => ({ listBans, setBan })) },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCloudflareContext).mockResolvedValue({ env } as unknown as Awaited<ReturnType<typeof getCloudflareContext>>);
  listBans.mockResolvedValue([]);
  setBan.mockImplementation(async (authorId, banned) => ({ ok: true, authorId, banned, ban: null }));
});

async function request(options: { wallet?: string; token?: string; method?: "GET" | "POST"; origin?: string; body?: unknown; raw?: string; contentType?: string } = {}) {
  const token = options.token ?? await issueSession(options.wallet ?? admin);
  const method = options.method ?? "POST";
  return new Request("https://xcp.fun/api/chat/moderation", {
    method,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, origin: options.origin ?? "https://xcp.fun", "content-type": options.contentType ?? "application/json" },
    ...(method === "POST" ? { body: options.raw ?? JSON.stringify(options.body ?? { address: admin, authorId: target, banned: true }) } : {}),
  });
}

describe("chat moderation authorization", () => {
  it("grants identity capability only to the exact verified admin address", async () => {
    for (const wallet of [admin, other, admin.toLowerCase()]) {
      const response = await identityGET(await request({ wallet, method: "GET" }));
      expect((await response.json()).isAdmin).toBe(wallet === admin);
    }
    expect(env.CHAT_ROOM.get).not.toHaveBeenCalled();
  });

  it("rejects ordinary wallets, forged cookies and client-supplied admin claims before room access", async () => {
    for (const method of ["GET", "POST"] as const) {
      expect((await (method === "GET" ? GET : POST)(await request({ method, wallet: other }))).status).toBe(403);
      expect((await (method === "GET" ? GET : POST)(await request({ method, token: "forged.cookie" }))).status).toBe(401);
    }
    expect(env.CHAT_ROOM.get).not.toHaveBeenCalled();
  });

  it("fails closed without a configured allowlist", async () => {
    const req = await request();
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: { ...env, CHAT_ADMIN_ADDRESSES: undefined } } as unknown as Awaited<ReturnType<typeof getCloudflareContext>>);
    expect((await POST(req)).status).toBe(403);
    expect(setBan).not.toHaveBeenCalled();
  });

  it("returns private ban lists and forwards only the opaque target and decision", async () => {
    const ban = { authorId: target, handle: "FrogABCD", createdAt: Date.now() };
    listBans.mockResolvedValueOnce([ban]);
    const response = await GET(await request({ method: "GET" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ bans: [ban] });
    for (const banned of [true, false]) {
      const updated = await POST(await request({ body: { address: admin, authorId: target, banned, isAdmin: true, handle: "forged" } }));
      expect(updated.status).toBe(200);
      expect(updated.headers.get("cache-control")).toBe("private, no-store");
      expect(setBan).toHaveBeenLastCalledWith(target, banned);
      expect(JSON.stringify(await updated.json())).not.toContain(admin);
    }
  });

  it("refuses cross-origin requests and selected-wallet races", async () => {
    for (const origin of ["https://attacker.example", ""]) expect((await POST(await request({ origin }))).status).toBe(403);
    expect((await POST(await request({ body: { address: other, authorId: target, banned: true } }))).status).toBe(409);
    expect(setBan).not.toHaveBeenCalled();
  });

  it("bounds actual body size and rejects malformed target/decisions without mutation", async () => {
    for (const body of [[], { address: admin, authorId: "bad", banned: true }, { address: admin, authorId: target, banned: "false" }, { address: admin, authorId: target }]) {
      expect((await POST(await request({ body }))).status).toBe(400);
    }
    expect((await POST(await request({ raw: "{bad" }))).status).toBe(400);
    expect((await POST(await request({ raw: JSON.stringify({ padding: "🐸".repeat(1100) }) }))).status).toBe(400);
    expect((await POST(await request({ contentType: "text/plain" }))).status).toBe(415);
    expect(setBan).not.toHaveBeenCalled();
  });

  it("prevents accidental self-ban but permits undoing an existing one", async () => {
    const { authorId } = await chatIdentity(admin, secret);
    expect((await POST(await request({ body: { address: admin, authorId, banned: true } }))).status).toBe(400);
    expect(setBan).not.toHaveBeenCalled();
    expect((await POST(await request({ body: { address: admin, authorId, banned: false } }))).status).toBe(200);
  });

  it("reports capacity/unavailability without leaking internals", async () => {
    setBan.mockResolvedValueOnce({ ok: false, error: "ban_limit" });
    expect((await POST(await request())).status).toBe(409);
    setBan.mockRejectedValueOnce(new Error("private server error"));
    const failed = await POST(await request());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "unavailable" });
    listBans.mockRejectedValueOnce(new Error("private server error"));
    expect((await GET(await request({ method: "GET" }))).status).toBe(503);
  });
});
