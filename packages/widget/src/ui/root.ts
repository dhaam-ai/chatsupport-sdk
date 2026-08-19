// The boundary between our DOM and the host's.
//
// Exactly one element of ours ever enters the host document: `<dh-chat-widget>`.
// Everything else lives inside its shadow root, which is what makes the two
// promises in the brief true in both directions — the host's `.button { ... }`
// cannot match anything of ours, and our `.dh-send` cannot match anything of
// theirs.
//
// ── open, not closed ────────────────────────────────────────────────────
//
// `mode: 'open'` is a deliberate choice and it costs nothing that matters.
// Style encapsulation is identical either way — `closed` changes JS
// reachability, not the cascade — so the only thing `closed` would buy is
// hiding the tree from `element.shadowRoot`. Against that: every automated
// accessibility tool (axe-core, Lighthouse, the browser's own a11y inspector)
// walks shadow trees through that property, and a widget whose accessibility
// cannot be audited by the customer shipping it is worse than one whose
// internals a determined host script could reach anyway — which it always
// could, since the host is the page that chose to load us.
//
// ── Stacking: the top layer, not a bigger number ────────────────────────
//
// A shadow root does not lift its host out of the page's z-order. v1 wrote
// `z-index: 999999` and lost to any host bidding higher, which is a race that
// cannot be won by escalating — there is always a bigger integer, and the
// widget that "wins" is then covering the host's own cookie banner.
//
// So the container is put in the TOP LAYER via the popover API, which sits
// above every z-index in the document by construction and is not a number at
// all. `popover="manual"` rather than `"auto"`: an `auto` popover is
// light-dismissed by an outside click and closes the whole widget when a user
// clicks the page behind it, and auto popovers close each other, so a host
// opening their own would silently dismiss us.
//
// Where the API is missing (Safari <17, Firefox <125) we fall back to
// `2147483647` — the actual 32-bit maximum, so at worst we tie rather than
// lose, and never to a made-up six-digit number.

const HOST_TAG = 'dh-chat-widget';

export interface WidgetRoot {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  /** Removes the host element and everything under it. Idempotent. */
  destroy(): void;
}

export function createWidgetRoot(css: string): WidgetRoot {
  // A hyphenated tag name, but deliberately NOT a registered custom element:
  // `customElements.define` is a document-global namespace, so defining
  // `dh-chat-widget` would throw the second time the script loaded, and would
  // collide irrecoverably if the host had already defined that name. An
  // unregistered hyphenated tag is a plain `HTMLElement` with a name nothing
  // else will style.
  const host = document.createElement(HOST_TAG) as HTMLElement;
  host.setAttribute('data-dh-widget', '');

  const shadow = host.attachShadow({ mode: 'open' });

  // A `<style>` element rather than `adoptedStyleSheets`. Constructable
  // stylesheets would let several instances share one parsed sheet, but there
  // is normally exactly one widget on a page, so the saving is theoretical
  // while the cost — no support in older Safari, and none in jsdom, which
  // would make the styling untestable — is real.
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  // documentElement, not body: a framework that replaces `document.body`
  // wholesale (some SPA bootstraps still do) would take the widget with it,
  // and appending to `<html>` is equally valid for a fixed-position element.
  const parent: Node = document.body ?? document.documentElement;
  parent.appendChild(host);

  promoteToTopLayer(host);

  let destroyed = false;
  return {
    host,
    shadow,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        // Leaving an element in the top layer after removing it is a
        // documented way to strand it in some engines.
        if (isPopoverCapable(host)) host.hidePopover();
      } catch {
        // Already hidden, or never shown. Nothing to recover.
      }
      host.remove();
    },
  };
}

interface PopoverElement extends HTMLElement {
  showPopover(): void;
  hidePopover(): void;
}

function isPopoverCapable(element: HTMLElement): element is PopoverElement {
  return (
    typeof (element as Partial<PopoverElement>).showPopover === 'function' &&
    typeof (element as Partial<PopoverElement>).hidePopover === 'function'
  );
}

/**
 * Lifts the container into the top layer, or falls back to a z-index.
 *
 * Everything here is best-effort by design: a failure to reach the top layer
 * is a widget that might be painted under a host overlay, which is a cosmetic
 * problem. Letting the exception escape would be a widget that does not exist,
 * which is not. The fallback z-index is set FIRST and left in place either
 * way, so a browser that supports `popover` but refuses the call still has a
 * usable stacking position.
 */
function promoteToTopLayer(host: HTMLElement): void {
  host.style.setProperty('position', 'relative');
  host.style.setProperty('z-index', '2147483647');

  if (!isPopoverCapable(host)) return;

  try {
    host.setAttribute('popover', 'manual');
    host.showPopover();
    // A popover is `position: fixed` with a UA-supplied `inset: 0` and a
    // background/border; ours is a transparent container whose children are
    // themselves fixed, so all of that is cleared. `pointer-events: none` is
    // essential — the container spans the viewport in the top layer, and
    // without this it would swallow every click on the host's page. The
    // launcher and panel re-enable pointer events on themselves.
    host.style.setProperty('inset', '0');
    host.style.setProperty('width', 'auto');
    host.style.setProperty('height', 'auto');
    host.style.setProperty('max-width', 'none');
    host.style.setProperty('max-height', 'none');
    host.style.setProperty('margin', '0');
    host.style.setProperty('padding', '0');
    host.style.setProperty('border', '0');
    host.style.setProperty('background', 'transparent');
    host.style.setProperty('overflow', 'visible');
    host.style.setProperty('pointer-events', 'none');
  } catch {
    // `showPopover` throws if the element is not connected, or if the UA
    // declines. The z-index above still stands.
    host.removeAttribute('popover');
  }
}
