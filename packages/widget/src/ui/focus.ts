// Focus management for the open panel.
//
// ── Why a trap at all, given a chat panel is not obviously modal ─────────
//
// A trap and `aria-modal` have to agree. Announcing `aria-modal="true"` while
// letting Tab walk out into the host page tells a screen-reader user the rest
// of the page is inert when it is not, and they discover the lie only after
// tabbing into content their screen reader claims does not exist. The honest
// pairings are "trap + aria-modal" or "no trap + no aria-modal".
//
// This picks the first, because the panel is opened by an explicit user action
// and covers a large part of the viewport in two of the three presentations —
// and because a keyboard user who tabs off the end of the composer and lands
// silently in the host's navigation, with the chat still open on top, has no
// way back that does not involve shift-tabbing blind through the whole page.
// Escape is always wired, so the trap is never a room without a door.
//
// ── Finding focusables through a shadow boundary ────────────────────────
//
// `document.activeElement` reports the shadow HOST when focus is inside a
// shadow tree, not the focused control — so every "where is focus now" check
// here goes through `shadowRoot.activeElement`, and the restore target is
// captured before the shadow tree ever takes focus.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface FocusTrap {
  /** Removes the key handler. Does not move focus — {@link restoreFocus} does that. */
  release(): void;
}

/**
 * Every tabbable element inside `container`, in DOM order.
 *
 * Filters on rendered-ness rather than on a `hidden` attribute: the panel keeps
 * its send button in the tree while disabled and its "load older" button
 * hidden, and a trap that cycles onto an invisible control strands the user on
 * a stop they cannot see. `offsetParent === null` catches `display: none` at
 * any ancestor; the explicit `visibility` read catches the panel's own closed
 * state, which uses `visibility: hidden` so it can transition.
 */
export function tabbableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if (element.hasAttribute('hidden')) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    if (element.offsetParent === null && getComputedStyle(element).position !== 'fixed') return false;
    return getComputedStyle(element).visibility !== 'hidden';
  });
}

/**
 * Cycles Tab within `container` until released.
 *
 * Listens on the container rather than on `document`: a `keydown` inside a
 * shadow tree retargets to the host by the time it reaches the document, so a
 * document-level handler cannot tell which of our controls was focused — and,
 * more importantly, a container-scoped listener cannot intercept a key the
 * user pressed somewhere else on the host's page.
 */
export function trapFocus(container: HTMLElement, shadow: ShadowRoot): FocusTrap {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;

    const stops = tabbableWithin(container);
    if (stops.length === 0) {
      // Nothing to cycle between: hold focus on the container itself rather
      // than letting Tab escape a panel that claims to be modal.
      event.preventDefault();
      return;
    }

    const first = stops[0];
    const last = stops[stops.length - 1];
    if (first === undefined || last === undefined) return;

    // `shadow.activeElement`, not `document.activeElement` — see the header.
    const active = shadow.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKeyDown);
  return {
    release() {
      container.removeEventListener('keydown', onKeyDown);
    },
  };
}

/**
 * Remembers what had focus before the panel opened.
 *
 * Returns a restore function rather than storing state in a module: two
 * widgets on one page (a support bubble and an order-status sidebar) would
 * otherwise share one "previously focused" slot and restore each other's.
 */
export function captureFocus(): () => void {
  const previous = document.activeElement;

  return () => {
    if (previous === null) return;
    if (!(previous instanceof HTMLElement)) return;
    // The node may have been unmounted by the host while the panel was open —
    // an SPA route change behind an open chat is entirely normal. Focusing a
    // detached element silently moves focus to `<body>`, which is a worse
    // outcome than leaving it where the browser put it.
    if (!previous.isConnected) return;
    try {
      previous.focus({ preventScroll: true });
    } catch {
      // Some elements throw on focus in older engines. Nothing to recover.
    }
  };
}
