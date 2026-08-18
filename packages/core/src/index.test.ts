// The public barrel — PRD §15's "no functional requirement ... requires
// reading src/" spirit applied to the package boundary itself: a consumer of
// `@dhaam-ccrm/core` sees exactly the §6.4/§6.5 surface plus the seams they
// must implement, and nothing that reveals how core is built internally.
//
// This is a structural test on purpose — it enumerates the exported keys
// rather than importing a handful and checking `typeof`, because the thing
// worth catching is a FUTURE export slipping in un-reviewed (an internal
// engine class re-exported by accident), and a spot-check would not catch
// that. See the T13 report for the breakage this test was confirmed to
// catch: temporarily re-exporting `SendQueue` from index.ts turned this red.

import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('the public barrel (packages/core/src/index.ts)', () => {
  it('exports the §6.1/§6.2 construction and session/message operations surface', () => {
    expect(typeof core.createChatClient).toBe('function');
  });

  it('exports the error classes a consumer is expected to catch', () => {
    expect(typeof core.ChatClientConfigError).toBe('function');
    expect(typeof core.ConnectionAbortedError).toBe('function');
    expect(typeof core.ConnectionSuspendedError).toBe('function');
    expect(typeof core.InvalidPublishableKeyError).toBe('function');
    expect(typeof core.SecretKeyInClientError).toBe('function');
    expect(typeof core.InvalidTokenResponseError).toBe('function');
    expect(typeof core.StorageError).toBe('function');
  });

  it('exports §6.4/§6.5 support: state factory, connection states, and the event name catalog', () => {
    expect(typeof core.createInitialChatState).toBe('function');
    expect(core.CONNECTION_STATE_VALUES).toContain('connected');
    expect(core.CHAT_EVENT_NAMES).toContain('message');
    expect(core.CHAT_EVENT_NAMES).toContain('sendFailed');
  });

  it('exports both shipped storage adapters and the namespace helper (T4 flagged storage as unexported — it now is)', () => {
    expect(typeof core.MemoryStorageAdapter).toBe('function');
    expect(typeof core.BrowserStorageAdapter).toBe('function');
    expect(typeof core.createBrowserStorageAdapter).toBe('function');
    expect(typeof core.namespaced).toBe('function');
  });

  it('exports the auth boundary helpers (publishable-key validation, token-response adapter)', () => {
    expect(typeof core.parsePublishableKey).toBe('function');
    expect(typeof core.isPublishableKey).toBe('function');
    expect(typeof core.publishableKeyEnvironment).toBe('function');
    expect(typeof core.createTokenProvider).toBe('function');
    expect(typeof core.toAuthToken).toBe('function');
  });

  it("exports messages/'s list algebra for bindings writing custom optimistic UI", () => {
    expect(typeof core.compareBySeq).toBe('function');
    expect(typeof core.sortMessages).toBe('function');
    expect(typeof core.upsertMessage).toBe('function');
    expect(typeof core.prependPage).toBe('function');
    expect(typeof core.NoActiveSessionError).toBe('function');
  });

  it('exports the protocol enum runtime guards ChatState/ChatMessage/ChatSession reference', () => {
    expect(typeof core.isChatStatus).toBe('function');
    expect(typeof core.isChatMode).toBe('function');
    expect(typeof core.isSenderType).toBe('function');
    expect(typeof core.isMessageType).toBe('function');
    expect(typeof core.isParticipantType).toBe('function');
    expect(typeof core.isPresenceStatus).toBe('function');
    expect(typeof core.isCloseReason).toBe('function');
    expect(typeof core.isErrorCode).toBe('function');
  });

  it('does NOT export any internal engine class from connection/, messages/, presence/, queue/, transport/, or backoff/', () => {
    const forbidden = [
      // connection/ — the state machine `createChatClient` drives internally.
      'ConnectionController',
      'ConnectionStateMachine',
      'ResumeTracker',
      'FakeTransport',
      'createWebSocketTransportFactory',
      // messages/ — the engine, not the seams.
      'MessageController',
      // presence/ — typing/presence/watermark engine.
      'PresenceCoordinator',
      'TypingController',
      'PresenceRegistry',
      'WatermarkTracker',
      'ManualTimers',
      // queue/ — the offline send queue engine, its test doubles, and its
      // codec/persistence/retention internals.
      'SendQueue',
      'QueuePersistence',
      'FaultStorageAdapter',
      'FakeQueueTransport',
      'encodeQueue',
      'decodeQueue',
      // transport/ — the socket engine and its test doubles. Only
      // `WebSocketFactory` (a type, invisible at this runtime check) is
      // public, to type `ChatClientConfig.webSocketFactory`.
      'WebSocketTransport',
      'StubWebSocket',
      'StubSocketFactory',
      'PendingAckRegistry',
      'HeartbeatMonitor',
      'decodeFrame',
      'createPlatformWebSocketFactory',
      // backoff/ — pure delay computation with no consumer-facing surface.
      'TransportBackoffPolicy',
      'AuthBackoffPolicy',
      'fullJitterDelay',
      // auth/ — credential hygiene with no consumer-facing use.
      'redact',
      'scrubCredentials',
      'containsCredentialMaterial',
      'REDACTED',
      // state/ — the store's own mutation surface (setState/emit) belongs to
      // T7-T12, never to a binding; only its read-only output (ChatState)
      // and the ChatStore class itself are what a binding might reasonably
      // want, but even ChatStore is not exposed — ChatClient wraps it.
      'ChatStore',
      'ChatEventEmitter',
      'deepFreeze',
    ] as const;

    const exported = new Set(Object.keys(core));
    const leaked = forbidden.filter((name) => exported.has(name));

    expect(leaked).toEqual([]);
  });
});
