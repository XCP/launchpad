import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";

// The form is a Client Component; its route metadata stays on the server.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "en";
  const t = makeT(await getMessages(locale));
  return {
    title: `${t("Launch a token")} — xcp.fun`,
    description: t("Name, image, description. Everything else is the standard."),
    alternates: localeAlternates(locale, "/create"),
  };
}

export default function CreateLayout({ children }: { children: ReactNode }) {
  return children;
}
