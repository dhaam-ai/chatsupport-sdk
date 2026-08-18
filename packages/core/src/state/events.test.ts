import { describe, expect, expectTypeOf, it } from 'vitest';

import { CHAT_EVENT_NAMES } from './events.js';
import type { ChatEventMap, ChatEventName } from './events.js';

describe('CHAT_EVENT_NAMES', () => {
  // `sendFailed` was added by the 2026-08-18 §6.5 amendment — see the
  // MessageDelivery note in state/types.ts for why an absent `seq` could not
  // carry a permanently-failed send.
  it('lists exactly the sixteen events in §6.5', () => {
    expect([...CHAT_EVENT_NAMES]).toEqual([
      'connected',
      'reconnecting',
      'suspended',
      'disconnected',
      'message',
      'messageAck',
      'sendFailed',
      'typing',
      'agentJoined',
      'agentLeft',
      'statusChange',
      'sessionClosed',
      'presenceUpdate',
      'ticketLinked',
      'tokenRefreshed',
      'error',
    ]);
  });

  it('covers every key of ChatEventMap', () => {
    // The half `satisfies` cannot check in events.ts: `satisfies` rejects a
    // name that is not an event, but not an event missing from the array.
    // If someone adds an entry to ChatEventMap and forgets this array,
    // `Missing` stops being `never` and this fails to compile.
    type Missing = Exclude<ChatEventName, (typeof CHAT_EVENT_NAMES)[number]>;
    expectTypeOf<Missing>().toBeNever();

    // Runtime mirror, so the failure is also visible as a test error and not
    // only as a compile error.
    expect(new Set(CHAT_EVENT_NAMES).size).toBe(CHAT_EVENT_NAMES.length);
  });
});

describe('ChatEventMap payload typing', () => {
  // The point of the map: `on('message', h)` must infer `h`'s parameter with
  // no annotation. These assert the map itself; store.test.ts asserts the
  // inference actually flows through `on()`.

  it('types each connection-lifecycle payload per §6.5', () => {
    expectTypeOf<ChatEventMap['reconnecting']>().toEqualTypeOf<{
      attempt: number;
      delayMs: number;
    }>();
    expectTypeOf<ChatEventMap['suspended']>().toEqualTypeOf<{ reason: 'auth' | 'maxAttempts' | 'protocol' }>();
    expectTypeOf<ChatEventMap['disconnected']>().toEqualTypeOf<{ reason: string }>();
  });

  it('gives `connected` a session and `message` a bare ChatMessage', () => {
    expectTypeOf<ChatEventMap['connected']>().toHaveProperty('session');
    // §6.5's payload column for `message` is `ChatMessage` itself, not a
    // wrapper object — a binding destructuring `{ message }` would be wrong.
    expectTypeOf<ChatEventMap['message']>().toHaveProperty('content');
    expectTypeOf<ChatEventMap['message']>().toHaveProperty('senderType');
  });

  it('requires participantId on the typing event', () => {
    // Contrast with ChatState.typing, where participantId is optional.
    expectTypeOf<ChatEventMap['typing']>().toEqualTypeOf<{
      isTyping: boolean;
      participantId: string;
    }>();
  });

  it('reuses the protocol payload shapes rather than redefining them', () => {
    // agentJoined/agentLeft are two events sharing one shape.
    expectTypeOf<ChatEventMap['agentJoined']>().toEqualTypeOf<ChatEventMap['agentLeft']>();
    expectTypeOf<ChatEventMap['agentJoined']>().toHaveProperty('agentId');
    expectTypeOf<ChatEventMap['presenceUpdate']>().toHaveProperty('participantId');
    expectTypeOf<ChatEventMap['presenceUpdate']>().toHaveProperty('status');
    expectTypeOf<ChatEventMap['ticketLinked']>().toHaveProperty('ticketId');
  });

  it('scopes sessionClosed to closeReason only', () => {
    expectTypeOf<ChatEventMap['sessionClosed']>().toEqualTypeOf<{ closeReason: 'RESOLVED' | 'MANUAL' | 'SWITCHED' }>();
  });

  it('gives tokenRefreshed an empty payload that rejects stray fields', () => {
    const empty: ChatEventMap['tokenRefreshed'] = {};
    expect(empty).toEqual({});

    // @ts-expect-error — tokenRefreshed carries no data (§6.5).
    const populated: ChatEventMap['tokenRefreshed'] = { token: 'abc' };
    expect(populated).toBeDefined();
  });

  it('types error as ChatError, covering both protocol and transport origins', () => {
    expectTypeOf<ChatEventMap['error']>().toHaveProperty('source');
    expectTypeOf<ChatEventMap['error']>().toHaveProperty('code');
    expectTypeOf<ChatEventMap['error']>().toHaveProperty('retryable');
  });

  it('rejects an event name outside the catalog', () => {
    // @ts-expect-error — 'messageDelivered' is not in §6.5.
    const bogus: ChatEventName = 'messageDelivered';
    expect(bogus).toBe('messageDelivered');
  });
});
