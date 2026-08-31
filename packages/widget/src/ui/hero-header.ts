// The tall branded header — the console's `design: 'hero'`.
//
// ── What "hero" means HERE, which is not quite what it means in the console ─
//
// In `chatsupport_react` the hero is a HOME SCREEN: a tall panel with a
// greeting and a "send us a message" card, and picking that card is what opens
// a conversation. It collapses to a 66px bar once the visitor scrolls into one.
//
// This widget NOW has that home/conversation split (`ui/screens.ts`,
// `ui/home-screen.ts`), and the hero is mounted as the Home screen's own
// banner — `widget.ts` shows it exactly while `screens.current() === 'home'`
// and `design === 'hero'`. Before that wiring landed, this widget's panel WAS
// the conversation, and the hero stood in for a home screen by keying off
// "the transcript is EMPTY" instead; that is no longer how any of it works,
// but it is worth naming here because the trigger below reads similarly and
// is a different thing:  `.dh-hero[data-empty="true"]` — "this hero has
// nothing to draw" — is unrelated to which SCREEN is showing.
//
// The CTA calls `onCallToAction`, which `widget.ts` wires to the same
// "open the new-conversation surface" flow the Home screen's own CTA card
// uses (`ui/home-screen.ts`) and the Messages screen's "New conversation"
// button uses — three affordances, one destination. A merchant who enables
// both this CTA (`header.ctaEnabled`) and relies on Home's own card gets two
// visually different buttons that do the same thing; that overlap is a
// console/design question, not something this component resolves on its own.
//

// ── Everything here is merchant-supplied ────────────────────────────────
//
// Greetings, CTA copy, logo and avatar URLs all come from a console over a
// public endpoint. Text goes through `el`'s `textContent` and images through
// `safeImageUrl`, both without exception — see ui/dom.ts's header for why
// `innerHTML` has no entry point in this package at all.

import type { HeaderAppearance } from '../config.js';

import { el, safeImageUrl } from './dom.js';

/** The hero's own copy and imagery — the half of the header that is content. */
export interface HeroContent {
  readonly showLogo: boolean;
  readonly logoUrl: string;
  readonly showAvatars: boolean;
  readonly showPresence: boolean;
  readonly avatars: readonly string[];
  readonly greeting: string;
  readonly subGreeting: string;
  readonly ctaEnabled: boolean;
  readonly ctaTitle: string;
  readonly ctaSubtitle: string;
}

export interface HeroHeaderView {
  readonly node: HTMLElement;
  /** Rebuilds the hero from a new appearance. Cheap; runs at most once per publish. */
  render(content: HeroContent): void;
}

/**
 * How many faces the row shows.
 *
 * Three, the console's own cap, enforced again here rather than trusted: the
 * field is a plain array on an opaque blob, and a fourth avatar would overflow
 * the row rather than being ignored the way an older console version's
 * validation would have.
 */
const MAX_AVATARS = 3;

export interface HeroHeaderCallbacks {
  /**
   * The CTA was pressed. See the module header — there is no conversation to
   * start, so the caller focuses the composer.
   */
  onCallToAction(): void;
}

export function createHeroHeader(callbacks: HeroHeaderCallbacks): HeroHeaderView {
  // `aria-hidden` on the whole block, and this is deliberate rather than
  // careless. Every string in it is decoration that the panel already conveys:
  // the greeting repeats what the composer's placeholder asks for, the logo
  // and faces are branding, and the CTA's only action is to focus a composer
  // a keyboard user reaches by pressing Tab once. Announcing all of it before
  // the conversation would put four lines of marketing in front of a screen
  // reader user every time they open the chat.
  const node = el('div', { attrs: { class: 'dh-hero', hidden: true, 'aria-hidden': 'true' } });

  function render(content: HeroContent): void {
    const children: Node[] = [];

    const logo = content.showLogo ? safeImageUrl(content.logoUrl) : null;
    if (logo !== null) {
      children.push(el('img', { attrs: { class: 'dh-hero-logo', src: logo, alt: '' } }));
    }

    const avatars = content.avatars
      .map((url) => safeImageUrl(url))
      .filter((url): url is string => url !== null)
      .slice(0, MAX_AVATARS);

    if (content.showAvatars && avatars.length > 0) {
      children.push(
        el('div', {
          attrs: { class: 'dh-hero-avatars' },
          children: avatars.map((src, index) =>
            el('span', {
              attrs: { class: 'dh-hero-avatar' },
              children: [
                el('img', { attrs: { src, alt: '' } }),
                // The presence dot rides the LAST face only — it says "someone
                // is here", not "this particular person is", so one is the
                // honest number regardless of how many faces are shown.
                ...(content.showPresence && index === avatars.length - 1
                  ? [el('span', { attrs: { class: 'dh-hero-presence' } })]
                  : []),
              ],
            }),
          ),
        }),
      );
    }

    if (content.greeting !== '') {
      children.push(el('p', { attrs: { class: 'dh-hero-greeting' }, text: content.greeting }));
    }
    if (content.subGreeting !== '') {
      children.push(el('p', { attrs: { class: 'dh-hero-sub' }, text: content.subGreeting }));
    }

    if (content.ctaEnabled && content.ctaTitle !== '') {
      children.push(
        el('button', {
          attrs: {
            class: 'dh-hero-cta',
            type: 'button',
            // Focusable despite the block's `aria-hidden`? No — and that is
            // why it is removed from the tab order explicitly. A focusable
            // control inside an aria-hidden subtree is the one combination
            // that genuinely breaks assistive tech, because focus lands
            // somewhere the screen reader insists does not exist. The composer
            // it would have focused is the very next tab stop anyway.
            tabindex: '-1',
          },
          children: [
            el('span', {
              attrs: { class: 'dh-hero-cta-text' },
              children: [
                el('span', { attrs: { class: 'dh-hero-cta-title' }, text: content.ctaTitle }),
                ...(content.ctaSubtitle === ''
                  ? []
                  : [el('span', { attrs: { class: 'dh-hero-cta-sub' }, text: content.ctaSubtitle })]),
              ],
            }),
          ],
          on: { click: () => callbacks.onCallToAction() },
        }),
      );
    }

    node.replaceChildren(...children);
    // An empty hero is not a short hero — a merchant who turned off every
    // piece of it has turned the block off, and a bare coloured slab above the
    // transcript would read as a rendering failure rather than as their
    // choice. The caller's own visibility rule still applies on top of this.
    node.dataset['empty'] = children.length === 0 ? 'true' : 'false';
  }

  return { node, render };
}

/**
 * The hero's content, assembled from the two places the console keeps it.
 *
 * `header.logoUrl` is the hero's own logo; `appearance.logoUrl` is the brand
 * mark the console writes when `avatarMode` is `'logo'`. A merchant who
 * uploaded one and not the other means the same thing by either, so the
 * header's own wins and the top-level one stands behind it — which is the
 * difference between `showLogo: true` rendering something and rendering
 * nothing at all.
 */
export function heroContentFrom(
  header: HeaderAppearance,
  fallbackLogoUrl: string,
): HeroContent {
  return {
    showLogo: header.showLogo,
    logoUrl: header.logoUrl.trim() === '' ? fallbackLogoUrl : header.logoUrl,
    showAvatars: header.showAvatars,
    showPresence: header.showPresence,
    avatars: header.avatars,
    greeting: header.greeting,
    subGreeting: header.subGreeting,
    ctaEnabled: header.ctaEnabled,
    ctaTitle: header.ctaTitle,
    ctaSubtitle: header.ctaSubtitle,
  };
}
