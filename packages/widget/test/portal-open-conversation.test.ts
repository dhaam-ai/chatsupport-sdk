// @vitest-environment jsdom
//
// CHARACTERIZATION (not RED), and a TYPE GUARD standing in for one the
// compiler no longer provides.
//
// Companion to customer-open-conversation.test.ts. Same boundary — opening a
// conversation from a Messages row — but the other of the two screens behind
// it, and deliberately a separate file: until this one existed, EVERY
// `createMessagesScreen` call in the suite omitted `userRole` and therefore
// exercised the customer branch. The portal branch shipped uncovered, and
// nothing about a green suite said so.
//
// ── Why this file has to exist now ───────────────────────────────────────
//
// `MessagesScreenCallbacks.onOpenConversation` declared `displayName` as a
// required `string` until 2026-09-14. That was wrong about the customer path
// (which has only an id to give) and the declaration was corrected to
// `displayName?`. The correction has a cost, and this file is the payment.
//
// Before the correction, editing the portal forwarding lambda — the sole
// `createMessageRow(...)` call site, inside `createPortalMessagesScreen`'s
// `render` in messages-screen.ts — down to
// `callbacks.onOpenConversation(sessionId)` was a compile error, TS2554.
// After it, that edit compiles clean. Nothing in the type system catches it
// any more:
//
// (Anchored to the symbol, not a line number, deliberately: this citation has
// drifted three times already as comments above it grew.)
//
//   - `createMessageRow`'s `onSelect: (sessionId: string, displayName: string,
//     subtitle?: string) => void` still requires a name, but it constrains
//     what flows INTO the lambda, not what the lambda chooses to forward OUT.
//   - the row's own click handler still computes a real `getRowDisplayName`.
//     It would simply be dropped on the floor.
//
// The customer-visible result of that hypothetical edit is a portal
// conversation header reading 'Conversation' — `openPortalConversation`'s
// `?? 'Conversation'` fallback, which exists for defence and is not meant to
// be the name anyone actually reads. So: the arity of the portal call is now
// a TEST's job to hold, and this is that test. It is not decoration. If it is
// ever deleted, the portal path has no guard of any kind left.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSessionSummary } from '@dhaam-ccrm/js';

import { createMessagesScreen } from '../src/ui/messages-screen.js';

/**
 * One `/agent/queue` row as the portal screen sees it.
 *
 * `chatType: 'customer'` puts it in the Customers tab, which is the tab an
 * ADMIN viewer opens on (`initialTab` in `createPortalMessagesScreen`), so the
 * row is visible and clickable without switching tabs first. `customerName`
 * and `customerEmail` are what `getRowDisplayName` / `getRowSubtitle` read for
 * an admin on that tab — real values, so that "non-empty" below means the
 * lambda forwarded something true rather than a fallback string.
 */
function queueRow(overrides: Record<string, unknown> = {}): ChatSessionSummary {
  return {
    id: 'sess_q1',
    status: 'WAITING_FOR_AGENT',
    mode: 'HUMAN',
    createdAt: '2026-08-19T09:00:00.000Z',
    closedAt: null,
    lastMessageAt: '2026-08-19T09:30:00.000Z',
    lastMessagePreview: 'My order has not arrived',
    unreadCount: 1,
    chatType: 'customer',
    customerName: 'Priya Raman',
    customerEmail: 'priya@example.com',
    ...overrides,
  } as ChatSessionSummary;
}

function build(userRole: string) {
  const onOpenConversation = vi.fn();
  const screen = createMessagesScreen({ onOpenConversation, onStartNew: () => undefined, userRole });
  document.body.appendChild(screen.node);
  return { screen, onOpenConversation };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('characterization — what the PORTAL Messages row hands the widget', () => {
  it('builds the portal variant, not the customer one, for an admin viewer', () => {
    const { screen } = build('admin');
    screen.render([queueRow()], null);

    // `.dh-mrow-btn` is the portal row; `.dh-messages-row` is the customer
    // row. Asserted so that a future change to the branch condition in
    // `createMessagesScreen` fails HERE, loudly, rather than silently turning
    // the arity assertion below into a second copy of the customer test.
    expect(screen.node.querySelector('.dh-mrow-btn')).not.toBeNull();
    expect(screen.node.querySelector('.dh-messages-row')).toBeNull();
  });

  it('calls onOpenConversation with all THREE arguments, and a real display name', () => {
    const { screen, onOpenConversation } = build('admin');
    screen.render([queueRow()], null);

    const row = screen.node.querySelector<HTMLButtonElement>('.dh-mrow-btn');
    expect(row).not.toBeNull();
    expect(row!.closest<HTMLElement>('.dh-mrow-item')!.hidden).toBe(false);
    row!.click();

    expect(onOpenConversation.mock.calls).toHaveLength(1);
    const call = onOpenConversation.mock.calls[0]!;

    // The arity itself. This is the assertion that replaces the TS2554 the
    // widened signature no longer raises at the `createMessageRow(...)` call
    // site in `createPortalMessagesScreen`'s `render`.
    expect(call).toHaveLength(3);

    const [sessionId, displayName, subtitle] = call as [string, string, string];
    expect(sessionId).toBe('sess_q1');

    // Not merely present: a NAME. `expect(call).toHaveLength(3)` alone would
    // be satisfied by forwarding `undefined, undefined`, which is exactly the
    // failure this file exists to catch, so the name is checked for content.
    expect(typeof displayName).toBe('string');
    expect(displayName.trim()).not.toBe('');
    expect(displayName).toBe('Priya Raman');

    // The subtitle travels the same lambda and is checked with it — a drop
    // here would leave `openPortalConversation` guessing 'Customer' from the
    // name, which is a quieter version of the same defect.
    expect(subtitle).toBe('Customer • priya@example.com');
  });

  it('still forwards a name when the row has to fall back for one', () => {
    const { screen, onOpenConversation } = build('admin');
    // No `customerName`, no `customerEmail`: `getRowDisplayName` reaches its
    // last resort for an admin on the Customers tab. Pinned because the
    // guarantee this file protects is "a name always arrives", and a fallback
    // name is still a name — the defect being guarded against is an ABSENT
    // argument, not an uninformative one.
    screen.render([queueRow({ customerName: undefined, customerEmail: undefined })], null);

    screen.node.querySelector<HTMLButtonElement>('.dh-mrow-btn')!.click();

    const call = onOpenConversation.mock.calls[0]!;
    expect(call).toHaveLength(3);
    expect(call[1]).toBe('Customer');
  });
});
