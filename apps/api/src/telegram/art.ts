/**
 * Stamping an announcement's picture with the version of the art it is
 * showing, at the moment it goes out.
 *
 * Telegram does not re-fetch a photo URL it has seen. It downloads the file
 * once, keeps a file_id against that exact URL, and every later sendPhoto with
 * the same string re-sends the same bytes — which is a feature for a channel
 * posting the same launch's art forty times, and a trap for art that moves.
 * Two kinds move here: a creator replacing their upload through the edit
 * panel, and a mirrored launch advancing a stage (see indexer/mirrors.ts).
 * Both rewrite an R2 object at a key that never changes, so nothing about the
 * URL tells Telegram anything happened.
 *
 * An etag does. R2 assigns a new one on every write, so appending it makes a
 * replacement a URL Telegram has never seen, while art that has not moved
 * keeps the URL it already has cached and costs nothing to re-send.
 *
 * This runs at send time rather than when the message is written, because the
 * queue paces at one message every 3.5 seconds and a backlog can be minutes
 * deep — long enough for the art to advance while the message waits.
 */
import { imageUrl, type Announcement } from "#api/telegram/format";

/**
 * The announcement with its photo URL pointed at the art we hold right now.
 *
 * Unchanged when there is no artwork, no launch to look up, or nothing stored
 * for it — that last case is a foreign launch whose art comes from the CDN,
 * where there is no version of ours to name and the CDN's own copy is
 * immutable anyway.
 *
 * R2 failing is not an error worth an announcement. An un-stamped URL is what
 * this sent before it could stamp at all, so a head that throws falls back to
 * exactly the old behaviour rather than dropping the message.
 */
export async function stampArtVersion(
  bucket: R2Bucket,
  a: Announcement,
): Promise<Announcement> {
  if (!a.photo || !a.asset) return a;
  const asset = a.asset.toUpperCase();
  try {
    // Same order the web worker resolves in: our own upload outranks our
    // mirror of somebody else's file. See apps/web/src/app/i/[asset]/route.ts.
    const stored = (await bucket.head(`i/${asset}`)) ?? (await bucket.head(`m/${asset}`));
    return stored?.etag ? { ...a, photo: imageUrl(a.asset, stored.etag) } : a;
  } catch {
    return a;
  }
}
