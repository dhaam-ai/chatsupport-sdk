// The barrel's re-export contract, pinned.
//
// index.ts's re-export block states the rule this file enforces: "so a
// consumer never needs a second import specifier (or a hand-copied shape)
// just to type a variable as `ChatState`/`ChatMessage`/etc. PRD §15 requires
// the binding-exposed `ChatState` to be byte-for-byte core's, enforced by a
// shared TypeScript import rather than by prose."
//
// That rule was only half-kept, and the first-party consumer of this package
// documented the breakage in its own source rather than here:
//
//   packages/widget/src/ui/message-list.ts:22  "`@dhaam-ccrm/js` re-exports
//     the whole of `ChatState`'s shape EXCEPT ... so a binding consumer
//     cannot name the type of a field the binding hands them. Reported as a
//     gap in that package"
//   packages/widget/src/ui/identity-header.ts:27  "`HandledBy`/`ChatStatus`
//     are imported straight from `@dhaam-ccrm/core` rather than
//     `@dhaam-ccrm/js` ... the binding package re-exports most of ChatState's
//     shape but not every type reachable from it"
//
// Two kinds of assertion live here and they fail in two different places, on
// purpose:
//
//   * the `import type` list below is checked by `pnpm --filter
//     @dhaam-ccrm/js typecheck` (tsconfig.test.json includes test/**). A
//     type this package does not re-export is a compile error, which is the
//     only way to prove a type-only export exists at all.
//   * the runtime block is checked by vitest. A missing runtime export makes
//     the ESM link of this module fail outright.
//
// The session-history surface — `pastSessions`, `pagination.initialLoaded` —
// gets behavioural pins instead, further down: react, vue and angular each
// narrowed `pagination` in their own selector layer and dropped
// `initialLoaded` doing it. This package's `select` is generic over the whole
// snapshot and cannot narrow anything, and these tests are what keeps that
// true.

import { buildMessage, buildSession, createConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import * as core from '@dhaam-ccrm/core';
import type { ChatState } from '@dhaam-ccrm/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createChatStore, isHandledByCurrent, SessionSwitchError, shallowEqual } from '../src/index.js';
import type {
  AttachmentMetadata,
  ChatMode,
  ChatSession,
  ChatSessionSummary,
  ChatStatus,
  CloseReason,
  ErrorCode,
  HandledBy,
  MessageDelivery,
  MessageMetadata,
  MessageType,
  ParticipantType,
  PresenceEntry,
  PresenceStatus,
  QueuedSend,
  RetryOutcome,
  SenderType,
} from '../src/index.js';

const teardown: (() => void)[] = [];
afterEach(() => {
  for (const dispose of teardown.splice(0)) dispose();
});

function harness(initial?: Partial<ChatState>) {
  const client = createConformanceChatClient(initial);
  const store = createChatStore(client, { onError: () => {} });
  teardown.push(() => store.destroy());
  return { client, store };
}

async function commit(client: ReturnType<typeof createConformanceChatClient>, patch: Partial<ChatState>): Promise<void> {
  client.__harness.setState(patch);
  await client.__harness.flushMicrotasks();
}

describe('re-exported runtime surface', () => {
  it('forwards core symbols by reference rather than re-implementing them', () => {
    // `toBe`, not `toBeDefined`: a local copy of either of these would pass a
    // presence check and then drift. `isHandledByCurrent` is the one canonical
    // "is `handledBy` safe to narrate as active" derivation (core's
    // client/session.ts) — the same reasoning that makes `deriveTickState` a
    // forward rather than a reimplementation here.
    expect(isHandledByCurrent).toBe(core.isHandledByCurrent);
    expect(SessionSwitchError).toBe(core.SessionSwitchError);
  });

  it('narrates a session as handled only when a name is real and current', () => {
    const handledBy: HandledBy = { kind: 'AGENT', id: 'participant_agent', displayName: 'Ada' };

    expect(isHandledByCurrent({ status: 'OPEN', handledBy })).toBe(true);
    // Reactivated and back in the queue: the name is stale, not current.
    expect(isHandledByCurrent({ status: 'WAITING_FOR_AGENT', handledBy })).toBe(false);
    // Nobody has picked it up yet — `handledBy` is absent, never null.
    expect(isHandledByCurrent({ status: 'OPEN' })).toBe(false);
  });

  it('lets a caller catch what switchSession rejects with, and read what failed', () => {
    const error = new SessionSwitchError('session_2', {
      source: 'protocol',
      code: 'SESSION_NOT_FOUND',
      message: 'not your session',
      retryable: false,
    });

    expect(error).toBeInstanceOf(SessionSwitchError);
    expect(error).toBeInstanceOf(Error);
    expect(error.sessionId).toBe('session_2');
    expect(error.cause.code).toBe('SESSION_NOT_FOUND');
  });
});

describe('re-exported type surface', () => {
  it('can name every type reachable from a ChatState this store hands out', () => {
    // Each annotation below is the assertion; the `expect` only keeps the
    // binding live. A missing re-export fails `pnpm --filter @dhaam-ccrm/js
    // typecheck`, not this run.
    const handledBy: HandledBy = { kind: 'BOT', id: 'bot_1', displayName: 'Aria' };
    const status: ChatStatus = 'OPEN';
    const mode: ChatMode = 'HUMAN';
    const closeReason: CloseReason = 'RESOLVED';
    const senderType: SenderType = 'AGENT';
    const messageType: MessageType = 'TEXT';
    const participantType: ParticipantType = 'AGENT';
    const presenceStatus: PresenceStatus = 'ONLINE';
    const presence: PresenceEntry = { participantId: 'participant_agent', status: presenceStatus };
    const errorCode: ErrorCode = 'VALIDATION_FAILED';
    const attachment: AttachmentMetadata = {
      url: 'https://cdn.example.com/a.png',
      fileName: 'a.png',
      mimeType: 'image/png',
      size: 12,
      mediaType: 'image',
    };
    const metadata: MessageMetadata = {};
    // `retryable` is what a retry affordance renders off — a `failed` bubble
    // with `retryable: false` must not offer a retry button.
    const delivery: MessageDelivery = { state: 'failed', reason: 'rejected', code: errorCode, retryable: false };
    const session: ChatSession = buildSession({ handledBy, status, mode });
    const summary: ChatSessionSummary = {
      id: 'session_9',
      status,
      mode,
      createdAt: '2026-01-01T00:00:00.000Z',
      closedAt: null,
      lastMessageAt: null,
      unreadCount: 0,
      handledBy,
    };

    expect([senderType, messageType, participantType, closeReason]).toHaveLength(4);
    expect(presence.status).toBe('ONLINE');
    expect(attachment.fileName).toBe('a.png');
    expect(metadata).toEqual({});
    expect(delivery).toMatchObject({ retryable: false });
    expect(session.handledBy).toBe(handledBy);
    expect(summary.handledBy).toBe(handledBy);
  });

  it('can name what retryMessage resolves to, on both branches', () => {
    const retried: RetryOutcome = {
      status: 'retried',
      entry: {
        id: 'msg_1',
        sessionId: 'session_1',
        payload: { content: 'hi', type: 'TEXT', sessionId: 'session_1' },
        enqueuedAt: 0,
        attempts: 1,
      },
    };
    const refused: RetryOutcome = { status: 'refused', reason: 'not-retryable' };

    const entry: QueuedSend =
      retried.status === 'retried'
        ? retried.entry
        : { id: '', sessionId: '', payload: { content: '', type: 'TEXT' }, enqueuedAt: 0, attempts: 0 };

    expect(entry.id).toBe('msg_1');
    expect(refused).toEqual({ status: 'refused', reason: 'not-retryable' });
  });
});

describe('the session-history surface survives the selector layer', () => {
  it('hands pagination through whole, initialLoaded included', async () => {
    const { client, store } = harness();

    expect(store.getState().pagination, 'getState is a pass-through, not a projection').toEqual({
      hasMore: false,
      loadingMore: false,
      initialLoaded: false,
    });

    const seen: ChatState['pagination'][] = [];
    store.select((state) => state.pagination, (value) => seen.push(value));

    // What a completed switch commits: page one landed, nothing older exists.
    await commit(client, { pagination: { hasMore: false, loadingMore: false, initialLoaded: true } });

    expect(seen).toEqual([{ hasMore: false, loadingMore: false, initialLoaded: true }]);
    expect(
      seen[0]?.initialLoaded,
      'initialLoaded is the only thing separating "nothing older" from "nothing asked for yet"',
    ).toBe(true);
  });

  it('does not fire a pagination subscriber when only initialLoaded is unchanged noise', async () => {
    const { client, store } = harness({ pagination: { hasMore: true, loadingMore: false, initialLoaded: true } });
    let calls = 0;
    store.select((state) => state.pagination, () => { calls += 1; }, { isEqual: shallowEqual });

    await commit(client, { unreadCount: 3 });

    expect(calls).toBe(0);
  });

  it('delivers pastSessions, handledBy intact', async () => {
    const { client, store } = harness();
    const seen: ChatSessionSummary[][] = [];
    store.select((state) => state.pastSessions, (value) => seen.push(value));

    const rows: ChatSessionSummary[] = [
      {
        id: 'session_1',
        status: 'CLOSED',
        mode: 'HUMAN',
        createdAt: '2026-01-01T00:00:00.000Z',
        closedAt: '2026-01-02T00:00:00.000Z',
        lastMessageAt: '2026-01-02T00:00:00.000Z',
        lastMessagePreview: 'thanks!',
        unreadCount: 0,
        handledBy: { kind: 'AGENT', id: 'participant_agent', displayName: 'Ada' },
      },
    ];
    await commit(client, { pastSessions: rows });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]?.handledBy?.displayName).toBe('Ada');
  });

  it('shows a completed switch as one notification per subscriber, never a half-state', async () => {
    // The switch commit is a single `setState` in core
    // (create-chat-client.ts's `commitSession`) covering session, messages,
    // pagination, watermarks and the rest. This binding fans one core
    // notification out to every selection synchronously, so no subscriber can
    // observe the new session against the old transcript.
    const { client, store } = harness({ session: buildSession({ id: 'session_1' }), messages: [buildMessage({ sessionId: 'session_1' })] });

    const observed: { session: string | null; messages: string[]; initialLoaded: boolean }[] = [];
    let sessionCalls = 0;
    let messageCalls = 0;

    store.select((state) => state.session, () => {
      sessionCalls += 1;
      const now = store.getState();
      observed.push({
        session: now.session?.id ?? null,
        messages: now.messages.map((message) => message.sessionId),
        initialLoaded: now.pagination.initialLoaded,
      });
    });
    store.select((state) => state.messages, () => { messageCalls += 1; });

    await commit(client, {
      session: buildSession({ id: 'session_2' }),
      messages: [buildMessage({ sessionId: 'session_2' })],
      pagination: { hasMore: true, loadingMore: false, initialLoaded: true },
      pastSessions: [],
    });

    expect(sessionCalls).toBe(1);
    expect(messageCalls).toBe(1);
    expect(observed).toEqual([{ session: 'session_2', messages: ['session_2'], initialLoaded: true }]);
  });
});
