import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rich } from "../apps/web/src/lib/i18n/rich";
import { makeT } from "../apps/web/src/lib/i18n/t";

describe("rich", () => {
  const t = makeT({ "Call {compose} once per {n} launches.": "{n} 回のローンチごとに {compose} を一度呼びます。" });

  it("keeps the sentence whole and places the node where the translation puts it", () => {
    const html = renderToStaticMarkup(
      <>{rich(t, "Call {compose} once per {n} launches.", { compose: <code>compose</code>, n: 3 })}</>,
    );
    expect(html).toBe("3 回のローンチごとに <code>compose</code> を一度呼びます。");
  });

  it("falls back to the English with the node in its original place", () => {
    const html = renderToStaticMarkup(
      <>{rich(makeT({}), "Call {compose} once per {n} launches.", { compose: <code>compose</code>, n: 3 })}</>,
    );
    expect(html).toBe("Call <code>compose</code> once per 3 launches.");
  });
});
