/**
 * The only module that talks to Telegram.
 *
 * Everything above it deals in Announcement objects; this turns one into an
 * HTTP call and reports honestly whether it landed. Kept apart from the
 * formatting so the wording can be tested without a network, and from the
 * queue so the pacing can be tested without a bot.
 */
import type { Announcement } from "#api/telegram/format";

const API = "https://api.telegram.org";

export interface SendResult {
  ok: boolean;
  /** Telegram's own wait, in seconds, when it rate-limits us. The queue backs
   *  off by this rather than guessing. */
  retryAfter: number | null;
  error: string | null;
}

/**
 * Send one announcement.
 *
 * A photo message when the launch has artwork, a plain message otherwise —
 * and a photo that fails to fetch falls back to text rather than being lost.
 * Telegram will refuse a URL it cannot download (a launch with no image
 * answers 404 at /full/<ASSET>), and losing the whole announcement over a
 * missing picture would be the wrong trade.
 */
export async function send(
  token: string,
  chatId: string,
  a: Announcement,
): Promise<SendResult> {
  if (a.photo) {
    const photo = await call(token, "sendPhoto", {
      chat_id: chatId,
      photo: a.photo,
      caption: a.text,
      parse_mode: "HTML",
    });
    if (photo.ok || photo.retryAfter !== null) return photo;
    // Fell through: the image was the problem, the message still is not.
  }
  return call(token, "sendMessage", {
    chat_id: chatId,
    text: a.text,
    parse_mode: "HTML",
    link_preview_options: JSON.stringify({ is_disabled: true }),
  });
}

async function call(
  token: string,
  method: string,
  body: Record<string, string>,
): Promise<SendResult> {
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (data.ok) return { ok: true, retryAfter: null, error: null };
    return {
      ok: false,
      // 429 carries its own wait. Honour it rather than inventing a backoff —
      // guessing short gets us limited again, guessing long stalls the feed.
      retryAfter: data.parameters?.retry_after ?? null,
      error: data.description ?? `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      retryAfter: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
