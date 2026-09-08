"use client";

import { FOCUS } from "@/components/ui/tokens";
import { useLocale, useT } from "@/lib/i18n/client";

export const TELEGRAM_URL = "https://t.me/xcpfun";

/**
 * The announce channel, as the third lamp on the dashboard.
 *
 * Same shape and register as its siblings — amber for what's queued, green
 * for what's on offer, and Telegram's own blue for where the feed lives. The
 * brand colour is doing real work here rather than decorating: it is the one
 * chip that leaves the site, and the logo plus the blue says so before the
 * label is read.
 *
 * English keeps its desktop label. Other locales use the paper plane alone
 * to leave room for translated navigation; the accessible label and hover
 * title still identify the destination.
 */
export function TelegramChip({ className = "" }: { className?: string }) {
  const t = useT();
  const english = useLocale() === "en";
  return (
    <a
      href={TELEGRAM_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={t("XCP.FUN on Telegram")}
      title={t("XCP.FUN on Telegram")}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 px-2.5 py-1 text-xs font-medium text-sky-700 dark:text-sky-300 transition-colors hover:border-sky-400 ${FOCUS} ${className}`}
    >
      <svg viewBox="0 0 24 24" aria-hidden className="size-3.5 shrink-0 fill-current">
        <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
      </svg>
      {english && <span className="hidden lg:inline">Telegram</span>}
    </a>
  );
}
