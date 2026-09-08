import { directoryMetadata, LaunchDirectoryPage } from "@/app/[lang]/_components/launch-directory-page";

export const generateMetadata = (props: { params: Promise<{ lang: string }> }) => directoryMetadata("minting", props);

export default function MintingPage() {
  return <LaunchDirectoryPage phase="minting" />;
}
