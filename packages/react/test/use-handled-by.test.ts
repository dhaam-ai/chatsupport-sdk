// @vitest-environment jsdom
//
// useHandledBy — the two traps its return type exists to make unrepresentable:
// (1) absent handledBy must read as "render your own title", never "nobody is
// handling this chat"; (2) a stale (post-reactivation) handledBy must be
// distinguishable from a currently-active one without the consumer calling
// `isHandledByCurrent` itself. See src/use-handled-by.ts's header for the
// full reasoning.

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatSession } from '@dhaam-ccrm/core';

import { ChatProvider } from '../src/context.js';
import { useHandledBy } from '../src/use-handled-by.js';
import { createFakeChatClient } from './fake-chat-client.js';
import { h } from './h.js';

afterEach(() => {
  cleanup();
});

function baseSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'sess_1',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    createdAt: new Date().toISOString(),
    closedAt: null,
    assignedAgent: null,
    customer: null,
    ticket: null,
    ...overrides,
  };
}

function View() {
  const result = useHandledBy();
  return h(
    'div',
    null,
    h('div', { 'data-testid': 'state' }, result.state),
    h('div', { 'data-testid': 'name' }, result.state === 'unset' ? '' : result.handledBy.displayName),
  );
}

describe('useHandledBy — no session', () => {
  it('is "unset" when there is no session at all', () => {
    const client = createFakeChatClient({ session: null });
    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('state').textContent).toBe('unset');
  });
});

describe('useHandledBy — handledBy absent', () => {
  it('is "unset" (never a bare falsy read) when the session has no handledBy — queued, unassigned', () => {
    const client = createFakeChatClient({
      session: baseSession({ status: 'WAITING_FOR_AGENT' }),
    });
    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('state').textContent).toBe('unset');
  });
});

describe('useHandledBy — currently handled', () => {
  it('is "active" with the agent\'s identity when isHandledByCurrent would be true', () => {
    const client = createFakeChatClient({
      session: baseSession({
        status: 'ASSIGNED',
        handledBy: { kind: 'AGENT', id: 'agent_1', displayName: 'Ada' },
      }),
    });
    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('state').textContent).toBe('active');
    expect(screen.getByTestId('name').textContent).toBe('Ada');
  });

  it('is "active" for a BOT handler too — handledBy is broader than assignedAgent', () => {
    const client = createFakeChatClient({
      session: baseSession({
        status: 'OPEN',
        mode: 'BOT',
        handledBy: { kind: 'BOT', id: 'bot_1', displayName: 'Helper Bot' },
      }),
    });
    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('state').textContent).toBe('active');
    expect(screen.getByTestId('name').textContent).toBe('Helper Bot');
  });
});

describe('useHandledBy — reactivated-from-terminal staleness', () => {
  it('is "stale" — names the previous agent but does NOT claim they are on the chat — when status is WAITING_FOR_AGENT with a handledBy present', () => {
    // The exact reactivation shape core describes: a session that was CLOSED
    // is reactivated to WAITING_FOR_AGENT by a new customer message, but
    // still carries the agent who closed it in `handledBy`.
    const client = createFakeChatClient({
      session: baseSession({
        status: 'WAITING_FOR_AGENT',
        handledBy: { kind: 'AGENT', id: 'agent_1', displayName: 'Ada' },
      }),
    });
    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('state').textContent).toBe('stale');
    expect(screen.getByTestId('name').textContent).toBe('Ada');
  });
});

describe('useHandledBy — reactivity', () => {
  it('follows an agent.joined-style session.updated transition from unset to active', () => {
    const client = createFakeChatClient({ session: baseSession({ status: 'WAITING_FOR_AGENT' }) });
    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('state').textContent).toBe('unset');

    act(() => {
      client.emitState({
        session: baseSession({
          status: 'ASSIGNED',
          handledBy: { kind: 'AGENT', id: 'agent_2', displayName: 'Baz' },
        }),
      });
    });

    expect(screen.getByTestId('state').textContent).toBe('active');
    expect(screen.getByTestId('name').textContent).toBe('Baz');
  });

  it('follows an agent.left-style transition from active back to unset', () => {
    const client = createFakeChatClient({
      session: baseSession({
        status: 'ASSIGNED',
        handledBy: { kind: 'AGENT', id: 'agent_1', displayName: 'Ada' },
      }),
    });
    render(h(ChatProvider, { client }, h(View)));

    expect(screen.getByTestId('state').textContent).toBe('active');

    act(() => {
      client.emitState({ session: baseSession({ status: 'WAITING_FOR_AGENT' }) });
    });

    expect(screen.getByTestId('state').textContent).toBe('unset');
  });

  it('does not re-render when an unrelated field (messages) changes', () => {
    const client = createFakeChatClient({
      session: baseSession({
        status: 'ASSIGNED',
        handledBy: { kind: 'AGENT', id: 'agent_1', displayName: 'Ada' },
      }),
    });
    let renderCount = 0;

    function Counter() {
      useHandledBy();
      renderCount += 1;
      return null;
    }

    render(h(ChatProvider, { client }, h(Counter)));
    expect(renderCount).toBe(1);

    act(() => {
      client.emitState({ messages: [] });
    });

    expect(renderCount).toBe(1);
  });
});
