---
"@dhaam-ccrm/js": minor
---

Re-export the session-history and session-switch surface a consumer needs to
name or catch.

`@dhaam-ccrm/js` is deliberately not a proxy for `ChatClient`'s operations —
`listSessions`, `switchSession` and `retryMessage` are called through
`store.client`, and that stays true. But calling them was only half-usable,
because the barrel's own §15 promise ("a consumer never needs a second import
specifier to name what this binding hands them") was kept for `ChatMessage` and
not for `ChatMessage.attachment`. The widget, this package's first consumer,
documented the breakage in its own source rather than here (`message-list.ts`
on `AttachmentMetadata`/`CloseReason`, `identity-header.ts` and
`session-picker.ts` on `HandledBy`/`ChatStatus`, and `isHandledByCurrent`
imported straight from core).

Two new runtime forwards, both core's own symbol rather than a local copy:

- `isHandledByCurrent` — the one canonical "is `handledBy` safe to narrate as
  the current handler" derivation. A reactivated session keeps the name of
  whoever last held it while `status` returns to `WAITING_FOR_AGENT`, and every
  binding must gate "connected to <name>" on the same rule.
- `SessionSwitchError` — what `switchSession()` rejects with. A value, so a
  caller can `instanceof` it and read `.sessionId`/`.cause` instead of
  comparing `error.name` against a string.

Type-only forwards, costing nothing at runtime: `AttachmentMetadata`,
`MessageMetadata`, `SenderType`, `MessageType`, `ChatStatus`, `ChatMode`,
`HandledBy`, `CloseReason`, `PresenceEntry`, `PresenceStatus`,
`ParticipantType`, `ErrorCode`, and `QueuedSend`/`RetryOutcome` for what
`retryMessage(id)` resolves to.

Core's runtime guards (`isChatStatus`, `isParkedCloseReason`, …) are
deliberately not forwarded: they validate untrusted input off the wire, which
core already does on the way in.

No behaviour change. This package's `select` is generic over the whole snapshot
and never projected `pagination` down — unlike the react/vue/angular selector
layers — so `pagination.initialLoaded` and `pastSessions` were always reachable;
`test/core-surface.test.ts` now pins that, along with a completed switch
arriving as exactly one notification per subscriber.
