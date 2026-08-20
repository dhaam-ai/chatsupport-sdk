// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import type { HandledBy } from '@dhaam-ccrm/core';
import type { ChatSession, ChatStatus } from '@dhaam-ccrm/core';

import { createIdentityHeader } from '../src/ui/identity-header.js';

const FALLBACK = 'Acme Support';

function session(overrides: Partial<Pick<ChatSession, 'status' | 'handledBy'>> = {}): Pick<
  ChatSession,
  'status' | 'handledBy'
> {
  return { status: 'ASSIGNED', ...overrides };
}

const AGENT: HandledBy = { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' };
const BOT: HandledBy = { kind: 'BOT', id: 'bot_1', displayName: 'Assistant' };

describe('mount shape', () => {
  it('is an <h2 id="dh-title">, the id the panel already wires aria-labelledby to', () => {
    const header = createIdentityHeader(FALLBACK);
    expect(header.node.tagName).toBe('H2');
    expect(header.node.id).toBe('dh-title');
  });

  it('starts on the configured title before any update', () => {
    const header = createIdentityHeader(FALLBACK);
    expect(header.node.textContent).toBe(FALLBACK);
  });

  it('exposes a dedicated status live region, separate from the title itself', () => {
    const header = createIdentityHeader(FALLBACK);
    expect(header.liveRegion.getAttribute('role')).toBe('status');
    expect(header.liveRegion.getAttribute('aria-live')).toBe('polite');
    expect(header.liveRegion).not.toBe(header.node);
  });
});

describe('absence — handledBy undefined means "render my own title", not "unhandled"', () => {
  it('falls back to the configured title when session is null', () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(null);
    expect(header.node.textContent).toBe(FALLBACK);
  });

  it('falls back to the configured title when handledBy is simply absent', () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'WAITING_FOR_AGENT' }));
    expect(header.node.textContent).toBe(FALLBACK);
    header.update(session({ status: 'OPEN' }));
    expect(header.node.textContent).toBe(FALLBACK);
  });
});

describe('presence — a current handledBy names the agent or the bot', () => {
  it('shows the human agent once assigned', () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    expect(header.node.textContent).toBe('Ada');
    expect(header.node.getAttribute('data-handled-by')).toBe('AGENT');
  });

  it("shows the bot's own name while the bot handles it", () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'OPEN', handledBy: BOT }));
    expect(header.node.textContent).toBe('Assistant');
    expect(header.node.getAttribute('data-handled-by')).toBe('BOT');
  });
});

describe('staleness — a reactivated session keeps a name isHandledByCurrent must reject', () => {
  it(
    'renders the configured title, NOT the closing agent\'s name, when a reactivated session ' +
      'reports WAITING_FOR_AGENT with a stale handledBy',
    () => {
      // Exactly core T10's documented case: a session reactivated from
      // CLOSED/RESOLVED keeps its previous assignedAgentId server-side, so
      // handledBy can still name the agent who closed it even though status
      // has already gone back to WAITING_FOR_AGENT. Rendering "Ada" here
      // would tell the customer someone is with them when nobody is.
      const header = createIdentityHeader(FALLBACK);
      header.update(session({ status: 'WAITING_FOR_AGENT', handledBy: AGENT }));

      expect(header.node.textContent).toBe(FALLBACK);
      expect(header.node.textContent).not.toContain('Ada');
      expect(header.node.getAttribute('data-handled-by')).toBe('');
    },
  );

  it('every other status trusts a present handledBy, per isHandledByCurrent — not just ASSIGNED', () => {
    const others: ChatStatus[] = ['OPEN', 'ASSIGNED', 'CLOSED', 'RESOLVED', 'ON_HOLD'];
    for (const status of others) {
      const header = createIdentityHeader(FALLBACK);
      header.update(session({ status, handledBy: AGENT }));
      expect(header.node.textContent).toBe('Ada');
    }
  });
});

describe('the live-region announcement', () => {
  it('never announces on the very first update — that describes what was already true, not a live change', () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    expect(header.liveRegion.textContent).toBe('');
  });

  it('announces once an agent joins mid-session', () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'WAITING_FOR_AGENT' })); // seed: fallback title
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT })); // agent.joined applied

    expect(header.liveRegion.textContent).toBe("You're now chatting with Ada.");
  });

  it('announces the reversion once an agent leaves', () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    header.liveRegion.textContent = '';

    header.update(session({ status: 'WAITING_FOR_AGENT' })); // agent.left applied
    expect(header.liveRegion.textContent).toBe(`You're now chatting with ${FALLBACK}.`);
  });

  it('does not re-announce when an update reruns with no actual label change', () => {
    // A store selector can re-fire for reasons unrelated to identity (e.g. a
    // new session object with the same handledBy). Repeating the
    // announcement every time would talk over whatever the user is reading —
    // the same discipline message-list.ts's setClosure applies to its own
    // live region.
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    header.liveRegion.textContent = '';

    header.update(session({ status: 'ASSIGNED', handledBy: { ...AGENT } }));
    expect(header.liveRegion.textContent).toBe('');
  });

  it('does not announce a stale handledBy as though it were a real hand-off', () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    header.liveRegion.textContent = '';

    // Reactivation: handledBy still says Ada, but isHandledByCurrent rejects
    // it — the rendered (and thus announced) label is the fallback title,
    // which differs from 'Ada', so this DOES announce, but with the honest
    // fallback text, never Ada's name.
    header.update(session({ status: 'WAITING_FOR_AGENT', handledBy: AGENT }));
    expect(header.liveRegion.textContent).toBe(`You're now chatting with ${FALLBACK}.`);
  });
});
