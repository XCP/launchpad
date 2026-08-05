import { notFound } from "next/navigation";
import { fetchFairminter } from "@/lib/api/counterparty";
import LaunchPage from "@/app/launch/[asset]/page";

export const revalidate = 30;

/**
 * Canonical launch URL: the fairminter's tx hash, the way people are used to
 * contract addresses. Delegates rendering to the asset launch page.
 */
export default async function CoinPage({
  params,
}: {
  params: Promise<{ txhash: string }>;
}) {
  const { txhash } = await params;
  if (!/^[0-9a-f]{64}$/i.test(txhash)) notFound();
  const fm = await fetchFairminter(txhash.toLowerCase());
  if (!fm?.asset) notFound();
  return LaunchPage({ params: Promise.resolve({ asset: fm.asset }) });
}
