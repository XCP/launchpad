import { redirect } from "next/navigation";
import { isLocale, localePath } from "@/lib/i18n/locales";

/** The launches list is a tab on the profile now; the old URL still works. */
export default async function LaunchesPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  redirect(localePath(isLocale(lang) ? lang : "en", "/profile"));
}
