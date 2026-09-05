/** Complete the peer's close handshake on our pre-2026-04-07 compatibility
 * date. Reserved local-only codes (1005/1006/1015) cannot be sent on the wire.
 */
export function closeWebSocket(ws: WebSocket, code = 1000, reason = "") {
  const standard = code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code);
  const application = code >= 3000 && code <= 4999;
  try {
    ws.close(standard || application ? code : 1000, reason);
  } catch {
    // An errored transport may already be closed; there is nothing to retry.
  }
}
