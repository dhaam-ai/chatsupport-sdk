// useSessionList — the session-picker's data source (T10): the customer's
// own recent sessions ("the last 5"), fetched via `client.listSessions()`,
// plus the loading/error state this package tracks locally (core's
// `ChatState` has no such flag for this call — unlike `loadOlderMessages()`,
// which core itself drives and tracks via `pagination.loadingMore`,
// `listSessions()` is an ad hoc REST call a component triggers, so "is one in
// flight" is exactly the kind of DOM/component-lifecycle-adjacent bookkeeping
// §4 leaves to bindings) and the switch action a picker row needs.
//
// Two rules from `SessionSummarySource`/`ChatClient.listSessions`'s own docs
// (client/types.ts) this hook is careful not to relitigate at the call site:
//
//   - A guest gets `200` with `[]`, never a 403/404 — emptiness is a normal,
//     successful `'ready'` result, never `'error'` and never stuck in
//     `'loading'`. This hook adds no client-side guest heuristic on top; it
//     only reports what the server actually decided.
//   - Terminal (`CLOSED`/`RESOLVED`) sessions are not filtered out of
//     `sessions` and are not marked unselectable here — picking one and
//     sending into it reactivates it server-side (§12.5). `switchSession`
//     below is offered uniformly for every row for exactly this reason.
//
// `switchSession` is the one action here that is NOT a bare delegation.
// `ChatClient.switchSession` became a composite, awaitable operation (core:
// abandon the outgoing session's queue, clear every per-session projection,
// join, wait for the snapshot, load page one) that RESOLVES only once the
// picked session's first page is in `ChatState.messages` and REJECTS with
// `SessionSwitchError` when the server refused the join, the socket was not
// open, or the snapshot never arrived. A picker that fires it and drops the
// promise is back to the original bug in a new costume: the row highlights,
// nothing loads, and nothing says why. So this hook tracks the same two
// things it already tracks for `listSessions()` — which request is in
// flight, and what the last one failed with — using the same request-id
// discipline, and hands back a typed outcome rather than rejecting, so
// `onClick={() => switchSession(id)}` cannot produce an unhandled rejection.
//
// `sessions` is read from `ChatState.pastSessions` via `useChatSelector`,
// not kept as this hook's own local copy of the fetch result — `listSessions()`
// writes there wholesale (§9.4-style replace) on every call, so reading the
// store keeps this hook's data in sync with any other caller of
// `listSessions()`/`useChannel()` elsewhere in the tree, not just this
// instance's own fetch.

import type { ChatSessionSummary, ChatState } from '@dhaam-ccrm/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useChatClient } from './context.js';
import { useChatSelector } from './use-chat-selector.js';

export type UseSessionListStatus = 'loading' | 'ready' | 'error';

/**
 * What one {@link UseSessionListResult.switchSession} call did.
 *
 * A resolved outcome rather than a thrown error, for the same reason
 * `retryMessage` returns a `RetryOutcome`: the caller is a click handler, and
 * a refusal is an ordinary thing for it to render, not an exception for it to
 * catch. `error` carries core's `SessionSwitchError` unchanged — read
 * `.cause.source` to tell "the server refused this session" (`'protocol'`)
 * from "the socket was not there" (`'transport'`), and `.sessionId` to tell
 * WHICH row failed.
 *
 * `'switched'` means core resolved: the picked session's first page is in
 * `ChatState.messages` by the time you see this.
 */
export type SessionSwitchOutcome =
  | { status: 'switched'; sessionId: string }
  | { status: 'failed'; sessionId: string; error: unknown };

export interface UseSessionListOptions {
  /** Passed straight through to `client.listSessions({ limit })`. Omit for the server's own default (§6.2, "last 5"). */
  limit?: number;
}

export interface UseSessionListResult {
  /**
   * `'loading'` while a fetch (initial mount, a `limit` change, or
   * `refresh()`) is in flight. `'ready'` on a successful resolution —
   * including an empty `sessions` array, which is a normal outcome (a guest,
   * or a customer with no past sessions yet), never `'error'`. `'error'`
   * only when the fetch itself rejected — see {@link UseSessionListResult.error}.
   */
  status: UseSessionListStatus;

  /** `ChatState.pastSessions`, most-recent-first, per `listSessions()`. Includes CLOSED/RESOLVED rows — do not filter or disable them; see this file's header. */
  sessions: readonly ChatSessionSummary[];

  /**
   * Whatever the configured `SessionSummarySource` rejected with — `null`
   * outside `status === 'error'`. Left as `unknown` rather than narrowed:
   * `listSessions()` passes the adapter's rejection through unchanged
   * (client/types.ts: "this does not swallow a failure into `lastError`"),
   * so this hook has no fixed shape to promise beyond "whatever was thrown."
   */
  error: unknown;

  /**
   * Re-fetches. Never rejects — a failure lands on {@link
   * UseSessionListResult.error} / `status: 'error'`, same as the initial
   * fetch. `sessions` keeps its last value while this is in flight, so a
   * picker can leave the previous list on screen instead of blanking to a
   * spinner on every refresh.
   */
  refresh: () => Promise<void>;

  /**
   * The session id a switch is currently in flight for, or `null`.
   *
   * Render the pressed row's spinner off THIS, never off a local `useState`
   * in the row: core clears the transcript the moment the switch starts, so
   * between the click and the first page landing the message list is
   * legitimately empty. Without a flag saying "we are opening one", a picker
   * has nothing to distinguish that window from a conversation with no
   * messages in it.
   *
   * Only ever names the most recently-started switch. A second click while
   * the first is still in flight supersedes it — core's own epoch counter
   * discards the loser's page, and this hook discards the loser's outcome to
   * match.
   */
  switchingSessionId: string | null;

  /**
   * What the last switch attempt failed with — core's `SessionSwitchError`
   * (`.sessionId`, `.cause`) — or `null` if the last one succeeded, none has
   * run, or one is in flight (starting a switch clears this).
   *
   * Typed `unknown` for the same reason {@link UseSessionListResult.error}
   * is: this hook reports what it caught, and promises no shape beyond it.
   * The same failure is also on `ChatState.lastError` (see `useChatError`);
   * this one is the half that tells you which ROW did not open.
   */
  switchError: unknown;

  /**
   * Opens the picked session: `client.switchSession(sessionId)`, with the
   * promise tracked rather than dropped.
   *
   * Resolves — never rejects — to a {@link SessionSwitchOutcome}, so
   * `onClick={() => void switchSession(id)}` is safe and a caller that wants
   * to branch (close the drawer only if it actually opened) can `await` it.
   * The failure is also on {@link UseSessionListResult.switchError} for
   * callers that would rather render from state.
   *
   * By the time `'switched'` comes back, that session's first page is in
   * `ChatState.messages` — `useMessages()` is already showing it. Until then
   * `useMessages().historyLoading` is `true`.
   *
   * Safe to call with a CLOSED/RESOLVED row's id: `session.join` accepts a
   * terminal session server-side. Reactivation, if any, happens only once the
   * customer sends into it and is observed the normal way through
   * `useChannel()`'s `session` — never assumed here.
   */
  switchSession: (sessionId: string) => Promise<SessionSwitchOutcome>;
}

function selectPastSessions(state: ChatState): readonly ChatSessionSummary[] {
  return state.pastSessions;
}

/**
 * Fetches and exposes the customer's recent sessions, and the action to
 * switch into one.
 *
 * Fetches once on mount and again whenever `options.limit` changes.
 * Concurrent-safe: a `limit` change while a fetch is in flight, or a
 * `refresh()` called before the previous one resolves, only ever applies the
 * most recently-started request's result, and a resolution that arrives
 * after unmount is a no-op rather than a `setState` on an unmounted
 * component. `switchSession` gets the same treatment on its own counter — a
 * double-clicked picker reports only the switch the user actually ended up
 * on, and the superseded one's failure is discarded rather than shown
 * against a row nobody is opening any more.
 */
export function useSessionList(options: UseSessionListOptions = {}): UseSessionListResult {
  const client = useChatClient();
  const { limit } = options;

  const sessions = useChatSelector(selectPastSessions);
  const [fetchState, setFetchState] = useState<{ status: UseSessionListStatus; error: unknown }>({
    status: 'loading',
    error: null,
  });

  // Incremented on every new request AND on unmount / dependency-change
  // teardown, so a request's own resolution can tell — after the fact —
  // whether it is still the one this hook cares about before calling
  // `setState`. This is what makes an overlapping `refresh()` and a stale
  // post-unmount resolution both inert instead of corrupting state.
  const requestIdRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setFetchState({ status: 'loading', error: null });
    try {
      await client.listSessions(limit === undefined ? undefined : { limit });
      if (requestIdRef.current === requestId) setFetchState({ status: 'ready', error: null });
    } catch (error) {
      if (requestIdRef.current === requestId) setFetchState({ status: 'error', error });
    }
  }, [client, limit]);

  useEffect(() => {
    void load();
    return () => {
      // Stales out this effect's own in-flight request — either the
      // component is unmounting, or this effect is about to re-run for a new
      // `limit` and `load()` is about to mint its own fresh id.
      requestIdRef.current += 1;
    };
  }, [load]);

  // The switch's own counter, kept separate from `requestIdRef` because the
  // two are unrelated operations: re-fetching the list must not cancel a
  // switch that is in flight, and vice versa. Same purpose otherwise — a
  // superseded or post-unmount settlement can tell it is no longer the one
  // this hook should report, and skips its `setState`.
  const switchIdRef = useRef(0);
  const [switchState, setSwitchState] = useState<{ switchingSessionId: string | null; switchError: unknown }>({
    switchingSessionId: null,
    switchError: null,
  });

  useEffect(
    () => () => {
      // Unmount only (empty deps): stales out whatever switch is in flight,
      // so its settlement does not `setState` on a gone component.
      switchIdRef.current += 1;
    },
    [],
  );

  const switchSession = useCallback(
    async (sessionId: string): Promise<SessionSwitchOutcome> => {
      const switchId = ++switchIdRef.current;
      setSwitchState({ switchingSessionId: sessionId, switchError: null });
      try {
        await client.switchSession(sessionId);
        if (switchIdRef.current === switchId) setSwitchState({ switchingSessionId: null, switchError: null });
        return { status: 'switched', sessionId };
      } catch (error) {
        // Reported, never rethrown: the caller is a click handler. A caller
        // that wants the failure gets it in the returned outcome; one that
        // does not gets `switchError` instead of an unhandled rejection.
        if (switchIdRef.current === switchId) setSwitchState({ switchingSessionId: null, switchError: error });
        return { status: 'failed', sessionId, error };
      }
    },
    [client],
  );

  const actions = useMemo(() => ({ refresh: load, switchSession }), [load, switchSession]);

  return { ...fetchState, sessions, ...switchState, ...actions };
}
