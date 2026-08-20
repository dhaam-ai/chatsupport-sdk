// @vitest-environment jsdom
//
// useSessionList — the picker's data source. Three rules under test that a
// naive implementation gets wrong: an empty result is 'ready', never
// 'error'; terminal (CLOSED/RESOLVED) rows are not filtered or specially
// marked; and switching delegates to the client's own `switchSession`
// (literally `joinSession` under a picker-friendly name) rather than
// reinventing session-switching in this package.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSessionSummary } from '@dhaam-ccrm/core';

import { ChatProvider } from '../src/context.js';
import { useSessionList } from '../src/use-session-list.js';
import { createFakeChatClient } from './fake-chat-client.js';
import { h } from './h.js';

afterEach(() => {
  cleanup();
});

function summary(overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary {
  return {
    id: 's1',
    status: 'CLOSED',
    mode: 'HUMAN',
    createdAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    unreadCount: 0,
    ...overrides,
  };
}

/** Resolves/rejects on demand, so a test can observe the 'loading' state before settling it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function View() {
  const { status, sessions, error, refresh, switchSession } = useSessionList();
  return h(
    'div',
    null,
    h('div', { 'data-testid': 'status' }, status),
    h('div', { 'data-testid': 'count' }, sessions.length),
    h('div', { 'data-testid': 'error' }, error === null ? 'none' : String(error)),
    h('button', { onClick: () => void refresh() }, 'refresh'),
    h('button', { onClick: () => switchSession('s1') }, 'switch'),
  );
}

describe('useSessionList — happy path', () => {
  it('starts loading, then reads the resolved list off ChatState.pastSessions', async () => {
    const client = createFakeChatClient();
    const rows = [summary({ id: 's1' }), summary({ id: 's2', status: 'RESOLVED' })];
    const request = deferred<readonly ChatSessionSummary[]>();
    client.listSessions = vi.fn(async () => request.promise);

    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('status').textContent).toBe('loading');
    expect(screen.getByTestId('count').textContent).toBe('0');

    await act(async () => {
      request.resolve(rows);
      // ChatState.pastSessions is written by the real client, not this fake
      // — emulate `listSessions()`'s own "wholesale replace" contract so the
      // hook's store-backed `sessions` reflects the resolution the same way
      // it would against a real ChatClient.
      client.emitState({ pastSessions: [...rows] });
      await request.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });
    expect(screen.getByTestId('count').textContent).toBe('2');
  });

  it('an empty result is "ready", never "error" — the guest signal is a normal success', async () => {
    const client = createFakeChatClient(); // default listSessions resolves []

    render(h(ChatProvider, { client }, h(View)));

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });
    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(screen.getByTestId('error').textContent).toBe('none');
  });

  it('does not filter out or otherwise mark terminal CLOSED/RESOLVED rows', async () => {
    const client = createFakeChatClient({
      pastSessions: [summary({ id: 's1', status: 'CLOSED' }), summary({ id: 's2', status: 'RESOLVED' })],
    });

    render(h(ChatProvider, { client }, h(View)));

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });
    // Both terminal rows are still present and counted — nothing in this
    // hook drops or special-cases them.
    expect(screen.getByTestId('count').textContent).toBe('2');
  });
});

describe('useSessionList — error path', () => {
  it('surfaces a rejection as status "error" with the rejection itself on `error`, without touching sessions', async () => {
    const client = createFakeChatClient({ pastSessions: [summary()] });
    const failure = new Error('network down');
    client.listSessions = vi.fn(async () => {
      throw failure;
    });

    render(h(ChatProvider, { client }, h(View)));

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });
    expect(screen.getByTestId('error').textContent).toBe(String(failure));
    // The store's last-known sessions are untouched by the failed fetch.
    expect(screen.getByTestId('count').textContent).toBe('1');
  });
});

describe('useSessionList — refresh', () => {
  it('re-fetches on demand and flips back to loading while in flight', async () => {
    const client = createFakeChatClient();
    render(h(ChatProvider, { client }, h(View)));

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    const request = deferred<readonly ChatSessionSummary[]>();
    client.listSessions = vi.fn(async () => request.promise);

    fireEvent.click(screen.getByText('refresh'));
    expect(screen.getByTestId('status').textContent).toBe('loading');

    await act(async () => {
      request.resolve([]);
      await request.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });
  });
});

describe('useSessionList — switching', () => {
  it('delegates to client.switchSession with the given id — the same operation as joinSession, never a hand-rolled one', async () => {
    const client = createFakeChatClient();
    render(h(ChatProvider, { client }, h(View)));

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    fireEvent.click(screen.getByText('switch'));
    expect(client.switchSession).toHaveBeenCalledWith('s1');
    expect(client.switchSession).toHaveBeenCalledTimes(1);
  });
});

describe('useSessionList — concurrency', () => {
  it('never calls setState after unmount for a request still in flight', async () => {
    const client = createFakeChatClient();
    const request = deferred<readonly ChatSessionSummary[]>();
    client.listSessions = vi.fn(async () => request.promise);

    const { unmount } = render(h(ChatProvider, { client }, h(View)));
    expect(screen.getByTestId('status').textContent).toBe('loading');

    unmount();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Resolves only after unmount — if the hook called setState here, React
      // would log the "Can't perform a React state update on an unmounted
      // component" warning, which this assertion catches.
      request.resolve([]);
      await request.promise;
      await Promise.resolve();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('only applies the most recently-started request\'s result when `limit` changes mid-flight', async () => {
    const client = createFakeChatClient();
    const first = deferred<readonly ChatSessionSummary[]>();
    const second = deferred<readonly ChatSessionSummary[]>();
    const calls: Array<{ limit?: number } | undefined> = [];
    client.listSessions = vi.fn(async (query?: { limit?: number }) => {
      calls.push(query);
      return calls.length === 1 ? first.promise : second.promise;
    });

    function LimitView(props: { limit: number }) {
      const { status } = useSessionList({ limit: props.limit });
      return h('div', { 'data-testid': 'status' }, status);
    }

    const { rerender } = render(h(ChatProvider, { client }, h(LimitView, { limit: 5 })));
    expect(screen.getByTestId('status').textContent).toBe('loading');

    rerender(h(ChatProvider, { client }, h(LimitView, { limit: 10 })));

    await act(async () => {
      second.resolve([summary({ id: 'from-second' })]);
      client.emitState({ pastSessions: [summary({ id: 'from-second' })] });
      await second.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    // The stale first request resolving afterward must not flip status back
    // to 'ready' a second time in a way that would mask a later error, nor
    // throw for being applied post-hoc — it is simply ignored.
    await act(async () => {
      first.resolve([summary({ id: 'from-first' })]);
      await first.promise;
    });

    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(calls).toEqual([{ limit: 5 }, { limit: 10 }]);
  });

  it('settles cleanly under React 18 StrictMode\'s dev mount/cleanup/mount, with no console error from a discarded first pass', async () => {
    const client = createFakeChatClient({ pastSessions: [summary()] });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(h(StrictMode, null, h(ChatProvider, { client }, h(View))));

      await waitFor(() => {
        expect(screen.getByTestId('status').textContent).toBe('ready');
      });
      expect(screen.getByTestId('count').textContent).toBe('1');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
