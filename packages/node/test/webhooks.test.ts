import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  DEFAULT_TOLERANCE_SECONDS,
  assertWebhookSignature,
  constructWebhookEvent,
  isKnownWebhookEvent,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../src/webhooks.js';
import { WebhookVerificationError, InvalidSecretKeyError } from '../src/errors.js';
import { ALL_CREDENTIALS, SECRET_KEY_LIVE, SECRET_KEY_OTHER } from './fixtures.js';

/** A realistic `message.created` delivery body. */
const EVENT_BODY = JSON.stringify({
  id: 'evt_01HQ8X',
  type: 'message.created',
  createdAt: '2026-08-18T10:00:00.000Z',
  tenantId: 'tenant_42',
  data: {
    id: '01HQ8XMSG',
    chatSessionId: 'sess_1',
    senderType: 'AGENT',
    content: 'Hello',
    messageType: 'TEXT',
    createdAt: '2026-08-18T10:00:00.000Z',
  },
});

/** Fixed clock, so the replay-window tests are not flaky at a second boundary. */
const NOW = 1_760_000_000;

function headerFor(body: string, timestamp = NOW, key = SECRET_KEY_LIVE): string {
  return signWebhookPayload({ payload: body, secretKey: key, timestamp });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('node:crypto');
  vi.resetModules();
});

describe('verifyWebhookSignature — acceptance', () => {
  it('accepts a correctly signed delivery', () => {
    expect(
      verifyWebhookSignature({
        payload: EVENT_BODY,
        signatureHeader: headerFor(EVENT_BODY),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('accepts the same delivery supplied as a Buffer', () => {
    // A framework exposing the raw body usually hands over a Buffer, not a
    // string. If only the string path worked, every Express integration would
    // fail — and the natural "fix" is to stringify, which is how byte-exact
    // verification gets quietly broken.
    expect(
      verifyWebhookSignature({
        payload: Buffer.from(EVENT_BODY, 'utf8'),
        signatureHeader: headerFor(EVENT_BODY),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('signs over the raw bytes, so a re-serialized body does NOT verify', () => {
    // The defect this guards: verifying against JSON.stringify(JSON.parse(body)).
    // Same data, different bytes — key order and spacing differ.
    const reserialized = JSON.stringify(JSON.parse(EVENT_BODY), null, 2);
    expect(reserialized).not.toBe(EVENT_BODY);
    expect(
      verifyWebhookSignature({
        payload: reserialized,
        signatureHeader: headerFor(EVENT_BODY),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('matches an independently computed HMAC over `${t}.${body}`', () => {
    // Computed here from the contract text rather than by calling our own
    // signer, so this test would still fail if signWebhookPayload and the
    // verifier drifted together into a scheme the server does not send.
    const expected = createHmac('sha256', SECRET_KEY_LIVE)
      .update(`${NOW}.${EVENT_BODY}`, 'utf8')
      .digest('hex');
    expect(headerFor(EVENT_BODY)).toBe(`t=${NOW},v1=${expected}`);
  });
});

describe('verifyWebhookSignature — rejection', () => {
  it('rejects a tampered body', () => {
    const tampered = EVENT_BODY.replace('Hello', 'Hell0');
    expect(
      verifyWebhookSignature({
        payload: tampered,
        signatureHeader: headerFor(EVENT_BODY),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects a body tampered with by a single flipped byte', () => {
    // A one-character change is the realistic tampering case; a test that only
    // ever mutates the body wholesale can pass against a comparison that only
    // checks length.
    const tampered = `${EVENT_BODY.slice(0, -2)}0}`;
    expect(
      verifyWebhookSignature({
        payload: tampered,
        signatureHeader: headerFor(EVENT_BODY),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects a signature made with the wrong key', () => {
    expect(
      verifyWebhookSignature({
        payload: EVENT_BODY,
        signatureHeader: headerFor(EVENT_BODY, NOW, SECRET_KEY_OTHER),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects a replayed delivery whose timestamp has aged out', () => {
    const old = NOW - DEFAULT_TOLERANCE_SECONDS - 1;
    expect(
      verifyWebhookSignature({
        payload: EVENT_BODY,
        // Correctly signed AT THAT TIME — this is exactly a captured delivery
        // resent later, not a forgery. Only the window rejects it.
        signatureHeader: headerFor(EVENT_BODY, old),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects a delivery whose timestamp is too far in the FUTURE', () => {
    // Rejecting only stale timestamps would leave a far-future delivery valid
    // indefinitely, turning one captured request into a permanent forgery.
    const future = NOW + DEFAULT_TOLERANCE_SECONDS + 1;
    expect(
      verifyWebhookSignature({
        payload: EVENT_BODY,
        signatureHeader: headerFor(EVENT_BODY, future),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('accepts a delivery exactly at the tolerance boundary, on both sides', () => {
    // Pins the comparison as `> tolerance`, not `>=`. Without this, tightening
    // the boundary by one second would go unnoticed.
    for (const t of [NOW - DEFAULT_TOLERANCE_SECONDS, NOW + DEFAULT_TOLERANCE_SECONDS]) {
      expect(
        verifyWebhookSignature({
          payload: EVENT_BODY,
          signatureHeader: headerFor(EVENT_BODY, t),
          secretKey: SECRET_KEY_LIVE,
          now: NOW,
        }),
      ).toBe(true);
    }
  });

  it('honours a custom tolerance', () => {
    const t = NOW - 60;
    const header = headerFor(EVENT_BODY, t);
    const base = { payload: EVENT_BODY, signatureHeader: header, secretKey: SECRET_KEY_LIVE, now: NOW };
    expect(verifyWebhookSignature({ ...base, toleranceSeconds: 120 })).toBe(true);
    expect(verifyWebhookSignature({ ...base, toleranceSeconds: 30 })).toBe(false);
  });

  it('rejects a signature whose timestamp was rewritten to "now"', () => {
    // The replay attack the scheme is designed to stop: an attacker captures a
    // stale delivery and edits `t` so it falls inside the window. Because `t`
    // is INSIDE the MAC, the signature no longer matches.
    const old = NOW - 10_000;
    const captured = headerFor(EVENT_BODY, old);
    const signature = captured.split('v1=')[1];
    const rewritten = `t=${NOW},v1=${signature}`;
    expect(
      verifyWebhookSignature({
        payload: EVENT_BODY,
        signatureHeader: rewritten,
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe('verifyWebhookSignature — malformed headers', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['empty', ''],
    ['no scheme part', `t=${NOW}`],
    ['no timestamp part', 'v1=abcdef'],
    ['non-numeric timestamp', `t=abc,v1=${'a'.repeat(64)}`],
    ['timestamp with trailing garbage', `t=${NOW}abc,v1=${'a'.repeat(64)}`],
    ['empty signature value', `t=${NOW},v1=`],
    ['unrecognised scheme only', `t=${NOW},v2=${'a'.repeat(64)}`],
    ['not the scheme at all', 'garbage'],
  ];

  for (const [name, header] of cases) {
    it(`rejects a header that is ${name}`, () => {
      expect(
        verifyWebhookSignature({
          payload: EVENT_BODY,
          signatureHeader: header,
          secretKey: SECRET_KEY_LIVE,
          now: NOW,
        }),
      ).toBe(false);
    });
  }

  it('tolerates an unknown scheme alongside a valid v1, so senders can add v2 additively', () => {
    const valid = headerFor(EVENT_BODY);
    expect(
      verifyWebhookSignature({
        payload: EVENT_BODY,
        signatureHeader: `${valid},v2=${'f'.repeat(64)}`,
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('accepts when ANY v1 matches, so a key rotation does not need a flag day', () => {
    const wrong = headerFor(EVENT_BODY, NOW, SECRET_KEY_OTHER).split('v1=')[1];
    const right = headerFor(EVENT_BODY).split('v1=')[1];
    expect(
      verifyWebhookSignature({
        payload: EVENT_BODY,
        signatureHeader: `t=${NOW},v1=${wrong},v1=${right}`,
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('accepts an upper-case hex signature', () => {
    const header = headerFor(EVENT_BODY);
    const [t, sig] = header.split(',v1=');
    expect(
      verifyWebhookSignature({
        payload: EVENT_BODY,
        signatureHeader: `${t},v1=${(sig as string).toUpperCase()}`,
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe('constant-time comparison', () => {
  it('uses crypto.timingSafeEqual rather than === on the signature', async () => {
    // Asserting the IMPLEMENTATION, not measurable timing: a timing assertion
    // is flaky under a JIT and a shared CI runner, and would be the kind of
    // test that gets deleted the first time it goes red for an unrelated
    // reason. This proves the primitive is reached.
    const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
    const spy = vi.fn(actual.timingSafeEqual);
    vi.doMock('node:crypto', () => ({ ...actual, default: actual, timingSafeEqual: spy }));

    const fresh = await import('../src/webhooks.js');
    fresh.verifyWebhookSignature({
      payload: EVENT_BODY,
      signatureHeader: fresh.signWebhookPayload({
        payload: EVENT_BODY,
        secretKey: SECRET_KEY_LIVE,
        timestamp: NOW,
      }),
      secretKey: SECRET_KEY_LIVE,
      now: NOW,
    });

    expect(spy).toHaveBeenCalled();
    // Both operands must be equal-length digests. If they were the raw hex
    // signatures, a length mismatch would THROW — and that throw is itself a
    // length oracle, which is the whole reason both sides are hashed first.
    const [a, b] = spy.mock.calls[0] as [Buffer, Buffer];
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
  });

  it('does not throw on a signature of the wrong length — it returns false', () => {
    // timingSafeEqual throws on a length mismatch. If the raw signatures were
    // passed to it, this input would produce an exception rather than a clean
    // rejection, and the exception would leak the expected length.
    for (const sig of ['a', 'a'.repeat(63), 'a'.repeat(200)]) {
      expect(
        verifyWebhookSignature({
          payload: EVENT_BODY,
          signatureHeader: `t=${NOW},v1=${sig}`,
          secretKey: SECRET_KEY_LIVE,
          now: NOW,
        }),
      ).toBe(false);
    }
  });
});

describe('misuse is refused loudly', () => {
  it('refuses an already-parsed body instead of re-serializing it', () => {
    expect(() =>
      verifyWebhookSignature({
        payload: JSON.parse(EVENT_BODY) as unknown as string,
        signatureHeader: headerFor(EVENT_BODY),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toThrow(TypeError);
    // And the message must point at the actual fix.
    expect(() =>
      verifyWebhookSignature({
        payload: JSON.parse(EVENT_BODY) as unknown as string,
        signatureHeader: headerFor(EVENT_BODY),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toThrow(/raw request body/);
  });

  it('refuses an empty secret key rather than verifying against it', () => {
    // The critical misconfiguration: an unset env var arriving as ''. An HMAC
    // keyed on '' verifies perfectly against a forgery signed with '', so
    // "successful" verification here would be worse than none — it would be
    // believed. This must throw, NOT return false.
    expect(() =>
      verifyWebhookSignature({
        payload: EVENT_BODY,
        signatureHeader: headerFor(EVENT_BODY),
        secretKey: '',
        now: NOW,
      }),
    ).toThrow(InvalidSecretKeyError);
  });

  it('refuses a negative tolerance', () => {
    expect(() =>
      verifyWebhookSignature({
        payload: EVENT_BODY,
        signatureHeader: headerFor(EVENT_BODY),
        secretKey: SECRET_KEY_LIVE,
        toleranceSeconds: -1,
        now: NOW,
      }),
    ).toThrow(TypeError);
  });
});

describe('assertWebhookSignature', () => {
  it('reports a coarse reason for each failure category', () => {
    const expectations: ReadonlyArray<readonly [string, string]> = [
      ['malformed_header', 'garbage'],
      ['timestamp_out_of_tolerance', headerFor(EVENT_BODY, NOW - 10_000)],
      ['signature_mismatch', `t=${NOW},v1=${'a'.repeat(64)}`],
    ];
    for (const [reason, header] of expectations) {
      try {
        assertWebhookSignature({
          payload: EVENT_BODY,
          signatureHeader: header,
          secretKey: SECRET_KEY_LIVE,
          now: NOW,
        });
        expect.unreachable(`expected ${reason} to throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(WebhookVerificationError);
        expect((error as WebhookVerificationError).reason).toBe(reason);
      }
    }
  });

  it('reports a tampered body and a wrong key identically', () => {
    // Deliberate: distinguishing them tells an attacker probing an endpoint
    // whether they have guessed the right key.
    const reasons = [
      headerFor(EVENT_BODY, NOW, SECRET_KEY_OTHER),
      headerFor(`${EVENT_BODY} `),
    ].map((header) => {
      try {
        assertWebhookSignature({
          payload: EVENT_BODY,
          signatureHeader: header,
          secretKey: SECRET_KEY_LIVE,
          now: NOW,
        });
        return 'no-throw';
      } catch (error) {
        return (error as WebhookVerificationError).reason;
      }
    });
    expect(reasons).toEqual(['signature_mismatch', 'signature_mismatch']);
  });
});

describe('constructWebhookEvent', () => {
  it('returns the typed event for a verified delivery', () => {
    const event = constructWebhookEvent({
      payload: EVENT_BODY,
      signatureHeader: headerFor(EVENT_BODY),
      secretKey: SECRET_KEY_LIVE,
      now: NOW,
    });
    expect(event.type).toBe('message.created');
    expect(event.id).toBe('evt_01HQ8X');
    expect(event.tenantId).toBe('tenant_42');

    // Narrowing must actually work — this is the ergonomic promise, and it
    // needs the guard: UnknownWebhookEvent['type'] is `string`, which overlaps
    // every literal, so a bare switch on the raw union leaves `data` unknown.
    if (!isKnownWebhookEvent(event)) throw new Error('expected a known event type');
    if (event.type === 'message.created') {
      expect(event.data.content).toBe('Hello');
      expect(event.data.senderType).toBe('AGENT');
    } else {
      throw new Error('expected message.created');
    }
  });

  it('isKnownWebhookEvent separates the catalog from a future event type', () => {
    const known = constructWebhookEvent({
      payload: EVENT_BODY,
      signatureHeader: headerFor(EVENT_BODY),
      secretKey: SECRET_KEY_LIVE,
      now: NOW,
    });
    expect(isKnownWebhookEvent(known)).toBe(true);

    const futureBody = JSON.stringify({
      id: 'evt_9',
      type: 'session.escalated',
      createdAt: '2026-08-18T10:00:00.000Z',
      tenantId: 'tenant_42',
      data: {},
    });
    const future = constructWebhookEvent({
      payload: futureBody,
      signatureHeader: headerFor(futureBody),
      secretKey: SECRET_KEY_LIVE,
      now: NOW,
    });
    expect(isKnownWebhookEvent(future)).toBe(false);
  });

  it('refuses to return an event when verification fails', () => {
    // The reason this function exists: an event must be unobtainable without
    // a passing signature.
    expect(() =>
      constructWebhookEvent({
        payload: EVENT_BODY.replace('Hello', 'Goodbye'),
        signatureHeader: headerFor(EVENT_BODY),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toThrow(WebhookVerificationError);
  });

  it('passes through an unknown event type rather than rejecting it', () => {
    // New event types are additive; a receiver upgraded later than the sender
    // must not start rejecting deliveries it cannot yet name.
    const body = JSON.stringify({
      id: 'evt_2',
      type: 'session.escalated',
      createdAt: '2026-08-18T10:00:00.000Z',
      tenantId: 'tenant_42',
      data: { anything: true },
    });
    const event = constructWebhookEvent({
      payload: body,
      signatureHeader: headerFor(body),
      secretKey: SECRET_KEY_LIVE,
      now: NOW,
    });
    expect(event.type).toBe('session.escalated');
  });

  it('rejects a verified body that is not a JSON object', () => {
    for (const body of ['not json', '[]', '"a string"', 'null']) {
      expect(() =>
        constructWebhookEvent({
          payload: body,
          signatureHeader: headerFor(body),
          secretKey: SECRET_KEY_LIVE,
          now: NOW,
        }),
      ).toThrow(WebhookVerificationError);
    }
  });

  it('rejects a verified object missing a required envelope field', () => {
    const body = JSON.stringify({ id: 'e', type: 'message.created', createdAt: 'x' });
    expect(() =>
      constructWebhookEvent({
        payload: body,
        signatureHeader: headerFor(body),
        secretKey: SECRET_KEY_LIVE,
        now: NOW,
      }),
    ).toThrow(/tenantId/);
  });
});

describe('no credential material escapes in a thrown message', () => {
  it('never puts a key, a signature, or the body into an error message', () => {
    const header = headerFor(EVENT_BODY);
    const signature = header.split('v1=')[1] as string;

    const thrown: Error[] = [];
    const attempts: Array<() => void> = [
      () => assertWebhookSignature({ payload: EVENT_BODY, signatureHeader: 'garbage', secretKey: SECRET_KEY_LIVE, now: NOW }),
      () => assertWebhookSignature({ payload: EVENT_BODY, signatureHeader: headerFor(EVENT_BODY, NOW - 10_000), secretKey: SECRET_KEY_LIVE, now: NOW }),
      () => assertWebhookSignature({ payload: EVENT_BODY, signatureHeader: header, secretKey: SECRET_KEY_OTHER, now: NOW }),
      () => assertWebhookSignature({ payload: EVENT_BODY, signatureHeader: header, secretKey: '', now: NOW }),
      () => assertWebhookSignature({ payload: EVENT_BODY, signatureHeader: header, secretKey: 'dhp' + '_live_' + 'A'.repeat(43), now: NOW }),
      () => constructWebhookEvent({ payload: 'not json', signatureHeader: headerFor('not json'), secretKey: SECRET_KEY_LIVE, now: NOW }),
    ];

    for (const attempt of attempts) {
      try {
        attempt();
        expect.unreachable('expected a throw');
      } catch (error) {
        thrown.push(error as Error);
      }
    }
    expect(thrown).toHaveLength(attempts.length);

    for (const error of thrown) {
      const serialized = `${error.name}: ${error.message}\n${String(error.stack ?? '')}`;
      for (const credential of ALL_CREDENTIALS) {
        expect(serialized).not.toContain(credential);
        // Not even a prefix of the random component: §14 rules out prefixes
        // because a prefix correlates one credential across systems.
        expect(serialized).not.toContain(credential.slice(0, 20));
      }
      expect(serialized).not.toContain(signature);
      expect(serialized).not.toContain(signature.slice(0, 16));
      // Nor the body: it is not a credential, but a webhook body carries
      // customer message content, which does not belong in an error tracker.
      expect(serialized).not.toContain('Hello');
    }
  });
});
