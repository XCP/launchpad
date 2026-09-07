import type { Metadata } from "next";
import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { ProfileView } from "@/app/[lang]/profile/_components/profile-view";

const PAGE_METADATA = {
  title: "Profile — xcp.fun",
  description:
    "Your positions, history, and launches. Every graduated XCP-69 launch trades against XCP, so a position's value is a pool price away from a dollar figure.",
};

/** The page's own metadata, plus the hreflang set for the locale it is
 *  rendered under — see lib/i18n/seo. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  return { ...PAGE_METADATA, alternates: localeAlternates(isLocale(lang) ? lang : "en", "/profile") };
}

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <ProfileView />
    </div>
  );
}
