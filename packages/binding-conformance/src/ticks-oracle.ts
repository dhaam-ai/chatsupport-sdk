// ── GAP-1: packages/core/src/index.ts does not export ticks.ts's derivation ──
//
// `packages/core/src/messages/ticks.ts` is exactly what this task's brief
// names as the tick conformance target ("Every binding must render from
// this, never reimplement it"), and `messages/index.ts` DOES export it
// (`export { MESSAGE_TICK_STATES, deriveTickState, deriveTickStateFromState }
// from './ticks.js';`, with its own barrel comment explaining why: "four
// bindings render the tick, and four independent derivations of it would
// disagree"). But `packages/core/src/index.ts` — the actual public package
// boundary (`@dhaam-ccrm/core`'s `package.json` "exports" field points only
// at what that file re-exports) — never promotes it. Every other symbol
// `messages/index.ts` exports (`compareBySeq`, `sortMessages`,
// `upsertMessage`, `prependPage`, `DEFAULT_PAGE_SIZE`, `NoActiveSessionError`)
// makes that final hop; the tick derivation is the one that doesn't.
//
// Net effect: NOTHING outside `packages/core` — not this suite, not a real
// Vue/Angular/vanilla binding, not an app — can import `deriveTickState` at
// all. `@dhaam-ccrm/core`'s `package.json` declares a single `"."` export
// target, so there is no deep-import path around this either (Node's
// package `exports` field rejects any subpath not listed there, and this
// package's own constraint — "no deep imports" — rules out reaching for one
// even if it worked). Confirmed by resolving the package from a sibling
// workspace package: it resolves to `packages/core/dist/index.cjs`, built
// from exactly the file this module's header describes.
//
// This is this task's most important finding — see the final report. It
// means every one of T20 (Vue)/T21 (Angular)/T22 (vanilla) is currently
// UNABLE to call the canonical tick derivation from application code, not
// just unable to satisfy this suite's tick-conformance battery. The fix is
// a two-line addition to `packages/core/src/index.ts` (out of this
// package's scope lock — packages/core is not writable from here):
//
//   export { MESSAGE_TICK_STATES, deriveTickState, deriveTickStateFromState } from './messages/index.js';
//   export type { MessageTickState, TickInput } from './messages/index.js';
//
// Until that lands, `resolveTickOracle()` below auto-detects which world
// it's in: if a future core build exports these, it uses them directly (no
// suite changes needed, no re-export of a dead code path). If not — today —
// it falls back to `mirrorDeriveTickState`, a byte-for-byte transcription of
// `ticks.ts`'s algorithm (transcribed from that file, not derived
// independently), kept ONLY so invariant #5 (tick derivation) can still be
// exercised through the public package boundary at all. This mirror is
// exactly the kind of duplication `ticks.ts`'s own module header warns
// against ("four independent implementations... will disagree") — it is
// tolerated here, once, clearly labeled, as the lesser evil against leaving
// the invariant completely untested. DELETE `mirrorDeriveTickState` the
// moment GAP-1 is fixed.

import * as core from '@dhaam-ccrm/core';
import type { ChatMessage, ChatState } from '@dhaam-ccrm/core';
import type { MirroredMessageTickState } from './types.js';

export interface TickOracleInput {
  readonly message: ChatMessage;
  readonly localParticipantId: string | null;
  readonly deliveredWatermarks: Readonly<Record<string, number>>;
  readonly readWatermarks: Readonly<Record<string, string>>;
}

export interface TickOracle {
  deriveTickState(input: TickOracleInput): MirroredMessageTickState | null;
  deriveTickStateFromState(
    state: Pick<ChatState, 'deliveredWatermarks' | 'readWatermarks'>,
    message: ChatMessage,
    localParticipantId: string | null,
  ): MirroredMessageTickState | null;
  /** `'core'` once GAP-1 is fixed and this is calling the real thing; `'mirror'` today. */
  readonly source: 'core' | 'mirror';
}

// ---------------------------------------------------------------------------
// Mirror — transcribed from packages/core/src/messages/ticks.ts. See header.
// ---------------------------------------------------------------------------

function mirrorHasOtherDelivered(input: TickOracleInput, seq: number): boolean {
  for (const [participantId, watermark] of Object.entries(input.deliveredWatermarks)) {
    if (participantId === input.localParticipantId) continue;
    if (watermark >= seq) return true;
  }
  return false;
}

function mirrorHasOtherRead(input: TickOracleInput, createdAt: string): boolean {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return false;
  for (const [participantId, watermark] of Object.entries(input.readWatermarks)) {
    if (participantId === input.localParticipantId) continue;
    const watermarkMs = Date.parse(watermark);
    if (Number.isNaN(watermarkMs)) continue;
    if (watermarkMs >= createdMs) return true;
  }
  return false;
}

function mirrorDeriveTickState(input: TickOracleInput): MirroredMessageTickState | null {
  const { message, localParticipantId } = input;

  if (localParticipantId === null) return null;
  if (message.senderId !== localParticipantId) return null;

  if (message.delivery?.state === 'failed') return null;
  if (message.delivery?.state === 'queued') return 'pending';

  const seq = message.seq;
  if (seq === undefined) return null;

  if (mirrorHasOtherRead(input, message.createdAt)) return 'read';
  if (mirrorHasOtherDelivered(input, seq)) return 'delivered';
  return 'sent';
}

function mirrorDeriveTickStateFromState(
  state: Pick<ChatState, 'deliveredWatermarks' | 'readWatermarks'>,
  message: ChatMessage,
  localParticipantId: string | null,
): MirroredMessageTickState | null {
  return mirrorDeriveTickState({
    message,
    localParticipantId,
    deliveredWatermarks: state.deliveredWatermarks,
    readWatermarks: state.readWatermarks,
  });
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

let warned = false;
let cached: TickOracle | null = null;

/**
 * Resolves the canonical tick derivation, preferring the real
 * `@dhaam-ccrm/core` export the moment GAP-1 is fixed, falling back to the
 * mirror until then. Memoized — the fallback warning fires at most once per
 * process, and re-resolving on every check would be pure overhead either
 * way (neither branch's answer can change mid-run).
 */
export function resolveTickOracle(): TickOracle {
  if (cached) return cached;

  const maybeDerive = (core as unknown as Record<string, unknown>)['deriveTickState'];
  const maybeDeriveFromState = (core as unknown as Record<string, unknown>)['deriveTickStateFromState'];

  if (typeof maybeDerive === 'function' && typeof maybeDeriveFromState === 'function') {
    cached = {
      deriveTickState: maybeDerive as TickOracle['deriveTickState'],
      deriveTickStateFromState: maybeDeriveFromState as TickOracle['deriveTickStateFromState'],
      source: 'core',
    };
    return cached;
  }

  if (!warned) {
    warned = true;
    // Deliberate, one-time — see this file's header (GAP-1).
    console.warn(
      '[@dhaam-ccrm/binding-conformance] GAP-1: @dhaam-ccrm/core does not export deriveTickState/' +
        'deriveTickStateFromState from its public barrel. Falling back to an internal mirror of ' +
        'packages/core/src/messages/ticks.ts for tick-conformance checks — see src/ticks-oracle.ts.',
    );
  }

  cached = {
    deriveTickState: mirrorDeriveTickState,
    deriveTickStateFromState: mirrorDeriveTickStateFromState,
    source: 'mirror',
  };
  return cached;
}
