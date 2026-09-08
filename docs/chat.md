# Shared asset chat

One global room appears on scheduled, minting, and graduated asset pages.
Refunded pages do not show it. Desktop shows a sidebar;
smaller screens have a bottom-right button that opens a sheet. Anyone can
read. Posting requires a server-verified wallet session matching the currently
selected address. There is no token-holding requirement or blockchain action.

Desktop readers can collapse the sidebar and reopen it from the same corner
button. The preference is local to their browser. A collapsed chat or closed
mobile sheet does not keep a chat WebSocket open. The existing presence badge
is independent of chat. The chat header counts open chat connections, not
distinct people: a reader with two tabs can count twice. Count changes reuse
the same WebSocket. Join/leave bursts are coalesced into at most one presence
broadcast per five seconds, with a single trailing flush so a quiet room does
not keep a stale count indefinitely. This briefly delays hibernation during a
burst; there is no periodic server timer or presence database write.

The locale layout owns the chat session. Following a confirmed `$ASSET` link
keeps the socket, draft, retry key, cooldown, and mobile-open state through the
client-side asset navigation. The destination must still resolve to an eligible
launch phase. Closing chat, visiting a non-chat page, or resolving to a refunded
or missing asset releases the socket. Navigation retention uses the router's
transition rather than a short grace timer. If an asset `loading.tsx` boundary
is added later, extend the lifecycle tests to cover its early-commit behavior.

## Transport and identity

`api.xcp.fun/ws/chat` is a public read-only WebSocket. Browsers publish through
same-origin `POST /api/chat`; the web Worker verifies its session cookie and
uses a direct `CHAT_ROOM` binding to invoke `ChatRoom.publish`. The API Worker
owns the singleton named `global`. There is no public HTTP or WebSocket write
endpoint that bypasses the session check.

Messages carry a server-generated pseudonym and opaque author ID, derived by
HMAC from the verified address and a dedicated `CHAT_HANDLE_SECRET`. The chat
room receives neither the address nor its connection proof. The web server
still knows the address; this is pseudonymous chat, not anonymous chat. Public
source code alone does not let readers derive an address from a nickname.
Someone with the private HMAC secret can test candidate wallet addresses.
Keep the handle secret stable: rotating it changes identities and prevents
existing mutes and bans from matching those wallets.

The shared `@launchpad/chat` protocol applies a 280-codepoint, three-line limit
to plain text. User text renders as text, with no HTML, embeds, or arbitrary URL
links. The exception is a `$ASSET` mention confirmed against the site's cached
launch search index: it links to the canonical, locale-preserving asset page.
Unknown names and unsupported routes stay plain text. `$XCP` is an explicit
exception that opens the current language's `/dispense` page in a new tab,
without an index lookup. This lookup is lazy and
shared across messages, with no per-message request or polling. Chat does not
call Counterparty or price feeds, and does not trigger launch indexing.

Enter sends and Shift+Enter inserts a newline; Enter used to confirm an IME
composition never submits the message. Names are short generated handles.
Clicking one inserts a plain-text @mention. There are no mention notifications
or private messages. A mention of the reader's verified handle is displayed as
a highlighted, translated `@you`; the stored text remains unchanged. Their
own handle also uses an accent color. The quick emoji buttons insert
🐸, 🌽, 🔥, or 😂 at the cursor without sending. `/mute @name`, `/unmute @name` and `/help` are local
commands; they are never published. The exact reverse form `@name /mute` is
also accepted, so a reader can click a name then type the command. A name
must resolve to a unique recently seen or locally muted author. An unknown or
ambiguous name does not hide anyone. Reader mutes do not remove public history.

## Moderation

`CHAT_ADMIN_ADDRESSES` in the web Worker's configuration is an exact comma-separated
allowlist. Initially it contains `19QWXpMXeLkoEKEJv2xo9rn8wkPCyxACSX`. The signed
wallet session must prove that address; a connected address or client-provided
admin flag is insufficient. Admins see **Ban from chat** in message menus and
can expand **Banned users** beneath the transcript to list and undo bans. The
expanded ban and personal-mute lists have a capped height with vertical scrolling.

`GET /api/chat/moderation` and `POST /api/chat/moderation` enforce this allowlist
on the server. Writes also enforce same origin, bounded JSON, and a match
between the selected wallet and signed session. The web Worker calls private
room RPC methods, forwarding only an opaque author ID and ban decision. These
controls remain available when posting is paused. The UI does not poll them.

Bans persist in a separate table capped at 500 entries. Repeating the same
decision does not write again. Bans prevent future posting, including retrying
an old accepted request, but leave reading and prior messages available. They
are separate from browser-local mutes. Self-banning through this endpoint is
refused. A ban follows that wallet's stable opaque identity; it cannot prevent
someone from using a different wallet. No wallet-to-name directory is sent to
the chat room or moderation UI.

The keyboard conventions follow familiar chat behavior (for example,
[Slack's Enter/Shift+Enter options](https://slack.com/help/articles/115005523006-Set-your-Enter-key-preference)); the scope remains a plain text room.

## Local development

1. Install workspace dependencies with `npm install` from the repository root.
2. Copy `apps/web/.dev.vars.example` to `apps/web/.dev.vars`, and populate its
   two secrets with independent random values of at least 32 characters.
3. Start the API locally: `npm run dev --workspace apps/api -- --port 8787`.
4. Set `NEXT_PUBLIC_CHAT_WS_URL=ws://localhost:8787/ws/chat` in
   `apps/web/.env.local`, then start `npm run dev --workspace apps/web -- --port 3015`.

Keep the API running while starting the Next dev server so Wrangler can
resolve the cross-Worker Durable Object binding. Local messages live in
Wrangler's local storage. Local chat must not connect to the production room.

## Production rollout

Deploy the API first to register its `ChatRoom` class and additive migration;
then deploy the web Worker with its matching binding. Set a dedicated random
`CHAT_HANDLE_SECRET` on the web Worker through Wrangler's secret command.
`SESSION_SECRET` must already be configured for verified wallet sessions.
Neither secret belongs in Wrangler's checked-in configuration or client code.

`CHAT_ENABLED` on the API Worker is the operator kill switch. The room is
enabled only by the exact string `true`. `CHAT_MUTED_AUTHORS` can contain a
comma-separated list of opaque author IDs to refuse posting by those authors.
Reader mutes are local to that browser; they are not operator bans. Wallet
addresses are cheap to create, so a per-wallet cooldown is not a per-person
identity check. The room also enforces a global burst limit.

The recent transcript is bounded to 50 messages and 24 hours. A cleanup alarm
expires idle data; WebSocket hibernation does not lose the recent transcript.
Posting retries use a client request ID scoped to the verified author, so a
lost acknowledgement can be retried without adding the same message twice
within the bounded deduplication window.

Resource bounds are enforced in the room: 500 concurrent readers, a three-second
per-author posting cooldown, 20 accepted posts per ten seconds room-wide,
50 visible messages, and 2,048 text-free retry receipts with the same 24-hour
expiry. Invalid or refused posts do not insert messages. History/cap scans are
bounded, and cap pruning runs only after an insert. Cleanup scheduling compares
the existing alarm and writes only when its deadline actually changes; an
empty room does not repeatedly delete a nonexistent alarm. Deletes and alarm
changes still count as storage writes.

The transport uses Cloudflare's recommended hibernating WebSocket API. A closed
panel owns no socket; an open idle panel requires no application ping loop.
There is no per-asset chat object, external chat service, or permanent message
archive. These bounds control normal workload and amplification, but do not
impose an account-wide spending cap or eliminate charges for hostile requests.
Production usage must be assessed with the account's other Workers and current
allowances. Reference: [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
and [Durable Object billing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Before rollout, verify two-browser delivery, read-only access, wallet switch
and expired-session refusal, a disconnected retry, limits, local mutes, and
the mobile pending/chat overlap. After rollout, inspect WebSocket connections,
post success/error counts, DO alarms/storage, and Worker errors. Existing
indexer request volume should be unaffected.
