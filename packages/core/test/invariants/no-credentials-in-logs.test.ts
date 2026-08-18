// GUARD 4 — PRD §14: no credential or message content in any log line.
//
// §14: "No credential (token, secret key) is ever passed to `logger` or
// included in any log line core emits."
//
// ── Asserting the invariant rather than the mechanism ────────────────────
//
// Core has three mechanisms pointed at this: `frameLogContext`'s allowlist in
// `transport/logger.ts`, `scrubCredentials` in `auth/redact.ts`, and the
// controller's scrub of host-authored error text. Testing those three
// functions is not the same as testing the invariant, for two reasons:
//
//   - A mechanism test passes while the invariant is broken, if a fourth log
//     site is added that routes around all three.
//   - Asserting `scrubCredentials(x)` removed a credential, using
//     `scrubCredentials`' own patterns as the oracle, is circular: it proves
//     the function agrees with itself. That is one of the ways a test in this
//     project has passed while checking nothing.
//
// So this file drives REAL code paths — a real `ChatClient`, a real transport,
// real inbound frames — with values that are credential-shaped, and then
// searches everything the host can observe for a set of unique sentinel
// strings. The oracle is a literal substring search for a value that has no
// business existing anywhere in the output. Nothing here calls the redaction
// functions, so nothing here can be satisfied by them agreeing with themselves.
//
// "Everything the host can observe" is deliberately wider than `logger`: a
// credential in `ChatState.lastError` or in the §6.5 `error` event reaches the
// host's error tracker just as surely as one in a log line, and the controller
// writes to all three from the same string.

import { describe, expect, it, vi } from 'vitest';

import { createChatClient, type ChatClientConfig } from '../../src/index.js';
import { StubSocketFactory } from '../../src/transport/index.js';

// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------
//
// Each is unique, so a hit names exactly which value escaped and by which
// route. They are credential-SHAPED (a JWT really starts `eyJ`, a bearer
// header really looks like this) because a redactor that only recognises the
// formats this system issues must be exercised with those formats.

const TOKEN_BODY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
/** What `getToken()` returns — a realistic three-segment JWT. */
const ACCESS_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${TOKEN_BODY}.SiGnAtUrE0123456789`;
/** A credential embedded in a HOST-authored error message, the §14 motivating case. */
const HOST_ERROR_TOKEN = `eyJhbGciOiJIUzI1NiJ9.HOSTSIDE${TOKEN_BODY}.HoStSiG9876543210`;
/** Message text the user typed. Never a debugging aid, always private content. */
const MESSAGE_CONTENT = 'my card number is 4111-1111-1111-1111 please help';
/** Content arriving on an inbound frame that also fails validation. */
const INBOUND_CONTENT = 'inbound-private-body-do-not-log';

/**
 * Credentials. Banned from EVERYTHING a host can observe — log lines, event
 * payloads, and `ChatState` alike. Core has no reason to surface a token
 * anywhere; the only place one legitimately appears is on the wire.
 */
const CREDENTIAL_SENTINELS: readonly (readonly [string, string])[] = [
  ['the access token', ACCESS_TOKEN],
  ['the access token body', TOKEN_BODY],
  ['a token inside host error text', HOST_ERROR_TOKEN],
];

/**
 * Message content. Banned from log lines and error text — but NOT from state
 * or the `message` event, where delivering it is the entire purpose of the
 * SDK.
 *
 * The distinction is the point rather than a loophole. Lumping the two
 * together produces a guard that fails on correct behaviour, and the way that
 * gets "fixed" under time pressure is by weakening it until it checks nothing.
 * §14's claim is about what core LOGS, so that is what is asserted.
 */
const CONTENT_SENTINELS: readonly (readonly [string, string])[] = [
  ['outbound message content', MESSAGE_CONTENT],
  ['inbound message content', INBOUND_CONTENT],
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Observed {
  /** Everything the host could see, concatenated: log lines, state, events. */
  text(): string;
  readonly logLines: string[];
  readonly consoleLines: string[];
}

interface Harness extends Observed {
  readonly sockets: StubSocketFactory;
  readonly config: ChatClientConfig;
}

function harness(overrides: Partial<ChatClientConfig> = {}): Harness {
  const sockets = new StubSocketFactory();
  const logLines: string[] = [];
  const consoleLines: string[] = [];
  const stateAndEvents: string[] = [];

  const record = (parts: unknown[]): string =>
    parts
      .map((p) => {
        if (typeof p === 'string') return p;
        try {
          return JSON.stringify(p) ?? String(p);
        } catch {
          return String(p);
        }
      })
      .join(' ');

  const config: ChatClientConfig = {
    publishableKey: 'dhp' + '_test_guard4key',
    wsUrl: 'wss://example.test/chat-services/v2/ws',
    getToken: () => Promise.resolve(ACCESS_TOKEN),
    localSender: { senderId: 'participant_customer_1', senderType: 'CUSTOMER' },
    history: {
      listMessages: () => Promise.resolve({ messages: [], hasMore: false }),
    },
    logger: (level, message, meta) => {
      logLines.push(record([level, message, meta]));
    },
    webSocketFactory: sockets.create,
    ...overrides,
  };

  return {
    sockets,
    config,
    logLines,
    consoleLines,
    text: () => [...logLines, ...consoleLines, ...stateAndEvents].join('\n'),
  };
}

/** Captures `console.warn`/`error` — where core's DEFAULT logger writes. */
function captureConsole(sink: string[]): () => void {
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    sink.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
  const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    sink.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
  return () => {
    warn.mockRestore();
    error.mockRestore();
  };
}

async function tick(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function ackJson(): unknown {
  return {
    v: 1,
    t: 'connection.ack',
    id: ULID,
    ts: 0,
    d: {
      protocolVersion: 1,
      seq: 0,
      session: {
        sessionId: 'session_1',
        status: 'ASSIGNED',
        mode: 'HUMAN',
        participants: [{ participantId: 'participant_customer_1', type: 'CUSTOMER' }],
        createdAt: '2026-08-18T09:00:00.000Z',
      },
    },
  };
}

/** Everything a client exposes to its host, rendered as searchable text. */
function observableOf(client: ReturnType<typeof createChatClient>): string {
  try {
    return JSON.stringify(client.getState()) ?? '';
  } catch {
    return String(client.getState());
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('§14 guard: the sentinel search itself works', () => {
  // Without this, every `not.toContain` below passes for a harness that
  // captured nothing at all — the exact shape of a test that asserts nothing.

  it('finds a sentinel that a logger really was given', () => {
    const h = harness();
    h.config.logger?.('warn', `leaked ${ACCESS_TOKEN}`, { content: MESSAGE_CONTENT });
    expect(h.text()).toContain(ACCESS_TOKEN);
    expect(h.text()).toContain(MESSAGE_CONTENT);
  });

  it('finds a sentinel written to the captured console', () => {
    const lines: string[] = [];
    const restore = captureConsole(lines);
    console.warn('leaked', HOST_ERROR_TOKEN);
    restore();
    expect(lines.join('\n')).toContain(HOST_ERROR_TOKEN);
  });
});

describe('§14 guard: a full connect + send + receive cycle logs no credential', () => {
  it('leaks nothing through logger, console, or state across a real session', async () => {
    const h = harness();
    const restore = captureConsole(h.consoleLines);

    try {
      const client = createChatClient(h.config);
      const events: string[] = [];
      for (const name of ['error', 'message', 'sendFailed', 'connected'] as const) {
        client.on(name, (payload: unknown) => {
          events.push(JSON.stringify({ name, payload }) ?? '');
        });
      }

      const connecting = client.connect();
      await tick();
      h.sockets.last.open();
      h.sockets.last.emitJson(ackJson());
      await connecting;

      await Promise.race([client.sendMessage(MESSAGE_CONTENT), tick()]);
      await tick();

      // Inbound frames the transport must LOG and DROP: malformed, but
      // carrying both a token and private content in their payload. This is
      // the path `frameLogContext`'s allowlist exists for.
      h.sockets.last.emitJson({
        v: 1,
        t: 'message.new',
        id: 'not-a-ulid',
        ts: 0,
        d: { token: ACCESS_TOKEN, content: INBOUND_CONTENT, publishableKey: 'dhk' + '_live_secret' },
      });
      h.sockets.last.emitJson({ garbage: true, token: ACCESS_TOKEN, content: INBOUND_CONTENT });
      h.sockets.last.emitJson('not json at all ' + ACCESS_TOKEN);
      await tick();

      const logs = [...h.logLines, ...h.consoleLines].join('\n');
      const everything = [logs, events.join('\n'), observableOf(client)].join('\n');

      // The transport really did log, and really did log about the frames
      // carrying the sentinels. Without this the leak checks below would pass
      // just as well against an empty log.
      expect(h.logLines.length + h.consoleLines.length).toBeGreaterThan(0);
      expect(logs).toMatch(/dropped malformed inbound frame/);

      for (const [label, sentinel] of CREDENTIAL_SENTINELS) {
        expect(everything, `${label} escaped into host-visible output`).not.toContain(sentinel);
      }

      for (const [label, sentinel] of CONTENT_SENTINELS) {
        expect(logs, `${label} escaped into a log line`).not.toContain(sentinel);
      }
    } finally {
      restore();
    }
  });

  it('delivers the message content it refuses to log, so the guard above is not vacuous', async () => {
    // Chesterton's fence for excluding state from the content check: content
    // really is in `ChatState.messages`, which is why finding it absent from
    // the logs is a fact about the logs.
    const h = harness();
    const client = createChatClient(h.config);

    const connecting = client.connect();
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson());
    await connecting;

    await Promise.race([client.sendMessage(MESSAGE_CONTENT), tick()]);
    await tick();

    expect(observableOf(client)).toContain(MESSAGE_CONTENT);
    expect(h.logLines.join('\n')).not.toContain(MESSAGE_CONTENT);
  });
});

describe('§14 guard: host-authored error text is scrubbed before core re-emits it', () => {
  // The §14 motivating case, stated in auth/redact.ts: `getToken()` is the
  // host's code, HTTP clients embed the request in error messages, and a
  // customer's 401 can therefore hand core a live token — which core would
  // otherwise write to `lastError` and emit as the §6.5 `error` event, i.e.
  // straight into their error tracker.

  it('leaks nothing when getToken() rejects with an error containing a bearer token', async () => {
    const h = harness({
      getToken: () =>
        Promise.reject(
          new Error(
            `Request failed: GET https://id.example.test/token ` +
              `401 {"authorization":"Bearer ${HOST_ERROR_TOKEN}"}`,
          ),
        ),
    });
    const restore = captureConsole(h.consoleLines);

    try {
      const client = createChatClient(h.config);
      const events: string[] = [];
      client.on('error', (payload: unknown) => {
        events.push(JSON.stringify(payload) ?? '');
      });

      await Promise.race([client.connect(), tick()]);
      await tick();

      const observed = [h.text(), events.join('\n'), observableOf(client)].join('\n');

      // The failure really did surface somewhere — a client that silently
      // swallowed the error would pass the leak check for the wrong reason.
      expect(observed).toMatch(/getToken\(\) failed/);
      expect(observed).not.toContain(HOST_ERROR_TOKEN);
      expect(observed).not.toContain(TOKEN_BODY);
      expect(observed).not.toContain('Bearer eyJ');
    } finally {
      restore();
    }
  });

  it('leaks nothing when getToken() rejects with a bare secret key in the text', async () => {
    const h = harness({
      getToken: () => Promise.reject(new Error(`token endpoint rejected ${'dhk' + '_live_'}${TOKEN_BODY}`)),
    });
    const restore = captureConsole(h.consoleLines);

    try {
      const client = createChatClient(h.config);
      await Promise.race([client.connect(), tick()]);
      await tick();

      const observed = [h.text(), observableOf(client)].join('\n');
      expect(observed).toMatch(/getToken\(\) failed/);
      expect(observed).not.toContain(TOKEN_BODY);
    } finally {
      restore();
    }
  });
});

describe('§14 guard: the default (unconfigured) logger leaks nothing either', () => {
  it('routes core warnings to console without credential material', async () => {
    // A host that never passes `logger` gets `consoleLogger`. That path shares
    // no code with the configured one at the call site, so a leak fixed in one
    // is not necessarily fixed in the other.
    const h = harness();
    const { logger: _logger, ...withoutLogger } = h.config;
    const restore = captureConsole(h.consoleLines);

    try {
      const client = createChatClient(withoutLogger as ChatClientConfig);
      const connecting = client.connect();
      await tick();
      h.sockets.last.open();
      h.sockets.last.emitJson(ackJson());
      await connecting;

      h.sockets.last.emitJson({
        v: 1,
        t: 'message.new',
        id: 'not-a-ulid',
        ts: 0,
        d: { token: ACCESS_TOKEN, content: INBOUND_CONTENT },
      });
      await tick();

      expect(h.consoleLines.length).toBeGreaterThan(0);
      const logs = h.consoleLines.join('\n');
      expect(logs).toMatch(/dropped malformed inbound frame/);

      for (const [label, sentinel] of [...CREDENTIAL_SENTINELS, ...CONTENT_SENTINELS]) {
        expect(logs, `${label} escaped via the default console logger`).not.toContain(sentinel);
      }
      expect(observableOf(client)).not.toContain(ACCESS_TOKEN);
    } finally {
      restore();
    }
  });
});

describe('§14 guard: the token core sends on the wire never reaches a log', () => {
  it('puts the token in the hello frame but in nothing observable', async () => {
    const h = harness();
    const restore = captureConsole(h.consoleLines);

    try {
      const client = createChatClient(h.config);
      const connecting = client.connect();
      await tick();
      h.sockets.last.open();
      h.sockets.last.emitJson(ackJson());
      await connecting;

      // Anchors the whole file: the token IS present in what core sends, so
      // "not found in the logs" is a real finding about the logs rather than a
      // statement that the token was never in play.
      expect(h.sockets.last.sent.join('\n')).toContain(ACCESS_TOKEN);

      expect([h.text(), observableOf(client)].join('\n')).not.toContain(ACCESS_TOKEN);
    } finally {
      restore();
    }
  });
});
