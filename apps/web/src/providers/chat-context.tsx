"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ChatMessage } from "@launchpad/chat";
import { useChat, useChatCollapsed, useChatIdentity, useChatModeration } from "@/hooks/use-chat";
import { useLocale } from "@/lib/i18n/client";
import { isLocale, localePath } from "@/lib/i18n/locales";
import { useWallet } from "@/lib/wallet/wallet-context";
import { useSession } from "@/providers/session-context";

const DESKTOP_QUERY = "(min-width: 1024px)";
const subscribeDesktop = (listener: () => void) => {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const desktopSnapshot = () => window.matchMedia(DESKTOP_QUERY).matches;

export interface ChatDraftMemory {
  draft: string;
  request: { text: string; address: string; id: string } | null;
  cooldownUntil: number;
  error: string | null;
}

/** A possible asset route still needs its resolved LaunchView's phase check. */
function assetForPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (isLocale(parts[0])) parts.shift();
  return parts.length === 1 && /^[B-Z][A-Z]{3,11}$/.test(parts[0]) ? parts[0] : null;
}

type Registration = { asset: string; eligible: boolean };
type ChatContextValue = ReturnType<typeof useChatState>;
const ChatContext = createContext<ChatContextValue | null>(null);
// LaunchView only reports its phase; incoming chat frames should not make the
// entire market view rerender just to keep that registration alive.
const ChatRouteContext = createContext<((asset: string, eligible: boolean) => () => void) | null>(null);

function useChatState() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const [pending, startNavigation] = useTransition();
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => false);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useChatCollapsed();
  const expanded = desktop && !collapsed;
  const visible = expanded || (!desktop && open);
  const [active, setActive] = useState(false);
  const registration = useRef<Registration | null>(null);
  const [registrationVersion, setRegistrationVersion] = useState(0);
  const registerRoute = useCallback((asset: string, eligible: boolean) => {
    const current = { asset, eligible };
    registration.current = current;
    setRegistrationVersion((version) => version + 1);
    return () => {
      if (registration.current !== current) return;
      registration.current = null;
      setRegistrationVersion((version) => version + 1);
    };
  }, []);

  useEffect(() => {
    const asset = assetForPath(pathname);
    // Read the ref after child layout effects have registered the committed
    // page. A destination remount must not briefly deactivate the transport.
    const page = registration.current;
    const next = !visible || !asset ? false : page?.asset === asset ? page.eligible : pending ? null : false;
    if (next !== null) {
      // This bridges child layout registration to the socket effect. Deriving
      // it during render can close a socket before its new page registers.
      setActive(next);
    }
    // A real router transition can outlast ordinary reconnect delays. Keep
    // the existing socket until it commits, cancels, or reaches an error page.
  }, [pathname, visible, pending, registrationVersion]);

  const navigateAsset = useCallback((href: string) => {
    startNavigation(() => router.push(localePath(locale, href)));
  }, [router, locale]);

  const [drafts, setDrafts] = useState<Record<string, ChatDraftMemory>>({});
  const rememberDraft = useCallback((address: string, update: Partial<ChatDraftMemory>) => {
    setDrafts((previous) => {
      const before = previous[address] ?? { draft: "", request: null, cooldownUntil: 0, error: null };
      const next = { ...before, ...update };
      return before.draft === next.draft && before.request === next.request && before.cooldownUntil === next.cooldownUntil && before.error === next.error
        ? previous : { ...previous, [address]: next };
    });
  }, []);
  const wallet = useWallet();
  const session = useSession();
  const address = wallet.status === "connected" && wallet.address && session.address === wallet.address ? wallet.address : null;
  const room = useChat(active);
  const { identity, rememberIdentity } = useChatIdentity(active, address);
  const acceptMessage = (message: ChatMessage) => {
    room.acceptMessage(message);
    if (address) rememberIdentity({ address, authorId: message.authorId, handle: message.handle });
  };
  const moderation = useChatModeration(identity);
  const [showBanned, setShowBanned] = useState(false);
  return { ...room, acceptMessage, identity, moderation, showBanned, setShowBanned, desktop, expanded, collapsed, setCollapsed, open, setOpen, drafts, rememberDraft, navigateAsset, registerRoute };
}

/** The locale layout survives asset page changes; the page only owns its UI. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const value = useChatState();
  return <ChatRouteContext.Provider value={value.registerRoute}><ChatContext.Provider value={value}>{children}</ChatContext.Provider></ChatRouteContext.Provider>;
}

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("ChatProvider is missing");
  return context;
}

/** Register every resolved launch, including ineligible refunded/RIP pages. */
export function useChatRoute(asset: string, eligible: boolean) {
  const registerRoute = useContext(ChatRouteContext);
  if (!registerRoute) throw new Error("ChatProvider is missing");
  useLayoutEffect(() => registerRoute(asset, eligible), [registerRoute, asset, eligible]);
}
