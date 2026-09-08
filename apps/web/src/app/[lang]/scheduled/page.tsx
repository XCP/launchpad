import { directoryMetadata, LaunchDirectoryPage } from "@/app/[lang]/_components/launch-directory-page";

export const generateMetadata = (props: { params: Promise<{ lang: string }> }) => directoryMetadata("scheduled", props);

export default function ScheduledPage() {
  return <LaunchDirectoryPage phase="scheduled" />;
}
