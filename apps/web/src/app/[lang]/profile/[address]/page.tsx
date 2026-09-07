import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { shortAddress } from "@/lib/format";
import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { BTC_ADDRESS_REGEX } from "@xcp/wallet-sdk";
import { ProfileView } from "@/app/[lang]/profile/_components/profile-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string; lang: string }>;
}): Promise<Metadata> {
  const { address, lang } = await params;
  if (!BTC_ADDRESS_REGEX.test(address)) notFound();
  const locale = isLocale(lang) ? lang : "en";
  const t = makeT(await getMessages(locale));
  return {
    title: `${shortAddress(address)} — xcp.fun`,
    description: t("Positions, open mints, history, and launches for {address} on xcp.fun.", { address }),
    alternates: localeAlternates(locale, `/profile/${address}`),
  };
}

/** Anyone's profile. All of this is public on-chain data, so no wallet is
 *  required to look — connecting only ever adds your own controls. */
export default async function AddressProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!BTC_ADDRESS_REGEX.test(address)) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <ProfileView viewing={address} />
    </div>
  );
}
