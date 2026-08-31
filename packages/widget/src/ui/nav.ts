// The two-tab footer: Home and Messages.
//
// Mirrors the reference product's `ChatNavigation`. Two tabs, the active one
// solid and accented, the inactive one muted — and the unread count riding on
// the Messages tab, because that is where a customer goes to find the
// conversation it belongs to.
//
// ── Why a real tablist ───────────────────────────────────────────────────
//
// `role="tablist"` with `aria-selected`, not two buttons that happen to look
// selected. A screen reader then announces "Messages, tab, 2 of 2, selected",
// which is the whole of what the visual state is saying — and arrow-key
// movement between tabs is what a keyboard user expects once the role says
// tablist, so it is implemented rather than left as a promise the role makes.

import { el, icon, solidIcon } from './dom.js';
import type { ScreenName } from './screens.js';

/** The tabs this bar offers. `conversation` is not one — it has no tab. */
export type NavTab = Extract<ScreenName, 'home' | 'messages'>;

const NAV_ICONS: Record<NavTab, readonly string[]> = {
  // Filled house, matching the reference's own choice of a solid glyph for
  // Home and an outlined one for Messages.
  home: ['M11.47 3.84a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.06l-8.689-8.69a2.25 2.25 0 0 0-3.182 0l-8.69 8.69a.75.75 0 0 0 1.061 1.06l8.69-8.69Z', 'M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.625a1.875 1.875 0 0 1-1.875-1.875v-6.198a2.29 2.29 0 0 0 .091-.086L12 5.432Z'],
  messages: ['M8 10.5h8', 'M8 14h5', 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H9l-5 4V5.5Z'],
};

const SOLID_TABS: ReadonlySet<NavTab> = new Set<NavTab>(['home']);

export interface NavView {
  readonly node: HTMLElement;
  /** Marks `active` selected, and paints the unread badge. */
  update(active: ScreenName, unread: number): void;
}

export function createNav(onSelect: (tab: NavTab) => void): NavView {
  const tabs: Array<{ id: NavTab; label: string; node: HTMLButtonElement; badge: HTMLElement }> = [];

  const build = (id: NavTab, label: string) => {
    const badge = el('span', { attrs: { class: 'dh-nav-badge', hidden: true } });
    const glyph = SOLID_TABS.has(id) ? solidIcon(NAV_ICONS[id], 22) : icon(NAV_ICONS[id], 22);
    const node = el('button', {
      attrs: {
        class: 'dh-nav-tab',
        type: 'button',
        role: 'tab',
        'aria-selected': 'false',
        // Not in the tab order unless selected — the roving-tabindex the
        // tablist role implies. One Tab press moves past the whole bar; the
        // arrows move within it.
        tabindex: '-1',
      },
      children: [
        el('span', { attrs: { class: 'dh-nav-icon' }, children: [glyph, badge] }),
        el('span', { attrs: { class: 'dh-nav-label' }, text: label }),
      ],
      on: { click: () => onSelect(id) },
    });
    tabs.push({ id, label, node, badge });
    return node;
  };

  const node = el('nav', {
    attrs: { class: 'dh-nav', role: 'tablist', 'aria-label': 'Chat sections' },
    children: [build('home', 'Home'), build('messages', 'Messages')],
    on: {
      keydown: (event) => {
        const key = (event as KeyboardEvent).key;
        if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
        event.preventDefault();
        const at = tabs.findIndex((t) => t.node === document.activeElement || t.node.contains(document.activeElement));
        if (at === -1) return;
        const next = tabs[(at + (key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
        next.node.focus();
        onSelect(next.id);
      },
    },
  });

  return {
    node,
    update(active, unread) {
      for (const tab of tabs) {
        // A conversation is not a tab, so while one is open NEITHER reads as
        // selected — saying "Messages, selected" over a transcript the
        // customer opened from Home would be false.
        const selected = tab.id === active;
        tab.node.setAttribute('aria-selected', String(selected));
        tab.node.setAttribute('tabindex', selected ? '0' : '-1');
        if (tab.id !== 'messages') continue;
        tab.badge.hidden = unread <= 0;
        // Capped, because the badge is a 16px disc and a real count past 99
        // tells the customer nothing the cap does not.
        tab.badge.textContent = unread > 99 ? '99+' : String(unread);
        tab.node.setAttribute(
          'aria-label',
          unread > 0 ? `${tab.label}, ${unread} unread` : tab.label,
        );
      }
    },
  };
}
