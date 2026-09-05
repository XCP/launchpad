import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLaunchPage } from "@/lib/api/launchpad-api";

const runtime = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(async () => ({ env: {}, cf: undefined })),
}));
vi.mock("@opennextjs/cloudflare", () => runtime);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("public launch API cache policy", () => {
  it("lets a server render enter Next's cache instead of opting the whole page out", async () => {
    const fetcher = vi.fn(async () => Response.json({ result: [], total: 0 }));
    vi.stubGlobal("fetch", fetcher);
    const page = await fetchLaunchPage("minting", undefined, 12, 0);
    expect(page?.total).toBe(0);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/v2/launches?phase=minting"),
      expect.objectContaining({ cache: "force-cache", next: { revalidate: 30 } }),
    );
  });

  it("continues bypassing the browser cache so visible polls stay fresh", async () => {
    vi.stubGlobal("window", {});
    const fetcher = vi.fn(async () => Response.json({ result: [], total: 0 }));
    vi.stubGlobal("fetch", fetcher);
    await fetchLaunchPage("minting", undefined, 12, 0);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/v2/launches?phase=minting"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
