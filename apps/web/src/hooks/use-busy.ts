import type { ComposeStatus } from "@/lib/wallet/useCompose";

/** True while a compose→sign→broadcast pipeline is in flight. */
export function isBusy(status: ComposeStatus): boolean {
  return (
    status === "composing" || status === "signing" || status === "broadcasting"
  );
}
