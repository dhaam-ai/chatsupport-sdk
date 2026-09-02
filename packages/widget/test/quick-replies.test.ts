// @vitest-environment node
//
// The handoff filter in `readQuickReplies`. Pure, so no DOM — the render half
// of quick-replies.ts is covered where it renders, in message-list.test.ts.
//
// The rule under test: a bot-suggested reply that matches the tenant's
// `behaviour.handoffKeywords` must not render. Escalation is keyword-only by
// the owner's call — the visible "Talk to a human" button was removed — and a
// chip that escalates when tapped IS that button back under a per-reply,
// LLM-authored name. The judge is `asksForAHuman` itself, the same matcher
// the composer escalates on, so "would tapping escalate?" and "should this
// render?" cannot drift apart.

import { describe, expect, it } from 'vitest';

import { readQuickReplies } from '../src/ui/quick-replies.js';

/** The console's own shipped default list, lower-cased as the parser leaves it. */
const KEYWORDS = ['agent', 'human', 'person', 'speak to someone'];

describe('readQuickReplies handoff filter', () => {
  it('drops a suggestion that matches a handoff keyword', () => {
    const metadata = { options: ['Track my order', 'Talk to a person', 'Refund status'] };
    expect(readQuickReplies(metadata, KEYWORDS)).toEqual(['Track my order', 'Refund status']);
  });

  it.each([
    'Talk to a human',
    'Speak to an agent',
    'Connect me with a person',
    'speak to someone',
  ])('drops %j against the default keyword list', (label) => {
    expect(readQuickReplies({ options: [label] }, KEYWORDS)).toEqual([]);
  });

  // Same word-boundary contract as the composer: a suggestion merely
  // CONTAINING a keyword ("urgent" contains "agent") must survive, because
  // tapping it would not escalate either.
  it('keeps a suggestion that only contains a keyword inside a longer word', () => {
    expect(readQuickReplies({ options: ['Mark as urgent'] }, KEYWORDS)).toEqual(['Mark as urgent']);
  });

  it('filters nothing when the tenant has no handoff keywords', () => {
    const metadata = { options: ['Talk to a human', 'Track my order'] };
    expect(readQuickReplies(metadata, [])).toEqual(['Talk to a human', 'Track my order']);
    // And the parameter is optional, for callers with no keyword source.
    expect(readQuickReplies(metadata)).toEqual(['Talk to a human', 'Track my order']);
  });

  it('still enforces the shape rules alongside the filter', () => {
    const metadata = { options: ['Talk to an agent', '  ', 'Refund', 'Refund', 42] };
    expect(readQuickReplies(metadata, KEYWORDS)).toEqual(['Refund']);
  });
});
