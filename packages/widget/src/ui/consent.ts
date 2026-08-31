// `behaviour.consentRequired` / `behaviour.consentText` — the notice a visitor
// agrees to before a conversation is stored.
//
// ── What this gate does and does not claim ───────────────────────────────
//
// It gates the COMPOSER, not the widget. A visitor who has not agreed can
// still open the panel, read the merchant's greeting and see who they would be
// talking to — none of which stores anything about them. What they cannot do
// is send, because sending is the act that creates the record the notice is
// about.
//
// It is deliberately NOT a claim about lawfulness. The console's own help text
// is "Required in some jurisdictions before you store a conversation", and
// what a given jurisdiction requires is the merchant's question, not this
// package's. This renders the merchant's words and records the answer.
//
// ── Why the answer is remembered per browser ─────────────────────────────
//
// A daily customer re-consenting daily reads as broken, and consent fatigue is
// itself a reason people stop reading notices. The record lives in the same
// durable storage core already uses (see client.ts's `storage`), keyed per
// publishable key so two tenants on one browser cannot answer for each other.
//
// Storage that is unavailable or full is NOT treated as consent. A failed
// write means the visitor is asked again next visit — mildly annoying, and the
// only safe direction to fail in: the alternative is a widget that believes it
// has an agreement it never recorded.

import type { StorageAdapter } from '@dhaam-ccrm/core';

import { el } from './dom.js';

export interface ConsentGateCallbacks {
  /** Run when the visitor agrees, after the answer has been recorded. */
  readonly onAgree: () => void;
}

export interface ConsentGateView {
  readonly node: HTMLElement;
  /** Whether the composer should be usable right now. */
  agreed(): boolean;
  /** Shows or hides the notice, and reports whether it is gating. */
  update(required: boolean, text: string): void;
  destroy(): void;
}

/** Where one tenant's answer is recorded. Namespaced like core's own keys. */
export function consentStorageKey(publishableKey: string): string {
  return `chatsdk:${publishableKey}:consent`;
}

/**
 * The consent notice.
 *
 * The stored answer is read ONCE at construction and cached, because the
 * adapter is async and every consumer of {@link ConsentGateView.agreed} is a
 * synchronous render path. The read is kicked off immediately and applied when
 * it lands; until then the gate is CLOSED, which is the safe direction — a
 * visitor briefly seeing a notice they have already dismissed is a smaller
 * failure than a conversation stored before the answer was known.
 */
export function createConsentGate(
  storage: StorageAdapter,
  publishableKey: string,
  callbacks: ConsentGateCallbacks,
  onError: (error: unknown) => void,
): ConsentGateView {
  const key = consentStorageKey(publishableKey);
  let stored = false;
  /**
   * Whether the gate is actually in force.
   *
   * `consentRequired: true` alone is NOT enough — the notice also needs
   * something to say. A merchant who switched the toggle on and left the text
   * empty would otherwise disable the composer behind a notice that renders
   * nothing, stranding every visitor with no control to agree with and no
   * explanation on screen. "Nothing to agree to" is not consent withheld.
   */
  let gating = false;

  const message = el('p', { attrs: { class: 'dh-consent-text' } });
  const agree = el('button', {
    attrs: { class: 'dh-consent-agree', type: 'button' },
    text: 'I agree',
    on: {
      click: () => {
        stored = true;
        node.hidden = true;
        // Recorded, then reported — but the click is honoured whether or not
        // the write lands. Refusing to let somebody chat because their browser
        // blocks site data would punish them for a setting they are entitled
        // to; the cost of a failed write is only that they are asked again.
        storage.set(key, 'true').catch(onError);
        callbacks.onAgree();
      },
    },
  });

  const node = el('div', {
    attrs: { class: 'dh-consent', hidden: true, role: 'group', 'aria-label': 'Consent' },
    children: [message, agree],
  });

  let destroyed = false;
  storage
    .get(key)
    .then((value) => {
      if (destroyed) return;
      stored = value === 'true';
      if (stored) node.hidden = true;
    })
    // A read that fails is "not agreed", which is the same as a first visit.
    .catch(onError);

  return {
    node,
    agreed: () => !gating || stored,
    update(nextRequired, text) {
      gating = nextRequired && text.trim() !== '';
      message.textContent = text;
      node.hidden = !gating || stored;
    },
    destroy() {
      destroyed = true;
    },
  };
}
