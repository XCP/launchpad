import { ProfileView } from "@/app/profile/_components/profile-view";

export const metadata = {
  title: "Profile — xcp.fun",
  description:
    "Your positions, history, and launches. Every graduated XCP-69 launch trades against XCP, so a position's value is a pool price away from a dollar figure.",
};

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <ProfileView />
    </div>
  );
}
