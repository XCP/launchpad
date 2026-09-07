import type { Metadata } from "next";
import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages } from "@/lib/i18n/server";
import { makeT, msg } from "@/lib/i18n/t";
import { ProfileView } from "@/app/[lang]/profile/_components/profile-view";

const PAGE_METADATA = {
  title: msg("Profile — xcp.fun"),
  description:
    msg("Your positions, history, and launches. Every graduated XCP-69 launch trades against XCP, so a position's value is a pool price away from a dollar figure."),
};

/** The page's own metadata, plus the hreflang set for the locale it is
 *  rendered under — see lib/i18n/seo. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "en";
  const t = makeT(await getMessages(locale));
  return {
    ...PAGE_METADATA,
    title: t(String(PAGE_METADATA.title)),
    ...(PAGE_METADATA.description ? { description: t(PAGE_METADATA.description) } : {}),
    alternates: localeAlternates(locale, "/profile"),
  };
}

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <ProfileView />
    </div>
  );
}
