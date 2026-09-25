// The per-message reply control.
//
// This was a "..." menu whose only two items were Copy and Reply — two
// clicks and a popover to reach either action. Copy is gone (nothing else in
// this product still offers it, and a control nobody uses is not a neutral
// leftover — it is one more thing a customer has to parse past to find
// Reply), and Reply is now the action itself: one click, no menu, and the
// icon says what it does instead of hiding it behind "more".
//
// Rendered as a real button rather than a hover-only affordance so it is
// reachable by keyboard and on touch, where there is no hover at all — see
// `.dh-msg-reply`'s own `@media (hover: none)` carve-out in styles.ts.

import { ICONS, el, icon } from './dom.js';

export interface MessageActionsCallbacks {
  readonly onReply: () => void;
}

export interface MessageActionsView {
  readonly node: HTMLElement;
  destroy(): void;
}

/**
 * How far above the button the tooltip needs to fit before it is allowed to
 * open upward. Below that, it opens downward instead.
 *
 * The message log scrolls, so it clips: a tooltip above the first message or
 * below the last one would be cut in half. Measuring the room actually
 * available — rather than always opening upward — is what keeps it legible
 * at either end of the transcript.
 */
const TOOLTIP_ROOM_PX = 30;

export function createMessageActions(callbacks: MessageActionsCallbacks): MessageActionsView {
  const tooltip = el('span', {
    attrs: { class: 'dh-msg-reply-tip', role: 'tooltip', hidden: true },
    text: 'Reply',
  });

  function showTip(): void {
    const log = button.closest('[role="log"]');
    const bounds = (log ?? document.documentElement).getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    tooltip.setAttribute('data-side', rect.top - bounds.top >= TOOLTIP_ROOM_PX ? 'top' : 'bottom');
    tooltip.hidden = false;
  }

  function hideTip(): void {
    tooltip.hidden = true;
  }

  const button = el('button', {
    attrs: { class: 'dh-msg-reply', type: 'button', 'aria-label': 'Reply to message' },
    children: [icon(ICONS.reply, 14)],
    on: {
      click: () => {
        // A click has already said what it meant; leaving the tooltip up
        // over the composer it just focused would only be in the way.
        hideTip();
        callbacks.onReply();
      },
      // Coarse pointers (touch) fire no `pointerenter`/`pointerleave` at
      // all, which is exactly right here — a tooltip that only a mouse can
      // see is the correct behaviour on a device with no hover to show it.
      pointerenter: (event) => {
        if ((event as PointerEvent).pointerType === 'mouse') showTip();
      },
      pointerleave: hideTip,
      focus: showTip,
      blur: hideTip,
    },
  });

  const node = el('div', { attrs: { class: 'dh-msg-actions' }, children: [button, tooltip] });

  return {
    node,
    // No document-level listeners exist on this control anymore — there is
    // no outside-click to release now that there is no menu to dismiss.
    destroy() {},
  };
}
