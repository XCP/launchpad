/** Shared wire limits: Unicode codepoints, not UTF-16 units or Latin letters. */
export const CHAT_MAX_CODEPOINTS = 280;
export const CHAT_MAX_LINES = 3;
export const CHAT_MAX_MESSAGES = 50;
export const CHAT_TTL_MS = 24 * 60 * 60 * 1_000;
export const CHAT_COOLDOWN_MS = 3_000;
export const CHAT_MAX_RAW_BYTES = 4_096;
export const CHAT_MAX_CONNECTIONS = 500;
export const CHAT_MAX_BANS = 500;

export interface ChatMessage {
  id: string;
  authorId: string;
  handle: string;
  text: string;
  /** Server time, in milliseconds since the Unix epoch. */
  createdAt: number;
}
/** Counts are connected sockets, including read-only viewers and multiple tabs. */
export type ChatFrame =
  | { type: "history"; messages: ChatMessage[]; count?: number }
  | { type: "message"; message: ChatMessage; count?: number }
  | { type: "presence"; count: number };
export interface ChatPost { requestId: string; authorId: string; handle: string; text: string }
export type ChatPostResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: "invalid_message" | "rate_limited" | "disabled" | "muted" | "banned"; /** Seconds. */ retryAfter?: number };
export interface ChatBan { authorId: string; handle: string; createdAt: number }
export type ChatBanResult =
  | { ok: true; authorId: string; banned: boolean; ban: ChatBan | null }
  | { ok: false; error: "invalid_author" | "ban_limit" };

export const isChatAuthorId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const isChatHandle = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{2,47}$/.test(value);
export const isChatRequestId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);

const MASCOTS = [
  "Pepe", "Doge", "Frog", "Toad", "Cat", "Panda", "Otter", "Fox",
  "Wolf", "Bear", "Bull", "Ape", "Whale", "Shark", "Squid", "Crab",
  "Goose", "Duck", "Owl", "Crow", "Raven", "Snek", "Gecko", "Llama",
  "Koala", "Moth", "Wombat", "Mantis", "Pigeon", "Bison", "Tiger", "Mole",
] as const;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const normalizeLineEndings = (value: string) => value.replace(/\r\n?|\u0085|\u2028|\u2029/g, "\n");

/** Count the lines the server would keep, including meaningful interior blanks. */
export function chatLineCount(value: string): number {
  const text = normalizeLineEndings(value).trim();
  return text ? text.split("\n").length : 0;
}

/** Cosmetic and stable: authorId, rather than this shortened label, is identity. */
export function chatHandle(authorId: string): string {
  if (!isChatAuthorId(authorId)) throw new Error("invalid_chat_author");
  const mascot = MASCOTS[Number.parseInt(authorId.slice(0, 2), 16) & 31]!;
  const suffix = Number.parseInt(authorId.slice(2, 7), 16);
  return mascot + [15, 10, 5, 0].map((shift) => BASE32[(suffix >>> shift) & 31]).join("");
}

/** Keep ordinary Unicode/emoji, normalize line endings, and reject hidden controls. */
export function normalizeChatText(value: unknown): string | null {
  if (typeof value !== "string" || value.length > CHAT_MAX_RAW_BYTES || new TextEncoder().encode(value).length > CHAT_MAX_RAW_BYTES) return null;
  const normalized = normalizeLineEndings(value);
  // Cc includes newline/tab, which are explicitly allowed. Cs rejects lone
  // surrogates; format characters such as emoji ZWJ remain ordinary text.
  if (/[\p{Cc}\p{Cs}]/u.test(normalized.replace(/[\n\t]/g, ""))) return null;
  const text = normalized.trim();
  if (!text || [...text].length > CHAT_MAX_CODEPOINTS || chatLineCount(text) > CHAT_MAX_LINES) return null;
  return text;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function normalizeChatPost(value: unknown): ChatPost | null {
  if (!object(value) || !isChatRequestId(value.requestId) || !isChatAuthorId(value.authorId) || !isChatHandle(value.handle)) return null;
  const text = normalizeChatText(value.text);
  return text === null ? null : { requestId: value.requestId, authorId: value.authorId, handle: chatHandle(value.authorId), text };
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!object(value) || !isChatRequestId(value.id) || !isChatAuthorId(value.authorId) || !isChatHandle(value.handle)
    || !Number.isSafeInteger(value.createdAt) || (value.createdAt as number) <= 0) return null;
  const text = normalizeChatText(value.text);
  if (text === null || text !== value.text) return null;
  return { id: value.id, authorId: value.authorId, handle: chatHandle(value.authorId), text, createdAt: value.createdAt as number };
}

/** Parse only bounded, valid frames; do not forward unknown fields into UI state. */
export function parseChatFrame(value: unknown): ChatFrame | null {
  if (typeof value === "string") {
    if (value.length > 100_000) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!object(value)) return null;
  if (value.count !== undefined && (!Number.isSafeInteger(value.count) || (value.count as number) < 0 || (value.count as number) > CHAT_MAX_CONNECTIONS)) return null;
  const count = value.count === undefined ? {} : { count: value.count as number };
  if (value.type === "presence") return value.count === undefined ? null : { type: "presence", count: value.count as number };
  if (value.type === "message") {
    const message = parseMessage(value.message);
    return message ? { type: "message", message, ...count } : null;
  }
  if (value.type === "history" && Array.isArray(value.messages) && value.messages.length <= CHAT_MAX_MESSAGES) {
    const messages = value.messages.map(parseMessage);
    if (messages.some((message) => message === null)) return null;
    const valid = messages as ChatMessage[];
    if (new Set(valid.map((message) => message.id)).size !== valid.length) return null;
    return { type: "history", messages: valid, ...count };
  }
  return null;
}
