// The boundary between the standalone form's DOM and the host page's.
//
// ── Why this is not `ui/root.ts` ──────────────────────────────────────────
//
// That module builds a FLOATING container: it appends to `document.body`,
// promotes itself into the TOP LAYER via the popover API, spans the viewport
// and turns off pointer events so the page underneath stays clickable. Every
// one of those is correct for a launcher pinned to a corner and wrong for a
// form that is supposed to sit in a merchant's page flow, between their
// heading and their footer, taking part in their layout.
//
// So this one appends to the element the CALLER named, occupies normal flow,
// and touches nothing else in the document. It shares one decision with
// `ui/root.ts` and inherits its reasoning verbatim: the shadow root is OPEN.
//
// ── open, not closed ──────────────────────────────────────────────────────
//
// Style encapsulation is identical either way — `closed` changes JS
// reachability, not the cascade — so the only thing `closed` would buy is
// hiding the tree from `element.shadowRoot`. Against that: every automated
// accessibility tool (axe-core, Lighthouse, the browser's own a11y
// inspector) walks shadow trees through that property, and a form whose
// accessibility the merchant shipping it cannot audit is worse than one
// whose internals their own page could reach anyway — which it always could,
// since it is the page that chose to load us.
//
// ── An unregistered hyphenated tag, deliberately ──────────────────────────
//
// `customElements.define` is a document-global namespace. Defining
// `dh-web-form` would throw the second time this bundle loaded and would
// collide irrecoverably if the host had already defined that name. An
// unregistered hyphenated tag is a plain `HTMLElement` that nothing else on
// the page will style.

const HOST_TAG = 'dh-web-form';

export interface FormRoot {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  /** The element the form is built into. Carries the typography reset. */
  readonly root: HTMLElement;
  /** Removes the host element and everything under it. Idempotent. */
  destroy(): void;
}

/**
 * Builds the shadow host and appends it to `target`.
 *
 * APPENDS — it never clears `target`. Whatever a merchant already put in that
 * element is theirs, and a third-party script that empties a container it was
 * pointed at will one day delete a fallback "or email us at…" block that was
 * the whole point of the element. The cost is that a `<div>Loading…</div>`
 * placeholder stays on screen next to the form; a host who wants it gone
 * empties the element themselves, which is one line and is reversible. The
 * other direction is not.
 */
export function createFormRoot(target: Element, css: string): FormRoot {
  const host = document.createElement(HOST_TAG);
  // A hook a merchant's own stylesheet can target for width/margin, and the
  // marker a second `mountForm` on the same element looks for.
  host.setAttribute('data-dh-form', '');

  const shadow = host.attachShadow({ mode: 'open' });

  // A `<style>` element rather than `adoptedStyleSheets`, for the reason
  // `ui/root.ts` gives: constructable stylesheets have no support in older
  // Safari and none in jsdom, which would make the styling untestable, and
  // the sharing they buy is theoretical at one or two forms per page.
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  // The typography reset lives HERE rather than on ':host'. See
  // `ui/form-styles.ts`, note 2 — a host page's
  // `* { font-family: X !important }` matches the host element and beats
  // every ':host' rule, but cannot reach inside the shadow tree.
  const root = document.createElement('div');
  root.className = 'dh-form-root';
  shadow.appendChild(root);

  target.appendChild(host);

  let destroyed = false;
  return {
    host,
    shadow,
    root,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // Only our own element. Nothing was added to the document outside it,
      // no listener was attached above it, so removing it is the whole
      // teardown — there is no top-layer state to release the way
      // `ui/root.ts` has to.
      host.remove();
    },
  };
}
