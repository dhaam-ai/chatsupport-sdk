// What the panel shows when the chat service cannot be reached at all.
//
// ── Why a whole screen rather than the status line ───────────────────────
//
// There has always been a status line and a Reconnect control for this, and
// they are the right weight for a blip the client is still working through.
// They are the wrong weight for "we have stopped trying": a customer looking
// at an empty transcript, a composer that accepts text, and one grey sentence
// has no reason to believe their message is going nowhere. They type it, they
// wait, and nobody ever answers.
//
// So once the client has given up, the panel says so plainly and offers the
// two things that can still help: try again, or reach the merchant another
// way.
//
// ── Only after the client has actually given up ──────────────────────────
//
// This is gated on core's TERMINAL connection states — the ones that mean it
// stopped on purpose — never on a state it is still retrying through. Showing
// "temporarily unavailable" over a reconnect that is about to succeed tells
// the customer something false and sends them away from a working chat.
//
// ── The email is the merchant's, or there is none ────────────────────────
//
// `behaviour.supportEmail` is a console setting, and an ABSENT one shows no
// link rather than a guess. An address nobody monitors is worse than admitting
// there is no second route: the customer waits on a reply that is never
// coming. Same rule the header menu's Privacy item follows.

import { el, icon } from './dom.js';

/** Longest local part + domain this will put on screen. */
const MAX_EMAIL = 254;

/**
 * A merchant-supplied address reduced to something safe to put in a `mailto:`,
 * or `null`.
 *
 * Deliberately strict rather than clever. This lands in an `href`, and the
 * shape of an email is exactly the kind of thing a permissive regex gets wrong
 * in the direction that matters — a value containing a newline or a `?` can
 * add headers to the message the customer is about to send. Anything that is
 * not one plain address is refused, and refusing renders no link at all, which
 * is a state this screen already handles.
 */
export function safeMailto(value: string): string | null {
  const address = value.trim();
  if (address === '' || address.length > MAX_EMAIL) return null;
  // One `@`, no whitespace, no characters that could open a header or a second
  // field, and a dotted domain.
  if (!/^[^\s@,;:<>"'()[\]\\?&]+@[^\s@,;:<>"'()[\]\\?&]+\.[a-z]{2,}$/i.test(address)) return null;
  // Used literally, NOT percent-encoded. The allowlist above is the guard —
  // nothing that survives it can open a header or a second field — and
  // `encodeURIComponent` on top of it is not extra safety, it is damage:
  // it turns the `+` of a perfectly ordinary plus-addressed inbox into
  // `%2B`, which some mail clients hand to the server verbatim and bounce.
  return `mailto:${address}`;
}

export interface UnavailableCallbacks {
  /** Retry the connection. The same path the Reconnect control uses. */
  readonly onRetry: () => void;
}

export interface UnavailableView {
  readonly node: HTMLElement;
  /**
   * @param supportEmail the merchant's fallback address, or `''` for none.
   * @param retrying whether a retry is already in flight.
   */
  update(supportEmail: string, retrying: boolean): void;
  focus(): void;
}

export function createUnavailable(callbacks: UnavailableCallbacks): UnavailableView {
  const retry = el('button', {
    attrs: { class: 'dh-unavail-retry', type: 'button' },
    text: 'Try again',
    on: { click: () => callbacks.onRetry() },
  });

  const email = el('a', {
    attrs: { class: 'dh-unavail-email', hidden: true },
  });

  const node = el('div', {
    attrs: {
      class: 'dh-unavail',
      hidden: true,
      // `alert` rather than `status`: this is the panel telling the customer
      // the thing they came here to do is not currently possible, which is
      // exactly the assertive case the role exists for. It replaces the
      // conversation, so there is nothing it can interrupt.
      role: 'alert',
    },
    children: [
      el('span', {
        attrs: { class: 'dh-unavail-icon', 'aria-hidden': 'true' },
        children: [icon(['M12 8v5', 'M12 16.5h.01', 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z'], 26)],
      }),
      el('p', { attrs: { class: 'dh-unavail-title' }, text: 'Chat is temporarily unavailable' }),
      el('p', {
        attrs: { class: 'dh-unavail-body' },
        text:
          "We couldn't reach the support service. Try again, or email us and we'll pick it up from there.",
      }),
      retry,
      email,
    ],
  });

  return {
    node,
    update(supportEmail, retrying) {
      retry.disabled = retrying;
      retry.textContent = retrying ? 'Trying…' : 'Try again';

      const href = safeMailto(supportEmail);
      email.hidden = href === null;
      if (href === null) return;
      email.setAttribute('href', href);
      // The address itself is the link text: a customer who cannot reach the
      // chat may well want to copy it into their own mail client rather than
      // trust a `mailto:` to open one, and a link reading "email us" hides the
      // one piece of information they need to do that.
      email.textContent = `Email ${supportEmail.trim()}`;
    },
    focus() {
      retry.focus({ preventScroll: true });
    },
  };
}
