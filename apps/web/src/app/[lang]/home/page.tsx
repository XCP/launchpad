import { redirect } from "next/navigation";
import { isLocale, localePath } from "@/lib/i18n/locales";

/** Renamed to /profile — "home" collided with the site's actual home page. */
export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  redirect(localePath(isLocale(lang) ? lang : "en", "/profile"));
}
