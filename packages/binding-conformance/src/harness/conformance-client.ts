// The suite's own `ChatClient` test double — what `runBindingConformance`
// passes to `adapter.mount()` for every check. This is the harness, not a
// fixture: every check gets a FRESH one (see `checks/`), and its whole job
// is to faithfully reproduce the documented contract of core's real
// `ChatStore` (packages/core/src/state/store.ts) — deep-frozen immutable
// snapshots, reference-stable no-op patches, microtask-batched
// notification, synchronous per-listener isolation on both `subscribe` and
// `on` — plus a `__harness` escape hatch the suite (never the binding under
// test) uses to drive state/events directly.
//
// Why reimplement this rather than import `ChatStore`: it is not part of
// `@dhaam-ccrm/core`'s public barrel (deliberately — state/index.ts's own
// header: "T13's src/index.ts decides what leaves the package", and
// `ChatStore` is core's internal engine, not a binding's concern). This
// mirrors the exact precedent `packages/react/test/fake-chat-client.ts`
// already set for the same reason ("independently reproduced at test-double
// scale, not imported").
//
// Why fidelity matters here specifically: this suite's whole purpose is to
// prove a binding behaves correctly against the REAL contract, not against
// a simplified one. A synchronous, unfrozen double would let a binding that
// only works by accident (e.g. one relying on synchronous delivery, or one
// that would break under a real frozen snapshot) pass conformance and then
// fail against the real `@dhaam-ccrm/core` in production — exactly the kind
// of vacuous pass this task exists to rule out.

import { createInitialChatState } from '@dhaam-ccrm/core';
import type {
  ChatClient,
  ChatEventHandler,
  ChatEventMap,
  ChatEventName,
  ChatSession,
  ChatState,
  CsatStatus,
  CsatSubmission,
  SendAttachmentOptions,
  SendMessageOptions,
  Unsubscribe,
} from '@dhaam-ccrm/core';

/**
 * Recursively freezes `value`. A trimmed, independently-written copy of
 * core's `state/freeze.ts` — see this file's header for why it is not
 * imported. Already-frozen values short-circuit, same as the original.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

interface StateRegistration {
  readonly fn: (state: ChatState) => void;
}

interface EventRegistration {
  readonly fn: (payload: never) => void;
}

/** The suite-only control surface — never touched by a binding/adapter under test, only by the suite driving it. */
export interface ConformanceHarness {
  /**
   * Applies a shallow patch exactly like `ChatStore.setState`: builds a new
   * top-level frozen `ChatState`, and is a reference-comparison no-op (no
   * new identity, no notification scheduled) if every patched key is
   * already reference-identical to the current value.
   */
  setState(patch: Partial<ChatState>): void;

  /** Emits a §6.5 event synchronously to every live `on(event, ...)` registration, isolating a throwing handler exactly like `ChatEventEmitter.emit`. */
  emit<E extends ChatEventName>(event: E, payload: ChatEventMap[E]): void;

  /**
   * Resolves once the microtask the fake store's flush is scheduled on has
   * run (or immediately, if no flush is pending) — the harness-side half of
   * settling; call `handle.settle()` afterwards for the binding's own half.
   */
  flushMicrotasks(): Promise<void>;

  /** Live `subscribe` registrations. For the unmount/remount leak checks. */
  subscriberCount(): number;

  /** Live `on(event, ...)` registrations for one event. For the "unsubscribing one does not disturb others" check. */
  eventListenerCount(event: ChatEventName): number;
}

export interface ConformanceChatClient extends ChatClient {
  /** @internal suite-only — see {@link ConformanceHarness}. Not part of the `ChatClient` contract a binding may rely on. */
  readonly __harness: ConformanceHarness;
}

function notConfigured(name: string): () => never {
  return () => {
    throw new Error(
      `createConformanceChatClient(): ${name}() has no behaviour in this harness. ` +
        'The conformance suite drives state and events directly through client.__harness ' +
        '(setState/emit), never through operation methods — a check calling this is a suite bug.',
    );
  };
}

export function createConformanceChatClient(initial?: Partial<ChatState>): ConformanceChatClient {
  let state: ChatState = deepFreeze({ ...createInitialChatState(), ...initial });
  let notifying: ChatState | null = null;
  let flushScheduled = false;
  let pendingFlush: Promise<void> = Promise.resolve();

  const listeners = new Set<StateRegistration>();
  const eventRegistrations = new Map<ChatEventName, Set<EventRegistration>>();

  function flush(): void {
    flushScheduled = false;
    const snapshot = state;
    notifying = snapshot;
    try {
      for (const registration of [...listeners]) {
        if (!listeners.has(registration)) continue;
        try {
          registration.fn(snapshot);
        } catch {
          // Isolate — matching ChatStore#flush's documented contract: a
          // throwing subscriber must not break the store or starve
          // siblings. (core reports via `reportListenerError`; this
          // harness has no equivalent hook because no check needs to
          // observe it — silently continuing is the behaviour under test.)
        }
      }
    } finally {
      notifying = null;
    }
  }

  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    pendingFlush = new Promise((resolve) => {
      queueMicrotask(() => {
        flush();
        resolve();
      });
    });
  }

  function setState(patch: Partial<ChatState>): void {
    const current = state;
    let changed = false;
    for (const key of Object.keys(patch) as (keyof ChatState)[]) {
      if (!Object.is(current[key], (patch as ChatState)[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = deepFreeze({ ...current, ...patch });
    scheduleFlush();
  }

  function emit<E extends ChatEventName>(event: E, payload: ChatEventMap[E]): void {
    const registrations = eventRegistrations.get(event);
    if (!registrations || registrations.size === 0) return;
    for (const registration of [...registrations]) {
      if (!registrations.has(registration)) continue;
      try {
        (registration.fn as (value: ChatEventMap[E]) => void)(payload);
      } catch {
        // Isolate — matching ChatEventEmitter#emit's documented contract.
      }
    }
  }

  const harness: ConformanceHarness = {
    setState,
    emit,
    flushMicrotasks: () => pendingFlush,
    subscriberCount: () => listeners.size,
    eventListenerCount: (event) => eventRegistrations.get(event)?.size ?? 0,
  };

  const client: ConformanceChatClient = {
    getState: () => notifying ?? state,

    subscribe(listener: (state: ChatState) => void): Unsubscribe {
      const registration: StateRegistration = { fn: listener };
      listeners.add(registration);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        listeners.delete(registration);
      };
    },

    on<E extends ChatEventName>(event: E, handler: ChatEventHandler<E>): Unsubscribe {
      let registrations = eventRegistrations.get(event);
      if (registrations === undefined) {
        registrations = new Set();
        eventRegistrations.set(event, registrations);
      }
      const registration: EventRegistration = { fn: handler as (payload: never) => void };
      registrations.add(registration);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        registrations?.delete(registration);
      };
    },

    connect: async () => {},
    // Reports `false`, matching the real contract: `retryNow()` acts only
    // while core is waiting out a backoff, and this double never is. A
    // binding under conformance must be able to call it without the harness
    // pretending an attempt started.
    retryNow: () => false,
    disconnect: () => {},
    joinSession: (_sessionId: string) => {},
    leaveSession: () => {},
    startNewSession: async (): Promise<void> => {},
    requestAgent: (_reason?: string) => {},
    reopenSession: notConfigured('reopenSession') as unknown as (sessionId: string) => Promise<ChatSession>,
    closeSession: async () => {},
    // Inert by contract (types.ts's own doc: "does NOT fetch anything, does
    // not touch `navigator`, and does not itself send a frame") — a plain
    // no-op matches that, not `notConfigured`, since a conformance suite
    // calling this is exercising real (if trivial) behaviour, not hitting an
    // operation this harness has no story for.
    setContactInfo: () => {},
    submitCsat: notConfigured('submitCsat') as unknown as (
      sessionId: string,
      rating: number,
      comment?: string,
    ) => Promise<CsatSubmission>,
    // Read-only, and answerable without a service: a harness with no CSAT
    // store has genuinely never recorded a rating, so `{rated: false}` is the
    // truth here rather than a stub — unlike `submitCsat`, which would have to
    // invent a receipt.
    getCsat: async (_sessionId: string): Promise<CsatStatus> => ({ rated: false }),

    sendMessage: async (_content: string, _opts?: SendMessageOptions) => {},

    switchSession: async (_sessionId: string) => {},

    listSessions: async (_query?: { readonly limit?: number }) => [],

    retryMessage: async (_id: string) => ({ status: 'refused' as const, reason: 'not-found' as const }),
    sendAttachment: async (_file: Blob, _opts?: SendAttachmentOptions) => {},
    markRead: () => {},
    startTyping: () => {},
    stopTyping: () => {},
    loadOlderMessages: async () => {},

    setPresence: () => {},
    queryPresence: (_participantIds?: readonly string[]) => {},

    __harness: harness,
  };

  return client;
}
