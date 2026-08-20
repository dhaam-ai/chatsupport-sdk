import { describe, expect, it } from 'vitest';

import { RestApiError } from './errors.js';
import {
  UNSUPPORTED_MESSAGE_MARKER,
  isAttachmentMetadata,
  projectHistoryRow,
  projectSessionSummaryRow,
  toChatMessage,
  toChatSession,
  toChatSessionSummary,
} from './projection.js';

/** A raw row as the REST path actually returns it — Prisma output, unprojected. */
function messageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    chatSessionId: 's1',
    senderId: 'cust-1',
    senderType: 1,
    messageType: 1,
    content: 'hello',
    metadata: null,
    replyToMessageId: null,
    createdAt: '2026-08-19T10:00:00.000Z',
    seq: 7,
    ...overrides,
  };
}

function sessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    tenantId: 't1',
    customerId: 'cust-1',
    assignedAgentId: 'agent-9',
    ticketId: null,
    mode: 2,
    status: 3,
    priority: 2,
    closedAt: null,
    createdAt: '2026-08-19T09:00:00.000Z',
    updatedAt: '2026-08-19T09:30:00.000Z',
    ...overrides,
  };
}

describe('toChatMessage — integer enums (C)', () => {
  it.each([
    [1, 'CUSTOMER'],
    [2, 'AGENT'],
    [3, 'BOT'],
    [4, 'SYSTEM'],
  ] as const)('decodes senderType %i to %s', (int, name) => {
    expect(toChatMessage(messageRow({ senderType: int })).senderType).toBe(name);
  });

  it.each([
    [1, 'TEXT'],
    [2, 'SYSTEM'],
    [3, 'FILE'],
    [4, 'IMAGE'],
    [5, 'VIDEO'],
    [6, 'AUDIO'],
    [7, 'TYPING'],
  ] as const)('decodes messageType %i to %s', (int, name) => {
    expect(toChatMessage(messageRow({ messageType: int })).type).toBe(name);
  });

  it('rejects an unmappable senderType rather than guessing a default', () => {
    // Guessing would attribute an agent's message to the customer reading it.
    expect(() => toChatMessage(messageRow({ senderType: 9 }))).toThrow(RestApiError);
    expect(() => toChatMessage(messageRow({ senderType: 'CUSTOMER' }))).toThrow(RestApiError);
  });

  it('rejects an unmappable messageType', () => {
    expect(() => toChatMessage(messageRow({ messageType: 0 }))).toThrow(RestApiError);
  });
});

describe('toChatMessage — field renames (E)', () => {
  it('renames chatSessionId to sessionId and messageType to type', () => {
    const message = toChatMessage(messageRow());

    expect(message.sessionId).toBe('s1');
    expect(message.type).toBe('TEXT');
    expect(message).not.toHaveProperty('chatSessionId');
    expect(message).not.toHaveProperty('messageType');
  });

  it('drops replyToMessage, the nested parent copy core does not model', () => {
    const message = toChatMessage(
      messageRow({
        replyToMessageId: 'm0',
        replyToMessage: { id: 'm0', content: 'earlier', senderType: 2, messageType: 1 },
      }),
    );

    expect(message.replyToMessageId).toBe('m0');
    expect(message).not.toHaveProperty('replyToMessage');
  });

  it('substitutes an empty senderId for a system message that has none', () => {
    expect(toChatMessage(messageRow({ senderType: 4, senderId: null })).senderId).toBe('');
  });

  it('omits seq for a row that predates sequencing rather than failing the page', () => {
    const message = toChatMessage(messageRow({ seq: null }));

    expect('seq' in message).toBe(false);
  });

  it('normalizes createdAt to ISO-8601 whether it arrives as a string or a Date', () => {
    expect(toChatMessage(messageRow()).createdAt).toBe('2026-08-19T10:00:00.000Z');
    expect(toChatMessage(messageRow({ createdAt: new Date(0) })).createdAt).toBe(
      '1970-01-01T00:00:00.000Z',
    );
  });

  it.each([
    ['id is missing', { id: undefined }],
    ['chatSessionId is missing', { chatSessionId: undefined }],
    ['createdAt is unparseable', { createdAt: 'not a date' }],
  ])('rejects a row where %s', (_label, overrides) => {
    expect(() => toChatMessage(messageRow(overrides))).toThrow(RestApiError);
  });

  it('rejects a non-object row', () => {
    expect(() => toChatMessage(null)).toThrow(RestApiError);
    expect(() => toChatMessage([messageRow()])).toThrow(RestApiError);
  });
});

describe('toChatMessage — attachments buried in metadata (D)', () => {
  const attachment = {
    url: 'https://cdn.example.test/cat.png',
    fileName: 'cat.png',
    mimeType: 'image/png',
    size: 1024,
    mediaType: 'IMAGE',
  };

  it('lifts metadata.attachment to the top level', () => {
    // Without this every reloaded image loses its attachment: the REST history
    // service does no metadata handling at all (message.service.ts:285-296).
    const message = toChatMessage(messageRow({ messageType: 4, metadata: { attachment } }));

    expect(message.attachment).toEqual(attachment);
  });

  it('strips the attachment from the metadata it keeps', () => {
    const message = toChatMessage(
      messageRow({ metadata: { attachment, source: 'web', locale: 'en' } }),
    );

    expect(message.attachment).toEqual(attachment);
    expect(message.metadata).toEqual({ source: 'web', locale: 'en' });
  });

  it('leaves metadata absent when the attachment was all it held', () => {
    // An empty object would be a second, contradictory answer to "is there
    // metadata?" — the ambiguity D4 exists to remove.
    const message = toChatMessage(messageRow({ metadata: { attachment } }));

    expect('metadata' in message).toBe(false);
  });

  it('keeps metadata that has no attachment in it', () => {
    const message = toChatMessage(messageRow({ metadata: { source: 'web' } }));

    expect(message.metadata).toEqual({ source: 'web' });
    expect('attachment' in message).toBe(false);
  });

  it.each([
    ['null', null],
    ['absent', undefined],
    ['an empty object', {}],
  ])('leaves both fields absent when metadata is %s', (_label, metadata) => {
    const message = toChatMessage(messageRow({ metadata }));

    expect('attachment' in message).toBe(false);
    expect('metadata' in message).toBe(false);
  });

  // The row's declared type is `Record<string, unknown> | null`
  // (shared/types/index.ts:105) and every write path stores a plain object
  // (message.service.ts:71,203,245 all coerce to `{}` or spread an object) —
  // but the column itself is Prisma `Json?` (schema.prisma:70), which places
  // no runtime constraint narrower than "valid JSON" on what a row can hold.
  // A value written by something other than this service's own write path
  // (a migration, a direct DB fixup, a future producer) could leave a scalar
  // or array in the column, and Prisma's client hands JSON columns back
  // already deserialized — never a string requiring a second `JSON.parse` —
  // so a string here specifically means "the JSON value stored WAS a string",
  // not "an unparsed JSON payload". Either way this must degrade to no
  // attachment and no metadata rather than throw: one malformed legacy row
  // failing an entire history page is a worse outcome than it losing its own
  // metadata, the same tradeoff `seq` omission makes above.
  it.each([
    ['a JSON-encoded string', '{"attachment":{"url":"x"}}'],
    ['an array', ['not', 'an', 'object']],
  ])('leaves both fields absent when metadata is %s rather than an object', (_label, metadata) => {
    const message = toChatMessage(messageRow({ metadata }));

    expect('attachment' in message).toBe(false);
    expect('metadata' in message).toBe(false);
  });
});

describe('attachment validation (forged metadata.attachment)', () => {
  // Reachable: chat-service validates an inbound message.send attachment only
  // when the field is TOP-LEVEL, so a forged d.metadata.attachment is persisted
  // unvalidated and comes back on the next history load.
  const good = {
    url: 'https://cdn.example.test/cat.png',
    fileName: 'cat.png',
    mimeType: 'image/png',
    size: 1024,
    mediaType: 'IMAGE',
  };

  it.each([
    ['a javascript: url', { ...good, url: 'javascript:fetch("//evil")' }],
    ['a data: url', { ...good, url: 'data:text/html,<script>1</script>' }],
    ['a blob: url', { ...good, url: 'blob:https://evil.test/abc' }],
    ['a protocol-relative url', { ...good, url: '//attacker.example/b' }],
    ['a non-string url', { ...good, url: 123 }],
    ['no url at all', { fileName: 'a', mimeType: 'b', size: 1, mediaType: 'IMAGE' }],
    ['an empty fileName', { ...good, fileName: '' }],
    ['a missing mimeType', { ...good, mimeType: undefined }],
    ['a non-finite size', { ...good, size: Number.NaN }],
    ['a string size', { ...good, size: '1024' }],
    ['an empty mediaType', { ...good, mediaType: '' }],
    ['an array', [good]],
    ['a string', 'https://cdn.example.test/cat.png'],
    ['null', null],
  ])('drops an attachment with %s', (_label, attachment) => {
    const message = toChatMessage(messageRow({ metadata: { attachment } }));

    expect('attachment' in message).toBe(false);
    // And it must not survive by the back door either.
    expect('metadata' in message).toBe(false);
  });

  it('drops the bad attachment without failing the row', () => {
    // Dropping, not throwing — consistent with tolerating a row that predates
    // sequencing. One forged attachment must not cost the customer the message.
    const message = toChatMessage(
      messageRow({ content: 'look at this', metadata: { attachment: { url: 'javascript:1' } } }),
    );

    expect(message.id).toBe('m1');
    expect(message.content).toBe('look at this');
  });

  it('accepts a well-formed https attachment', () => {
    expect(toChatMessage(messageRow({ metadata: { attachment: good } })).attachment).toEqual(good);
  });

  it('rebuilds the attachment, dropping unvalidated extra keys', () => {
    const message = toChatMessage(
      messageRow({
        metadata: { attachment: { ...good, __proto__: { polluted: true }, extra: 'ignored' } },
      }),
    );

    expect(message.attachment).toEqual(good);
    expect(Object.getOwnPropertyNames(message.attachment)).toEqual([
      'url',
      'fileName',
      'mimeType',
      'size',
      'mediaType',
    ]);
  });

  it('exposes the predicate so a hand-written adapter can reuse it', () => {
    expect(isAttachmentMetadata(good)).toBe(true);
    expect(isAttachmentMetadata({ ...good, url: 'javascript:1' })).toBe(false);
  });
});

describe('metadata prototype-pollution keys', () => {
  // JSON.parse makes __proto__ an OWN property, unlike an object literal, so a
  // response body really can carry one this far.
  const polluted = JSON.parse(
    '{"__proto__":{"isAdmin":true},"constructor":{"x":1},"prototype":{"y":2},"source":"web"}',
  ) as Record<string, unknown>;

  it('excludes __proto__, constructor and prototype from the published bag', () => {
    const message = toChatMessage(messageRow({ metadata: polluted }));

    expect(Object.getOwnPropertyNames(message.metadata)).toEqual(['source']);
    expect(message.metadata).toEqual({ source: 'web' });
  });

  it('leaves metadata absent when the unsafe keys were all it held', () => {
    const onlyUnsafe = JSON.parse('{"__proto__":{"isAdmin":true}}') as Record<string, unknown>;

    expect('metadata' in toChatMessage(messageRow({ metadata: onlyUnsafe }))).toBe(false);
  });

  it('does not detach the prototype of anything it produces', () => {
    const message = toChatMessage(messageRow({ metadata: polluted }));

    expect(Object.getPrototypeOf(message.metadata)).toBe(Object.prototype);
    expect(({} as { isAdmin?: boolean }).isAdmin).toBeUndefined();
  });
});

describe('projectHistoryRow — one bad row must not cost a page', () => {
  it('projects a good row exactly as toChatMessage does', () => {
    expect(projectHistoryRow(messageRow())).toEqual(toChatMessage(messageRow()));
  });

  it('returns a placeholder for an undecodable senderType', () => {
    const message = projectHistoryRow(messageRow({ senderType: 99 }));

    expect(message).toEqual({
      id: 'm1',
      sessionId: 's1',
      senderId: '',
      senderType: 'SYSTEM',
      type: 'SYSTEM',
      content: '',
      createdAt: '2026-08-19T10:00:00.000Z',
      seq: 7,
      metadata: { [UNSUPPORTED_MESSAGE_MARKER]: true },
    });
  });

  it('returns a placeholder for an undecodable messageType', () => {
    // The sender decoded here, but the placeholder still says SYSTEM: naming an
    // author is the misattribution risk decode() throws to avoid, and
    // understating a known sender is the safe direction to be wrong in.
    const message = projectHistoryRow(messageRow({ senderType: 2, messageType: 42 }));

    expect(message).toMatchObject({ senderType: 'SYSTEM', type: 'SYSTEM', senderId: '' });
  });

  it('never claims an author it could not decode', () => {
    const message = projectHistoryRow(messageRow({ senderType: 99, senderId: 'agent-9' }));

    expect(message?.senderId).toBe('');
    expect(message?.senderType).toBe('SYSTEM');
  });

  it('drops the content of a message whose type it does not understand', () => {
    // A future card format's payload rendered as raw prose is worse than a notice.
    const message = projectHistoryRow(
      messageRow({ messageType: 42, content: '{"card":{"v":2,"blocks":[]}}' }),
    );

    expect(message?.content).toBe('');
  });

  it('discards the metadata of a row it could not decode', () => {
    const message = projectHistoryRow(
      messageRow({ senderType: 99, metadata: { source: 'web', attachment: { url: 'javascript:1' } } }),
    );

    expect(message?.metadata).toEqual({ [UNSUPPORTED_MESSAGE_MARKER]: true });
    expect('attachment' in (message ?? {})).toBe(false);
  });

  it.each([
    ['no id', { id: undefined }],
    ['no chatSessionId', { chatSessionId: undefined }],
    ['an unparseable createdAt', { createdAt: 'nope' }],
  ])('returns null when a placeholder would have %s to key or order by', (_label, overrides) => {
    expect(projectHistoryRow(messageRow({ senderType: 99, ...overrides }))).toBeNull();
  });

  it('returns null for a row that is not an object at all', () => {
    expect(projectHistoryRow(null)).toBeNull();
    expect(projectHistoryRow('nope')).toBeNull();
  });

  it('omits seq when the undecodable row had none', () => {
    const message = projectHistoryRow(messageRow({ senderType: 99, seq: null }));

    expect(message).not.toBeNull();
    expect('seq' in (message ?? {})).toBe(false);
  });
});

describe('toChatSession', () => {
  it('decodes the integer status and mode', () => {
    expect(toChatSession(sessionRow({ status: 1, mode: 1 }))).toMatchObject({
      status: 'OPEN',
      mode: 'BOT',
    });
    expect(toChatSession(sessionRow({ status: 6, mode: 2 }))).toMatchObject({
      status: 'ON_HOLD',
      mode: 'HUMAN',
    });
  });

  it.each([
    [1, 'OPEN'],
    [2, 'WAITING_FOR_AGENT'],
    [3, 'ASSIGNED'],
    [4, 'CLOSED'],
    [5, 'RESOLVED'],
    [6, 'ON_HOLD'],
  ] as const)('decodes status %i to %s', (int, name) => {
    expect(toChatSession(sessionRow({ status: int })).status).toBe(name);
  });

  it('rejects an unmappable status or mode', () => {
    expect(() => toChatSession(sessionRow({ status: 99 }))).toThrow(RestApiError);
    expect(() => toChatSession(sessionRow({ mode: 0 }))).toThrow(RestApiError);
  });

  it('synthesizes participantId from the outer row, which enrichment omits', () => {
    // enrichSessionWithUsers returns {displayName,email,avatarUrl,isOnline} and
    // no id, but core keys presence and read watermarks by participantId.
    const session = toChatSession(
      sessionRow({
        assignedAgent: { displayName: 'Ada', email: 'ada@x.test', avatarUrl: null, isOnline: true },
        customer: { displayName: 'Bob', email: null, avatarUrl: 'https://x.test/b.png' },
      }),
    );

    expect(session.assignedAgent).toEqual({
      participantId: 'agent-9',
      displayName: 'Ada',
      email: null,
      avatarUrl: null,
    });
    expect(session.customer).toEqual({
      participantId: 'cust-1',
      displayName: 'Bob',
      email: null,
      avatarUrl: 'https://x.test/b.png',
    });
  });

  it('never copies an email into ChatState, even when /full returns one', () => {
    // The WS path always wrote null and nothing in the SDK renders this. The
    // widget runs inside third-party pages whose session-replay tools serialize
    // application state wholesale.
    const session = toChatSession(
      sessionRow({
        assignedAgent: { displayName: 'Ada', email: 'ada@private.test', avatarUrl: null },
        customer: { displayName: 'Bob', email: 'bob@private.test', avatarUrl: null },
      }),
    );

    expect(session.assignedAgent?.email).toBeNull();
    expect(session.customer?.email).toBeNull();
    expect(JSON.stringify(session)).not.toContain('private.test');
  });

  it('returns a null profile when there is no id to correlate presence by', () => {
    const session = toChatSession(
      sessionRow({
        assignedAgentId: null,
        assignedAgent: { displayName: 'Ghost', email: null, avatarUrl: null },
      }),
    );

    expect(session.assignedAgent).toBeNull();
  });

  it('returns a null profile when enrichment found no user', () => {
    // chat-user.service swallows its own failure and leaves these null.
    expect(toChatSession(sessionRow({ assignedAgent: null, customer: null })).customer).toBeNull();
  });

  it('maps the bare ticketId onto core ChatTicket shape', () => {
    expect(toChatSession(sessionRow({ ticketId: 'TICK-1' })).ticket).toEqual({
      id: 'TICK-1',
      url: null,
    });
    expect(toChatSession(sessionRow({ ticketId: null })).ticket).toBeNull();
  });

  it('keeps closedAt null while the session is open and ISO once it is closed', () => {
    expect(toChatSession(sessionRow()).closedAt).toBeNull();
    expect(
      toChatSession(sessionRow({ status: 4, closedAt: '2026-08-19T11:00:00.000Z' })).closedAt,
    ).toBe('2026-08-19T11:00:00.000Z');
  });

  it('drops row fields core does not model', () => {
    const session = toChatSession(sessionRow());

    expect(Object.keys(session).sort()).toEqual([
      'assignedAgent',
      'closedAt',
      'createdAt',
      'customer',
      'id',
      'mode',
      'status',
      'ticket',
    ]);
  });
});

/** A `sessions[]` item as `GET /chat/sessions/customer` actually returns it (v2 string enums). */
function sessionSummaryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sum-1',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    createdAt: '2026-08-19T09:00:00.000Z',
    closedAt: null,
    lastMessageAt: '2026-08-19T09:05:00.000Z',
    lastMessagePreview: 'here you go',
    unreadCount: 3,
    handledBy: { kind: 'AGENT', id: 'agent-9', displayName: 'Ada' },
    ...overrides,
  };
}

describe('toChatSessionSummary — string enums (already v2-projected)', () => {
  it.each([
    'OPEN',
    'WAITING_FOR_AGENT',
    'ASSIGNED',
    'CLOSED',
    'RESOLVED',
    'ON_HOLD',
  ] as const)('accepts status %s verbatim', (status) => {
    expect(toChatSessionSummary(sessionSummaryRow({ status })).status).toBe(status);
  });

  it.each(['BOT', 'HUMAN'] as const)('accepts mode %s verbatim', (mode) => {
    expect(toChatSessionSummary(sessionSummaryRow({ mode })).mode).toBe(mode);
  });

  it('rejects an unmappable status or mode rather than guessing', () => {
    expect(() => toChatSessionSummary(sessionSummaryRow({ status: 'BOGUS' }))).toThrow(RestApiError);
    expect(() => toChatSessionSummary(sessionSummaryRow({ mode: 'BOGUS' }))).toThrow(RestApiError);
    // The raw-row integer form must not sneak through either — this route
    // already sends v2 strings, so a stray integer is exactly as unmappable.
    expect(() => toChatSessionSummary(sessionSummaryRow({ status: 3 }))).toThrow(RestApiError);
  });
});

describe('toChatSessionSummary — full mapping', () => {
  it('parses every field, including handledBy', () => {
    expect(toChatSessionSummary(sessionSummaryRow())).toEqual({
      id: 'sum-1',
      status: 'ASSIGNED',
      mode: 'HUMAN',
      createdAt: '2026-08-19T09:00:00.000Z',
      closedAt: null,
      lastMessageAt: '2026-08-19T09:05:00.000Z',
      lastMessagePreview: 'here you go',
      unreadCount: 3,
      handledBy: { kind: 'AGENT', id: 'agent-9', displayName: 'Ada' },
    });
  });

  it('parses a BOT handledBy the same way as an AGENT one', () => {
    const summary = toChatSessionSummary(
      sessionSummaryRow({ handledBy: { kind: 'BOT', id: 'bot', displayName: 'Assistant' } }),
    );
    expect(summary.handledBy).toEqual({ kind: 'BOT', id: 'bot', displayName: 'Assistant' });
  });

  it('keeps optional fields absent, not undefined-valued or null, when the wire omits them', () => {
    const row = sessionSummaryRow();
    delete row['lastMessagePreview'];
    delete row['handledBy'];

    const summary = toChatSessionSummary(row);

    expect('lastMessagePreview' in summary).toBe(false);
    expect('handledBy' in summary).toBe(false);
    expect(Object.keys(summary).sort()).toEqual([
      'closedAt',
      'createdAt',
      'id',
      'lastMessageAt',
      'mode',
      'status',
      'unreadCount',
    ]);
  });

  it('treats an empty-string lastMessagePreview as absent, same as replyToMessageId', () => {
    expect(toChatSessionSummary(sessionSummaryRow({ lastMessagePreview: '' })).lastMessagePreview).toBeUndefined();
  });

  it('keeps closedAt and lastMessageAt null rather than treating null as a parse failure', () => {
    const summary = toChatSessionSummary(sessionSummaryRow({ closedAt: null, lastMessageAt: null }));
    expect(summary.closedAt).toBeNull();
    expect(summary.lastMessageAt).toBeNull();
  });

  it('requires unreadCount as a non-negative number', () => {
    expect(() => toChatSessionSummary(sessionSummaryRow({ unreadCount: -1 }))).toThrow(RestApiError);
    expect(() => toChatSessionSummary(sessionSummaryRow({ unreadCount: '3' }))).toThrow(RestApiError);
    expect(() => toChatSessionSummary({ ...sessionSummaryRow(), unreadCount: undefined })).toThrow(
      RestApiError,
    );
  });

  it('accepts unreadCount: 0 as a normal, present value', () => {
    expect(toChatSessionSummary(sessionSummaryRow({ unreadCount: 0 })).unreadCount).toBe(0);
  });

  it('drops a malformed handledBy rather than failing the whole summary', () => {
    // handledBy is additive information the picker does not depend on — a bad
    // one should not cost the rest of an otherwise-good row.
    const summary = toChatSessionSummary(sessionSummaryRow({ handledBy: { kind: 'AGENT' } }));
    expect(summary.handledBy).toBeUndefined();
    expect(summary.id).toBe('sum-1');
  });

  it('rejects a handledBy with an unrecognized kind the same way', () => {
    const summary = toChatSessionSummary(
      sessionSummaryRow({ handledBy: { kind: 'CUSTOMER', id: 'x', displayName: 'x' } }),
    );
    expect(summary.handledBy).toBeUndefined();
  });
});

describe('projectSessionSummaryRow', () => {
  it('keeps every good row when one row cannot be decoded', () => {
    // Mirrors projectHistoryRow's contract: one forward-incompatible status
    // must cost that one session, not the customer's entire picker.
    const rows = [
      sessionSummaryRow({ id: 's1' }),
      sessionSummaryRow({ id: 's2', status: 'BOGUS' }),
      sessionSummaryRow({ id: 's3' }),
    ];

    const projected = rows.map(projectSessionSummaryRow);

    expect(projected.map((s) => s?.id)).toEqual(['s1', undefined, 's3']);
    expect(projected[1]).toBeNull();
  });

  it('returns the same value as toChatSessionSummary for a good row', () => {
    expect(projectSessionSummaryRow(sessionSummaryRow())).toEqual(
      toChatSessionSummary(sessionSummaryRow()),
    );
  });
});
