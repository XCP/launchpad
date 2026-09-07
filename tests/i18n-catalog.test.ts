import { describe, expect, it } from "vitest";
import { collectMessages, mergeDerivedMessages } from "../apps/web/scripts/i18n-catalog.mjs";

describe("translation extraction", () => {
  it("collects conditional rich text and the runtime context argument positions", () => {
    const { keys } = collectMessages(`
      rich(t, held === 1 ? "Holds {count} token" : "Holds {count} tokens", { count: <b>{held}</b> });
      rich(t, issued?.count === 1 && !issued.capped ? "Issued {count} token" : "Issued {count} tokens", { count: <b>{issued.count}</b> });
      t("open", undefined, "bounty");
      t("All", "window");
      t("{n} open", { n: count }, "orders");
      rich(t, "Open {link}", { link: <a>link</a> }, "action");
    `);
    expect(keys.sort()).toEqual([
      "Holds {count} token", "Holds {count} tokens", "Issued {count} token", "Issued {count} tokens",
      "open@@bounty", "All@@window", "{n} open@@orders", "Open {link}@@action",
    ].sort());
  });

  it("reads the same escaped strings as JavaScript, ignores comments, and reports indirect labels", () => {
    const { keys, indirect } = collectMessages(String.raw`
      // t("Comment only")
      /* rich(t, "Documentation only", {}) */
      msg("Saved\nlabel");
      t("Quote: \"ok\"");
      t ("Whitespace before paren");
      t(count === 1 ? "One" : (count === 0 ? "None" : "Many"));
      t(item.label, { n: count });
    `);
    expect(keys.sort()).toEqual(["Saved\nlabel", 'Quote: "ok"', "Whitespace before paren", "One", "None", "Many"].sort());
    expect(indirect).toEqual(["item.label"]);
  });
});

describe("Traditional Chinese draft regeneration", () => {
  it("keeps reviewed regional edits and status metadata while refreshing machine drafts", () => {
    const existing = { reviewed: "台灣用語", machine: "Old draft", regional: "香港用語" };
    const status = { machine: ["machine", "removed"], reviewer: "regional review" };
    const result = mergeDerivedMessages(
      { reviewed: "Automatic replacement", machine: "New draft", added: "New entry" },
      existing,
      status,
    );
    expect(result.messages).toEqual({ reviewed: "台灣用語", machine: "New draft", regional: "香港用語", added: "New entry" });
    expect(result.status).toEqual({ machine: ["machine", "added"], reviewer: "regional review" });
    expect(existing.reviewed).toBe("台灣用語");
    expect(status.machine).toEqual(["machine", "removed"]);
  });

  it("treats existing entries without a status record as reviewed and new entries as drafts", () => {
    expect(mergeDerivedMessages({ old: "Generated", added: "New" }, { old: "Edited" })).toEqual({
      messages: { old: "Edited", added: "New" },
      status: { machine: ["added"] },
    });
    expect(mergeDerivedMessages({ first: "Draft" })).toEqual({
      messages: { first: "Draft" },
      status: { machine: ["first"] },
    });
  });
});
