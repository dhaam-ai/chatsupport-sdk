# ADR-0001 — The client-generated ULID is the permanent message id

- **Status:** Accepted 2026-08-17. Implemented and shipped in `@dhaam-ccrm/core`.
- **Decision record:** PRD §0.5 **D1**. Closes Open Question 1 (§18).
- **Supersedes:** v1's two-mechanism dedup (`src/context.tsx`, `src/client.ts`).

## Context

v1 carried **two independent, overlapping dedup mechanisms** for the same problem,
because neither one worked on its own. This is the evidence:

**Mechanism 1 — `clientMessageId` ack mapping.** `src/context.tsx:728` generated a
`crypto.randomUUID()` per send and kept a `clientMsgMap` of `clientMessageId → tempId`
(`:730`). The optimistic message got an id of the form `temp-…`. When
`chat.message.ack` arrived carrying `{clientMessageId, messageId, chatSessionId, seq}`,
the handler at `src/context.tsx:589-592` looked the temp id back up and swapped it for
the server's real id. The `clientMessageId` travelled *alongside* the payload, not as
it (`src/client.ts:425-434`).

**Mechanism 2 — a content-matching echo suppressor.** In the same file, a second map
`pendingReplaces` (`src/context.tsx:293`) was keyed on the **message content string**
(`:744`), consulted when an inbound `MESSAGE_RECEIVE` arrived (`:324`), and cleared on a
`10_000` ms timer (`:778`). Its inline comment says plainly that it exists because the
ack path alone was not reliable enough historically.

Two things follow from that pair. First, an ack contract that needs a content-matching
safety net is not a contract. Second, the safety net is **wrong by construction**: it is
keyed on content, so two identical messages sent inside the same ten seconds — "ok",
"ok" — collide, and the second is suppressed as an echo of the first. The user's message
disappears. Retiring one mechanism without fixing the other was never an option; both
symptoms had one cause, which is that the client and the server did not agree on what a
message's identity *is*.

The underlying cause: in v1 a message's identity **changed** partway through its life,
from `temp-…` to a server-minted id. Everything downstream — React list keys, the
optimistic replace path, reconnect replay, read watermarks — had to be written to
tolerate an identity that moves.

## Decision

**The client generates a ULID, puts it on the frame envelope's `id`, and that value is
the message's permanent, canonical, server-side id.**

- The ULID is Crockford base32: `^[0-9A-HJKMNP-TV-Z]{26}$`. `I`, `L`, `O` and `U` are
  not in the alphabet.
- The envelope `id` on `message.send` **is** the message id. It is not carried beside the
  payload, and there is no second identifier.
- The server validates the ULID's format, enforces per-session uniqueness, and stores it
  as the canonical id. **The server does not mint an id of its own.**
- Core therefore has **no optimistic-id-swap code path at all**. A message's identity
  never changes after `sendMessage()` returns.

## Consequences

### What this buys

- **Replay after a reconnect dedupes structurally.** §8.4 requires any unacked frame to
  move into the durable queue and be replayed with the *identical* envelope `id`. If the
  server persisted it moments before the drop, replay is a no-op by construction — not
  by heuristic, not by timing window.
- **Both v1 mechanisms are deleted, not ported.** No `clientMessageId` field, no
  `pendingReplaces`, no ten-second window, no content-string key. The "two identical
  messages in quick succession" bug is unwritable.
- **Bindings get stable list keys for free.** React, Vue, Angular and the vanilla store
  all key on `message.id` and never re-key. The conformance suite can assert identity
  stability as an invariant rather than a race.

### What it costs — stated honestly

- **Id-uniqueness enforcement moves to the server, and is now security-relevant.** The
  client chooses the primary key. If the server's per-session uniqueness check is missing
  or wrong, a client can overwrite another message rather than merely duplicating one.
  This is a strictly larger obligation than "generate an id", and it is the server's.
- **The ULID charset is a hard, silent gate.** Envelope ids are ULID-validated at decode.
  A frame whose `id` contains `I`, `L`, `O` or `U` is **dropped before correlation** — no
  ack, no error, no correlation to the send that produced it. Reaching for
  `crypto.randomUUID()` out of habit (as v1 did) means every frame is refused and nothing
  says why. This has already cost debugging time on the Dart client.
- **"Did it land?" is no longer answerable from the id.** In v1 an id that still started
  with `temp-` meant "unacked". With a permanent id there is no such signal, and `seq`
  is absent both for a message in flight and for one the queue has permanently given up
  on. That gap is why `ChatMessage.delivery` and the `sendFailed` event had to be added
  (PRD §6.4, T10 amendment) — a binding could not otherwise tell a spinner from a retry
  affordance. D1 did not remove that problem; it relocated it into an explicit field.
- **Message ids are not an ordering or enumeration key.** They are client-chosen, so they
  carry no server-side ordering authority. Ordering is `seq` (ADR-0002) and nothing else.
