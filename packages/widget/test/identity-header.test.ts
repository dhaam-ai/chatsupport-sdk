// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import type { HandledBy } from '@dhaam-ccrm/core';
import type { ChatSession, ChatStatus } from '@dhaam-ccrm/core';

import { createIdentityHeader } from '../src/ui/identity-header.js';

/** A SPECIFIC title — a real store/outlet/merchant name — never paired with a handler's name. */
const FALLBACK = 'Acme Support';
/** A GENERIC title — the widget's own default — IS paired with a handler's name once one is current. */
const GENERIC_FALLBACK = 'Chat with us';

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

describe('a SPECIFIC title (a real store/outlet name) is never paired with who answers', () => {
  // A store-scoped chat is identified by the outlet, not by which staff
  // member happens to be on it — "tse · Mohali" answers a question the
  // customer never asked and buries the one fact that matters. So a
  // specific title stands alone regardless of the session's handler.

  it('stays on the configured title once a human agent is assigned', () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    expect(header.node.textContent).toBe(FALLBACK);
    // The avatar/CSS hook still reflects the real handler — only the visible
    // title text is unaffected by who it is.
    expect(header.node.getAttribute('data-handled-by')).toBe('AGENT');
  });

  it('stays on the configured title while a bot handles it', () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'OPEN', handledBy: BOT }));
    expect(header.node.textContent).toBe(FALLBACK);
    expect(header.node.getAttribute('data-handled-by')).toBe('BOT');
  });

  it('every other status agrees — a specific title never changes for a handler', () => {
    const statuses: ChatStatus[] = ['OPEN', 'ASSIGNED', 'CLOSED', 'RESOLVED', 'ON_HOLD'];
    for (const status of statuses) {
      const header = createIdentityHeader(FALLBACK);
      header.update(session({ status, handledBy: AGENT }));
      expect(header.node.textContent).toBe(FALLBACK);
    }
  });
});

describe('a GENERIC title pairs with the current handler’s name', () => {
  it('pairs the human agent with the platform brand once assigned', () => {
    const header = createIdentityHeader(GENERIC_FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    expect(header.node.textContent).toBe('Ada · Dhaam Support');
    expect(header.node.getAttribute('data-handled-by')).toBe('AGENT');
  });

  it('pairs the bot the same way while it handles the chat', () => {
    const header = createIdentityHeader(GENERIC_FALLBACK);
    header.update(session({ status: 'OPEN', handledBy: BOT }));
    expect(header.node.textContent).toBe('Assistant · Dhaam Support');
  });

  it('an absent config.title (undefined → "") is generic too', () => {
    const header = createIdentityHeader('');
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    expect(header.node.textContent).toBe('Ada · Dhaam Support');
  });

  it('shows the bare name once, not paired with itself, when the handler IS the platform brand', () => {
    // The tenant's default bot name ("Assistant") colliding with a
    // placeholder widget title — must not read "Assistant · Dhaam Support"
    // when the bot itself already carries a different name; it only
    // collapses when the two strings are actually identical.
    const header = createIdentityHeader(GENERIC_FALLBACK);
    header.update(session({ status: 'OPEN', handledBy: { kind: 'BOT', id: 'b1', displayName: 'Dhaam Support' } }));
    expect(header.node.textContent).toBe('Dhaam Support');
  });

  it('is case- and whitespace-insensitive about the same-name check', () => {
    // The comparison trims/lowercases before comparing, but still renders the
    // handler's name exactly as the server sent it — trimming the DISPLAYED
    // text is not this guard's job.
    const header = createIdentityHeader(GENERIC_FALLBACK);
    header.update(session({ status: 'OPEN', handledBy: { kind: 'BOT', id: 'b1', displayName: '  dhaam support  ' } }));
    expect(header.node.textContent).toBe('  dhaam support  ');
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
      const header = createIdentityHeader(GENERIC_FALLBACK);
      header.update(session({ status: 'WAITING_FOR_AGENT', handledBy: AGENT }));

      expect(header.node.textContent).toBe(GENERIC_FALLBACK);
      expect(header.node.textContent).not.toContain('Ada');
      expect(header.node.getAttribute('data-handled-by')).toBe('');
    },
  );
});

describe('the live-region announcement', () => {
  // Exercised against a GENERIC title: that is the one case where the
  // visible label actually moves when a handler joins or leaves, so it is
  // the one case where an announcement has anything to say. A specific
  // title's label never changes for a handler (see above), so it never
  // announces a hand-off either — correctly: the header intentionally does
  // not surface the individual staff member for a store-scoped chat, and
  // that includes the screen-reader channel.

  it('never announces on the very first update — that describes what was already true, not a live change', () => {
    const header = createIdentityHeader(GENERIC_FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    expect(header.liveRegion.textContent).toBe('');
  });

  it('announces once an agent joins mid-session', () => {
    const header = createIdentityHeader(GENERIC_FALLBACK);
    header.update(session({ status: 'WAITING_FOR_AGENT' })); // seed: fallback title
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT })); // agent.joined applied

    expect(header.liveRegion.textContent).toBe("You're now chatting with Ada.");
  });

  it('announces the reversion once an agent leaves', () => {
    const header = createIdentityHeader(GENERIC_FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    header.liveRegion.textContent = '';

    header.update(session({ status: 'WAITING_FOR_AGENT' })); // agent.left applied
    expect(header.liveRegion.textContent).toBe(`You're now chatting with ${GENERIC_FALLBACK}.`);
  });

  it('does not re-announce when an update reruns with no actual label change', () => {
    // A store selector can re-fire for reasons unrelated to identity (e.g. a
    // new session object with the same handledBy). Repeating the
    // announcement every time would talk over whatever the user is reading —
    // the same discipline message-list.ts's setClosure applies to its own
    // live region.
    const header = createIdentityHeader(GENERIC_FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    header.liveRegion.textContent = '';

    header.update(session({ status: 'ASSIGNED', handledBy: { ...AGENT } }));
    expect(header.liveRegion.textContent).toBe('');
  });

  it('does not announce a stale handledBy as though it were a real hand-off', () => {
    const header = createIdentityHeader(GENERIC_FALLBACK);
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    header.liveRegion.textContent = '';

    // Reactivation: handledBy still says Ada, but isHandledByCurrent rejects
    // it — the rendered (and thus announced) label is the fallback title,
    // which differs from 'Ada', so this DOES announce, but with the honest
    // fallback text, never Ada's name.
    header.update(session({ status: 'WAITING_FOR_AGENT', handledBy: AGENT }));
    expect(header.liveRegion.textContent).toBe(`You're now chatting with ${GENERIC_FALLBACK}.`);
  });

  it('never announces at all for a SPECIFIC title — the label never moves for a handler to begin with', () => {
    const header = createIdentityHeader(FALLBACK);
    header.update(session({ status: 'WAITING_FOR_AGENT' }));
    header.update(session({ status: 'ASSIGNED', handledBy: AGENT }));
    expect(header.liveRegion.textContent).toBe('');
    header.update(session({ status: 'WAITING_FOR_AGENT' }));
    expect(header.liveRegion.textContent).toBe('');
  });
});
