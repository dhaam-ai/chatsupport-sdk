// The Home screen — the first thing the panel shows.
//
// Mirrors the reference product's `ChatHome`: the merchant's greeting, one
// prominent "start a conversation" card, the most recent conversation with a
// way to see the rest, and the merchant's Common Questions.
//
// ── What this does NOT own ───────────────────────────────────────────────
//
// The hero header above it, and the Common Questions list itself. Both already
// exist (`ui/hero-header.ts`, `ui/common-questions.ts`), are already driven by
// published config, and are already tested. This screen arranges them; it does
// not re-implement either, and a second Common Questions renderer would be a
// second place for one console setting to be interpreted.

import { el, icon, ICONS } from './dom.js';
import { relativeTimeLabel } from './session-picker.js';
import type { ChatSessionSummary } from '@dhaam-ccrm/js';

export interface HomeScreenCallbacks {
  /** Start a fresh conversation. */
  readonly onStartNew: () => void;
  /** Open the conversation named by id. */
  readonly onOpenConversation: (sessionId: string) => void;
  /** Go to the full conversation list. */
  readonly onSeeAll: () => void;
}

export interface HomeScreenView {
  readonly node: HTMLElement;
  /**
   * @param recent the newest conversation, or `null` when there is none —
   *   which is the case for every first-time visitor, and the reason the
   *   whole "Recent conversation" section is conditional rather than an
   *   empty-state box.
   */
  update(recent: ChatSessionSummary | null, subtitle: string): void;
}

/**
 * The pill shown beside a conversation, or nothing.
 *
 * Only the states a customer can act on are named. "Assigned" and "On hold"
 * are internal routing facts — telling somebody their conversation is
 * ASSIGNED explains nothing they can use, and a pill they cannot interpret
 * reads as an error code.
 */
const STATUS_PILL: Partial<Record<ChatSessionSummary['status'], string>> = {
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  WAITING_FOR_AGENT: 'Waiting',
};

export function createHomeScreen(callbacks: HomeScreenCallbacks): HomeScreenView {
  // The primary action. A card rather than a button, because it carries a
  // second line — the response-time promise the merchant configured — and a
  // button with two lines of different weight is a card that has not admitted
  // it yet.
  const ctaSubtitle = el('span', { attrs: { class: 'dh-home-cta-sub' } });
  const cta = el('button', {
    attrs: { class: 'dh-home-cta', type: 'button' },
    children: [
      el('span', { attrs: { class: 'dh-home-cta-icon' }, children: [icon(ICONS.chat, 20)] }),
      el('span', {
        attrs: { class: 'dh-home-cta-text' },
        children: [
          el('span', { attrs: { class: 'dh-home-cta-title' }, text: 'Send us a message' }),
          ctaSubtitle,
        ],
      }),
      el('span', { attrs: { class: 'dh-home-chevron', 'aria-hidden': 'true' }, text: '›' }),
    ],
    on: { click: () => callbacks.onStartNew() },
  });

  // ── Recent conversation ────────────────────────────────────────────────
  const recentTitle = el('span', { attrs: { class: 'dh-home-recent-title' } });
  const recentStatus = el('span', { attrs: { class: 'dh-home-recent-status' } });
  const recentPreview = el('span', { attrs: { class: 'dh-home-recent-preview' } });
  const recentTime = el('span', { attrs: { class: 'dh-home-recent-time' } });
  const recentRow = el('button', {
    attrs: { class: 'dh-home-recent-row', type: 'button' },
    children: [
      el('span', {
        attrs: { class: 'dh-home-recent-body' },
        children: [
          el('span', { attrs: { class: 'dh-home-recent-head' }, children: [recentTitle, recentStatus] }),
          recentPreview,
          recentTime,
        ],
      }),
      el('span', { attrs: { class: 'dh-home-chevron', 'aria-hidden': 'true' }, text: '›' }),
    ],
  });

  const seeAll = el('button', {
    attrs: { class: 'dh-home-seeall', type: 'button' },
    text: 'See all',
    on: { click: () => callbacks.onSeeAll() },
  });

  const recentSection = el('section', {
    attrs: { class: 'dh-home-section', hidden: true, 'aria-labelledby': 'dh-home-recent-heading' },
    children: [
      el('div', {
        attrs: { class: 'dh-home-section-head' },
        children: [
          el('h3', {
            attrs: { class: 'dh-home-section-title', id: 'dh-home-recent-heading' },
            text: 'Recent conversation',
          }),
          seeAll,
        ],
      }),
      recentRow,
    ],
  });

  // The Common Questions row is MOUNTED here by the widget, not built here —
  // it is the same `commonQuestionsHost` the conversation screen used, moved
  // rather than duplicated.
  const questionsSlot = el('section', {
    attrs: { class: 'dh-home-section dh-home-questions', hidden: true, 'aria-labelledby': 'dh-home-q-heading' },
    children: [
      el('h3', {
        attrs: { class: 'dh-home-section-title', id: 'dh-home-q-heading' },
        text: 'Common Questions',
      }),
    ],
  });

  const node = el('div', { attrs: { class: 'dh-home' }, children: [cta, recentSection, questionsSlot] });

  return {
    node,
    update(recent, subtitle) {
      // The merchant's own response-time line, reused rather than a second
      // hardcoded "We usually reply instantly" — it is the same promise the
      // status line makes, and two copies would drift.
      ctaSubtitle.textContent = subtitle;
      ctaSubtitle.hidden = subtitle === '';

      recentSection.hidden = recent === null;
      if (recent === null) return;

      // NOT a subject line. The reference product shows one ("Delivery
      // issue", "Refund request"), but that is its own mock data: there is no
      // subject, title or topic on `chat_sessions`, in the REST projection, or
      // on core's `ChatSessionSummary`. Inventing one — from the first message,
      // say — would put a label on the row that the customer never wrote and
      // that nothing else in the product agrees with.
      //
      // So the heading is WHO handled it, which is real, and the preview
      // below carries what it was about. A row with neither still identifies
      // itself by time.
      recentTitle.textContent = recent.handledBy?.displayName ?? 'Conversation';
      recentStatus.textContent = STATUS_PILL[recent.status] ?? '';
      recentStatus.hidden = (STATUS_PILL[recent.status] ?? '') === '';
      recentStatus.setAttribute('data-status', recent.status);
      recentPreview.textContent = recent.lastMessagePreview ?? '';
      recentPreview.hidden = (recent.lastMessagePreview ?? '') === '';
      recentTime.textContent = relativeTimeLabel(recent.lastMessageAt ?? recent.createdAt);
      recentRow.onclick = () => callbacks.onOpenConversation(recent.id);
    },
  };
}

/** Where the widget mounts the shared Common Questions row on this screen. */
export function homeQuestionsSlot(view: HomeScreenView): HTMLElement {
  return view.node.querySelector('.dh-home-questions')!;
}
