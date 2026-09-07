"use client";

/**
 * The last boundary: a throw in the root layout, or in the locale boundary
 * itself, lands here. It replaces the document, so it must render its own
 * `<html>` and `<body>` and must not import anything that could fail — no i18n
 * loader, no providers, no stylesheet-dependent classes. Inline styles only,
 * English only, and nothing that reads the URL.
 *
 * If this file is ever the thing on screen, something structural broke rather
 * than one upstream read; the locale boundary in `[lang]/error.tsx` is what
 * handles the ordinary case.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#171717", background: "#fff" }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: "96px 16px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 12px" }}>This page didn&rsquo;t load</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#666", margin: "0 0 20px" }}>
            Something failed while building it. Trying again usually works.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              color: "#fff",
              background: "#171717",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#999", marginTop: 24 }}>Reference {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
