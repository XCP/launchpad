import { notFound } from "next/navigation";
import { shortAddress } from "@/lib/format";
import { BTC_ADDRESS_REGEX } from "@/lib/wallet/sdk";
import { ProfileView } from "@/app/profile/_components/profile-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return {
    title: `${shortAddress(address)} — xcp.fun`,
    description: `Positions, open mints, history, and launches for ${address} on xcp.fun.`,
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
