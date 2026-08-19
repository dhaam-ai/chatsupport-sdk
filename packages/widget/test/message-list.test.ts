// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialChatState } from '@dhaam-ccrm/core';
import type { AttachmentMetadata, ChatMessage, ChatState } from '@dhaam-ccrm/core';

import { createMessageList } from '../src/ui/message-list.js';

const ME = 'cus_1';
const AGENT = 'agt_9';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    senderId: ME,
    senderType: 'CUSTOMER',
    type: 'TEXT',
    content: 'where is my order',
    createdAt: '2026-08-19T10:00:00.000Z',
    ...overrides,
  };
}

function state(overrides: Partial<ChatState> = {}): ChatState {
  return { ...createInitialChatState(), ...overrides };
}

function build() {
  const onRetry = vi.fn();
  const onLoadOlder = vi.fn();
  const view = createMessageList({ onRetry, onLoadOlder });
  // Attached so `getComputedStyle` and `scrollHeight` behave.
  document.body.append(view.log, view.liveRegion);
  return { view, onRetry, onLoadOlder };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('delivery ticks', () => {
  it('renders the tick core derives, with a text equivalent for every state', () => {
    const cases: Array<[Partial<ChatState>, Partial<ChatMessage>, string]> = [
      [{}, { delivery: { state: 'queued' } }, 'Sending'],
      [{}, { seq: 5 }, 'Sent'],
      [{ deliveredWatermarks: { [AGENT]: 5 } }, { seq: 5 }, 'Delivered'],
      [
        { readWatermarks: { [AGENT]: '2026-08-19T10:00:01.000Z' } },
        { seq: 5 },
        'Read',
      ],
    ];

    for (const [stateOverrides, messageOverrides, expected] of cases) {
      document.body.innerHTML = '';
      const { view } = build();
      const msg = message(messageOverrides);
      view.render(state({ ...stateOverrides, messages: [msg] }), ME);

      const row = view.log.querySelector('.dh-msg');
      // WCAG 1.4.1: colour alone cannot be the difference between "delivered"
      // and "read", so every tick carries the word.
      expect(row?.textContent).toContain(expected);
    }
  });

  it('shows no tick at all on someone else\'s message', () => {
    const { view } = build();
    view.render(
      state({ messages: [message({ id: 'm2', senderId: AGENT, senderType: 'AGENT', seq: 3 })] }),
      ME,
    );

    const tick = view.log.querySelector('.dh-tick');
    expect(tick?.textContent).toBe('');
    expect(view.log.querySelector('.dh-msg')?.textContent).not.toContain('Sent');
  });

  it('shows no tick when the local participant is unknown', () => {
    // core's conservative no-tick: guessing would make an agent-side embed
    // draw ticks on the customer's messages.
    const { view } = build();
    view.render(state({ messages: [message({ seq: 5 })] }), null);

    expect(view.log.querySelector('.dh-tick')?.textContent).toBe('');
  });

  it('does not treat presence as delivery', () => {
    // v1's actual bug: it drew the double tick when the other party was
    // connected. Connectivity is not delivery — a participant can be online
    // and not yet caught up.
    const { view } = build();
    view.render(
      state({
        messages: [message({ seq: 5 })],
        presence: { [AGENT]: { participantId: AGENT, status: 'ONLINE' } },
        deliveredWatermarks: {},
      }),
      ME,
    );

    expect(view.log.querySelector('.dh-msg')?.textContent).toContain('Sent');
    expect(view.log.querySelector('.dh-msg')?.textContent).not.toContain('Delivered');
  });

  it('offers a retry, and no tick, on a failed send', () => {
    const { view, onRetry } = build();
    view.render(
      state({ messages: [message({ delivery: { state: 'failed', reason: 'rejected' } })] }),
      ME,
    );

    const retry = view.log.querySelector<HTMLButtonElement>('.dh-retry');
    expect(retry?.hidden).toBe(false);
    // A tick would claim something untrue about a message that will never
    // arrive; `delivery.reason` plus a retry button is the right affordance.
    expect(view.log.querySelector('.dh-tick')?.textContent).toBe('');

    retry?.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('the live region', () => {
  it('stays silent on the first render, which is history loading', () => {
    const { view } = build();
    // INCOMING messages specifically. An earlier version of this test used our
    // own, which the "never announce your own message" rule suppresses anyway
    // — so it passed with the first-render guard deleted and proved nothing.
    view.render(
      state({
        messages: [
          message({ id: 'a', senderId: AGENT, senderType: 'AGENT', content: 'hello there' }),
          message({ id: 'b', senderId: AGENT, senderType: 'AGENT', content: 'your order is out' }),
        ],
      }),
      ME,
    );

    // Announcing forty backfilled messages when the panel opens is hostile.
    expect(view.liveRegion.textContent).toBe('');
  });

  it('announces an incoming message once it is live', () => {
    const { view } = build();
    view.render(state({ messages: [message({ id: 'a' })] }), ME);
    view.render(
      state({
        messages: [
          message({ id: 'a' }),
          message({ id: 'b', senderId: AGENT, senderType: 'AGENT', content: 'ten minutes away' }),
        ],
      }),
      ME,
    );

    expect(view.liveRegion.textContent).toContain('ten minutes away');
  });

  it('never announces the user\'s own message back to them', () => {
    const { view } = build();
    view.render(state({ messages: [message({ id: 'a' })] }), ME);
    view.render(
      state({ messages: [message({ id: 'a' }), message({ id: 'b', content: 'still waiting' })] }),
      ME,
    );

    expect(view.liveRegion.textContent).toBe('');
  });

  it('does not re-announce when an unrelated field changes on the same message', () => {
    // The watermark is the id, not the array length: a tick advancing does not
    // lengthen the array, and re-reading the message aloud on every watermark
    // update would make the widget unusable with a screen reader.
    const { view } = build();
    const incoming = message({ id: 'b', senderId: AGENT, senderType: 'AGENT', content: 'on its way', seq: 2 });

    view.render(state({ messages: [message({ id: 'a' })] }), ME);
    view.render(state({ messages: [message({ id: 'a' }), incoming] }), ME);
    expect(view.liveRegion.textContent).toContain('on its way');

    view.liveRegion.textContent = '';
    view.render(
      state({ messages: [message({ id: 'a' }), incoming], deliveredWatermarks: { [AGENT]: 2 } }),
      ME,
    );
    expect(view.liveRegion.textContent).toBe('');
  });

  it('is not the message log itself', () => {
    const { view } = build();
    // Marking the log live would announce the whole backfill on every
    // "load earlier" and re-read our own optimistic echo.
    expect(view.log.getAttribute('aria-live')).toBe('off');
    expect(view.liveRegion.getAttribute('aria-live')).toBe('polite');
  });
});

describe('rendering', () => {
  it('renders message text as text, never as markup', () => {
    const { view } = build();
    view.render(state({ messages: [message({ content: '<img src=x onerror=alert(1)>' })] }), ME);

    // This string is another user's input arriving over a socket, rendered
    // inside a shadow root on a customer's checkout page.
    expect(view.log.querySelector('img')).toBeNull();
    expect(view.log.querySelector('.dh-msg-body')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('reuses the same element for a message across renders', () => {
    // A wholesale rebuild destroys text selection mid-drag, restarts audio
    // playback, and moves focus off a focused retry button.
    const { view } = build();
    view.render(state({ messages: [message()] }), ME);
    const first = view.log.querySelector('.dh-msg');

    view.render(state({ messages: [message({ seq: 7 })] }), ME);
    expect(view.log.querySelector('.dh-msg')).toBe(first);
  });

  it('keeps DOM order equal to core\'s array order when a seq arrives late', () => {
    const { view } = build();
    const a = message({ id: 'a', content: 'first' });
    const b = message({ id: 'b', content: 'second' });

    view.render(state({ messages: [a, b] }), ME);
    // Core reorders on a late `seq` (D2); position is asserted every pass
    // rather than assumed from insertion order.
    view.render(state({ messages: [b, a] }), ME);

    const texts = [...view.log.querySelectorAll('.dh-msg-body')].map((n) => n.textContent);
    expect(texts).toEqual(['second', 'first']);
  });

  it('refuses an unsafe attachment URL scheme as a link', () => {
    // The allow-list is `^(https?:|blob:)`, so every one of these must
    // collapse to the "unsafe, render text only" branch rather than produce
    // an anchor at all — a mangled-but-present href would still let a click
    // execute it.
    const unsafeUrls = [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      '\u0000javascript:alert(1)', // leading-NUL bypass attempt
    ];

    for (const url of unsafeUrls) {
      document.body.innerHTML = '';
      const { view } = build();
      view.render(
        state({
          messages: [
            message({
              content: '',
              attachment: {
                url,
                fileName: 'receipt.pdf',
                mimeType: 'application/pdf',
                mediaType: 'document',
                size: 10,
              },
            }),
          ],
        }),
        ME,
      );

      expect(view.log.querySelector('a[href]')).toBeNull();
      // Same allow-list gates the image branch; asserted here too so a
      // regression that moved the check would not slip past this test by
      // only exercising the link path.
      expect(view.log.querySelector('img[src]')).toBeNull();
    }
  });

  it('refuses an unsafe attachment URL scheme as an inline image', () => {
    // Same scheme list, but through the image branch specifically: an `img`
    // src does not require a click to run, so this is the more dangerous of
    // the two surfaces and gets its own pass with an image mime type.
    const unsafeUrls = [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      '\u0000javascript:alert(1)',
    ];

    for (const url of unsafeUrls) {
      document.body.innerHTML = '';
      const { view } = build();
      view.render(
        state({
          messages: [
            message({
              content: '',
              attachment: { url, fileName: 'photo.png', mimeType: 'image/png', mediaType: 'image', size: 10 },
            }),
          ],
        }),
        ME,
      );

      expect(view.log.querySelector('img[src]')).toBeNull();
      expect(view.log.querySelector('a[href]')).toBeNull();
    }
  });

  it('does not throw when attachment.url is null or absent', () => {
    // Every other field read in this file's attachment handling is guarded
    // with a `typeof` check on the stated grounds that the record arrives
    // over the socket from another participant's client, so the compiler's
    // guarantee describes our own call sites, not what the server actually
    // sent. `visibleContent`'s `attachment?.url` comparison is the one
    // deref that would otherwise skip that guard — and since it runs on
    // every `render()`, a throw there would freeze the entire scrollback,
    // not just fail to show one message.
    const withNullUrl: AttachmentMetadata = {
      url: null as unknown as string,
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      mediaType: 'document',
      size: 10,
    };
    const withAbsentUrl = {
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      mediaType: 'document',
      size: 10,
    } as unknown as AttachmentMetadata;

    for (const attachment of [withNullUrl, withAbsentUrl]) {
      document.body.innerHTML = '';
      const { view } = build();
      expect(() =>
        view.render(
          state({ messages: [message({ content: '', attachment })] }),
          ME,
        ),
      ).not.toThrow();
    }
  });

  it('drops a row whose message core removed', () => {
    const { view } = build();
    view.render(state({ messages: [message({ id: 'a' }), message({ id: 'b' })] }), ME);
    expect(view.log.querySelectorAll('.dh-msg')).toHaveLength(2);

    view.render(state({ messages: [message({ id: 'a' })] }), ME);
    expect(view.log.querySelectorAll('.dh-msg')).toHaveLength(1);
  });

  it('is unaffected by the attachment suppression rule when there is no attachment', () => {
    // Guard against an over-broad fix: a plain text message must render and
    // read back exactly as before, whether or not it happens to contain
    // something that looks like a URL.
    const { view } = build();
    view.render(state({ messages: [message({ content: 'where is my order' })] }), ME);

    expect(view.log.querySelector('.dh-msg-body')?.textContent).toBe('where is my order');
    expect(view.log.querySelector('img')).toBeNull();
  });

  it('hides the attachment URL from the bubble when content is only the placeholder', () => {
    // Core's §12.10 wire shape sets `content` to `attachment.url` verbatim on
    // a plain-attachment message (packages/core/src/messages/controller.ts).
    // That URL is not caption text, and must not show up as text next to the
    // rendered image.
    const { view } = build();
    const url = 'https://cdn.example.com/receipts/receipt.png';
    view.render(
      state({
        messages: [
          message({
            content: url,
            attachment: {
              url,
              fileName: 'receipt.png',
              mimeType: 'image/png',
              mediaType: 'image',
              size: 10,
            },
          }),
        ],
      }),
      ME,
    );

    const img = view.log.querySelector('img.dh-attachment-image');
    expect(img).not.toBeNull();
    expect(view.log.querySelector('.dh-msg-body')?.textContent).toBe('');
    expect(view.log.querySelector('.dh-msg')?.textContent).not.toContain(url);
  });

  it('still renders a real caption sent alongside an attachment', () => {
    // The suppression rule keys off `content === attachment.url` specifically,
    // not "an attachment is present" — an agent can send genuine caption text
    // together with an image, and that caption must still show up above it.
    const { view } = build();
    const url = 'https://cdn.example.com/receipts/receipt.png';
    view.render(
      state({
        messages: [
          message({
            content: 'Here is your receipt',
            attachment: {
              url,
              fileName: 'receipt.png',
              mimeType: 'image/png',
              mediaType: 'image',
              size: 10,
            },
          }),
        ],
      }),
      ME,
    );

    expect(view.log.querySelector('.dh-msg-body')?.textContent).toBe('Here is your receipt');
    expect(view.log.querySelector('img.dh-attachment-image')).not.toBeNull();
  });
});

describe('describing an attachment to the live region', () => {
  // Goes through the actual announcement path (an incoming message from the
  // agent) rather than reaching into the module, since `describeContent` is
  // not exported — this is also what proves the live region really would
  // speak these words rather than the suppressed URL.
  const cases: Array<[string, string]> = [
    ['image/png', 'sent an image'],
    ['audio/webm', 'sent a voice message'],
    ['application/pdf', 'sent a file'],
  ];

  for (const [mimeType, expected] of cases) {
    it(`announces "${expected}" for a ${mimeType} attachment with no caption`, () => {
      const { view } = build();
      const url = 'https://cdn.example.com/files/f';
      view.render(state({ messages: [message({ id: 'a' })] }), ME);
      view.render(
        state({
          messages: [
            message({ id: 'a' }),
            message({
              id: 'b',
              senderId: AGENT,
              senderType: 'AGENT',
              content: url,
              attachment: { url, fileName: 'f', mimeType, mediaType: 'file', size: 10 },
            }),
          ],
        }),
        ME,
      );

      expect(view.liveRegion.textContent).toContain(expected);
      expect(view.liveRegion.textContent).not.toContain(url);
    });
  }

  it('announces a real caption instead of the mime fallback when one is present', () => {
    const { view } = build();
    const url = 'https://cdn.example.com/files/f';
    view.render(state({ messages: [message({ id: 'a' })] }), ME);
    view.render(
      state({
        messages: [
          message({ id: 'a' }),
          message({
            id: 'b',
            senderId: AGENT,
            senderType: 'AGENT',
            content: 'Here is your receipt',
            attachment: { url, fileName: 'f', mimeType: 'image/png', mediaType: 'file', size: 10 },
          }),
        ],
      }),
      ME,
    );

    expect(view.liveRegion.textContent).toContain('Here is your receipt');
    expect(view.liveRegion.textContent).not.toContain('sent an image');
  });
});
