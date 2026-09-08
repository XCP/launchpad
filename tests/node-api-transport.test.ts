import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeApiFetch } from "@/lib/api/node";

afterEach(() => vi.unstubAllGlobals());

describe("first-party node transport", () => {
  it("preserves Next's persistent-cache options and caller deadline on server reads", async () => {
    const http = vi.fn(async () => Response.json({ result: [] })); vi.stubGlobal("fetch", http);
    const init = { next: { revalidate: 31_536_000 }, signal: new AbortController().signal };
    await nodeApiFetch("/transactions/creation/events/NEW_FAIRMINTER", init);
    expect(http).toHaveBeenCalledExactlyOnceWith("https://api.xcp.fun/node/v2/transactions/creation/events/NEW_FAIRMINTER", init);
  });

  it("does not replay transport failure against the public node", async () => {
    const http = vi.fn().mockRejectedValue(new Error("unavailable")); vi.stubGlobal("fetch", http);
    await expect(nodeApiFetch("/assets/EVOLVEDPEPE/fairminters")).rejects.toThrow("unavailable");
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("uses only the public first-party origin in a browser", async () => {
    vi.stubGlobal("window", {});
    const response = Response.json({ result: [] });
    const http = vi.fn(async () => response); vi.stubGlobal("fetch", http);
    expect(await nodeApiFetch("/assets/EVOLVEDPEPE/fairminters")).toBe(response);
    expect(http.mock.calls[0][0]).toBe("https://api.xcp.fun/node/v2/assets/EVOLVEDPEPE/fairminters");
  });
});
