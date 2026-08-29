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
      className="shrink-0 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-600 hover:text-gray-900 dark:hover:text-gray-100"
    >
      {state === "copied"
        ? "Copied ✓"
        : state === "failed"
          ? "Copy failed"
          : "Copy as Markdown"}
    </button>
  );
}
