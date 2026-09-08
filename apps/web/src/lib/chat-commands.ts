import type { ChatMessage } from "@launchpad/chat";

export type ChatCommand =
  | { type: "help" }
  | { type: "mute" | "unmute"; handle: string }
  | { type: "invalid" };
export type ChatAuthor = Pick<ChatMessage, "authorId" | "handle">;

const HANDLE = /^@?[A-Za-z][A-Za-z0-9]{2,15}$/;
const LINE_BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
function normalizedHandle(handle: string): string | null {
  return HANDLE.test(handle) ? handle.replace(/^@/, "") : null;
}

/** Non-null results are local commands, including invalid attempts. They must
 * never fall through to the public message submission path. */
export function parseChatCommand(text: string): ChatCommand | null {
  const input = text.trim();
  // A clicked mention followed by exactly one command is also convenient.
  // Prose such as "@PepeAAAA please use /mute" remains an ordinary message.
  const reverse = /^(@\S+)\s+\/(mute|unmute)$/i.exec(input);
  if (!input.startsWith("/") && !reverse) return null;
  if (LINE_BREAK.test(text)) return { type: "invalid" };
  if (reverse) {
    const handle = normalizedHandle(reverse[1]);
    return handle ? { type: reverse[2].toLowerCase() as "mute" | "unmute", handle } : { type: "invalid" };
  }
  if (/^\/help$/i.test(input)) return { type: "help" };
  const command = /^\/(mute|unmute)[ \t]+(\S+)$/i.exec(input);
  const handle = command && normalizedHandle(command[2]);
  return command && handle
    ? { type: command[1].toLowerCase() as "mute" | "unmute", handle } : { type: "invalid" };
}

/** Labels are cosmetic and can collide. Resolve only a unique existing
 * identity, including muted authors no longer present in recent history. */
export function resolveChatAuthor(
  handle: string,
  recentMessages: readonly ChatAuthor[],
  mutedAuthors: readonly ChatAuthor[],
): ChatAuthor | null {
  const normalized = normalizedHandle(handle)?.toLowerCase();
  if (!normalized) return null;
  const matches = new Map<string, ChatAuthor>();
  for (const author of [...recentMessages, ...mutedAuthors]) {
    if (author.handle.toLowerCase() === normalized && !matches.has(author.authorId)) {
      matches.set(author.authorId, { authorId: author.authorId, handle: author.handle });
    }
  }
  return matches.size === 1 ? matches.values().next().value! : null;
}
