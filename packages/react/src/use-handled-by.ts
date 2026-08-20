// useHandledBy — the customer's session-header source of truth for "who am
// I talking to" (core's T7 binding handoff, `HandledBy`'s own doc in
// `@dhaam-ccrm/core`'s protocol/domain.ts: "Framework bindings should expose
// it as a first-class reactive value so a header component can read it
// directly instead of reaching into `assignedAgent` and guessing").
//
// `ChatSession.handledBy` is an `HandledBy | undefined` in core, and a bare
// pass-through of that shape would let every call site independently get two
// things wrong:
//
//   1. Absence does NOT mean "nobody is handling this chat" — `status`/
//      `mode` (see `useChannel()`) carry that signal, not this field. Core's
//      own doc on `ChatSession.handledBy` is explicit: a binding "MUST fall
//      back to its own configured title" on absence, never to "this chat is
//      unhandled." A plain `HandledBy | undefined` invites exactly the wrong
//      render (`{handledBy ? handledBy.displayName : 'No agent'}`), so this
//      hook never hands out `undefined` for a caller to interpret — absence
//      is its own named state below (`'unset'`).
//   2. A session reactivated from a terminal `CLOSED`/`RESOLVED` state keeps
//      its previous agent (backend T6), so `handledBy` can still name someone
//      while `status` has already gone back to `WAITING_FOR_AGENT` — that
//      person is NOT currently on the chat. Core never suppresses this (the
//      wire value is wholesale-authoritative, §9.4) and ships
//      `isHandledByCurrent(session)` as the one canonical "is this safe to
//      narrate as active" gate. This hook calls it once, here, so a consumer
//      branches on `state: 'active' | 'stale'` instead of every render site
//      needing to remember to import and call `isHandledByCurrent` itself.
//
// Reactive like every other selector hook in this package: `agent.joined`/
// `agent.left`, `session.updated`, and `connection.ack` all replace
// `ChatState.session` wholesale, so this hook's return value follows with no
// extra wiring — a new message or a typing update never touches `session`,
// so it does not re-render for either.

import type { ChatSession, ChatState, HandledBy } from '@dhaam-ccrm/core';
import { isHandledByCurrent } from '@dhaam-ccrm/core';
import { useMemo } from 'react';

import { useChatSelector } from './use-chat-selector.js';

/**
 * `'unset'` — no session yet, or the session has nothing presentable to say
 * (queued with no assignee yet, or a display name that has not resolved).
 * Render your own configured title. This is explicitly NOT "nobody is
 * handling this chat" — read `useChannel()`'s `session.status`/`.mode` for
 * that signal instead.
 *
 * `'active'` — `handledBy` names who the customer is CURRENTLY talking to
 * (`isHandledByCurrent` is true for the underlying session). Safe to render
 * "connected to `<name>`"-style copy from `handledBy`.
 *
 * `'stale'` — `handledBy` names who handled this session before it was
 * reactivated from a terminal state; `isHandledByCurrent` is false. The name
 * is genuine (fine for "previously spoke with `<name>`" copy) but that
 * person is not on the chat right now — do not render "connected to" copy
 * from this branch.
 */
export type UseHandledByResult =
  | { readonly state: 'unset' }
  | { readonly state: 'active'; readonly handledBy: HandledBy }
  | { readonly state: 'stale'; readonly handledBy: HandledBy };

/**
 * Shared singleton for the `'unset'` branch, so two consecutive `'unset'`
 * results (even across a `session` reference change that does not affect
 * this outcome — e.g. a ticket-link update on an otherwise-unassigned
 * session) are the exact same object. Keeps this hook's return safe to put
 * in a `useEffect`/`useMemo` dependency array without a false "it changed".
 */
const UNSET_RESULT: UseHandledByResult = { state: 'unset' };

function selectSession(state: ChatState): ChatSession | null {
  return state.session;
}

/**
 * Who the customer is currently talking to, or was talking to before this
 * session was reactivated — see this file's header for the two semantics
 * encoded in the return type.
 *
 * Re-renders only when `ChatState.session`'s reference changes — core's
 * shallow-patch contract means a new message or a typing update never
 * touches `session`, so this hook does not fire for either (same reasoning
 * `useTypingIndicator` documents for `state.typing`). The returned object is
 * `useMemo`'d off that same session reference, so a consumer does not see a
 * new identity on a render this hook did not itself cause.
 */
export function useHandledBy(): UseHandledByResult {
  const session = useChatSelector(selectSession);

  return useMemo((): UseHandledByResult => {
    if (session === null || session.handledBy === undefined) {
      return UNSET_RESULT;
    }
    return {
      state: isHandledByCurrent(session) ? 'active' : 'stale',
      handledBy: session.handledBy,
    };
  }, [session]);
}
