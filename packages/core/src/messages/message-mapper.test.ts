import { describe, expect, it } from 'vitest';

import type { MessagePayload } from '../protocol/index.js';
import { messagePayloadToChatMessage } from './message-mapper.js';

function basePayload(overrides: Partial<MessagePayload> = {}): MessagePayload {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    sessionId: 's1',
    senderId: 'agent-1',
    senderType: 'AGENT',
    type: 'TEXT',
    content: 'hello',
    seq: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('messagePayloadToChatMessage', () => {
  it('maps sessionId to chatSessionId and type to messageType', () => {
    const message = messagePayloadToChatMessage(basePayload());

    expect(message.chatSessionId).toBe('s1');
    expect(message.messageType).toBe('TEXT');
  });

  it('carries id, senderId, senderType, content, createdAt through unchanged', () => {
    const message = messagePayloadToChatMessage(basePayload());

    expect(message.id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(message.senderId).toBe('agent-1');
    expect(message.senderType).toBe('AGENT');
    expect(message.content).toBe('hello');
    expect(message.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('defaults senderName and replyToMessage to null — the wire payload has no equivalent field', () => {
    const message = messagePayloadToChatMessage(basePayload());

    expect(message.senderName).toBeNull();
    expect(message.replyToMessage).toBeNull();
  });

  it('defaults attachment and replyToMessageId to null when absent', () => {
    const message = messagePayloadToChatMessage(basePayload());

    expect(message.attachment).toBeNull();
    expect(message.replyToMessageId).toBeNull();
  });

  it('carries replyToMessageId through when present', () => {
    const message = messagePayloadToChatMessage(basePayload({ replyToMessageId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' }));

    expect(message.replyToMessageId).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAW');
  });

  it('hoists metadata.attachment to the top-level attachment field', () => {
    const attachment = { url: 'https://x/y.png', fileName: 'y.png', mimeType: 'image/png', size: 10, mediaType: 'image' };
    const message = messagePayloadToChatMessage(basePayload({ metadata: { attachment } }));

    expect(message.attachment).toEqual(attachment);
  });

  it('does not leak the attachment key into the remaining metadata bag', () => {
    const attachment = { url: 'https://x/y.png', fileName: 'y.png', mimeType: 'image/png', size: 10, mediaType: 'image' };
    const message = messagePayloadToChatMessage(basePayload({ metadata: { attachment, custom: 'value' } }));

    expect(message.metadata).toEqual({ custom: 'value' });
    expect(message.metadata).not.toHaveProperty('attachment');
  });

  it('omits metadata entirely when nothing besides attachment was present', () => {
    const attachment = { url: 'https://x/y.png', fileName: 'y.png', mimeType: 'image/png', size: 10, mediaType: 'image' };
    const message = messagePayloadToChatMessage(basePayload({ metadata: { attachment } }));

    expect(message.metadata).toBeUndefined();
  });

  it('preserves arbitrary metadata when there is no attachment', () => {
    const message = messagePayloadToChatMessage(basePayload({ metadata: { intent: 'billing' } }));

    expect(message.metadata).toEqual({ intent: 'billing' });
  });
});
