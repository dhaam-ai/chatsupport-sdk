// Outbound frame *intents* — the seam that keeps this module socket-free.
//
// PRD §7.3 lists five client→server frames this module is responsible for
// producing: `typing.start`, `typing.stop`, `message.markRead`, `presence.set`,
// and `presence.query`. This module decides *when* each should go out and with
// what payload; it never sends one. It hands an intent to an `IntentSink`, and
// the transport layer (T7) wraps it in the §7.2 envelope — supplying `v`, a
// fresh ULID `id`, and `ts` — and writes it to the socket.
//
// An intent is therefore deliberately just `{ t, d }`: the envelope fields it
// omits are precisely the ones this module cannot produce without owning a
// ULID source and the negotiated protocol version, both of which belong to
// transport. That omission is what makes every unit here testable by passing a
// recording function and asserting on plain objects, with no WebSocket in
// sight.

import type { ClientFramePayloadMap, ClientToServerFrameType } from '../protocol/index.js';

/**
 * The five §7.3 client→server frame types this module produces.
 *
 * `satisfies` ties this to the protocol module's own frame catalog, so a name
 * that is not a real client→server frame type fails to compile here rather
 * than silently producing a frame the server will reject.
 */
export const PRESENCE_INTENT_TYPES = [
  'typing.start',
  'typing.stop',
  'message.markRead',
  'presence.set',
  'presence.query',
] as const satisfies readonly ClientToServerFrameType[];

export type PresenceIntentType = (typeof PRESENCE_INTENT_TYPES)[number];

/**
 * Distributes the protocol's payload map into a union of `{ t, d }` pairs —
 * the same map-to-discriminated-union pattern protocol/frames.ts uses for
 * `ClientFrame`. Each member carries a literal `t`, so `switch (intent.t)`
 * narrows `d` to that frame's exact payload with no cast.
 *
 * Payload types are *read* from `ClientFramePayloadMap`, never restated. A
 * change to `MessageMarkReadPayload` in protocol/ reaches this module as a
 * compile error rather than as drift (D4).
 */
export type OutboundIntent = {
  [K in PresenceIntentType]: { readonly t: K; readonly d: ClientFramePayloadMap[K] };
}[PresenceIntentType];

/**
 * Where produced intents go. Injected by the caller (T8's connection layer),
 * which is what owns the decision of whether an intent is written to a live
 * socket, dropped, or queued (§8.4).
 *
 * Implementations must not throw: an intent sink that throws would abort a
 * state mutation half-applied. Callers in this module invoke the sink *after*
 * committing state, so a throwing sink cannot corrupt state — but it will
 * still propagate to whoever called `markRead()`/`startTyping()`.
 */
export type IntentSink = (intent: OutboundIntent) => void;
