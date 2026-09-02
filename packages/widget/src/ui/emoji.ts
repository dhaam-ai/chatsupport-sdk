// The emoji picker: a small fixed palette in a popover above the composer.
//
// ── Why a fixed list and not a full emoji keyboard ───────────────────────
//
// Every platform already ships one, reachable from the same textarea. What a
// support widget adds on top is a SHORTLIST — the dozen-odd reactions that
// actually occur in a support thread — so this is a shortcut, not a
// replacement. That framing is also what keeps it affordable: a real picker
// means a searchable index of ~1900 emoji plus skin-tone variants, which is
// several times the entire widget's budget for a feature nobody embeds a chat
// SDK to get.
//
// ── Three deliberate departures from the React widget ────────────────────
//
// 1. Inserts AT THE CARET (`setRangeText`), not by appending to the end. The
//    React version does `onChange(value + emoji)`, which silently teleports
//    the emoji to the end of a half-written sentence whenever the customer
//    had clicked back into the middle of it.
// 2. Returns focus to the textarea and leaves the caret after the inserted
//    character, so typing continues where it left off. The React version
//    refocuses nothing, so the next keystroke goes nowhere.
// 3. Stays OPEN after a pick. The React version closes on every insertion,
//    which makes "🎉🎉" two round trips through the trigger button. Escape,
//    an outside click, or the trigger closes it.

import { el } from './dom.js';

/**
 * The shortlist, in display order — 8 columns x 2 rows.
 *
 * Deliberately the same 16 as the React widget, in the same order: a customer
 * who has used one surface should find the same glyph in the same place in the
 * other, and this list has already been through product review once.
 */
const EMOJI = [
  '👍', '🙏', '😊', '😕', '😡', '🎉', '❤️', '🔥',
  '✅', '❌', '🍕', '📦', '🚚', '💳', '⏰', '❓',
] as const;

const COLUMNS = 8;

export interface EmojiPickerCallbacks {
  /** The customer picked one. The picker stays open. */
  readonly onSelect: (emoji: string) => void;
}

export interface EmojiPickerView {
  /**
   * The one node to mount — a `position: relative` wrapper holding both the
   * trigger and its popover, so it lands correctly wherever the composer row
   * places it without depending on an ancestor establishing a positioning
   * context. Same self-contained shape as the session switcher.
   */
  readonly node: HTMLElement;
  setEnabled(enabled: boolean): void;
  isOpen(): boolean;
  close(): void;
  destroy(): void;
}

export function createEmojiPicker(callbacks: EmojiPickerCallbacks): EmojiPickerView {
  let open = false;

  const trigger = el('button', {
    attrs: {
      class: 'dh-icon-button',
      type: 'button',
      'aria-label': 'Insert emoji',
      'aria-expanded': 'false',
      'aria-haspopup': 'true',
    },
    // A text glyph rather than an SVG from ICONS: the control's whole subject
    // is emoji, so the most legible icon for it is one. `aria-hidden` because
    // the button's own `aria-label` already names it — without that a screen
    // reader announces "grinning face, Insert emoji".
    children: [el('span', { attrs: { class: 'dh-emoji-glyph', 'aria-hidden': 'true' }, text: '🙂' })],
    on: { click: () => toggle() },
  });

  const buttons = EMOJI.map((emoji, index) =>
    el('button', {
      attrs: {
        class: 'dh-emoji-cell',
        type: 'button',
        'aria-label': `Insert ${emoji}`,
        // Roving tabindex: the grid is ONE tab stop, and arrows move within
        // it. Sixteen separate tab stops between the attach button and the
        // textarea would make Tab unusable for a keyboard customer who only
        // wanted to reach the message box.
        tabindex: index === 0 ? '0' : '-1',
      },
      text: emoji,
      on: {
        click: () => callbacks.onSelect(emoji),
        keydown: (event) => onGridKeydown(event as KeyboardEvent, index),
      },
    }),
  );

  const grid = el('div', {
    attrs: { class: 'dh-emoji-grid', role: 'group', 'aria-label': 'Emoji' },
    children: buttons,
  });

  const popover = el('div', {
    attrs: { class: 'dh-emoji-popover', hidden: true },
    children: [grid],
  });

  const node = el('div', { attrs: { class: 'dh-emoji' }, children: [trigger, popover] });

  function focusCell(index: number): void {
    const target = buttons[index];
    if (target === undefined) return;
    for (const button of buttons) button.setAttribute('tabindex', '-1');
    target.setAttribute('tabindex', '0');
    target.focus({ preventScroll: true });
  }

  function onGridKeydown(event: KeyboardEvent, index: number): void {
    // Wrapping arithmetic in both axes, so a customer holding Right never
    // hits a dead end and has to work out which key gets them moving again.
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const delta = moves[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      focusCell((index + delta + buttons.length) % buttons.length);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusCell(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusCell(buttons.length - 1);
    }
  }

  // `composedPath()[0]`, not `event.target`: this listener lives on the
  // document, OUTSIDE the shadow tree, so a press on one of our own cells is
  // retargeted and reports the shadow HOST as its target — which
  // `node.contains` rejects, closing the popover DURING the press and
  // swallowing the click a real pointer was producing. Full story on
  // header-menu.ts's onOutside; same cure as session-picker.ts.
  function onDocumentPointerDown(event: Event): void {
    const pressed = event.composedPath()[0] ?? event.target;
    if (!node.contains(pressed as Node)) close();
  }

  function onDocumentKeydown(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.key !== 'Escape' || !open) return;
    // Capture phase + stopPropagation: the widget panel has its own Escape
    // handler that closes the WHOLE panel, and without this an Escape meant
    // for the popover would shut the conversation instead. Same reasoning the
    // React widget's useDismissable documents.
    key.stopPropagation();
    close();
    trigger.focus({ preventScroll: true });
  }

  function toggle(): void {
    if (open) {
      close();
      return;
    }
    open = true;
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    // Listeners are registered only while open. A widget that lives as long as
    // the tab does must not hold two document-level listeners for a popover
    // that is shut 99% of the time.
    document.addEventListener('pointerdown', onDocumentPointerDown);
    document.addEventListener('keydown', onDocumentKeydown, true);
    focusCell(0);
  }

  function close(): void {
    if (!open) return;
    open = false;
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocumentPointerDown);
    document.removeEventListener('keydown', onDocumentKeydown, true);
  }

  return {
    node,
    setEnabled(enabled) {
      trigger.disabled = !enabled;
      // A disabled trigger with an open popover would be unreachable and
      // unclosable by pointer — shut it rather than stranding it.
      if (!enabled) close();
    },
    isOpen: () => open,
    close,
    destroy() {
      close();
    },
  };
}

/**
 * Inserts text at the caret, leaving the caret after it.
 *
 * Split out from the picker because it is the part worth testing directly and
 * it is a pure function of the textarea's own state. `setRangeText` handles
 * the selection-replacement case for free — typing over a selected word
 * replaces it, which is what every other text control on the page does.
 */
export function insertAtCaret(input: HTMLTextAreaElement, text: string): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(text, start, end, 'end');
  input.focus({ preventScroll: true });
}
