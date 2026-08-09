"use client";

import { useState } from "react";

/** Copies the docs-as-markdown payload — for pasting into an LLM or README. */
export function CopyDocsButton({ markdown }: { markdown: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-400 hover:text-gray-900"
    >
      {state === "copied"
        ? "Copied ✓"
        : state === "failed"
          ? "Copy failed"
          : "Copy as Markdown"}
    </button>
  );
}
