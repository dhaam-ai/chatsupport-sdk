// The conversation header's ⋯ menu.
//
// ── Every item here does something ───────────────────────────────────────
//
// The reference design shows five, and all five are backed by something real
// before they were built. That check is the point of this comment, because the
// alternative — a menu item that looks like a feature and does nothing — is a
// promise the product breaks in front of the customer, and it is the trap this
// codebase has already documented twice (the emailed transcript before its
// route existed; edit/delete, which have no protocol frame and were therefore
// left out of the per-message menu).
//
//   Mute / Unmute notifications → silences the local chime (ui/chime.ts), or
//                         gives it back. Per BROWSER, not per tenant: it is
//                         this visitor's preference about noise on their own
//                         machine, and there is nothing to sync it to. The
//                         label states the ACTION and therefore flips — see
//                         `setMuted` for why that ruled out checkbox
//                         semantics.
//   Start new conversation → core's `startNewSession`.
//   End conversation    → core's `closeSession`, over chat-service's own
//                         `POST /chat/sessions/:id/close` (customer-owned).
//   Report an issue     → ui/report-issue.ts, filing a real nexusai ticket.
//   Privacy             → `behaviour.privacyUrl`. HIDDEN when the merchant
//                         has not set one, rather than linking nowhere.
//
// ── Why End is styled as destructive and confirms ────────────────────────
//
// Closing is not reversible from this side: chat-service reopens a session on
// the agent's say-so, not the customer's, so a mis-tap ends the conversation
// they were in the middle of. It is the one item here with a consequence the
// customer cannot undo, so it is coloured as such and asks once — inside the
// widget, through ui/end-conversation.ts, in the same surface slot every
// other form uses; never through the browser's own `confirm()`.

import { ICONS, el, icon, safeLinkUrl } from './dom.js';

export interface HeaderMenuCallbacks {
  readonly onStartNew: () => void;
  readonly onEndConversation: () => void;
  readonly onReportIssue: () => void;
  /** Toggles the local chime. Receives the NEW muted state. */
  readonly onMuteChange: (muted: boolean) => void;
}

export interface HeaderMenuView {
  readonly node: HTMLElement;
  /**
   * @param canEnd  whether there is a live conversation to end — the item is
   *   hidden otherwise, because "End conversation" on an already-closed one
   *   would do nothing and look broken.
   * @param privacyUrl the merchant's policy, or `''` to offer no Privacy item.
   * @param reportIssue whether the merchant offers the report form.
   */
  update(options: {
    canEnd: boolean;
    privacyUrl: string;
    reportIssue: boolean;
    muted: boolean;
  }): void;
  close(): void;
  destroy(): void;
}

/** Menu glyphs. Outlines, matching the rest of this package's icon set. */
const MENU_ICONS = {
  mute: ['M17 17H5l1.4-1.4A5 5 0 0 0 8 12V9a4 4 0 0 1 5-3.9', 'M18 8a4 4 0 0 0-1.2-2.9', 'M3 3l18 18'],
  unmute: ['M17 17H5l1.4-1.4A5 5 0 0 0 8 12V9a4 4 0 1 1 8 0v3a5 5 0 0 0 1.6 3.6L19 17', 'M10 20a2 2 0 0 0 4 0'],
  newChat: ['M11 4h-5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5', 'M18.4 2.6a2 2 0 0 1 2.8 2.8L12 14.6l-4 1 1-4Z'],
  end: ['M12 8v5', 'M12 16.5h.01', 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z'],
  flag: ['M4 21V4', 'M4 4h11l-1.5 3.5L15 11H4'],
  shield: ['M12 3l7.5 3v5.5c0 4.2-3 7.7-7.5 9-4.5-1.3-7.5-4.8-7.5-9V6L12 3Z'],
} as const;

export function createHeaderMenu(callbacks: HeaderMenuCallbacks): HeaderMenuView {
  let muted = false;

  const item = (
    glyph: readonly string[],
    label: string,
    onClick: () => void,
    extraClass = '',
  ): HTMLButtonElement => {
    const node = el('button', {
      attrs: { class: `dh-hmenu-item ${extraClass}`.trim(), type: 'button', role: 'menuitem' },
      children: [icon(glyph, 16), el('span', { text: label })],
      on: {
        click: () => {
          close();
          onClick();
        },
      },
    });
    return node;
  };

  const muteLabel = el('span', { text: 'Mute notifications' });
  const muteGlyph = el('span', { attrs: { class: 'dh-hmenu-glyph' }, children: [icon(MENU_ICONS.unmute, 16)] });
  // `role="menuitem"`, NOT `menuitemcheckbox` — see `setMuted`.
  const mute = el('button', {
    attrs: { class: 'dh-hmenu-item', type: 'button', role: 'menuitem' },
    children: [muteGlyph, muteLabel],
    on: {
      click: () => {
        close();
        setMuted(!muted);
        callbacks.onMuteChange(muted);
      },
    },
  });

  /**
   * ── Why this item is a plain menuitem whose label flips ──────────────────
   *
   * The label states the ACTION: "Mute notifications" while sound is on,
   * "Unmute notifications" once it is off. It used to be pinned to "Mute
   * notifications" forever, with only the glyph changing, which left the one
   * word that says what pressing it does permanently lying.
   *
   * A flipping action label cannot coexist with the `role="menuitemcheckbox"`
   * + `aria-checked` this item used to carry: once muted, that combination
   * announces "Unmute notifications, checked", which asserts the opposite of
   * what the control will do. The escape — keeping the checkbox and pinning a
   * stable `aria-label` — is worse, not better: the accessible name would then
   * no longer contain the visible label, which is a WCAG 2.5.3 (Label in Name)
   * failure and leaves a voice-control user saying "unmute notifications" at a
   * control the browser knows only as "mute notifications".
   *
   * So the checkbox semantics go and the item becomes what it always behaved
   * like: a command named after its effect. Its state is still legible — from
   * the label itself, and from the struck-through bell beside it.
   */
  function setMuted(next: boolean): void {
    muted = next;
    muteLabel.textContent = muted ? 'Unmute notifications' : 'Mute notifications';
    muteGlyph.replaceChildren(icon(muted ? MENU_ICONS.mute : MENU_ICONS.unmute, 16));
  }

  const startNew = item(MENU_ICONS.newChat, 'Start new conversation', () => callbacks.onStartNew());
  const endChat = item(MENU_ICONS.end, 'End conversation', () => callbacks.onEndConversation(), 'dh-hmenu-danger');
  const report = item(MENU_ICONS.flag, 'Report an issue', () => callbacks.onReportIssue());

  // An anchor, not a button: it opens the merchant's own page, and a real link
  // is what gives the customer middle-click, "open in new tab" and a visible
  // destination on hover — all of which a button-plus-`window.open` takes away.
  const privacy = el('a', {
    attrs: {
      class: 'dh-hmenu-item',
      role: 'menuitem',
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    children: [icon(MENU_ICONS.shield, 16), el('span', { text: 'Privacy' })],
    on: { click: () => close() },
  });

  const menu = el('div', {
    attrs: { class: 'dh-hmenu', hidden: true, role: 'menu', 'aria-label': 'Conversation options' },
    children: [mute, startNew, endChat, report, privacy],
  });

  const toggle = el('button', {
    attrs: {
      class: 'dh-icon-button dh-hmenu-toggle',
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': 'Conversation options',
    },
    children: [icon(ICONS.more, 18)],
    on: {
      click: (event) => {
        event.stopPropagation();
        if (menu.hidden) open();
        else close();
      },
    },
  });

  const node = el('div', { attrs: { class: 'dh-hmenu-wrap' }, children: [toggle, menu] });

  // `composedPath()[0]`, not `event.target`: this listener lives on the
  // document, OUTSIDE the shadow tree, so a press on one of our own items is
  // retargeted and reports the shadow HOST as its target — which
  // `node.contains` rejects, closing the menu DURING the press. A menu hidden
  // between pointerdown and pointerup swallows the click those events were
  // producing, so under a real pointer every item "did nothing", while a
  // synthetic `.click()` (which dispatches no pointerdown) worked — which is
  // exactly how automation passed this menu and a human failed it. Same trap,
  // same cure as session-picker.ts's onOutsidePointerDown.
  const onOutside = (event: Event): void => {
    const pressed = event.composedPath()[0] ?? event.target;
    if (!node.contains(pressed as Node)) close();
  };

  function open(): void {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside);
    // Focus the first item that is actually offered — the list is conditional,
    // so `menu.firstElementChild` is not reliably visible.
    const first = [...menu.children].find((c) => !(c as HTMLElement).hidden) as HTMLElement | undefined;
    first?.focus();
  }

  function close(): void {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside);
  }

  // Escape closes the MENU and is stopped there. Without this the panel's own
  // Escape handler closes the entire widget because somebody dismissed a menu.
  node.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Escape' || menu.hidden) return;
    event.stopPropagation();
    close();
    toggle.focus();
  });

  return {
    node,
    update({ canEnd, privacyUrl, reportIssue, muted: nextMuted }) {
      setMuted(nextMuted);
      endChat.hidden = !canEnd;
      report.hidden = !reportIssue;

      const href = safeLinkUrl(privacyUrl);
      // Hidden rather than linking nowhere, and run through the same allowlist
      // the branding link uses — this is merchant-supplied and lands in an
      // `href`, so `javascript:` has to be unreachable rather than unlikely.
      privacy.hidden = href === null;
      if (href !== null) privacy.setAttribute('href', href);
    },
    close,
    destroy() {
      document.removeEventListener('pointerdown', onOutside);
    },
  };
}
