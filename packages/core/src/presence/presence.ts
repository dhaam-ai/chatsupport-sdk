// Participant presence — PRD §7.3 (`presence.set` / `presence.query` /
// `presence.update`), §6.5 (the `presenceUpdate` event).
//
// ---------------------------------------------------------------------------
// Why presence is NOT written into ChatState
// ---------------------------------------------------------------------------
//
// It cannot be, and this is a genuine gap in §6.4 rather than a shortcut:
//
//   1. §6.4 specifies `ChatState` as exactly ten fields and none of them
//      carries presence. There is no `presence` map to write to.
//   2. The one presence-shaped field anywhere in the state layer is
//      `ChatParticipantProfile.isOnline`, reachable as
//      `session.assignedAgent` / `session.customer`. But
//      `ChatParticipantProfile` has NO id field — it is
//      `{ displayName, email, avatarUrl, isOnline }` — so a
//      `presence.update` carrying `participantId` cannot be correlated to a
//      profile at all.
//   3. Even given the participant→type mapping this module holds from
//      session snapshots, routing an AGENT's presence to the singular
//      `assignedAgent` would be wrong in exactly the case that mapping
//      exists for: multi-agent sessions are confirmed real (§12.9), so "some
//      agent went offline" does not imply "the assigned agent went offline".
//
// So presence is surfaced the two ways that ARE specified: the §6.5
// `presenceUpdate` discrete event, and this registry's read accessors for
// callers that want the current picture. Closing the gap properly means a
// §6.4 amendment (an id on `ChatParticipantProfile`, or a presence map in
// `ChatState`) — a spec change, not something to improvise here.
//
// ---------------------------------------------------------------------------
// Last-write-wins, deliberately unlike watermarks
// ---------------------------------------------------------------------------
//
// watermarks.ts enforces monotonic advance; this module does not, and the
// asymmetry is intentional. A read watermark is a monotonic quantity — it
// only ever means "has read at least this far" — so an older value is always
// stale and rejecting it is safe. Presence is a *current* fact with no
// ordering key: `PresenceEntry` carries `lastSeen` only while a participant
// is offline (domain.ts), so ONLINE entries have no timestamp to order by,
// and an ONLINE→OFFLINE→ONLINE sequence would be unorderable. Applying the
// newest frame received is the only well-defined rule available.

import type { PresenceEntry, PresenceStatus, PresenceUpdatePayload } from '../protocol/index.js';
import type { ChatStore } from '../state/index.js';
import type { IntentSink } from './intents.js';

export interface PresenceRegistryOptions {
  readonly store: ChatStore;
  readonly emitIntent: IntentSink;
}

export class PresenceRegistry {
  readonly #store: ChatStore;
  readonly #emitIntent: IntentSink;
  readonly #entries = new Map<string, PresenceEntry>();

  constructor(options: PresenceRegistryOptions) {
    this.#store = options.store;
    this.#emitIntent = options.emitIntent;
  }

  // ---------------------------------------------------------------------
  // Inbound
  // ---------------------------------------------------------------------

  /**
   * Applies a `presence.update` push (§7.3) and emits `presenceUpdate` (§6.5).
   *
   * A frame that restates what we already hold is recorded but not re-emitted:
   * §6.5's catalog describes discrete *occurrences*, and a `presence.query`
   * answer that merely confirms the status we had is not one. That keeps a
   * poll-style query from waking every handler for nothing.
   */
  applyPresenceUpdate(entry: PresenceUpdatePayload): void {
    const previous = this.#entries.get(entry.participantId);
    this.#entries.set(entry.participantId, entry);

    if (previous !== undefined && previous.status === entry.status && previous.lastSeen === entry.lastSeen) {
      return;
    }
    this.#store.emit('presenceUpdate', entry);
  }

  /**
   * Applies the entries carried by a `presence.query` ack
   * (`PresenceQueryAckData.presences`).
   *
   * Correlating that ack to the query that caused it is transport's job (it
   * owns the `ref` table, per protocol/envelope.ts); applying the result is
   * this module's.
   */
  applyPresenceSnapshot(entries: readonly PresenceEntry[]): void {
    for (const entry of entries) this.applyPresenceUpdate(entry);
  }

  // ---------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------

  /**
   * Publishes the local participant's presence (§7.3 `presence.set`).
   *
   * Deliberately no optimistic local echo. `#entries` is keyed by
   * participantId and this frame carries none — the server knows the sender —
   * so there is no key to write under. Our own presence lands in the registry
   * if and when the server relays it back as a `presence.update`.
   */
  setPresence(status: PresenceStatus): void {
    this.#emitIntent({ t: 'presence.set', d: { status } });
  }

  /**
   * Requests presence for specific participants, or for every participant in
   * the session when `participantIds` is omitted (§7.3).
   *
   * Results arrive asynchronously on the query's ack — see
   * `applyPresenceSnapshot`.
   */
  queryPresence(participantIds?: readonly string[]): void {
    this.#emitIntent({
      t: 'presence.query',
      // `exactOptionalPropertyTypes` forbids an explicit `undefined` — the key
      // must be absent to mean "every participant".
      d: participantIds === undefined ? {} : { participantIds: [...participantIds] },
    });
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  /** The last known presence for a participant, or `undefined` if never seen. */
  get(participantId: string): PresenceEntry | undefined {
    return this.#entries.get(participantId);
  }

  /** The last known status, or `undefined` if never seen. */
  statusOf(participantId: string): PresenceStatus | undefined {
    return this.#entries.get(participantId)?.status;
  }

  /** Every known presence entry, in first-seen order. */
  all(): readonly PresenceEntry[] {
    return [...this.#entries.values()];
  }

  /**
   * Discards every entry.
   *
   * Called on disconnect: presence learned over a socket that is now gone is
   * not evidence of anything, and serving it as current would show an agent
   * ONLINE indefinitely after the connection dropped.
   */
  clear(): void {
    this.#entries.clear();
  }
}
