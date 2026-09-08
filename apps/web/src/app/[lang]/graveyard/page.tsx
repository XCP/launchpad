import { directoryMetadata, LaunchDirectoryPage } from "@/app/[lang]/_components/launch-directory-page";

export const generateMetadata = (props: { params: Promise<{ lang: string }> }) => directoryMetadata("refunded", props);

export default function GraveyardPage() {
  return <LaunchDirectoryPage phase="refunded" />;
}
