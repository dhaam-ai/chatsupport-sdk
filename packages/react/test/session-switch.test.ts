// @vitest-environment jsdom
//
// The two user-reported symptoms, at the React binding layer:
//
//   1. "click on a prev session — it does not load the session messages"
//   2. "reload the app — it does not load messages of the current session"
//
// Core now owns both fixes (`switchSession` is a composite operation that
// resolves once page one of the NEW session is in `ChatState.messages`, and
// it seeds history itself on every `connected`). What is left for THIS
// package — and what these tests pin — is that the bindings expose that
// corrected behaviour rather than quietly re-breaking it:
//
//   - `switchSession` is now async and REJECTS with `SessionSwitchError`.
//     A binding that returns `client.switchSession(id)` and lets the caller
//     drop it turns a refused row into a dead click, which is symptom 1 all
//     over again with a different cause. `useSessionList` therefore tracks
//     which row is opening and what it failed with.
//   - `useMessages` must let a consumer tell "nothing loaded yet" from
//     "genuinely empty", or every switch (and every reload) flashes an
//     "no messages yet" empty state before the transcript arrives.
//   - Nothing in this package may seed history itself. Core does it. A
//     binding-side latch would be a second owner racing core's.
//
// The `ChatClient` double below reproduces core's ACTUAL new sequence —
// one atomic per-session reset, then the `session.updated` snapshot, then
// page one — rather than just resolving. That is what makes assertion "the
// picked session's messages are on screen" meaningful instead of trivially
// true. See fake-chat-client.ts's header for why this package tests against
// a double at all instead of a real `createChatClient()`.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatSession } from '@dhaam-ccrm/core';
import { SessionSwitchError } from '@dhaam-ccrm/core';

import { ChatProvider } from '../src/context.js';
import { useChannel } from '../src/use-channel.js';
import { useMessages } from '../src/use-messages.js';
import { useSessionList } from '../src/use-session-list.js';
import type { FakeChatClient } from './fake-chat-client.js';
import { createFakeChatClient } from './fake-chat-client.js';
import { h } from './h.js';

afterEach(() => {
  cleanup();
});

const CURRENT = 'sess_current';
const PAST = 'sess_past';

function session(id: string): ChatSession {
  return {
    id,
    status: id === CURRENT ? 'ASSIGNED' : 'CLOSED',
    mode: 'HUMAN',
    createdAt: '2026-01-01T00:00:00.000Z',
    closedAt: id === CURRENT ? null : '2026-01-02T00:00:00.000Z',
    assignedAgent: null,
    customer: null,
    ticket: null,
  };
}

function message(id: string, sessionId: string, content: string): ChatMessage {
  return {
    id,
    sessionId,
    senderId: 'agent_1',
    senderType: 'AGENT',
    type: 'TEXT',
    content,
    createdAt: '2026-01-01T00:00:00.000Z',
    seq: 1,
  };
}

const TRANSCRIPTS: Record<string, ChatMessage[]> = {
  [CURRENT]: [message('m_current', CURRENT, 'the chat we are in')],
  [PAST]: [message('m_past', PAST, 'the chat we picked')],
};

function transcriptOf(sessionId: string): ChatMessage[] {
  return TRANSCRIPTS[sessionId] ?? [];
}

/**
 * Installs core's real post-fix `switchSession` sequence on the double:
 * ONE atomic reset (transcript + pagination, `initialLoaded` back to
 * `false`), then the `session.updated` snapshot, then page one — resolving
 * only after that last write, exactly as client/types.ts now promises.
 *
 * `gate` lets a test observe the in-flight window before the transcript
 * lands.
 */
function installCoreSwitch(client: FakeChatClient, gate?: () => Promise<void>): void {
  client.switchSession = vi.fn(async (sessionId: string) => {
    client.emitState({
      messages: [],
      pagination: { hasMore: false, loadingMore: false, initialLoaded: false },
    });
    if (gate) await gate();
    client.emitState({ session: session(sessionId) });
    client.emitState({
      messages: transcriptOf(sessionId),
      pagination: { hasMore: false, loadingMore: false, initialLoaded: true },
    });
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A picker + transcript in one component — the smallest thing that can show symptom 1. */
function Picker() {
  const { switchSession, switchingSessionId, switchError } = useSessionList();
  const { messages, historyLoading } = useMessages();
  const { session: active } = useChannel();

  return h(
    'div',
    null,
    h('div', { 'data-testid': 'session' }, active === null ? 'none' : active.id),
    h('div', { 'data-testid': 'transcript' }, messages.map((m) => m.content).join('|')),
    h('div', { 'data-testid': 'historyLoading' }, String(historyLoading)),
    h('div', { 'data-testid': 'switching' }, switchingSessionId ?? 'none'),
    h('div', { 'data-testid': 'switchError' }, switchError === null ? 'none' : String(switchError)),
    h('button', { onClick: () => void switchSession(PAST) }, 'pick-past'),
    h('button', { onClick: () => void switchSession(CURRENT) }, 'pick-current'),
  );
}

function mountPicker(client: FakeChatClient) {
  return render(h(ChatProvider, { client }, h(Picker)));
}

/** The state a live client is in mid-conversation: connected, in CURRENT, page one loaded. */
function inCurrentSession(): FakeChatClient {
  return createFakeChatClient({
    connectionState: 'connected',
    session: session(CURRENT),
    messages: transcriptOf(CURRENT),
    pagination: { hasMore: false, loadingMore: false, initialLoaded: true },
  });
}

describe('bug 1 — picking a previous session loads that session’s messages', () => {
  it('replaces the transcript with the picked session’s own messages', async () => {
    const client = inCurrentSession();
    installCoreSwitch(client);
    mountPicker(client);

    expect(screen.getByTestId('transcript').textContent).toBe('the chat we are in');

    await act(async () => {
      fireEvent.click(screen.getByText('pick-past'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('transcript').textContent).toBe('the chat we picked');
    });
    // The header moved too, and — the actual reported symptom — it is NOT
    // showing the new session above the old session's messages.
    expect(screen.getByTestId('session').textContent).toBe(PAST);
    expect(client.switchSession).toHaveBeenCalledWith(PAST);
    expect(client.switchSession).toHaveBeenCalledTimes(1);
  });

  it('never renders the new session id against the old session’s transcript', async () => {
    const client = inCurrentSession();
    installCoreSwitch(client);

    const observed: Array<{ session: string; transcript: string }> = [];
    function Observer() {
      const { session: active } = useChannel();
      const { messages } = useMessages();
      observed.push({
        session: active === null ? 'none' : active.id,
        transcript: messages.map((m) => m.content).join('|'),
      });
      const { switchSession } = useSessionList();
      return h('button', { onClick: () => void switchSession(PAST) }, 'pick-past');
    }

    render(h(ChatProvider, { client }, h(Observer)));

    await act(async () => {
      fireEvent.click(screen.getByText('pick-past'));
    });

    await waitFor(() => {
      expect(observed[observed.length - 1]).toEqual({ session: PAST, transcript: 'the chat we picked' });
    });
    // Not one commit paired PAST's id with CURRENT's messages.
    expect(observed.filter((frame) => frame.session === PAST && frame.transcript.includes('we are in'))).toEqual([]);
  });

  it('reports which row is opening through switchingSessionId, and clears it once the transcript lands', async () => {
    const client = inCurrentSession();
    const gate = deferred<void>();
    installCoreSwitch(client, () => gate.promise);
    mountPicker(client);

    await act(async () => {
      fireEvent.click(screen.getByText('pick-past'));
    });

    // Mid-switch: core has already cleared the transcript, so without this
    // flag a picker has nothing to distinguish "opening" from "empty chat".
    expect(screen.getByTestId('switching').textContent).toBe(PAST);
    expect(screen.getByTestId('transcript').textContent).toBe('');
    expect(screen.getByTestId('historyLoading').textContent).toBe('true');

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId('switching').textContent).toBe('none');
    });
    expect(screen.getByTestId('historyLoading').textContent).toBe('false');
    expect(screen.getByTestId('transcript').textContent).toBe('the chat we picked');
  });

  it('surfaces a refused switch instead of dropping the rejection on the floor', async () => {
    const client = inCurrentSession();
    const failure = new SessionSwitchError(PAST, {
      source: 'protocol',
      code: 'SESSION_NOT_FOUND',
      message: 'not your session',
      retryable: false,
    });
    client.switchSession = vi.fn(async () => {
      throw failure;
    });

    const outcomes: unknown[] = [];
    function View() {
      const { switchSession, switchingSessionId, switchError } = useSessionList();
      return h(
        'div',
        null,
        h('div', { 'data-testid': 'switching' }, switchingSessionId ?? 'none'),
        h('div', { 'data-testid': 'switchError' }, switchError === null ? 'none' : String(switchError)),
        h(
          'button',
          {
            onClick: () => {
              void switchSession(PAST).then((outcome) => outcomes.push(outcome));
            },
          },
          'pick-past',
        ),
      );
    }

    render(h(ChatProvider, { client }, h(View)));

    await act(async () => {
      fireEvent.click(screen.getByText('pick-past'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('switchError').textContent).toBe(String(failure));
    });
    // The spinner must stop, or the row stays stuck "opening" forever.
    expect(screen.getByTestId('switching').textContent).toBe('none');
    // Resolves to a typed outcome rather than rejecting — an onClick handler
    // that says `void switchSession(id)` must not produce an unhandled
    // rejection, and a caller that DOES await gets the failure either way.
    expect(outcomes).toEqual([{ status: 'failed', sessionId: PAST, error: failure }]);
  });

  it('clears a previous failure when a new switch starts', async () => {
    const client = inCurrentSession();
    const failure = new SessionSwitchError(PAST, {
      source: 'transport',
      code: null,
      message: 'socket was not open',
      retryable: true,
    });
    client.switchSession = vi.fn(async () => {
      throw failure;
    });
    mountPicker(client);

    await act(async () => {
      fireEvent.click(screen.getByText('pick-past'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('switchError').textContent).toBe(String(failure));
    });

    installCoreSwitch(client);
    await act(async () => {
      fireEvent.click(screen.getByText('pick-past'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('switchError').textContent).toBe('none');
    });
    expect(screen.getByTestId('transcript').textContent).toBe('the chat we picked');
  });

  it('a superseded switch never writes its outcome over the winner’s', async () => {
    const client = inCurrentSession();
    const first = deferred<void>();
    const second = deferred<void>();
    const gates = [first, second];
    let call = 0;

    const failure = new SessionSwitchError(PAST, {
      source: 'protocol',
      code: 'SESSION_NOT_FOUND',
      message: 'not your session',
      retryable: false,
    });
    client.switchSession = vi.fn(async (sessionId: string) => {
      const gate = gates[call++];
      await gate?.promise;
      if (sessionId === PAST) throw failure;
      client.emitState({
        session: session(sessionId),
        messages: transcriptOf(sessionId),
        pagination: { hasMore: false, loadingMore: false, initialLoaded: true },
      });
    });

    mountPicker(client);

    await act(async () => {
      fireEvent.click(screen.getByText('pick-past'));
      fireEvent.click(screen.getByText('pick-current'));
    });
    expect(screen.getByTestId('switching').textContent).toBe(CURRENT);

    // The WINNER settles first, then the superseded one rejects.
    await act(async () => {
      second.resolve();
      await second.promise;
    });
    await waitFor(() => {
      expect(screen.getByTestId('switching').textContent).toBe('none');
    });

    await act(async () => {
      first.resolve();
      await first.promise.then(
        () => {},
        () => {},
      );
    });

    // The loser's rejection must not resurrect a spinner or show an error
    // for a row the user is no longer opening.
    expect(screen.getByTestId('switching').textContent).toBe('none');
    expect(screen.getByTestId('switchError').textContent).toBe('none');
    expect(screen.getByTestId('transcript').textContent).toBe('the chat we are in');
  });

  it('never setStates after unmount for a switch still in flight', async () => {
    const client = inCurrentSession();
    const gate = deferred<void>();
    installCoreSwitch(client, () => gate.promise);
    const { unmount } = mountPicker(client);

    await act(async () => {
      fireEvent.click(screen.getByText('pick-past'));
    });
    expect(screen.getByTestId('switching').textContent).toBe(PAST);

    unmount();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      gate.resolve();
      await gate.promise;
      await Promise.resolve();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('useChannel — switchSession is reachable without the picker hook', () => {
  it('exposes the composite switch alongside the raw joinSession frame', async () => {
    const client = inCurrentSession();
    installCoreSwitch(client);

    function View() {
      const { switchSession, joinSession, pastSessions } = useChannel();
      const { messages } = useMessages();
      return h(
        'div',
        null,
        h('div', { 'data-testid': 'transcript' }, messages.map((m) => m.content).join('|')),
        h('div', { 'data-testid': 'past' }, pastSessions.length),
        h('button', { onClick: () => void switchSession(PAST) }, 'switch'),
        h('button', { onClick: () => joinSession(PAST) }, 'join'),
      );
    }

    render(h(ChatProvider, { client }, h(View)));

    await act(async () => {
      fireEvent.click(screen.getByText('switch'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('transcript').textContent).toBe('the chat we picked');
    });
    expect(client.switchSession).toHaveBeenCalledWith(PAST);

    // `joinSession` is still the bare protocol frame — unchanged, and NOT
    // routed through `switchSession`.
    fireEvent.click(screen.getByText('join'));
    expect(client.joinSession).toHaveBeenCalledWith(PAST);
    expect(client.switchSession).toHaveBeenCalledTimes(1);
  });
});

describe('bug 2 — the current session’s transcript after a page reload', () => {
  it('renders the transcript core seeds on connect, without this package fetching history itself', async () => {
    // A reload: a brand-new client at `createInitialChatState()` — no
    // session, no messages, nothing loaded.
    const client = createFakeChatClient();
    mountPicker(client);

    expect(screen.getByTestId('session').textContent).toBe('none');
    expect(screen.getByTestId('transcript').textContent).toBe('');
    // Crucially NOT indistinguishable from "this conversation is empty":
    // a consumer keys its skeleton off this instead of `messages.length`.
    expect(screen.getByTestId('historyLoading').textContent).toBe('true');

    // Core restores the persisted selection on `connected` and seeds page
    // one itself (create-chat-client.ts's `restoreSelectionAndSeed`).
    await act(async () => {
      client.emitState({ connectionState: 'connected', session: session(CURRENT) });
      client.emitState({
        messages: transcriptOf(CURRENT),
        pagination: { hasMore: false, loadingMore: false, initialLoaded: true },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('transcript').textContent).toBe('the chat we are in');
    });
    expect(screen.getByTestId('session').textContent).toBe(CURRENT);
    expect(screen.getByTestId('historyLoading').textContent).toBe('false');
    // The regression guard that matters: this package must NOT grow the
    // widget's `historyRequested` latch. Core is the single owner of the
    // connect-time seed; a second one here would race it.
    expect(client.loadOlderMessages).not.toHaveBeenCalled();
  });

  it('a failed first load leaves historyLoading true so a retry affordance stays reachable', async () => {
    const client = createFakeChatClient();
    mountPicker(client);

    // Core's catch path: `loadingMore` back to false, `lastError` set, and
    // `initialLoaded` deliberately NOT latched (controller.ts) — the load
    // did not load anything, so a retry must still fetch.
    await act(async () => {
      client.emitState({
        connectionState: 'connected',
        pagination: { hasMore: false, loadingMore: false, initialLoaded: false },
        lastError: { source: 'transport', code: null, message: 'failed to load message history', retryable: true },
      });
    });

    expect(screen.getByTestId('historyLoading').textContent).toBe('true');
    expect(screen.getByTestId('transcript').textContent).toBe('');
  });
});
