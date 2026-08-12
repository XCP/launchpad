import { redirect } from "next/navigation";

/** Renamed to /profile — "home" collided with the site's actual home page. */
export default function HomePage() {
  redirect("/profile");
}
