# ADR-0002 — A monotonic per-session `seq`, replayed inline on resume

- **Status:** Accepted 2026-08-17. Implemented in `@dhaam-ccrm/core`
  (`connection/resume.ts`) and verified end to end against real Postgres.
- **Decision record:** PRD §0.5 **D2**. Closes Open Question 2 (§18), and settles §8.3.
- **Supersedes:** v1's `socket.io`-delegated reconnect and its `CONNECTION_ACK`
  coaxing workaround.

## Context

v1 had **no sequence number of any kind**, and its reconnect story was three separate
compensations stacked on each other:

**The handshake was asymmetric.** On a fresh connect the server pushes
`chat.connection.ack` unprompted. On `socket.io`'s built-in `reconnect` event it does
**not**. `src/client.ts:395-410` carries an explicit workaround with a comment saying
exactly this: it re-emits `JOIN_SESSION` after a reconnect purely to *coax* the server
into sending a second `CONNECTION_ACK`, because the input stays disabled otherwise. The
client is compensating for a server that treats reconnect as a different event class
from connect.

**There was no ordering key.** Messages were ordered by timestamp — and the timestamp
had four aliases. `normalizeMessage()` in `src/client.ts:70` reads
`raw.timestamp ?? raw.createdAt ?? raw.created_at ?? raw.sentAt`. Four names, one
concept, all sender-clock. Two clients with skewed clocks disagree about order.

**There was no gap detection.** If frames were missed while the socket was down, nothing
noticed. Reconnect was delegated wholesale to `socket.io` with a fixed 1000 ms delay and
a five-attempt cap (`src/client.ts:103-105, 175-177`) — no backoff, no jitter, and no
concept of "what did I miss".

## Decision

**The backend tracks a monotonic per-session sequence number, and `connection.ack`
replays what the client missed, inline.**

- `connection.hello.d.resumeFrom` carries **the integer `seq` of the last frame the
  client fully applied to state**. Never a ULID. Never a timestamp. The server validates
  it as an integer and rejects anything else with `VALIDATION_FAILED`.
- `connection.ack.d.replay` inlines the missed frames, **capped at 200**.
- Over the cap the server sends **no replay** plus the true `last_seq` in
  `connection.ack.d.seq`; the client reads that as **one gap** spanning everything missed.
- `seq` — never `ts` — is core's ordering key and its gap-detection signal. A `seq` jump
  means refetch.
- `connection.ack` is **symmetric**: it is sent after every valid `connection.hello`,
  whether that hello follows a first connect or a reconnect.

## Consequences

### What this buys

- **Resume is one WebSocket round trip.** No REST fallback in the happy path. The
  handshake that re-establishes session context is the same handshake that delivers the
  missed frames.
- **The `CONNECTION_ACK` coaxing workaround is deleted, not ported.** Symmetry at the
  protocol level removes the reason the workaround existed.
- **Gap detection is structural.** `seq` is dense and monotonic per session, so a missing
  value is arithmetic, not inference. Ordering no longer depends on anybody's clock;
  `ts` on the envelope is explicitly informational.

### What it costs — stated honestly

- **The 200-frame cap converts a long absence into a full refetch.** A client offline
  past the cap gets one gap, not 3000 frames, and must recover the interval through
  history. `MessageHistorySource` is consequently **not optional** in
  `ChatClientConfig` — a config that omits it has no recovery path from a long
  disconnect, which is why core requires it at construction rather than failing later.
- **`resumeFrom`'s type is a genuine foot-gun the spec itself set.** §8.3 originally read
  "the id/seq of the last frame", which predates D2 and reads as though a ULID were
  acceptable. **A Dart client implemented from that sentence failed on every single
  reconnect** — the server rejected the ULID with `VALIDATION_FAILED`. The sentence was
  corrected on 2026-08-19; the episode is the reason this ADR states the type three
  times.
- **Walking the replay array is not sufficient.** An ack can say "I am current as of
  seq 40" *after* replaying only up to seq 37. An implementation that advances its anchor
  from the last replayed frame, rather than adopting `connection.ack.d.seq`, silently
  under-advances and re-replays on the next reconnect. `connection/resume.ts` documents
  this case because it is the one a straightforward implementation misses.
- **Optimistic messages have no `seq`.** `seq` is server-assigned, so a message still in
  the queue cannot be ordered against server messages by seq alone. Core sorts unsent
  messages after the highest known `seq`; a binding writing its own optimistic list must
  match that, which is why `compareBySeq`/`sortMessages`/`upsertMessage` are exported
  from core rather than reimplemented per binding.
- **This is net-new backend work with no v1 precedent**, including a uniqueness
  constraint on `(chatSessionId, seq)`. The client cannot detect gaps in a sequence the
  server does not actually guarantee is gapless.
