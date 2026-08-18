// GUARD 3 — PRD §10.1/§14: a secret key cannot reach a browser through core.
//
// §14 wants `dhsk_live_...` to be "structurally impossible to reference from
// any browser-targeted package". The type system does most of that work
// (`PublishableKey` is branded, so only `parsePublishableKey` can mint one),
// but a type is erased at runtime and a host app is plain JavaScript reading a
// key out of an env var. The runtime refusal is what actually holds.
//
// ── What this adds over the tests that already exist ─────────────────────
//
// `src/auth/keys.test.ts` covers `parsePublishableKey` thoroughly — casing,
// whitespace, error identity, and a leak check with its own self-test. The
// e2e suite covers one `dhsk_live_` value reaching `createChatClient`. Neither
// states the invariant this file is about, which is a REACHABILITY claim about
// the two doors into the package:
//
//   1. Both doors agree. Every value `parsePublishableKey` refuses is also
//      refused by `createChatClient`. These are the only two entry points that
//      accept a key, and a guard that checked one would pass while the other
//      silently accepted secrets — which is exactly what happens if someone
//      later adds a `createChatClient` fast path, a cached client, or a second
//      constructor that forgets to validate.
//   2. Refusal happens before anything else runs. No socket opened, no
//      `getToken()` called, no storage written. A client that validated late
//      would already have put the secret on the wire.
//
// The fixtures deliberately use short, obviously-fake bodies. `src/auth/keys.ts`
// records that GitHub's secret scanner blocked a push to this repo over two
// synthetic `sk_live_`-shaped fixtures; a realistic-looking literal here would
// do it again and block the very commit that adds the guard.

import { describe, expect, it } from 'vitest';

import {
  createChatClient,
  InvalidPublishableKeyError,
  isPublishableKey,
  parsePublishableKey,
  SecretKeyInClientError,
  type ChatClientConfig,
  type StorageAdapter,
} from '../../src/index.js';

/**
 * A body unique enough that finding it in any error output is proof of a leak,
 * and shaped so no vendor's secret scanner claims it.
 */
const CANARY = 'CANARY-MUST-NOT-APPEAR';

/**
 * Values that must never be accepted as a publishable key.
 *
 * Spelled out as literals rather than built from the prefix constants in
 * `src/auth/keys.ts`. Importing those constants would make the test compare
 * the code against itself: renaming the prefix would change both sides at once
 * and the test would keep passing while every real key in the wild was
 * rejected.
 */
const SECRET_SHAPED = [
  ['our live secret key', `dhsk_live_${CANARY}`],
  ['our test secret key', `dhsk_test_${CANARY}`],
  ['our secret key for an undocumented environment', `dhsk_staging_${CANARY}`],
  // §10.1: core refuses a bare foreign `sk_` on purpose. Someone pasting a
  // real Stripe key has made the same mistake with the same consequences, and
  // must get a credential-incident error rather than a formatting error that
  // sends them hunting for a typo.
  ['a foreign (Stripe-scheme) live secret key', `sk_live_${CANARY}`],
  ['a foreign (Stripe-scheme) test secret key', `sk_test_${CANARY}`],
  ['a bare foreign secret key with no environment', `sk_${CANARY}`],
  ['a secret key defeated by casing', `DHSK_LIVE_${CANARY}`],
  ['a foreign secret key defeated by casing', `SK_Live_${CANARY}`],
  ['a secret key with surrounding whitespace', `  dhsk_live_${CANARY}  `],
  ['a secret key with a leading newline', `\n\tsk_live_${CANARY}`],
] as const;

/** Records whether any I/O seam was touched during construction. */
interface Seams {
  readonly calls: string[];
  config(publishableKey: string): ChatClientConfig;
}

function seams(): Seams {
  const calls: string[] = [];

  const storage: StorageAdapter = {
    get(key) {
      calls.push(`storage.get(${key})`);
      return Promise.resolve(null);
    },
    set(key) {
      calls.push(`storage.set(${key})`);
      return Promise.resolve();
    },
    remove(key) {
      calls.push(`storage.remove(${key})`);
      return Promise.resolve();
    },
  };

  return {
    calls,
    config(publishableKey) {
      return {
        publishableKey,
        wsUrl: 'wss://example.test/chat-services/v2/ws',
        getToken: () => {
          calls.push('getToken()');
          return Promise.resolve('tok_never');
        },
        localSender: { senderId: 'participant_customer_1', senderType: 'CUSTOMER' },
        history: {
          listMessages: () => {
            calls.push('history.listMessages()');
            return Promise.resolve({ messages: [], hasMore: false });
          },
        },
        storage,
        webSocketFactory: (url: string) => {
          calls.push(`webSocketFactory(${url})`);
          throw new Error('a socket must never be created for a rejected key');
        },
        logger: (level, message) => {
          calls.push(`logger(${level}, ${message})`);
        },
      };
    },
  };
}

/** Everything a thrown error could carry a credential in. */
function errorSurface(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return [error.name, error.message, error.stack ?? '', JSON.stringify(error)].join('\n');
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe('§14 guard: parsePublishableKey refuses every secret-shaped value', () => {
  it.each(SECRET_SHAPED)('rejects %s', (_label, value) => {
    expect(() => parsePublishableKey(value)).toThrow(SecretKeyInClientError);
    expect(isPublishableKey(value)).toBe(false);
  });
});

describe('§14 guard: createChatClient refuses the same values, at construction', () => {
  it.each(SECRET_SHAPED)('rejects %s', (_label, value) => {
    const s = seams();
    expect(() => createChatClient(s.config(value))).toThrow(SecretKeyInClientError);
  });

  it.each(SECRET_SHAPED)('opens no socket and calls no getToken for %s', (_label, value) => {
    // A client that validated lazily — on `connect()`, or after building its
    // transport — would already have handed the secret to a socket factory
    // and, on a customer's own token endpoint, to the network.
    const s = seams();
    thrownBy(() => createChatClient(s.config(value)));
    expect(s.calls).toEqual([]);
  });

  it('the seam recorder is not simply always empty', () => {
    // Without this, the assertion above passes for a client that never calls
    // anything, including one that was never wired to the seams at all.
    // `connect()` reaches `getToken()` first and the socket factory later, so
    // this only waits for the first observable seam touch.
    const s = seams();
    const client = createChatClient(s.config('dhpk_test_valid123'));
    void client.connect();
    expect(s.calls).toContain('getToken()');
  });
});

describe('§14 guard: the two doors agree — neither is a way around the other', () => {
  it.each(SECRET_SHAPED)('%s is refused by both, with the same error class', (_label, value) => {
    const fromParse = thrownBy(() => parsePublishableKey(value));
    const s = seams();
    const fromClient = thrownBy(() => createChatClient(s.config(value)));

    expect(fromParse).toBeInstanceOf(SecretKeyInClientError);
    expect(fromClient).toBeInstanceOf(SecretKeyInClientError);
    expect((fromClient as Error).message).toBe((fromParse as Error).message);
  });

  it('a valid publishable key is accepted by both, so the guard is not refusing everything', () => {
    const key = 'dhpk_test_valid123';
    expect(parsePublishableKey(key)).toBe(key);
    const s = seams();
    expect(() => createChatClient(s.config(key))).not.toThrow();
  });
});

describe('§14 guard: a secret key is a credential incident, not a format error', () => {
  it.each(SECRET_SHAPED)('%s does not masquerade as a formatting mistake', (_label, value) => {
    // Distinct classes on purpose: a host that catches "bad config format" and
    // shows a "check your key" message must not swallow the one failure whose
    // remedy is to ROTATE an exposed credential.
    const error = thrownBy(() => parsePublishableKey(value));
    expect(error).not.toBeInstanceOf(InvalidPublishableKeyError);
    expect(errorSurface(error)).toMatch(/rotate/i);
  });

  it('a merely malformed key still gets the ordinary format error', () => {
    // The counterpart: if everything threw SecretKeyInClientError, the test
    // above would pass while the distinction it protects had been erased.
    const error = thrownBy(() => parsePublishableKey('not_a_key_at_all'));
    expect(error).toBeInstanceOf(InvalidPublishableKeyError);
    expect(error).not.toBeInstanceOf(SecretKeyInClientError);
  });
});

describe('§14 guard: no part of the rejected key reaches the error', () => {
  it.each(SECRET_SHAPED)('leaks nothing when parsePublishableKey rejects %s', (_label, value) => {
    expect(errorSurface(thrownBy(() => parsePublishableKey(value)))).not.toContain(CANARY);
  });

  it.each(SECRET_SHAPED)('leaks nothing when createChatClient rejects %s', (_label, value) => {
    const s = seams();
    expect(errorSurface(thrownBy(() => createChatClient(s.config(value))))).not.toContain(CANARY);
  });

  it('the leak detector would actually catch a disclosure', () => {
    // Proves `errorSurface` reads the fields a real leak would land in. A
    // detector that returned '' would make every assertion above vacuous.
    expect(errorSurface(new Error(`key was ${CANARY}`))).toContain(CANARY);
    expect(errorSurface(thrownBy(() => parsePublishableKey('x')))).toMatch(/publishableKey/);
  });
});
