# ADR-0004 — One wire format, and zero coercion in core

- **Status:** Accepted 2026-08-17. Implemented: no `normalize*` function exists anywhere
  in `@dhaam-ccrm/core`.
- **Decision record:** PRD §0.5 **D4**. Closes Open Question 4 (§18).
- **Supersedes:** v1's defensive coercion layer, written twice.

## Context

The v1 client survived an undocumented, drifted wire contract by coercing everything it
received. The coercion was **duplicated across two files**, which is itself the evidence
that it was accumulated reactively rather than designed:

**Enum coercion, written twice.** `normalizeSenderType`, `normalizeMessageType`,
`normalizeChatStatus` and `normalizeChatMode` exist independently in `src/client.ts`
(lines 13, 24, 40, 57) **and again** in `src/context.tsx`. Each accepts *either* the
integer enum value *or* the string name — because the backend has, across its rollout
history, sent both for the same field.

**Key coercion, per field.** `normalizeMessage()` (`src/client.ts:70`) reads every field
through a fallback chain: `raw.chatSessionId ?? raw.chat_session_id`,
`raw.senderId ?? raw.sender_id`, `raw.messageType ?? raw.message_type`, and
`raw.timestamp ?? raw.createdAt ?? raw.created_at ?? raw.sentAt` — **four aliases for one
concept**. This is direct evidence that the backend has emitted both camelCase and
snake_case for the same payload across different releases and endpoints.

**Two canonical locations for one fact.** v1 read attachments from `message.attachment`
*and* `message.metadata.attachment`, interchangeably.

**The type system did not model reality.** `src/types.ts` declares `ChatStatus` as a
four-value union (`OPEN | WAITING_FOR_AGENT | ASSIGNED | CLOSED`), while
`src/shared/enums.ts` — in the same repository — documents **six**: `RESOLVED` and
`ON_HOLD` are real backend states the v1 type system does not know exist. `closeReason`
is a loose `string | null` even though it carries a meaningful distinction (`'SWITCHED'`
for a session parked because the customer moved to another chat, versus `'MANUAL'` for
one genuinely ended).

The important reading of all this: **it is not a client bug to fix.** It is evidence that
nothing had ever forced the wire contract to be a single source of truth, and that the
client had absorbed the cost of that on the server's behalf — invisibly, and in two
places that could drift from each other.

## Decision

**One wire format, mandatory, with no compatibility shim on the client.**

- Enums are transmitted as their **canonical string name**. No bare integers in any `d`
  payload.
- Keys are **camelCase, exclusively**. No snake_case on the wire, ever.
- Timestamps are **ISO-8601**, with exactly **one canonical name per concept** — no
  `timestamp`/`createdAt`/`created_at`/`sentAt` aliasing.
- Every concept has exactly **one canonical location** (attachment is top-level, not
  under `metadata`; presence lives in `ChatState.presence` and the `isOnline` field was
  removed from the participant profile).
- The frame schemas are the **literal** source of truth. **Core ships zero coercion** —
  every `normalize*` function above is deleted, not ported.
- Malformed frames are **dropped with a logged warning, never partially applied**.
- The full six-value `ChatStatus` is modelled, and `CloseReason` is a first-class enum.

## Consequences

### What this buys

- **Drift becomes a server bug with a loud client symptom**, rather than a silent client
  workaround that hides the server bug indefinitely.
- **There is no second place business logic lives.** The duplicated coercion in
  `client.ts` and `context.tsx` could disagree with each other; nothing can now.
- **A Dart, Swift or Kotlin client can be written without reading TypeScript**, because
  there are no undocumented parsing rules to reverse-engineer. This is the property that
  keeps the mobile paths in §11 open.
- **The type system finally matches the backend.** `RESOLVED` and `ON_HOLD` are
  expressible; `CloseReason` distinguishes parked from ended.

### What it costs — stated honestly

- **The backend must be correct, or the client fails loudly.** This is the real trade-off
  and it should not be softened. A malformed frame is dropped, not coerced — so a server
  regression that reintroduces snake_case on one field does not *degrade* the feature, it
  **stops** it, and there is no shim to switch on while the fix ships. v1 would have
  absorbed that regression and nobody would have noticed for months. We are trading
  invisible degradation for visible outage, deliberately, and the operational
  prerequisite is that the server side can detect and roll back a wire regression quickly.
- **The blast radius is asymmetric, in the worse direction.** The publishable key and the
  client bundle live in *customers'* deployments and cannot be redeployed on our schedule;
  the server can be. So the party that must never drift is the one that *can* be fixed
  fastest, and the party that cannot be fixed fast is the one that fails. Contract tests
  on the server are not optional under D4 — they are what replaces the client's tolerance.
- **Zero coercion raises the cost of an underspecified spec, and the spec is currently
  underspecified.** PRD §7.3 names the frame types but **defines no payload fields**; the
  authoritative shapes are `packages/core/src/protocol/frames.ts` and its runtime
  validator `validate.ts`. Success criterion §1 ("an engineer could implement a conformant
  client purely from §7 and the OpenAPI spec") **does not hold today**: a Dart client
  written against §7 alone had to recover roughly **40 field definitions** by reading the
  server, and hit five blocking ambiguities — `resumeFrom`'s type, the unnamed
  `connection.ack.d.seq`, `message.send.d.type` being required by the server but optional
  in §6.3, the ULID character set, and the absence of any gap-detection algorithm. A
  forgiving parser would have absorbed several of those misreadings. Nothing absorbs them
  now.
- **Two things the server implements are absent from the published catalog**:
  `message.markDelivered` / `message.delivered` (the delivery watermarks), and the fact
  that **liveness is RFC 6455 ping/pong on a 25 s interval, not the `system.heartbeat`
  frame**. An implementer on a WebSocket library that does not auto-pong is dropped every
  50 s while dutifully sending heartbeats.
- **Closing this properly means generating the payload schemas from the protocol types,
  or writing them into §7 and enforcing agreement in CI.** Until that exists, treat
  `packages/core/src/protocol/` as the contract and this ADR as the record of why the
  gap matters more here than it would in a coercing client.
