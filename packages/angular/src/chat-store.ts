// `ChatStore` — the whole Angular binding. PRD §4: "hooks/context/provider
// wrapping one core client instance; mapping core's observable store to
// [the framework's] re-renders" and nothing else. Everything below is either
// a projection of `ChatClient.getState()`/`subscribe()` (§6.4) onto an
// Angular signal, a one-line delegation to a `ChatClient` method (§6.2/§6.3),
// or event plumbing over `ChatClient.on` (§6.5). No reconnect, backoff,
// dedup, ordering, queueing, token refresh, or watermark logic lives here —
// all of it is core's, and tested there.
//
// ---------------------------------------------------------------------------
// Signals, not Observables
// ---------------------------------------------------------------------------
//
// Core's store is a synchronous, reference-stable snapshot store: `getState()`
// is readable at any instant and returns the identical reference until
// something actually changes. That IS a signal's contract, so the mapping is
// lossless in one direction and lossy in the other — an `Observable` has no
// "current value" and needs a `BehaviorSubject`/`shareReplay(1)` to fake one,
// plus cold/hot and late-subscriber rules core does not have.
//
// Two more reasons the choice is not close:
//
//   * `computed(fn, { equal })` is exactly the selector cache §6.4 makes every
//     binding write, already built and already correct: on an `equal` hit
//     Angular keeps the PREVIOUS value and does not bump the signal version,
//     so nothing re-renders. `@dhaam-ccrm/react` hand-rolls this with a
//     `{ raw, selected }` ref; here it is the primitive.
//   * The signal graph is glitch-free. A consumer selecting two fields at once
//     can never observe an intermediate state, which `combineLatest` over two
//     RxJS selectors can.
//
// A team on RxJS loses nothing: `toObservable(store.messages)` from
// `@angular/core/rxjs-interop` is a one-liner, and because it is DERIVED from
// the same signal rather than being a second subscription to the client, the
// two consumers cannot disagree. Shipping both surfaces from this package
// would have created exactly that second source of truth. This package
// therefore has NO `rxjs` peer dependency at all.
//
// §6.5 events are the one thing that is deliberately not a signal: an event is
// an occurrence, not a state. Two identical `typing` frames must both be
// delivered, and a signal would collapse them. `on()` below stays a plain
// subscription with `DestroyRef`-driven teardown.
//
// ---------------------------------------------------------------------------
// Zone safety
// ---------------------------------------------------------------------------
//
// A `message` frame arrives on a socket callback that may or may not be inside
// Angular's zone, and if change detection does not run the UI silently goes
// stale. Two independent mechanisms cover it, which is why this package's
// minimum is Angular 18 rather than 16:
//
//   1. Structural (the real guarantee). Since v18 a signal write that dirties
//      a consumer notifies Angular's `ChangeDetectionScheduler`, which
//      schedules `ApplicationRef.tick()` regardless of which zone the write
//      happened in — the same mechanism that makes zoneless apps work. This
//      binding's only push into Angular is `stateSignal.set(...)`, so it
//      inherits that guarantee for free and supports `provideZonelessChangeDetection()`
//      with no extra code.
//   2. Belt and braces. If an `NgZone` is reachable and we are demonstrably
//      outside it, the write is wrapped in `ngZone.run(...)`. This is not
//      redundant: `provideZoneChangeDetection({ ignoreChangesOutsideZone: true })`
//      switches mechanism 1 off by design, and that flag is exactly the
//      configuration in which a socket callback outside the zone would
//      otherwise leave the UI stale.

import {
  createChatClient,
  deriveTickState,
  type ChatClient,
  type ChatClientConfig,
  type ChatError,
  type ChatEventHandler,
  type ChatEventName,
  type ChatMessage,
  type ChatSession,
  type ChatSessionSummary,
  type ChatState,
  type ConnectionState,
  type MessageTickState,
  type PresenceEntry,
  type PresenceStatus,
  type SendAttachmentOptions,
  type SendMessageOptions,
  type Unsubscribe,
} from '@dhaam-ccrm/core';
import { computed, isSignal, signal, DestroyRef, NgZone } from '@angular/core';
import type { Signal } from '@angular/core';

import { defaultIsEqual } from './equality.js';
import { injectIfAvailable } from './injection-context.js';

/**
 * The slice of `NgZone` this package uses, spelled structurally so a real
 * `NgZone`, a `NoopNgZone` (what a zoneless app injects), and a test double
 * all satisfy it without this file depending on Angular's class shape.
 */
export interface ZoneRunner {
  run<T>(fn: () => T): T;
}

/**
 * A plain value, or a signal carrying one.
 *
 * Accepted wherever an argument is likely to come from a signal `input()` in a
 * real component (`tickState`'s message id). Passing the signal — rather than
 * reading it at the call site — is what keeps the returned signal reactive to
 * it.
 */
export type MaybeSignal<T> = T | Signal<T>;

function unwrap<T>(value: MaybeSignal<T>): T {
  return isSignal(value) ? (value() as T) : (value as T);
}

export interface ChatStoreOptions {
  /**
   * The zone to re-enter when a core notification arrives outside Angular's
   * zone. Defaults to the ambient `NgZone` when the store is built through
   * DI; pass `null` to opt out entirely (a zoneless app loses nothing — see
   * this file's header, mechanism 1).
   */
  readonly ngZone?: ZoneRunner | null;
}

/** Options for {@link ChatStore.on}. */
export interface ChatEventOptions {
  /**
   * Who owns the teardown. Defaults to the ambient `DestroyRef` when `on()`
   * is called inside an injection context (a component field initializer, a
   * service constructor, `runInInjectionContext`), so the handler unsubscribes
   * with its owner and no manual bookkeeping is needed.
   *
   * Pass an explicit `DestroyRef` to bind the handler to some other lifetime,
   * or `null` to opt out of that teardown entirely.
   *
   * Outside any injection context — a plain function, a test, a conformance
   * probe — there is nothing to adopt, so the CALLER owns the returned
   * `Unsubscribe`. `on()` degrades to that rather than throwing NG0203, which
   * is where it differs from Angular's own `takeUntilDestroyed()`.
   *
   * In every case {@link ChatStore.destroy} is the backstop: nothing this
   * store registered outlives the store.
   */
  readonly destroyRef?: DestroyRef | null;
}

/**
 * One `ChatClient`, projected onto Angular signals.
 *
 * Obtain it with `inject(CHAT_STORE)` after `provideChatClient(...)`, or build
 * one directly with {@link createChatStore} outside of DI.
 */
export interface ChatStore {
  // ---- §6.4 observable state ----

  /** The full snapshot. Every other signal below is a `select()` off this one. */
  readonly state: Signal<ChatState>;

  /** §8.1's seven states: idle | connecting | authenticating | connected | reconnecting | suspended | closed. */
  readonly connectionState: Signal<ConnectionState>;
  readonly session: Signal<ChatSession | null>;
  /** In server order (D2's `seq`) — never re-sorted here (§6.4). */
  readonly messages: Signal<ChatMessage[]>;
  readonly typing: Signal<{ isTyping: boolean; participantId?: string }>;
  readonly unreadCount: Signal<number>;
  readonly pagination: Signal<{ hasMore: boolean; loadingMore: boolean; initialLoaded: boolean }>;
  /** True while an attachment upload is in flight (§6.4). */
  readonly uploading: Signal<boolean>;
  readonly pastSessions: Signal<ChatSessionSummary[]>;
  /** participantId → ISO-8601 read watermark (§9.5). */
  readonly readWatermarks: Signal<Record<string, string>>;
  /** participantId → highest `seq` that participant holds (§9.5, D2). Never presence. */
  readonly deliveredWatermarks: Signal<Record<string, number>>;
  readonly presence: Signal<Record<string, PresenceEntry>>;
  /** Most recent protocol- or transport-level error, or `null` (§6.4, §6.5). */
  readonly lastError: Signal<ChatError | null>;

  /**
   * A derived signal over `selector(state)` that only notifies when the
   * SELECTED value changes.
   *
   * `isEqual` defaults to `Object.is`, which is right for a selector that
   * returns a field straight off `ChatState` (core's shallow `setState` keeps
   * an untouched field's reference, so an unrelated change is already a
   * reference hit). Pass `shallowEqual` for a selector that builds a new
   * object literal from several fields.
   *
   * Returns a NEW signal on every call, so call it once and keep the result —
   * a class field, typically. Calling it from a template expression would
   * build a fresh signal on every change-detection pass and cache nothing.
   */
  select<T>(selector: (state: ChatState) => T, isEqual?: (a: T, b: T) => boolean): Signal<T>;

  /**
   * The delivery tick for one message, or `null` for no tick — derived by
   * core's `deriveTickState` and nothing else.
   *
   * This binding computes no part of the rule itself. v1 rendered the
   * double-grey tick from presence ("the other party is connected"), which is
   * a statement about a socket rather than about a message; core owns the one
   * derivation precisely so four bindings cannot re-introduce four versions of
   * that bug (see `packages/core/src/messages/ticks.ts`).
   *
   * Depends only on `messages`/`deliveredWatermarks`/`readWatermarks`, so an
   * unrelated state change does not invalidate it.
   *
   * Both arguments accept a signal, so a message-bubble component can pass its
   * `input()` straight through and get a tick that tracks it:
   *
   * ```ts
   * readonly messageId = input.required<string>();
   * readonly tick = inject(CHAT_STORE).tickState(this.messageId, this.me);
   * ```
   *
   * Like {@link select}, this returns a NEW signal per call — call it once.
   */
  tickState(
    messageId: MaybeSignal<string>,
    localParticipantId: MaybeSignal<string | null>,
  ): Signal<MessageTickState | null>;

  // ---- §6.5 events ----

  /**
   * Subscribes `handler` to a §6.5 event. Unsubscribes automatically when the
   * ambient (or supplied) `DestroyRef` is destroyed — see {@link ChatEventOptions}.
   * The returned `Unsubscribe` is idempotent and always safe to call too.
   *
   * After {@link destroy} this registers nothing and returns a no-op, rather
   * than throwing: a component's own teardown running after the injector
   * already disposed the store is an ordering detail, not a programming error,
   * and it must not be able to plant a handler nothing will ever release.
   */
  on<E extends ChatEventName>(event: E, handler: ChatEventHandler<E>, options?: ChatEventOptions): Unsubscribe;

  // ---- §6.2 session / channel operations ----

  /** Opens the connection and drives it to `connected`. Resolves once `connection.ack` is received (§6.2). */
  connect(): Promise<void>;
  /** User-initiated, terminal — no auto-reconnect follows (§6.2, §8.1). */
  disconnect(): void;
  joinSession(sessionId: string): void;
  leaveSession(): void;
  requestAgent(reason?: string): void;
  /** REST-only; rejects with `ChatClientConfigError` if the client wasn't configured with `sessionActions` (§6.2). */
  reopenSession(sessionId: string): Promise<ChatSession>;
  /** REST-only; rejects with `ChatClientConfigError` if the client wasn't configured with `sessionActions` (§6.2). */
  closeSession(): Promise<void>;

  // ---- §6.3 message operations ----

  /** Optimistic send; queues/sends the frame, never throws for "offline" (§6.3). */
  sendMessage(content: string, opts?: SendMessageOptions): Promise<void>;
  /** Rejects with `ChatClientConfigError` if the client wasn't configured with an `uploader` (§6.3). */
  sendAttachment(file: Blob, opts?: SendAttachmentOptions): Promise<void>;
  /** Cursor-based backward page fetch (§6.3, §12.10). */
  loadOlderMessages(): Promise<void>;
  /** Advances the local read watermark optimistically and syncs it (§6.3, §9.5). */
  markRead(): void;
  startTyping(): void;
  stopTyping(): void;
  setPresence(status: PresenceStatus): void;
  queryPresence(participantIds?: readonly string[]): void;

  // ---- lifecycle / escape hatch ----

  /**
   * The raw `ChatClient`, for anything this store does not wrap. The same
   * instance for the store's whole lifetime, so it is safe to close over.
   */
  readonly client: ChatClient;

  /**
   * Drops this store's single `client.subscribe` registration and releases
   * every §6.5 handler registered through {@link on} that is still live.
   * Called for you when the injector that created the store is destroyed;
   * idempotent.
   *
   * Nothing this store registered outlives it — including a handler that opted
   * out of `DestroyRef` teardown with `{ destroyRef: null }`, since after
   * `destroy()` that handler is unreachable through the store anyway.
   *
   * Deliberately does NOT `disconnect()` the client: this package never
   * invents connection lifecycle (§4 reserves that for core), and a client
   * handed in by the app is the app's to close — the same contract
   * `@dhaam-ccrm/react`'s `ChatProvider` has.
   */
  destroy(): void;
}

/** A `ChatClientConfig` has no `getState`/`subscribe`; a `ChatClient` has both (§6.4). */
function isChatClientInstance(value: ChatClient | ChatClientConfig): value is ChatClient {
  return (
    typeof (value as Partial<ChatClient>).getState === 'function' &&
    typeof (value as Partial<ChatClient>).subscribe === 'function'
  );
}

/** Resolves the two shapes `provideChatClient` accepts into one `ChatClient` (§6.1). */
export function resolveChatClient(clientOrConfig: ChatClient | ChatClientConfig): ChatClient {
  return isChatClientInstance(clientOrConfig) ? clientOrConfig : createChatClient(clientOrConfig);
}

/**
 * Builds a `ChatStore` over `client`. Usable anywhere — no injection context
 * required — which is what lets a plain test (or the binding-conformance
 * suite) drive the binding without bootstrapping an application.
 *
 * Through DI you normally do not call this: `provideChatClient()` wires it to
 * the injector, including `destroy()` on that injector's `DestroyRef`.
 */
export function createChatStore(client: ChatClient, options?: ChatStoreOptions): ChatStore {
  const ngZone = options?.ngZone ?? null;

  // Seeded from `getState()` rather than waiting for the first notification:
  // core's store never replays, so a consumer created mid-session must still
  // read the current snapshot on its very first read.
  const state = signal<ChatState>(client.getState());

  // The store's ONE subscription. Every `select()` below is a `computed` off
  // this signal, not a second registration — so no selector can leak a
  // listener, and `destroy()` has exactly one thing to undo.
  const unsubscribeFromClient = client.subscribe((next: ChatState) => {
    // See this file's header, mechanism 2. `NgZone.isInAngularZone()` is a
    // static read of the ambient `Zone` and is simply `false` when zone.js was
    // never loaded, so the zoneless path costs one boolean.
    if (ngZone !== null && !NgZone.isInAngularZone()) {
      ngZone.run(() => state.set(next));
      return;
    }
    state.set(next);
  });

  let destroyed = false;

  // Every §6.5 handler `on()` registered and that has not been released yet.
  // Tracked so `destroy()` can leave nothing behind on the client — a handler
  // registered outside any injection context has no other owner.
  const liveEventReleases = new Set<Unsubscribe>();

  function select<T>(selector: (s: ChatState) => T, isEqual: (a: T, b: T) => boolean = defaultIsEqual): Signal<T> {
    return computed(() => selector(state()), { equal: isEqual });
  }

  const messages = select((s) => s.messages);
  const readWatermarks = select((s) => s.readWatermarks);
  const deliveredWatermarks = select((s) => s.deliveredWatermarks);

  function tickState(
    messageId: MaybeSignal<string>,
    localParticipantId: MaybeSignal<string | null>,
  ): Signal<MessageTickState | null> {
    return computed(() => {
      const id = unwrap(messageId);
      const message = messages().find((candidate) => candidate.id === id);
      if (message === undefined) return null;
      return deriveTickState({
        message,
        localParticipantId: unwrap(localParticipantId),
        deliveredWatermarks: deliveredWatermarks(),
        readWatermarks: readWatermarks(),
      });
    });
  }

  function on<E extends ChatEventName>(event: E, handler: ChatEventHandler<E>, options?: ChatEventOptions): Unsubscribe {
    if (destroyed) return () => {};

    const unsubscribe = client.on(event, handler);

    let released = false;
    let unregisterFromDestroyRef: (() => void) | null = null;
    const release: Unsubscribe = () => {
      if (released) return;
      released = true;
      liveEventReleases.delete(release);
      unregisterFromDestroyRef?.();
      unsubscribe();
    };
    liveEventReleases.add(release);

    const destroyRef =
      options !== undefined && options.destroyRef !== undefined ? options.destroyRef : injectIfAvailable(DestroyRef);
    if (destroyRef !== null) {
      // `DestroyRef.onDestroy` returns its own unregister function; holding it
      // is what stops a long-lived store accumulating dead callbacks on a
      // long-lived injector when handlers come and go.
      unregisterFromDestroyRef = destroyRef.onDestroy(release);
    }

    return release;
  }

  return {
    state: state.asReadonly(),

    connectionState: select((s) => s.connectionState),
    session: select((s) => s.session),
    messages,
    typing: select((s) => s.typing),
    unreadCount: select((s) => s.unreadCount),
    pagination: select((s) => s.pagination),
    uploading: select((s) => s.uploading),
    pastSessions: select((s) => s.pastSessions),
    readWatermarks,
    deliveredWatermarks,
    presence: select((s) => s.presence),
    lastError: select((s) => s.lastError),

    select,
    tickState,
    on,

    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    joinSession: (sessionId: string) => client.joinSession(sessionId),
    leaveSession: () => client.leaveSession(),
    requestAgent: (reason?: string) => client.requestAgent(reason),
    reopenSession: (sessionId: string) => client.reopenSession(sessionId),
    closeSession: () => client.closeSession(),

    sendMessage: (content: string, opts?: SendMessageOptions) => client.sendMessage(content, opts),
    sendAttachment: (file: Blob, opts?: SendAttachmentOptions) => client.sendAttachment(file, opts),
    loadOlderMessages: () => client.loadOlderMessages(),
    markRead: () => client.markRead(),
    startTyping: () => client.startTyping(),
    stopTyping: () => client.stopTyping(),
    setPresence: (status: PresenceStatus) => client.setPresence(status),
    queryPresence: (participantIds?: readonly string[]) => client.queryPresence(participantIds),

    client,

    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      unsubscribeFromClient();
      for (const release of [...liveEventReleases]) release();
    },
  };
}
