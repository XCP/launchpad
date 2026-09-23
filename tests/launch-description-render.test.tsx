// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAssetDescription } from "@/lib/api/asset-description";
import { LaunchDescriptionContent } from "@/app/[lang]/[asset]/_components/launch-metadata";

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));
vi.mock("@/lib/client", () => ({ fetchJson: vi.fn() }));

const network = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", network.mockReset()));
afterEach(() => vi.unstubAllGlobals());

describe.each([
  "https://ordinals.com/content/examplei0?.json",
  "https://xcp.fun/FAKEBANG.json",
])("rendered description from %s", (pointer) => {
  function documentBody(json: unknown) {
    return pointer.startsWith("https://xcp.fun/")
      ? json
      : { result: { url: pointer, json } };
  }

  async function renderDescription() {
    const text = await fetchAssetDescription("FAKEBANG", pointer, "text/plain", null);
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <LaunchDescriptionContent text={text} description={pointer} mimeType="text/plain" asset="FAKEBANG" />,
    );
    return container;
  }

  it.each(["404", "missing", "empty", "wrong-type", "malformed"])("shows the original link for %s metadata", async (failure) => {
    const response = failure === "404" ? new Response(null, { status: 404 })
      : failure === "malformed" ? new Response("<html>Not JSON</html>")
      : Response.json(documentBody({
        asset: "FAKEBANG",
        ...(failure === "missing" ? {} : { description: failure === "empty" ? "  " : 42 }),
      }));
    network.mockResolvedValue(response);

    const container = await renderDescription();
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(pointer);
    expect(link?.textContent).toBe(pointer);
    expect(link?.getAttribute("rel")).toBe("noreferrer nofollow");
    expect(container.querySelector("blockquote")).toBeNull();
    expect(network).toHaveBeenCalledOnce();
  });

  it("renders JSON descriptions literally, with no HTML elements or interpreted entities", async () => {
    const description = '<b>In the beginning...</b> <img src=x onerror="alert(1)"><script>alert(1)</script><a href="https://example.com">link</a> &amp;';
    network.mockResolvedValue(Response.json(documentBody({ asset: "FAKEBANG", description })));

    const container = await renderDescription();
    expect(container.querySelector("blockquote p")?.textContent).toBe(description);
    expect(container.querySelector("b, img, script, a")).toBeNull();
    expect(network).toHaveBeenCalledOnce();
  });
});
