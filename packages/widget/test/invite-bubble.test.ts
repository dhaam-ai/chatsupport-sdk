// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createInviteBubble } from '../src/ui/invite-bubble.js';

function build() {
  const onAccept = vi.fn();
  const onDismiss = vi.fn();
  const bubble = createInviteBubble({ onAccept, onDismiss });
  document.body.appendChild(bubble.node);
  return { bubble, onAccept, onDismiss };
}

describe('the invite bubble', () => {
  it('is hidden until update() is called', () => {
    const { bubble } = build();
    expect(bubble.node.hidden).toBe(true);
  });

  it('has an accessible name', () => {
    const { bubble } = build();
    expect(bubble.node.getAttribute('aria-label')).toBe('Chat invitation');
  });

  it('shows the invite text and un-hides', () => {
    const { bubble } = build();
    bubble.update({ inviteId: 'inv_1', text: 'Need a hand finding something?', buttons: [] });
    expect(bubble.node.hidden).toBe(false);
    expect(bubble.node.textContent).toContain('Need a hand finding something?');
  });

  it('hides again on update(null)', () => {
    const { bubble } = build();
    bubble.update({ inviteId: 'inv_1', text: 'hi', buttons: [] });
    bubble.update(null);
    expect(bubble.node.hidden).toBe(true);
  });

  it('tapping the text accepts the invite', () => {
    const { bubble, onAccept } = build();
    bubble.update({ inviteId: 'inv_1', text: 'hi', buttons: [] });
    bubble.node.querySelector<HTMLElement>('.dh-invite-text')?.click();
    expect(onAccept).toHaveBeenCalledWith('inv_1');
  });

  it('never renders the flow\'s buttons here — the bubble is text only; they show once the chat opens', () => {
    const { bubble, onAccept } = build();
    bubble.update({
      inviteId: 'inv_1',
      text: 'Looking for something?',
      buttons: [{ id: 'b1', label: 'Yes please' }],
    });
    expect(bubble.node.querySelectorAll('.dh-invite-button')).toHaveLength(0);
    expect(bubble.node.textContent).not.toContain('Yes please');
    // Tapping the text is still how the invite is accepted.
    bubble.node.querySelector<HTMLElement>('.dh-invite-text')?.click();
    expect(onAccept).toHaveBeenCalledWith('inv_1');
  });

  it('the close affordance dismisses without accepting', () => {
    const { bubble, onAccept, onDismiss } = build();
    bubble.update({ inviteId: 'inv_1', text: 'hi', buttons: [] });
    bubble.node.querySelector<HTMLElement>('.dh-invite-close')?.click();
    expect(onDismiss).toHaveBeenCalledWith('inv_1');
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('never puts markup in the DOM — text only', () => {
    const { bubble } = build();
    bubble.update({ inviteId: 'inv_1', text: '<img src=x onerror=alert(1)>', buttons: [] });
    expect(bubble.node.querySelector('img')).toBeNull();
  });

  it('shows no sender header until setSender() names one', () => {
    const { bubble } = build();
    bubble.update({ inviteId: 'inv_1', text: 'hi', buttons: [] });
    expect(bubble.node.querySelector('.dh-invite-header')).toBeNull();
  });

  it('setSender() shows "{name} replied" above the message', () => {
    const { bubble } = build();
    bubble.setSender('Dhaam Support');
    bubble.update({ inviteId: 'inv_1', text: 'Need a hand?', buttons: [] });
    expect(bubble.node.querySelector('.dh-invite-name')?.textContent).toBe('Dhaam Support replied');
  });

  it('setSender() with initials shows a one-letter avatar', () => {
    const { bubble } = build();
    bubble.setSender('Dhaam Support', 'D');
    bubble.update({ inviteId: 'inv_1', text: 'hi', buttons: [] });
    expect(bubble.node.querySelector('.dh-invite-avatar')?.textContent).toBe('D');
  });

  it('setSender() with no initials shows the name but no avatar', () => {
    const { bubble } = build();
    bubble.setSender('Dhaam Support');
    bubble.update({ inviteId: 'inv_1', text: 'hi', buttons: [] });
    expect(bubble.node.querySelector('.dh-invite-avatar')).toBeNull();
  });

  it('setSender() with initials marks the bubble so the message indents under the name', () => {
    const { bubble } = build();
    bubble.setSender('Dhaam Support', 'D');
    expect(bubble.node.classList.contains('dh-invite-has-avatar')).toBe(true);
  });

  it('setSender() with no initials leaves the message flush with the card edge', () => {
    const { bubble } = build();
    bubble.setSender('Dhaam Support');
    expect(bubble.node.classList.contains('dh-invite-has-avatar')).toBe(false);
  });
});
