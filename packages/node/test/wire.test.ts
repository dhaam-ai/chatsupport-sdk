// The wire format: the `{ success, data }` envelope and the raw Prisma row.
//
// These are the two disagreements between what this package DECLARED and what
// the service actually sends. Both were silent: the envelope made history come
// back empty, and the un-lifted `metadata.attachment` made every reloaded image
// lose its file. Neither threw. Each test below pins one of them.

import { describe, expect, it } from 'vitest';
import { ChatApiError } from '../src/errors.js';
import { normalizeMediaType, toChatMessage, toMessagePage, unwrapEnvelope } from '../src/wire.js';

/** A raw row as Prisma hands it to the route — integer enums, nested attachment. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_1',
    chatSessionId: 'sess_1',
    senderType: 1,
    senderId: 'user_1',
    messageType: 1,
    content: 'hello',
    createdAt: '2026-08-18T10:00:00.000Z',
    ...overrides,
  };
}

describe('unwrapEnvelope', () => {
  it('returns data from a successful envelope', () => {
    const page = unwrapEnvelope<{ messages: unknown[]; hasMore: boolean }>(
      { success: true, data: { messages: [], hasMore: false } },
      'GET /chat/sessions/{sessionId}/messages',
    );
    expect(page).toEqual({ messages: [], hasMore: false });
  });

  it('rejects a bare body that is not enveloped', () => {
    // The shape this package used to expect. Accepting it now would mean
    // accepting a body no route sends.
    expect(() => unwrapEnvelope({ messages: [], hasMore: false }, 'route')).toThrow(ChatApiError);
  });

  it('rejects success: false, an absent data key, and a non-object data', () => {
    for (const body of [
      { success: false, data: {} },
      { success: true },
      { success: true, data: null },
      { success: true, data: 'nope' },
      // An array under `data` is rejected rather than passed through: no route
      // this package calls returns one, and one that did would be as broken
      // for the caller as a missing `data`.
      { success: true, data: [] },
      null,
      'not an object',
    ]) {
      expect(() => unwrapEnvelope(body, 'route')).toThrow(/did not return a \{ success: true, data \} envelope/);
    }
  });

  it('reports MALFORMED_RESPONSE as a non-retryable 200', () => {
    // The transport succeeded and the server reported no error — the body is
    // simply not what the route documents. No retry changes a response shape.
    try {
      unwrapEnvelope({ success: true }, 'route');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ChatApiError);
      expect((error as ChatApiError).code).toBe('MALFORMED_RESPONSE');
      expect((error as ChatApiError).status).toBe(200);
      expect((error as ChatApiError).retryable).toBe(false);
    }
  });

  it('never echoes the response body into the error message', () => {
    // Rows on this service carry customer message bodies and signed attachment
    // URLs (§14), and an error from this package is one console.error away
    // from an error tracker.
    const secretish = 'https://s3.example.com/f.png?X-Amz-Signature=deadbeef';
    try {
      unwrapEnvelope({ success: true, data: secretish }, 'GET /chat/sessions/{sessionId}/messages');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(secretish);
      expect((error as Error).message).not.toContain('deadbeef');
    }
  });
});

describe('integer enum decoding', () => {
  it('maps every senderType the service defines', () => {
    // Pinned as literals against shared/constants/enums.ts:29-34. Renumbering
    // one of these misattributes an agent's message to the customer reading it.
    const expected = { 1: 'CUSTOMER', 2: 'AGENT', 3: 'BOT', 4: 'SYSTEM' } as const;
    for (const [int, name] of Object.entries(expected)) {
      expect(toChatMessage(row({ senderType: Number(int) })).senderType).toBe(name);
    }
  });

  it('maps every messageType the service defines', () => {
    // Pinned as literals against shared/constants/enums.ts:36-44.
    const expected = {
      1: 'TEXT',
      2: 'SYSTEM',
      3: 'FILE',
      4: 'IMAGE',
      5: 'VIDEO',
      6: 'AUDIO',
      7: 'TYPING',
    } as const;
    for (const [int, name] of Object.entries(expected)) {
      expect(toChatMessage(row({ messageType: Number(int) })).messageType).toBe(name);
    }
  });

  it('throws on an unmapped enum rather than guessing a default', () => {
    // The enums are append-only, so an unknown integer always means this
    // package is behind the service — a code change, not a fallback.
    expect(() => toChatMessage(row({ senderType: 99 }))).toThrow(/unmappable senderType/);
    expect(() => toChatMessage(row({ messageType: 99 }))).toThrow(/unmappable messageType/);
  });

  it('throws on a string enum name where an integer belongs', () => {
    // The row is raw. A string here means something else already projected it,
    // and silently accepting both shapes is how the two paths drift apart.
    expect(() => toChatMessage(row({ senderType: 'CUSTOMER' }))).toThrow(/unmappable senderType/);
  });
});

describe('attachment lifting', () => {
  const attachment = {
    url: 'https://s3.example.com/images/cat.png',
    fileName: 'cat.png',
    mimeType: 'image/png',
    size: 2048,
    mediaType: 'images',
  };

  it('lifts metadata.attachment to the top level', () => {
    // The bug this exists to prevent: the row nests it, this package declares
    // it top-level (types.ts:84), and without the lift every reloaded image
    // silently arrives with no attachment at all.
    const message = toChatMessage(row({ messageType: 4, metadata: { attachment } }));
    expect(message.attachment).toEqual({
      url: attachment.url,
      fileName: 'cat.png',
      mimeType: 'image/png',
      size: 2048,
      // Normalized from the S3 folder name the upload route reports.
      mediaType: 'IMAGE',
    });
  });

  it('strips the attachment from the metadata that survives', () => {
    // It must never appear in both places — that ambiguity is exactly what v1
    // clients had to defend against (§12.2).
    const message = toChatMessage(row({ metadata: { attachment, source: 'widget' } }));
    expect(message.metadata).toEqual({ source: 'widget' });
    expect(message.metadata).not.toHaveProperty('attachment');
  });

  it('omits metadata entirely when it held nothing but the attachment', () => {
    const message = toChatMessage(row({ metadata: { attachment } }));
    expect(message.metadata).toBeUndefined();
    expect('metadata' in message).toBe(false);
  });

  it('leaves attachment absent when there is none', () => {
    expect('attachment' in toChatMessage(row())).toBe(false);
    expect('attachment' in toChatMessage(row({ metadata: { source: 'widget' } }))).toBe(false);
    expect('attachment' in toChatMessage(row({ metadata: { attachment: null } }))).toBe(false);
  });

  it('drops an attachment with no url rather than surfacing a dead link', () => {
    const message = toChatMessage(row({ metadata: { attachment: { fileName: 'x.png' } } }));
    expect('attachment' in message).toBe(false);
  });

  it('coerces a stringified size, which survives the metadata JSON round trip', () => {
    const message = toChatMessage(row({ metadata: { attachment: { ...attachment, size: '2048' } } }));
    expect(message.attachment?.size).toBe(2048);
  });
});

describe('normalizeMediaType', () => {
  it('maps the S3 folder names the upload route reports', () => {
    // upload.routes.ts:172 sends s3-client's `mediaFolder` verbatim — lowercase
    // and mostly plural.
    expect(normalizeMediaType('images')).toBe('IMAGE');
    expect(normalizeMediaType('videos')).toBe('VIDEO');
    expect(normalizeMediaType('audio')).toBe('AUDIO');
    expect(normalizeMediaType('documents')).toBe('DOCUMENT');
  });

  it('leaves an already-correct name unchanged', () => {
    expect(normalizeMediaType('IMAGE')).toBe('IMAGE');
    expect(normalizeMediaType('VIDEO')).toBe('VIDEO');
  });

  it('falls back to DOCUMENT rather than throwing', () => {
    // Mirrors s3-client's own fallback for an unclassified MIME type. An
    // upload is not worth failing over a label.
    expect(normalizeMediaType('spreadsheets')).toBe('DOCUMENT');
    expect(normalizeMediaType(undefined)).toBe('DOCUMENT');
    expect(normalizeMediaType(42)).toBe('DOCUMENT');
  });
});

describe('field names and shape', () => {
  it('keeps the row\'s own field names, unlike the core-facing projection', () => {
    // @dhaam-ccrm/rest renames these to core's vocabulary (`sessionId`, `type`).
    // This package does not: its ChatMessage is transcribed from the OpenAPI
    // document, which keeps the column names.
    const message = toChatMessage(row());
    expect(message.chatSessionId).toBe('sess_1');
    expect(message.messageType).toBe('TEXT');
    expect(message).not.toHaveProperty('sessionId');
    expect(message).not.toHaveProperty('type');
  });

  it('carries the nested reply preview, decoding its integer senderType', () => {
    // The row's `replyToMessage` block selects {id, content, senderType,
    // senderId, messageType} (message.repository.ts:29-33), so its senderType
    // is an integer too. rest drops this block; this package models it.
    const message = toChatMessage(
      row({
        replyToMessageId: 'msg_0',
        replyToMessage: { id: 'msg_0', content: 'earlier', senderType: 2, messageType: 1 },
      }),
    );
    expect(message.replyToMessageId).toBe('msg_0');
    expect(message.replyToMessage).toEqual({ id: 'msg_0', content: 'earlier', senderType: 'AGENT' });
  });

  it('drops a malformed reply preview without failing the message', () => {
    // The preview is decoration on a message whose own content is intact.
    const message = toChatMessage(row({ replyToMessage: { id: 'msg_0', senderType: 99 } }));
    expect('replyToMessage' in message).toBe(false);
    expect(message.content).toBe('hello');
  });

  it('omits senderId for a SYSTEM message that has none', () => {
    const message = toChatMessage(row({ senderType: 4, senderId: null }));
    expect('senderId' in message).toBe(false);
  });

  it('normalizes a Date and an epoch timestamp to ISO-8601', () => {
    // The service returns real Dates on a cache miss and ISO strings on a
    // Redis cache hit (projection.ts:94-106). Both arrive here.
    const iso = '2026-08-18T10:00:00.000Z';
    expect(toChatMessage(row({ createdAt: new Date(iso) })).createdAt).toBe(iso);
    expect(toChatMessage(row({ createdAt: Date.parse(iso) })).createdAt).toBe(iso);
  });

  it('rejects a row missing the fields it cannot invent', () => {
    expect(() => toChatMessage(row({ id: undefined }))).toThrow(/missing message.id/);
    expect(() => toChatMessage(row({ chatSessionId: undefined }))).toThrow(/missing message.chatSessionId/);
    expect(() => toChatMessage(row({ createdAt: 'not a date' }))).toThrow(/unparseable message.createdAt/);
    expect(() => toChatMessage(null)).toThrow(/expected an object for a message row/);
    expect(() => toChatMessage([])).toThrow(/expected an object for a message row/);
  });

  it('never interpolates row content into a thrown message', () => {
    const signedUrl = 'https://s3.example.com/f.png?X-Amz-Signature=deadbeef';
    try {
      toChatMessage(row({ senderType: 99, content: 'my bank pin is 1234', metadata: { attachment: { url: signedUrl } } }));
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('1234');
      expect(message).not.toContain('deadbeef');
      expect(message).not.toContain(signedUrl);
    }
  });
});

describe('toMessagePage', () => {
  it('unwraps, validates and projects in one call', () => {
    const page = toMessagePage({
      success: true,
      data: { messages: [row(), row({ id: 'msg_2', senderType: 2 })], hasMore: true },
    });
    expect(page.hasMore).toBe(true);
    expect(page.messages.map((m) => m.senderType)).toEqual(['CUSTOMER', 'AGENT']);
  });

  it('reads a missing hasMore as "stop", never as "keep asking"', () => {
    // Coercing here would turn a truncated body into an unbounded request loop
    // inside a customer's backend.
    expect(toMessagePage({ success: true, data: { messages: [] } }).hasMore).toBe(false);
  });

  it('rejects an envelope whose data carries no messages array', () => {
    expect(() => toMessagePage({ success: true, data: { hasMore: false } })).toThrow(
      /without a messages array/,
    );
    expect(() => toMessagePage({ success: true, data: { messages: 'nope' } })).toThrow(
      /without a messages array/,
    );
  });
});
