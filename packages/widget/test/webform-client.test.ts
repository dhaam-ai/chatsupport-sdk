// node, vi.stubGlobal('fetch', …). Mirrors remote-config.test.ts's own
// fetch-testing idiom, one level down: this is the write half.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WEBFORM_PATH,
  WebformError,
  newSubmissionId,
  submitWebform,
  visitorMessage,
} from '../src/webform.js';
import type { WebformDraft, WebformFailureKind } from '../src/webform.js';

const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

function draft(overrides: Partial<WebformDraft> = {}): WebformDraft {
  return {
    submissionId: 'sub-0123456789',
    email: 'ada@example.com',
    message: 'Where is my order?',
    fillMs: 4200,
    company_website: '',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submitWebform — the request', () => {
  it('POSTs to WEBFORM_PATH under apiUrl, stripping a trailing slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { outcome: 'ticket', receiptId: 'r1', duplicate: false }));
    vi.stubGlobal('fetch', fetchMock);

    await submitWebform({ apiUrl: 'https://chat.example.com//', publishableKey: PUBLISHABLE, draft: draft() });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://chat.example.com${WEBFORM_PATH}`);
    expect(init.method).toBe('POST');
  });

  it('carries X-Publishable-Key and no Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { outcome: 'ticket', receiptId: 'r1', duplicate: false }));
    vi.stubGlobal('fetch', fetchMock);

    await submitWebform({ apiUrl: 'https://chat.example.com', publishableKey: PUBLISHABLE, draft: draft() });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Publishable-Key']).toBe(PUBLISHABLE);
    expect(headers['Authorization']).toBeUndefined();
    expect(init.credentials).toBe('omit');
  });

  it('sends a body with exactly the WebformDraft keys — the route is .strict()', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { outcome: 'ticket', receiptId: 'r1', duplicate: false }));
    vi.stubGlobal('fetch', fetchMock);

    const theDraft = draft({ name: 'Ada', phone: '+1', subject: 'Order', prefer: 'ticket', pageUrl: 'https://x', locale: 'en-US' });
    await submitWebform({ apiUrl: 'https://chat.example.com', publishableKey: PUBLISHABLE, draft: theDraft });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(Object.keys(theDraft).sort());
    expect(sent).toEqual(theDraft);
  });

  it('omits an absent optional field rather than sending it as null/undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { outcome: 'ticket', receiptId: 'r1', duplicate: false }));
    vi.stubGlobal('fetch', fetchMock);

    await submitWebform({ apiUrl: 'https://chat.example.com', publishableKey: PUBLISHABLE, draft: draft() });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect('name' in sent).toBe(false);
    expect('phone' in sent).toBe(false);
    expect('subject' in sent).toBe(false);
  });
});

describe('submitWebform — success', () => {
  it('resolves with the receipt on 2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(202, { outcome: 'chat', receiptId: 'r1', duplicate: false, chatSessionId: 'sess_1' })),
    );

    await expect(
      submitWebform({ apiUrl: 'https://chat.example.com', publishableKey: PUBLISHABLE, draft: draft() }),
    ).resolves.toEqual({ outcome: 'chat', receiptId: 'r1', duplicate: false, chatSessionId: 'sess_1' });
  });

  it('rejects with an "unavailable" WebformError when the 2xx body is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(202, { nonsense: true })));

    const rejection = await submitWebform({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      draft: draft(),
    }).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(WebformError);
    expect((rejection as WebformError).kind).toBe('unavailable');
  });
});

describe('submitWebform — status → WebformFailureKind, exhaustively', () => {
  it.each<[number, unknown, WebformFailureKind]>([
    [400, { error: { code: 'VALIDATION_FAILED' } }, 'validation'],
    // The OUTCOME-level refusal, which shares 400 with the schema failure
    // above and is told apart by its code alone. `refuse(...)` sends no
    // `details.fieldErrors` with it, which is exactly why it cannot be
    // answered with the "check the highlighted field" sentence.
    [400, { error: { code: 'WEBFORM_EMAIL_REQUIRED' } }, 'needs_email'],
    [401, { error: { code: 'AUTH_INVALID' } }, 'unauthorized'],
    [403, { error: { code: 'ORIGIN_NOT_ALLOWED' } }, 'origin'],
    [403, { error: { code: 'CHANNEL_DISABLED' } }, 'channel_off'],
    [413, { error: { code: 'PAYLOAD_TOO_LARGE' } }, 'too_large'],
    [429, { error: { code: 'RATE_LIMITED' } }, 'rate_limited'],
    [503, { error: { code: 'WEBFORM_UNAVAILABLE' } }, 'unavailable'],
    [500, { error: { code: 'INTERNAL' } }, 'unavailable'],
    // Unlisted statuses, exercising the total fallback. Below 500 the route
    // did not answer us at all — NOT a disagreement about what the visitor
    // typed, which is what this used to claim.
    [404, {}, 'unreachable'],
    [418, {}, 'unreachable'],
    [507, {}, 'unavailable'],
  ])('%i → %s', async (status, body, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, body)));

    const rejection = await submitWebform({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      draft: draft(),
    }).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(WebformError);
    expect((rejection as WebformError).kind).toBe(kind);
  });

  it('a 403 with an unparseable body falls to "origin" — the branch that does not trigger a refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 403 })));

    const rejection = await submitWebform({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      draft: draft(),
    }).catch((error: unknown) => error);
    expect((rejection as WebformError).kind).toBe('origin');
  });

  it('parses Retry-After into retryAfterSec on a 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(429, { error: { code: 'RATE_LIMITED' } }, { 'Retry-After': '30' })),
    );

    const rejection = await submitWebform({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      draft: draft(),
    }).catch((error: unknown) => error);
    expect((rejection as WebformError).retryAfterSec).toBe(30);
  });

  it('leaves retryAfterSec undefined when the header is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, { error: { code: 'RATE_LIMITED' } })));

    const rejection = await submitWebform({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      draft: draft(),
    }).catch((error: unknown) => error);
    expect((rejection as WebformError).retryAfterSec).toBeUndefined();
  });

  it('names the field from details.fieldErrors on a 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, { error: { code: 'VALIDATION_FAILED', details: { fieldErrors: { email: ['invalid'] } } } }),
      ),
    );

    const rejection = await submitWebform({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      draft: draft(),
    }).catch((error: unknown) => error);
    expect((rejection as WebformError).field).toBe('email');
  });
});

describe('submitWebform — network and timeout', () => {
  it('rejects with kind "network" on a bare fetch rejection (offline, CORS, DNS)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const rejection = await submitWebform({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      draft: draft(),
    }).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(WebformError);
    expect((rejection as WebformError).kind).toBe('network');
  });

  it('aborts after the timeout and rejects with "network" rather than hanging', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );

    const pending = submitWebform({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      draft: draft(),
      timeoutMs: 15_000,
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(15_000);
    const rejection = await pending;
    expect(rejection).toBeInstanceOf(WebformError);
    expect((rejection as WebformError).kind).toBe('network');
    vi.useRealTimers();
  });
});

describe('newSubmissionId', () => {
  const ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

  it('matches the server-required pattern when crypto.randomUUID is present', () => {
    const id = newSubmissionId();
    expect(id).toMatch(ID_PATTERN);
  });

  it('matches the server-required pattern in the fallback path too', () => {
    vi.stubGlobal('crypto', {});
    const id = newSubmissionId();
    expect(id).toMatch(ID_PATTERN);
  });

  it('mints a different id on every call', () => {
    expect(newSubmissionId()).not.toBe(newSubmissionId());
  });
});

describe('visitorMessage — total, and never the server’s own words', () => {
  const kinds: readonly WebformFailureKind[] = [
    'validation',
    'needs_email',
    'unauthorized',
    'origin',
    'channel_off',
    'unreachable',
    'too_large',
    'rate_limited',
    'unavailable',
    'network',
  ];

  it.each(kinds)('yields a non-empty sentence for %s', (kind) => {
    const error = new WebformError(kind, 'attacker-controlled detail: <script>', kind === 'rate_limited');
    const message = visitorMessage(error);
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain('<script>');
    expect(message).not.toContain('attacker-controlled');
  });

  // ── Total AT RUNTIME, not merely over the union ───────────────────────
  //
  // `WebformError` is a public export, so its `kind` is only as narrow as the
  // caller's types: JavaScript callers, and two bundle versions sharing one
  // page, can both produce a kind this `switch` has never seen. Without a
  // `default` the function returned `undefined` and the consumer wrote that
  // into `textContent` — the visitor read the literal word "undefined".
  it('answers a kind outside the union with a sentence, never undefined', () => {
    const rogue = new WebformError('teapot' as WebformFailureKind, 'x', false);
    const message = visitorMessage(rogue);

    expect(typeof message).toBe('string');
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain('undefined');
    expect(message).toBe(visitorMessage(new WebformError('network', '', true)));
  });

  it('treats anything that is not a WebformError as "network"', () => {
    expect(visitorMessage(new Error('boom'))).toBe(visitorMessage(new WebformError('network', '', true)));
  });

  it('channel_off gets its own sentence, distinct from a plain retry', () => {
    expect(visitorMessage(new WebformError('channel_off', '', false))).toBe(
      'This form is no longer available on this site.',
    );
  });

  // ── Criterion 3, at the one kind whose sentence was outright wrong ─────
  //
  // 403 `CHANNEL_DISABLED` is answered for TWO situations since C6, and the
  // widget maps both to this one kind on purpose — `webform.service.ts` says
  // so in as many words, because only `channel_off` reaches `sendWebform`'s
  // stale-cache recovery. One of the two is row 3
  // (`no_reachable_destination`), where the web form is off and LIVE CHAT IS
  // ON AND OPEN: `resolveSupportEntry` publishes `primary: 'chat', secondary:
  // null` for it. On that row the refresh confirms (neither primary nor
  // secondary is 'ticket'), the panel re-renders offering "Chat now", and the
  // old sentence — "Messaging is switched off for this site." — was read by
  // the visitor directly above a working chat button.
  //
  // So the sentence may say the FORM went away. It may not say messaging did.
  it('never claims messaging is off — row 3 answers this code with chat still on', () => {
    const sentence = visitorMessage(new WebformError('channel_off', '', false));
    expect(sentence.toLowerCase()).not.toContain('messaging');
    expect(sentence.toLowerCase()).toContain('form');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// The honest taxonomy — what a stranger is told, per situation
// ══════════════════════════════════════════════════════════════════════════
// Every assertion here is about a SENTENCE, not a kind, because the sentence
// is the whole product at this seam. Each is checked against what
// chat-service actually answers in that case, read from its handler.
describe('the sentence a visitor reads is true of what the server did', () => {
  const VALIDATION_SENTENCE = 'Please check the highlighted field and try again.';

  async function reject(status: number, body: unknown): Promise<WebformError> {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, body)));
    const rejection = await submitWebform({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      draft: draft(),
    }).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(WebformError);
    return rejection as WebformError;
  }

  // ── CRITERION 1 ────────────────────────────────────────────────────────
  // A 404 means the submit route is not where this bundle posted. Nothing the
  // visitor typed produced it and nothing they can type fixes it, so the one
  // sentence that must never appear is the one blaming their input.
  it('a 404 does not tell the visitor to check the form', async () => {
    const error = await reject(404, {});

    expect(error.kind).toBe('unreachable');
    expect(visitorMessage(error)).not.toBe(VALIDATION_SENTENCE);
    expect(visitorMessage(error)).toBe("We can't reach support from this page right now.");
  });

  // A 404 body is usually a gateway's HTML, not JSON — `submitWebform` parses
  // it as `null` — so the honest kind may not depend on reading a code.
  it('reaches the same verdict when the 404 body is not JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>404</html>', { status: 404 })));
    const rejection = (await submitWebform({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      draft: draft(),
    }).catch((error: unknown) => error)) as WebformError;

    expect(rejection.kind).toBe('unreachable');
    expect(visitorMessage(rejection)).not.toBe(VALIDATION_SENTENCE);
  });

  // Retrying a route that is not there cannot succeed, so nothing may offer a
  // retry affordance on the strength of this error.
  it('does not mark an unreachable route retryable', async () => {
    expect((await reject(404, {})).retryable).toBe(false);
  });

  // The 400 that IS about the visitor's input keeps its sentence — this is
  // what makes the 404 change a narrowing rather than a blanket swap.
  it('still blames the field on a real validation 400', async () => {
    const error = await reject(400, {
      error: { code: 'VALIDATION_FAILED', details: { fieldErrors: { phone: ['is not a valid phone number'] } } },
    });

    expect(error.kind).toBe('validation');
    expect(error.field).toBe('phone');
    expect(visitorMessage(error)).toBe(VALIDATION_SENTENCE);
  });

  // ── CRITERION 3, the contact-rule refusal ──────────────────────────────
  // `decideWebformOutcome` answers `needs_email` when the only destination is
  // a ticket and no address was given — reachable from this form under BOTH
  // 'phone' and 'either', where Email renders optional. chat-service turns it
  // into `400 WEBFORM_EMAIL_REQUIRED` via `refuse(...)`, whose body is
  // `{ error: { code, message, retryable } }` — no `fieldErrors`. Under the
  // old fall-through this produced "check the highlighted field" with nothing
  // highlighted, which is advice a visitor cannot act on.
  it('tells a visitor refused for a missing email what to add, and where', async () => {
    const error = await reject(400, {
      error: { code: 'WEBFORM_EMAIL_REQUIRED', message: 'An email address is required.', retryable: false },
    });

    expect(error.kind).toBe('needs_email');
    expect(visitorMessage(error)).not.toBe(VALIDATION_SENTENCE);
    expect(visitorMessage(error)).toBe("Please add an email address — that's the only way we can reply.");
    // The box the form puts them back in. Named here because the refusal
    // names no field of its own.
    expect(error.field).toBe('email');
  });

  // ── The standing rule for every sentence on this surface ───────────────
  // A stranger on someone else's site must never be shown our vocabulary.
  it('leaks no status code, error code, URL or console vocabulary in any sentence', async () => {
    const cases: ReadonlyArray<[number, unknown]> = [
      [400, { error: { code: 'VALIDATION_FAILED' } }],
      [400, { error: { code: 'WEBFORM_EMAIL_REQUIRED' } }],
      [401, { error: { code: 'AUTH_INVALID' } }],
      [403, { error: { code: 'ORIGIN_NOT_ALLOWED' } }],
      [403, { error: { code: 'CHANNEL_DISABLED' } }],
      [404, {}],
      [413, { error: { code: 'PAYLOAD_TOO_LARGE' } }],
      [429, { error: { code: 'RATE_LIMITED' } }],
      [503, { error: { code: 'WEBFORM_UNAVAILABLE' } }],
    ];

    for (const [status, body] of cases) {
      const sentence = visitorMessage(await reject(status, body));
      expect(sentence).not.toMatch(/\d{3}/);
      expect(sentence).not.toMatch(/[A-Z]{3,}_[A-Z]/);
      expect(sentence).not.toMatch(/https?:|\/widget\/|tenant|webform|publishable|nexusai|ticket/i);
      // No roadmap or disclaimer copy, anywhere on this surface.
      expect(sentence).not.toMatch(/\b(yet|soon|coming|not built|unsupported|beta)\b/i);
      expect(sentence.trim()).toBe(sentence);
      expect(sentence.length).toBeGreaterThan(0);
    }
  });
});
