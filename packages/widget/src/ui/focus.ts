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
//
// ── What a green test suite does NOT prove about this file ───────────────
//
// Every test covering this module runs in jsdom, and jsdom's focus model is
// more permissive than any real browser's in three ways that matter here:
//
//   1. It focuses HIDDEN elements. `display: none`, `visibility: hidden` and
//      the `hidden` attribute are all no-ops to `.focus()` in a browser;
//      jsdom moves `activeElement` onto them anyway.
//   2. It focuses DETACHED elements. A browser drops focus to `<body>`.
//   3. It does NOT blur an element that becomes hidden while focused. A
//      browser does.
//
// So a test can watch focus land somewhere a real user could never reach it,
// and pass. The defences against all three — the semantic hidden-ness test in
// `tabbableWithin`, and the `isConnected` guards in `captureFocus` and
// `preserveListFocus` — are therefore UNFALSIFIABLE by this project's tests,
// by construction. They are load-bearing anyway. Do not delete one because
// removing it left the suite green, and do not read a green suite as evidence
// that focus behaves in Chrome the way it behaves here.

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
 * Hidden-ness is decided SEMANTICALLY — the `hidden` attribute, `aria-hidden`,
 * and computed `display`/`visibility` up the ancestor chain — rather than from
 * layout. The layout test everyone reaches for first, `offsetParent === null`,
 * is wrong here twice over: it reports `null` for any `position: fixed`
 * element, which is what this widget's panel is, so the obvious version needs
 * a `position === 'fixed'` exemption bolted on; and it is unimplemented in
 * jsdom, where it returns `null` for every node, so the exemption cannot be
 * tested and the trap silently degrades to "no stops at all".
 *
 * The bias when a check is inconclusive is toward INCLUDING an element. A
 * false include costs one dead tab stop; a false exclude lets a user tab out
 * of a panel that has just told their screen reader it is modal.
 */
export function tabbableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !isHidden(element, container),
  );
}

function isHidden(element: HTMLElement, container: HTMLElement): boolean {
  let node: HTMLElement | null = element;
  while (node !== null) {
    if (node.hasAttribute('hidden')) return true;
    if (node.getAttribute('aria-hidden') === 'true') return true;

    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;

    // Stops at the trap's own container: everything above it belongs to the
    // host page, whose styles are none of our business and whose ancestors we
    // would otherwise walk all the way to `<html>` on every Tab keypress.
    if (node === container) return false;
    node = node.parentElement;
  }
  return false;
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

// ── Keeping the keyboard inside a list that re-renders under it ──────────
//
// A list that removes rows has a focus problem the moment removal stops
// being the user's own doing. Deleting the focused element does NOT hand
// focus to a sibling: the browser resets the document's focus to `<body>`,
// and for a shadow-DOM widget that means focus leaves the shadow root and
// the widget entirely — the next Tab restarts from the top of the HOST page,
// behind the still-open panel, with nothing said about why.
//
// This became reachable without any user action when CLOSED conversations
// started LEAVING the conversation list rather than merely relabelling
// themselves: the portal queue re-polls every 20 seconds, so a conversation
// somebody else closes can delete the row the keyboard is sitting on.

/** The element with focus inside `container`, seen through the shadow boundary. */
function focusedWithin(container: HTMLElement): HTMLElement | null {
  const root = container.getRootNode();
  // `document.activeElement` reports the shadow HOST for anything focused
  // inside the tree, so the question has to be asked of the root that
  // actually owns the node — `ShadowRoot` when mounted in one, `Document`
  // otherwise. A detached subtree's root is a plain `DocumentFragment`,
  // which has no `activeElement` and no focus to lose.
  if (!(root instanceof Document) && !(root instanceof ShadowRoot)) return null;
  const active = root.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  return container.contains(active) ? active : null;
}

/**
 * What {@link preserveListFocus} did, so the caller can say so out loud.
 *
 * Only `moved` and `emptied` are worth announcing: they are the two outcomes
 * where the user's own place went away and focus is somewhere they did not
 * put it. `restored` deliberately is not — the row is still there and focus
 * is back on the same control, so there is nothing a person would notice and
 * nothing they need told.
 */
export type ListFocusOutcome =
  /** Focus was not in this list, or was and stayed put. Nothing happened. */
  | { readonly kind: 'untouched' }
  /** Same row, same control — a re-order dropped focus and it was put back. */
  | { readonly kind: 'restored' }
  /** The row went away; focus is now on `id`, a different conversation. */
  | { readonly kind: 'moved'; readonly id: string }
  /** The row went away and none was left; focus is on the fallback. */
  | { readonly kind: 'emptied' };

const UNTOUCHED: ListFocusOutcome = { kind: 'untouched' };

/**
 * Call BEFORE a list re-render; call the returned function AFTER rows have
 * been removed and re-filtered.
 *
 * If the row holding focus is still there afterwards, this does nothing at
 * all — focus never moved, so moving it would be the disruption. If that row
 * is gone, focus goes to the nearest row that survived, searching FORWARD
 * from the lost row's old position first and then backward, so the keyboard
 * lands where the list carried on rather than at the top of it. When no row
 * survives at all, `fallback` takes it — the list's own search box, which is
 * the control the emptied list belongs to and which does nothing to anyone's
 * data if the user's next keystroke was already on its way.
 *
 * `orderedIds` must be the order the rows are rendered in, captured before
 * the render mutates anything; `nodeFor` must return `undefined` for a row
 * that has been removed.
 *
 * EVERY landing place — the user's own row restored as much as a substitute
 * one — is taken from {@link tabbableWithin}, which returns nothing for a row
 * hidden by a tab or a search query. A row that is out of sight is therefore
 * never chosen on either path, and a row that survived but is now hidden is
 * treated exactly like a removed one.
 *
 * Connectedness alone is deliberately NOT the test. A hidden element is still
 * connected, and `.focus()` on one is a no-op in a real browser, so trusting
 * `isConnected` would "restore" focus somewhere it cannot go and leave the
 * user on `<body>` — which is the precise failure this function exists to
 * prevent. jsdom will not catch that mistake for you; see the note in this
 * file's header.
 *
 * ── Scrolling ──
 *
 * The two paths answer this differently, on purpose (user decision, T4-R2).
 *
 * A RESCUE — landing on a different row, or on the fallback — scrolls. It
 * only ever fires because the user's focus was already in this list, so
 * somebody is present to be re-oriented, and a focus ring parked off-screen
 * reads as "my focus vanished", which is the very complaint this whole
 * function exists to answer.
 *
 * A RESTORE keeps `preventScroll`. That row was on screen a moment ago by
 * definition — it is the one the user was sitting on — so scrolling to it
 * would be a jump with no cause behind it.
 */
export function preserveListFocus(
  orderedIds: readonly string[],
  nodeFor: (id: string) => HTMLElement | undefined,
  fallback: HTMLElement,
): () => ListFocusOutcome {
  const held = focusedRow(orderedIds, nodeFor);
  // Nothing in this list had focus, so nothing here has any business moving
  // it. This is the overwhelmingly common case — an unattended poll while
  // the user is somewhere else entirely — and it must stay a no-op.
  if (held === undefined) return () => UNTOUCHED;

  const { index, id, element } = held;

  return () => {
    const row = nodeFor(id);

    if (row !== undefined && row.isConnected) {
      // The row is still there. Usually so is the focus, and then the right
      // amount of intervention is none.
      if (focusedWithin(row) !== null) return UNTOUCHED;
      // But not always: a render that removes ANY row re-orders the ones
      // that remain, and `insertBefore` on an already-mounted node detaches
      // and reattaches it — which drops focus exactly as thoroughly as a
      // deletion does. The row the user chose still exists, so the honest
      // repair is to put the keyboard back on the control it was on, not to
      // treat this as a removal and move them somewhere new.
      //
      // `tabbableWithin` is the arbiter rather than `element.isConnected`,
      // because the same render that re-ordered this row may also have just
      // hidden it: `applyFilter()` re-tests the search query against the name,
      // status and preview the poll has only now rewritten, so a row the user
      // was sitting on can stop matching without the user touching anything.
      // The button inside a hidden row is still `isConnected`, so the
      // connectedness test would have "restored" focus to a control no real
      // browser will accept it on, leaving the user on `<body>`.
      const stops = tabbableWithin(row);
      const back = stops.includes(element) ? element : stops[0];
      if (back !== undefined) {
        // `preventScroll` KEPT — this row was already on screen. See above.
        back.focus({ preventScroll: true });
        return { kind: 'restored' };
      }
      // Nothing reachable left on the surviving row — hidden by the filter,
      // or its control went `disabled`. Deliberately NO early return: a row
      // nobody can reach is not a landing place, so fall through and treat
      // this as the removal it amounts to.
    }

    // Both branches below scroll — no `preventScroll`. See the docblock.
    const next = nearestRow(orderedIds, index, nodeFor);
    if (next !== undefined && next.element.isConnected) {
      next.element.focus();
      return { kind: 'moved', id: next.id };
    }
    if (fallback.isConnected) {
      fallback.focus();
      return { kind: 'emptied' };
    }
    // Nowhere left to put it. Saying nothing is right: we did not move focus,
    // so there is no move to explain.
    return UNTOUCHED;
  };
}

/** Which row of the list holds the keyboard right now, if any. */
function focusedRow(
  orderedIds: readonly string[],
  nodeFor: (id: string) => HTMLElement | undefined,
): { readonly index: number; readonly id: string; readonly element: HTMLElement } | undefined {
  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    if (id === undefined) continue;
    const node = nodeFor(id);
    if (node === undefined) continue;
    const element = focusedWithin(node);
    if (element === null) continue;
    return { index, id, element };
  }
  return undefined;
}

/**
 * The closest surviving row: forward from `from` first, then back.
 *
 * Returns the id alongside the control so the caller can NAME the place it
 * sent the user, which is the difference between an announcement that
 * explains the move and one that just says something moved.
 */
function nearestRow(
  orderedIds: readonly string[],
  from: number,
  nodeFor: (id: string) => HTMLElement | undefined,
): { readonly id: string; readonly element: HTMLElement } | undefined {
  for (let i = from + 1; i < orderedIds.length; i += 1) {
    const found = rowTarget(orderedIds[i], nodeFor);
    if (found !== undefined) return found;
  }
  for (let i = from - 1; i >= 0; i -= 1) {
    const found = rowTarget(orderedIds[i], nodeFor);
    if (found !== undefined) return found;
  }
  return undefined;
}

function rowTarget(
  id: string | undefined,
  nodeFor: (id: string) => HTMLElement | undefined,
): { readonly id: string; readonly element: HTMLElement } | undefined {
  if (id === undefined) return undefined;
  const node = nodeFor(id);
  // A detached node is not a landing place: focusing one silently drops
  // focus on `<body>`, which is the failure this whole helper exists to stop.
  if (node === undefined || !node.isConnected) return undefined;
  const element = tabbableWithin(node)[0];
  return element === undefined ? undefined : { id, element };
}
