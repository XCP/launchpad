// OpenNext generates this module before Wrangler bundles the custom entry point.
// eslint-disable-next-line no-restricted-imports -- generated Worker is outside src's @/ alias
import handler, { DOQueueHandler as OpenNextQueue, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default handler;
export { DOShardedTagCache, BucketCachePurge };

/** Keep completed retries completed across Durable Object restarts.
 * OpenNext 1.20.6 removes terminal jobs from memory but leaves failed_state in SQLite.
 * Delegate rendering, backoff, deduplication and limits to the pinned adapter.
 */
export class DOQueueHandler extends OpenNextQueue {
  async executeRevalidation(message) {
    const wasRetrying = this.routeInFailedState.has(message.MessageDeduplicationId);
    await super.executeRevalidation(message);
    if (wasRetrying && !this.disableSQLite && !this.routeInFailedState.has(message.MessageDeduplicationId)) {
      this.sql.exec("DELETE FROM failed_state WHERE id = ?", message.MessageDeduplicationId);
    }
  }
}
