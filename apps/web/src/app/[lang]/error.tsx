"use client";

/**
 * What a visitor sees when a server render throws.
 *
 * Until this file existed there was no boundary anywhere in the app, so one
 * failed upstream read — a Counterparty throttle, a cancelled subrequest —
 * replaced the whole page with Next's built-in 500 and an error digest. The
 * digest is a hash of the stack that is deliberately meaningless to the person
 * reading it and, because Next prints it to the browser rather than logging it,
 * meaningless to us as well: it cannot be searched for in Workers Logs.
 *
 * This boundary keeps the site's own chrome, says the one thing the visitor can
 * act on, and offers the retry that usually works, because the failures behind
 * it are transient by nature.
 *
 * The copy is inline rather than loaded through the i18n server helpers on
 * purpose. A boundary that depends on the same machinery the page does can fail
 * for the same reason, and an error boundary that throws renders nothing at
 * all. Eleven short strings are cheap insurance; the locale comes from the URL,
 * which is the only thing that ever decides language here.
 */

import { useEffect } from "react";
import { useParams } from "next/navigation";

const COPY: Record<string, { title: string; body: string; retry: string; home: string }> = {
  en: {
    title: "This page didn't load",
    body: "Something upstream failed while building it. Trying again usually works.",
    retry: "Try again",
    home: "Go home",
  },
  ja: {
    title: "このページを読み込めませんでした",
    body: "ページの生成中に外部サービスの取得に失敗しました。もう一度お試しいただくと成功することがほとんどです。",
    retry: "再試行",
    home: "ホームへ",
  },
  zh: {
    title: "此页面未能加载",
    body: "生成页面时上游服务出错。重试通常可以解决。",
    retry: "重试",
    home: "返回首页",
  },
  "zh-tw": {
    title: "此頁面未能載入",
    body: "產生頁面時上游服務發生錯誤。重試通常可以解決。",
    retry: "重試",
    home: "返回首頁",
  },
  "zh-hk": {
    title: "此頁面未能載入",
    body: "產生頁面時上游服務發生錯誤。重試通常可以解決。",
    retry: "重試",
    home: "返回首頁",
  },
  es: {
    title: "Esta página no se cargó",
    body: "Falló un servicio externo al generarla. Volver a intentarlo suele funcionar.",
    retry: "Reintentar",
    home: "Ir al inicio",
  },
  ko: {
    title: "이 페이지를 불러오지 못했습니다",
    body: "페이지를 만드는 중 외부 서비스 요청이 실패했습니다. 다시 시도하면 대개 성공합니다.",
    retry: "다시 시도",
    home: "홈으로",
  },
  pt: {
    title: "Esta página não carregou",
    body: "Um serviço externo falhou enquanto ela era gerada. Tentar de novo costuma resolver.",
    retry: "Tentar de novo",
    home: "Ir para o início",
  },
  fr: {
    title: "Cette page n'a pas pu se charger",
    body: "Un service externe a échoué pendant sa génération. Réessayer suffit le plus souvent.",
    retry: "Réessayer",
    home: "Accueil",
  },
  ru: {
    title: "Страница не загрузилась",
    body: "Внешний сервис не ответил при её сборке. Обычно достаточно повторить попытку.",
    retry: "Повторить",
    home: "На главную",
  },
  uk: {
    title: "Сторінка не завантажилася",
    body: "Зовнішній сервіс не відповів під час її збирання. Зазвичай достатньо повторити спробу.",
    retry: "Повторити",
    home: "На головну",
  },
};

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ lang?: string }>();
  const lang = typeof params?.lang === "string" ? params.lang : "en";
  const copy = COPY[lang] ?? COPY.en!;
  const home = lang === "en" ? "/" : `/${lang}`;

  // Next logs the server-side stack itself; this covers the client half, where
  // nothing else would record it. The digest goes in so a report from a visitor
  // can at least be matched against the browser console.
  useEffect(() => {
    console.error("render failed", error.digest ?? "", error.message);
  }, [error]);

  return (
    <main className="mx-auto flex max-w-md flex-col items-start gap-4 px-4 py-24">
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">{copy.body}</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          {copy.retry}
        </button>
        <a
          href={home}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-700"
        >
          {copy.home}
        </a>
      </div>
    </main>
  );
}
