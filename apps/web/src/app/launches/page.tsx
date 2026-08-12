import { redirect } from "next/navigation";

/** The launches list is a tab on the profile now; the old URL still works. */
export default function LaunchesPage() {
  redirect("/profile");
}
