// @vitest-environment jsdom
//
// "Common Questions" shipped once as a wrapped row of pill-shaped chips
// (`border-radius: 999px`, `flex-wrap: wrap`) with no row boundary and no
// "this opens something" affordance at all — see common-questions.ts's own
// header for the fix. This file proves the REBUILT shape: a single bordered
// list, one row per question, a trailing chevron, and the click wiring
// unchanged underneath the new markup.
//
// The other half of the reported bug — a tap sending nothing because
// `sendMessage` throws `NoActiveSessionError` with no session joined yet, and
// the widget never navigating to show what happened even when it DID work —
// lives one level up, in widget.ts's `startCommonQuestion`. See
// `common-questions-mount.test.ts` for that half; this file only proves the
// presentational component's own contract.

import { describe, expect, it, vi } from 'vitest';

import { createCommonQuestions } from '../src/ui/common-questions.js';
import type { CommonQuestion } from '../src/ui/common-questions.js';
import { STYLES } from '../src/ui/styles.js';

function question(overrides: Partial<CommonQuestion> = {}): CommonQuestion {
  return { id: 'track', label: 'Track my order', prompt: 'Where is my order?', ...overrides };
}

describe('createCommonQuestions — rendering', () => {
  it('renders a single list, one row per question — not a wrapped row of independent chips', () => {
    const { node } = createCommonQuestions(
      [question({ id: 'a', label: 'Track my order' }), question({ id: 'b', label: 'Refund question' })],
      { onSelect: vi.fn() },
    );

    expect(node.tagName).toBe('UL');
    // Explicit, like ui/messages-screen.ts's own list — Safari/VoiceOver
    // drops the implicit list role once `list-style` is styled away.
    expect(node.getAttribute('role')).toBe('list');
    expect(node.querySelectorAll('.dh-common-question-item')).toHaveLength(2);
    // The regression this guards against shipped as `<button>` children
    // directly on the group node — no `<li>`, no list semantics at all.
    expect(node.querySelectorAll('.dh-common-question-chip')).toHaveLength(0);
  });

  it('shows the question label as the row text', () => {
    const { node } = createCommonQuestions([question({ label: 'Cancel an order' })], { onSelect: vi.fn() });
    expect(node.querySelector('.dh-common-question-label')?.textContent).toBe('Cancel an order');
  });

  it('shows a trailing chevron on each row — the SAME glyph Home’s own CTA rows use, not a new one', () => {
    const { node } = createCommonQuestions([question()], { onSelect: vi.fn() });
    const chevron = node.querySelector('.dh-common-question-row .dh-home-chevron');
    expect(chevron).not.toBeNull();
    expect(chevron?.textContent).toBe('›');
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('createCommonQuestions — selection', () => {
  it('calls onSelect with the full question object when a row is tapped', () => {
    const onSelect = vi.fn();
    const target = question({ id: 'refund', label: 'Refund question', prompt: 'I have a question about a refund.' });
    const { node } = createCommonQuestions([question({ id: 'other' }), target], { onSelect });

    const rows = [...node.querySelectorAll<HTMLButtonElement>('.dh-common-question-row')];
    rows[1]!.click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(target);
  });
});

describe('createCommonQuestions — CSS shape', () => {
  it('is styled as a bordered list with hairline row separators, not wrapped pill chips', () => {
    // Asserted against the real stylesheet, not just the markup: the
    // reported bug was purely visual — the DOM already had one button per
    // question before this fix, and the pill look came entirely from CSS.
    expect(STYLES).not.toMatch(/\.dh-common-question-chip/);
    expect(STYLES).not.toMatch(/\.dh-common-questions\s*\{[^}]*border-radius:\s*999px/);
    expect(STYLES).toMatch(/\.dh-common-questions\s*\{[^}]*border:\s*1px solid var\(--dh-border\)/);
    expect(STYLES).toMatch(/\.dh-common-question-item \+ \.dh-common-question-item\s*\{\s*border-top/);
  });
});
