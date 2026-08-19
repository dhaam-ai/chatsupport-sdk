// A hand-rolled `ChatClient` test double — deliberately NOT a real
// `createChatClient()` wired to a fake transport. This package's job is
// "map core's observable store to React re-renders," so its tests need a
// controllable implementation of the public `ChatClient` interface
// (`@dhaam-ccrm/core`'s exported type), not a working WS/reconnect/dedup
// engine. Reaching for the real thing here would mean constructing
// `history`/`localSender`/etc. seams just to exercise hook plumbing that has
// nothing to do with any of that — see this package's own module docs
// ("no reconnect, backoff, dedup ... logic lives here") for why a real
// client is the wrong tool for testing the binding layer itself.
//
// The `getState`/`subscribe` half below intentionally mirrors
// `packages/core/src/state/store.ts`'s two documented invariants (same
// reasoning, independently reproduced at test-double scale, not imported):
// state is replaced wholesale rather than mutated, and an unchanged patch is
// a no-op — because those are exactly the invariants this package's hooks
// are being tested against, and a fake that didn't uphold them would let a
// broken hook pass by accident.

import type {
  ChatClient,
  ChatError,
  ChatEventHandler,
  ChatEventMap,
  ChatEventName,
  ChatSession,
  ChatState,
  SendAttachmentOptions,
  SendMessageOptions,
  Unsubscribe,
} from '@dhaam-ccrm/core';
import { createInitialChatState } from '@dhaam-ccrm/core';
import { vi } from 'vitest';

export interface FakeChatClient extends ChatClient {
  /**
   * Test-only. Applies a shallow patch exactly like core's `ChatStore.setState`:
   * builds a new top-level `ChatState` object, and is a no-op (no new
   * identity, no notification) if every patched key is already
   * reference-identical. Delivery is synchronous (no microtask batching) —
   * tests assert on effects, not on core's batching policy, which is
   * covered by core's own suite.
   */
  emitState: (patch: Partial<ChatState>) => void;
  /** Test-only. Live `subscribe` listener count — for the unmount/StrictMode unsubscribe assertions. */
  listenerCount: () => number;
  /** Test-only. Fires a §6.5 event to any `on(event, handler)` registrations. */
  emitEvent: <E extends ChatEventName>(event: E, payload: ChatEventMap[E]) => void;
}

export function createFakeChatClient(initial?: Partial<ChatState>): FakeChatClient {
  let state: ChatState = Object.freeze({ ...createInitialChatState(), ...initial });

  const listeners = new Set<(state: ChatState) => void>();
  const eventHandlers = new Map<ChatEventName, Set<(payload: never) => void>>();

  function emitState(patch: Partial<ChatState>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof ChatState)[]) {
      if (!Object.is(state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    state = Object.freeze({ ...state, ...patch });
    for (const listener of [...listeners]) listener(state);
  }

  function emitEvent<E extends ChatEventName>(event: E, payload: ChatEventMap[E]): void {
    const handlers = eventHandlers.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) (handler as ChatEventHandler<E>)(payload);
  }

  const client: FakeChatClient = {
    getState: () => state,

    subscribe: (listener) => {
      listeners.add(listener);
      let unsubscribed = false;
      const unsubscribe: Unsubscribe = () => {
        if (unsubscribed) return;
        unsubscribed = true;
        listeners.delete(listener);
      };
      return unsubscribe;
    },

    on: (event, handler) => {
      let handlers = eventHandlers.get(event);
      if (!handlers) {
        handlers = new Set();
        eventHandlers.set(event, handlers);
      }
      handlers.add(handler as (payload: never) => void);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        handlers?.delete(handler as (payload: never) => void);
      };
    },

    connect: vi.fn(async () => {}),
    disconnect: vi.fn(() => {}),
    joinSession: vi.fn((_sessionId: string) => {}),
    leaveSession: vi.fn(() => {}),
    startNewSession: vi.fn(async () => {}),
    requestAgent: vi.fn((_reason?: string) => {}),
    reopenSession: vi.fn(async (_sessionId: string): Promise<ChatSession> => {
      throw new Error('createFakeChatClient: reopenSession has no default — override it for this test.');
    }),
    closeSession: vi.fn(async () => {}),

    sendMessage: vi.fn(async (_content: string, _opts?: SendMessageOptions) => {}),
    sendAttachment: vi.fn(async (_file: Blob, _opts?: SendAttachmentOptions) => {}),
    markRead: vi.fn(() => {}),
    startTyping: vi.fn(() => {}),
    stopTyping: vi.fn(() => {}),
    loadOlderMessages: vi.fn(async () => {}),

    setPresence: vi.fn(() => {}),
    queryPresence: vi.fn(() => {}),

    emitState,
    listenerCount: () => listeners.size,
    emitEvent,
  };

  return client;
}

/** A minimal, well-formed `ChatError` for tests that need one (e.g. `useChatError`). */
export function makeChatError(overrides: Partial<ChatError> = {}): ChatError {
  return {
    source: 'transport',
    code: null,
    message: 'socket closed unexpectedly',
    retryable: true,
    ...overrides,
  };
}
