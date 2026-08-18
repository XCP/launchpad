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
  /** The id Telegram assigned, kept so a replay can be undone.
   *
   *  There is no API for "list what this bot has posted" — a bot cannot read
   *  channel history — so an id not recorded at send time is an id that cannot
   *  be deleted later except by hand. Iterating on the wording means posting
   *  the backlog more than once, and each attempt has to be removable. */
  messageId: number | null;
}

/**
 * Whether this artwork can be sent as something that moves.
 *
 * sendPhoto re-encodes whatever it is given into one still frame, so a GIF
 * announced that way arrives as its own first frame and the art stops moving.
 * sendAnimation is the method that keeps it: it takes a GIF (or silent H.264)
 * by URL, converts it to MP4 itself, and clients loop it. Both carry a caption
 * with the same parse_mode, so the choice is invisible to everything above.
 *
 * Animated WEBP has no method at all — sendAnimation takes GIF and MP4 only,
 * sendDocument renders a file card with no caption, and animated WEBP is not
 * one of the sticker formats (static .webp, Lottie .tgs, VP9 .webm). It gets
 * sendPhoto and a still frame, which is why the upload form warns about it.
 */
export const playsAsAnimation = (contentType: string | null) =>
  contentType?.split(";")[0].trim().toLowerCase() === "image/gif";

/**
 * What kind of image the artwork URL is serving, or null if it cannot be
 * asked. /full/<ASSET> streams the R2 original with its stored content type,
 * so a HEAD is enough and never pulls the bytes.
 *
 * Failure is not an error here: null means "send it as a photo", which is
 * exactly what this module did before it could tell the difference. A probe
 * that times out must not cost an announcement.
 */
async function contentTypeOf(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? res.headers.get("content-type") : null;
  } catch {
    return null;
  }
}

/**
 * Send one announcement.
 *
 * A photo or animation message when the launch has artwork, a plain message
 * otherwise — and an image that fails to fetch falls back to text rather than
 * being lost. Telegram will refuse a URL it cannot download (a launch with no
 * image answers 404 at /full/<ASSET>), and losing the whole announcement over
 * a missing picture would be the wrong trade.
 *
 * The animation attempt falls back to sendPhoto before it falls back to text:
 * the probe can be wrong (a redirect to the CDN, a missing content type) and a
 * still frame is a much smaller loss than a caption on its own.
 */
export async function send(
  token: string,
  chatId: string,
  a: Announcement,
): Promise<SendResult> {
  if (a.photo) {
    if (playsAsAnimation(await contentTypeOf(a.photo))) {
      const anim = await call(token, "sendAnimation", {
        chat_id: chatId,
        animation: a.photo,
        caption: a.text,
        parse_mode: "HTML",
      });
      if (anim.ok || anim.retryAfter !== null) return anim;
    }
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
      result?: { message_id?: number };
      parameters?: { retry_after?: number };
    };
    if (data.ok) {
      return {
        ok: true,
        retryAfter: null,
        error: null,
        messageId: data.result?.message_id ?? null,
      };
    }
    return {
      ok: false,
      // 429 carries its own wait. Honour it rather than inventing a backoff —
      // guessing short gets us limited again, guessing long stalls the feed.
      retryAfter: data.parameters?.retry_after ?? null,
      error: data.description ?? `HTTP ${res.status}`,
      messageId: null,
    };
  } catch (e) {
    return {
      ok: false,
      retryAfter: null,
      error: e instanceof Error ? e.message : String(e),
      messageId: null,
    };
  }
}
