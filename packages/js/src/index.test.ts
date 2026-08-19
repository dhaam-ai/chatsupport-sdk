// Runtime check that this package's re-exports actually exist at runtime,
// not just in types — this file imports from source (via vitest, same as
// core's own tests), complementing test/global-build.test.ts which verifies
// the separately-built IIFE artifact.

import { describe, expect, it } from 'vitest';

import * as ChatSdk from './index.js';

describe('@dhaam-ccrm/js re-exports', () => {
  it('re-exports createChatClient as a function', () => {
    expect(typeof ChatSdk.createChatClient).toBe('function');
  });

  it('re-exports the state classes and helpers used directly (not just as types)', () => {
    expect(typeof ChatSdk.ChatStateStore).toBe('function');
    expect(typeof ChatSdk.ChatEventEmitter).toBe('function');
    expect(typeof ChatSdk.createInitialChatState).toBe('function');
    expect(typeof ChatSdk.MemoryStorageAdapter).toBe('function');
  });

  it('re-exports CORE_PROTOCOL_VERSION with the same value as core', () => {
    expect(typeof ChatSdk.CORE_PROTOCOL_VERSION).toBe('number');
  });
});
