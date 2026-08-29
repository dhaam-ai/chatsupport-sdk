// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmojiPicker, insertAtCaret } from '../src/ui/emoji.js';
import type { EmojiPickerView } from '../src/ui/emoji.js';

function cells(picker: EmojiPickerView): HTMLButtonElement[] {
  return [...picker.node.querySelectorAll<HTMLButtonElement>('.dh-emoji-cell')];
}

function trigger(picker: EmojiPickerView): HTMLButtonElement {
  const button = picker.node.querySelector<HTMLButtonElement>('.dh-icon-button');
  if (button === null) throw new Error('no trigger');
  return button;
}

describe('insertAtCaret', () => {
  let input: HTMLTextAreaElement;

  beforeEach(() => {
    input = document.createElement('textarea');
    document.body.appendChild(input);
  });

  afterEach(() => {
    input.remove();
  });

  // The React widget appends to the end of the draft, which teleports the
  // emoji out of a half-written sentence whenever the caret was in the middle.
  it('inserts at the caret rather than appending to the end', () => {
    input.value = 'thanks so much';
    input.setSelectionRange(6, 6);

    insertAtCaret(input, '👍');

    expect(input.value).toBe('thanks👍 so much');
  });

  it('leaves the caret after what it inserted, so typing continues in place', () => {
    input.value = 'hi';
    input.setSelectionRange(2, 2);

    insertAtCaret(input, '🎉');

    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('replaces a selection, like every other text control on the page', () => {
    input.value = 'that is bad';
    input.setSelectionRange(8, 11);

    insertAtCaret(input, '😡');

    expect(input.value).toBe('that is 😡');
  });

  it('appends when the textarea is empty', () => {
    insertAtCaret(input, '❤️');
    expect(input.value).toBe('❤️');
  });

  it('focuses the textarea so the next keystroke lands in it', () => {
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();

    insertAtCaret(input, '✅');

    expect(document.activeElement).toBe(input);
    other.remove();
  });
});

describe('createEmojiPicker', () => {
  let picker: EmojiPickerView;
  let selected: string[];

  beforeEach(() => {
    selected = [];
    picker = createEmojiPicker({ onSelect: (emoji) => selected.push(emoji) });
    document.body.appendChild(picker.node);
  });

  afterEach(() => {
    picker.destroy();
    picker.node.remove();
  });

  it('renders the 16-glyph shortlist in an 8-column grid', () => {
    expect(cells(picker)).toHaveLength(16);
    expect(cells(picker)[0]?.textContent).toBe('👍');
    expect(cells(picker)[15]?.textContent).toBe('❓');
  });

  it('starts closed, with the popover hidden and the trigger collapsed', () => {
    expect(picker.isOpen()).toBe(false);
    expect(picker.node.querySelector('.dh-emoji-popover')?.hasAttribute('hidden')).toBe(true);
    expect(trigger(picker).getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on the trigger and reports it to assistive tech', () => {
    trigger(picker).click();
    expect(picker.isOpen()).toBe(true);
    expect(trigger(picker).getAttribute('aria-expanded')).toBe('true');
    expect(picker.node.querySelector('.dh-emoji-popover')?.hasAttribute('hidden')).toBe(false);
  });

  it('gives every cell a distinct accessible name', () => {
    const labels = cells(picker).map((cell) => cell.getAttribute('aria-label'));
    expect(labels[0]).toBe('Insert 👍');
    expect(new Set(labels).size).toBe(16);
  });

  it('reports a pick to the caller', () => {
    trigger(picker).click();
    cells(picker)[5]?.click();
    expect(selected).toEqual(['🎉']);
  });

  // The React widget closes after every insertion, making two emoji two round
  // trips through the trigger.
  it('stays open after a pick so several can be inserted in a row', () => {
    trigger(picker).click();
    cells(picker)[0]?.click();
    cells(picker)[1]?.click();
    expect(selected).toEqual(['👍', '🙏']);
    expect(picker.isOpen()).toBe(true);
  });

  it('closes when the trigger is pressed again', () => {
    trigger(picker).click();
    trigger(picker).click();
    expect(picker.isOpen()).toBe(false);
  });

  it('closes on an outside pointerdown', () => {
    trigger(picker).click();
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(picker.isOpen()).toBe(false);
  });

  it('stays open on a pointerdown inside itself', () => {
    trigger(picker).click();
    cells(picker)[0]?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(picker.isOpen()).toBe(true);
  });

  // Load-bearing: the panel has its own Escape handler that closes the whole
  // conversation, so an un-stopped Escape here would shut the wrong thing.
  it('swallows the Escape that closes it, so the panel does not also close', () => {
    trigger(picker).click();
    const panelHandler = vi.fn();
    document.addEventListener('keydown', panelHandler);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(picker.isOpen()).toBe(false);
    expect(panelHandler).not.toHaveBeenCalled();
    document.removeEventListener('keydown', panelHandler);
  });

  it('lets an Escape through while it is already closed', () => {
    const panelHandler = vi.fn();
    document.addEventListener('keydown', panelHandler);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(panelHandler).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', panelHandler);
  });

  it('returns focus to the trigger on Escape', () => {
    trigger(picker).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(trigger(picker));
  });

  describe('roving focus — the grid is one tab stop, arrows move within it', () => {
    beforeEach(() => {
      trigger(picker).click();
    });

    it('gives exactly one cell a tabindex of 0', () => {
      const tabbable = cells(picker).filter((cell) => cell.getAttribute('tabindex') === '0');
      expect(tabbable).toHaveLength(1);
    });

    it('focuses the first cell on open', () => {
      expect(document.activeElement).toBe(cells(picker)[0]);
    });

    it.each([
      ['ArrowRight', 0, 1],
      ['ArrowLeft', 1, 0],
      ['ArrowDown', 0, 8],
      ['ArrowUp', 8, 0],
      ['End', 0, 15],
      ['Home', 5, 0],
    ])('%s moves focus from cell %i to cell %i', (key, from, to) => {
      cells(picker)[from]?.focus();
      cells(picker)[from]?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(document.activeElement).toBe(cells(picker)[to]);
    });

    // No dead ends: a customer holding an arrow key should never have to work
    // out which key gets them moving again.
    it.each([
      ['ArrowRight', 15, 0],
      ['ArrowLeft', 0, 15],
      ['ArrowDown', 8, 0],
      ['ArrowUp', 0, 8],
    ])('%s wraps from cell %i to cell %i', (key, from, to) => {
      cells(picker)[from]?.focus();
      cells(picker)[from]?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(document.activeElement).toBe(cells(picker)[to]);
    });

    it('moves the tabindex along with focus', () => {
      cells(picker)[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(cells(picker)[0]?.getAttribute('tabindex')).toBe('-1');
      expect(cells(picker)[1]?.getAttribute('tabindex')).toBe('0');
    });
  });

  describe('setEnabled', () => {
    it('disables the trigger', () => {
      picker.setEnabled(false);
      expect(trigger(picker).disabled).toBe(true);
    });

    // A disabled trigger with an open popover is unreachable and unclosable
    // by pointer.
    it('closes an open popover rather than stranding it behind a dead trigger', () => {
      trigger(picker).click();
      picker.setEnabled(false);
      expect(picker.isOpen()).toBe(false);
    });
  });

  it('releases its document listeners on destroy', () => {
    trigger(picker).click();
    picker.destroy();

    const panelHandler = vi.fn();
    document.addEventListener('keydown', panelHandler);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // If the picker were still listening it would have swallowed this.
    expect(panelHandler).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', panelHandler);
  });
});
