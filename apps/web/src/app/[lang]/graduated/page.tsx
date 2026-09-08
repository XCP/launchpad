import { directoryMetadata, LaunchDirectoryPage } from "@/app/[lang]/_components/launch-directory-page";

export const generateMetadata = (props: { params: Promise<{ lang: string }> }) => directoryMetadata("graduated", props);

export default function GraduatedPage() {
  return <LaunchDirectoryPage phase="graduated" />;
}
