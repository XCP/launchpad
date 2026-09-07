"use client";

/**
 * The last boundary: a throw in the root layout, or in the locale boundary
 * itself, lands here. It replaces the document, so it must render its own
 * `<html>` and `<body>` and must not import anything that could fail — no i18n
 * loader, no providers, no stylesheet-dependent classes. Inline styles only.
 *
 * If this file is ever the thing on screen, something structural broke rather
 * than one upstream read; the locale boundary in `[lang]/error.tsx` is what
 * handles the ordinary case.
 *
 * The copy is inline, and duplicated from that sibling on purpose. A boundary
 * that reaches for the machinery the page uses can fail for the same reason
 * the page did, and a boundary that throws renders nothing at all. Reading the
 * first path segment is the one exception: it is a string, not a dependency,
 * and it costs nothing to be wrong about — an unrecognised segment is English.
 *
 * This was English-only until the site had eleven locales. Showing a Russian
 * visitor an English failure page is a worse answer than the duplication.
 */

const COPY: Record<string, { title: string; body: string; retry: string }> = {
  en: {
    title: "This page didn't load",
    body: "Something failed while building it. Trying again usually works.",
    retry: "Try again",
  },
  ja: {
    title: "このページを読み込めませんでした",
    body: "ページの生成中に問題が発生しました。もう一度お試しいただくと成功することがほとんどです。",
    retry: "再試行",
  },
  zh: {
    title: "此页面未能加载",
    body: "生成页面时出错。重试通常可以解决。",
    retry: "重试",
  },
  "zh-tw": {
    title: "此頁面未能載入",
    body: "產生頁面時發生錯誤。重試通常可以解決。",
    retry: "重試",
  },
  "zh-hk": {
    title: "此頁面未能載入",
    body: "產生頁面時發生錯誤。重試通常可以解決。",
    retry: "重試",
  },
  es: {
    title: "Esta página no se cargó",
    body: "Algo falló al generarla. Volver a intentarlo suele funcionar.",
    retry: "Reintentar",
  },
  ko: {
    title: "이 페이지를 불러오지 못했습니다",
    body: "페이지를 만드는 중 문제가 발생했습니다. 다시 시도하면 대개 성공합니다.",
    retry: "다시 시도",
  },
  pt: {
    title: "Esta página não carregou",
    body: "Algo falhou enquanto ela era gerada. Tentar de novo costuma resolver.",
    retry: "Tentar de novo",
  },
  fr: {
    title: "Cette page n'a pas pu se charger",
    body: "Quelque chose a échoué pendant sa génération. Réessayer suffit le plus souvent.",
    retry: "Réessayer",
  },
  ru: {
    title: "Страница не загрузилась",
    body: "При её сборке произошёл сбой. Обычно достаточно повторить попытку.",
    retry: "Повторить",
  },
  uk: {
    title: "Сторінка не завантажилася",
    body: "Під час її збирання стався збій. Зазвичай достатньо повторити спробу.",
    retry: "Повторити",
  },
};

/** The first path segment, when it names a locale we have copy for. Guarded
 *  for the server pass, where there is no location to read. */
function localeFromPath(): string {
  if (typeof window === "undefined") return "en";
  const segment = window.location.pathname.split("/")[1] ?? "";
  return segment in COPY ? segment : "en";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const lang = localeFromPath();
  const copy = COPY[lang] ?? COPY.en!;

  return (
    <html lang={lang}>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#171717", background: "#fff" }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: "96px 16px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 12px" }}>{copy.title}</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#666", margin: "0 0 20px" }}>{copy.body}</p>
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
            {copy.retry}
          </button>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#999", marginTop: 24 }}>Reference {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
