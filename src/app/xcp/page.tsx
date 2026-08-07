import { redirect } from "next/navigation";

/** The bridge moved to /dispense; keep old links working. */
export default function XcpRedirect() {
  redirect("/dispense");
}
