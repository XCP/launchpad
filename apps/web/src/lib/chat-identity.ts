/** Server-only pseudonyms. A public address hash could be matched against
 * known holders; the keyed digest prevents that offline lookup. The server
 * still knows the wallet address, so this is not an anonymity guarantee. */
import { chatHandle } from "@launchpad/chat";

export async function chatIdentity(address: string, secret: string) {
  if (secret.length < 32) throw new Error("Chat identity secret unavailable");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, encoder.encode(`xcp.fun/chat-author/v1\0${address}`),
  ));
  const authorId = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    authorId,
    handle: chatHandle(authorId),
  };
}
