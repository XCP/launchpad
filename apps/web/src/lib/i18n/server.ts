import { lang } from "next/root-params";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/locales";
import { makeT, type Messages, type T } from "@/lib/i18n/t";

/**
 * The server side of `t`.
 *
 * Every page lives under `app/[lang]`, so the locale is a root parameter and
 * any server component or utility can read it with `next/root-params` —
 * no prop drilling, and nothing request-scoped to leak between renders.
 * Message files are imported here, on the server, so a page's translations
 * never inflate the client bundle; the locale layout hands the client its
 * one map separately.
 */
const MESSAGES: Record<Locale, () => Promise<Messages>> = {
  en: async () => ({}),
  ja: () => import("@/locales/ja.json").then((m) => m.default as Messages),
  zh: () => import("@/locales/zh.json").then((m) => m.default as Messages),
  "zh-tw": () => import("@/locales/zh-tw.json").then((m) => m.default as Messages),
  "zh-hk": () => import("@/locales/zh-hk.json").then((m) => m.default as Messages),
  es: () => import("@/locales/es.json").then((m) => m.default as Messages),
  ko: () => import("@/locales/ko.json").then((m) => m.default as Messages),
  pt: () => import("@/locales/pt.json").then((m) => m.default as Messages),
  fr: () => import("@/locales/fr.json").then((m) => m.default as Messages),
  ru: () => import("@/locales/ru.json").then((m) => m.default as Messages),
  uk: () => import("@/locales/uk.json").then((m) => m.default as Messages),
};

export async function getMessages(locale: Locale): Promise<Messages> {
  return MESSAGES[locale]();
}

/** Whether a locale is still mostly the model's draft. The draft script lists
 *  the keys it wrote in `<locale>.status.json`; a reviewer removes what they
 *  have checked. While most of the file is on that list, the footer says so. */
const STATUS: Partial<Record<Locale, () => Promise<{ machine: string[] }>>> = {
  ja: () => import("@/locales/ja.status.json").then((m) => m.default as { machine: string[] }),
  zh: () => import("@/locales/zh.status.json").then((m) => m.default as { machine: string[] }),
  "zh-tw": () => import("@/locales/zh-tw.status.json").then((m) => m.default as { machine: string[] }),
  "zh-hk": () => import("@/locales/zh-hk.status.json").then((m) => m.default as { machine: string[] }),
  es: () => import("@/locales/es.status.json").then((m) => m.default as { machine: string[] }),
  ko: () => import("@/locales/ko.status.json").then((m) => m.default as { machine: string[] }),
  pt: () => import("@/locales/pt.status.json").then((m) => m.default as { machine: string[] }),
  fr: () => import("@/locales/fr.status.json").then((m) => m.default as { machine: string[] }),
  ru: () => import("@/locales/ru.status.json").then((m) => m.default as { machine: string[] }),
  uk: () => import("@/locales/uk.status.json").then((m) => m.default as { machine: string[] }),
};

export async function isMachineDrafted(locale: Locale): Promise<boolean> {
  const load = STATUS[locale];
  if (!load) return false;
  const [status, messages] = await Promise.all([load(), getMessages(locale)]);
  const total = Object.keys(messages).length;
  return total > 0 && status.machine.length * 2 > total;
}

/** The current request's locale, from the URL segment. */
export async function getLocale(): Promise<Locale> {
  const value = await lang();
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** A `t` bound to the current request's locale. */
export async function getT(): Promise<T> {
  const locale = await getLocale();
  return makeT(await getMessages(locale));
}
