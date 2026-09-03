// The ONE status vocabulary every conversation list in this widget speaks.
//
// ── Why this is its own module ────────────────────────────────────────────
//
// Three surfaces render a session's status: the session picker and the
// Messages list (`ui/session-picker.ts`, `ui/messages-screen.ts`) and Home's
// "Recent conversation" row (`ui/home-screen.ts`). They used to disagree
// about what a status even IS: the first two named all six, while Home carried
// a private `STATUS_PILL` that named three and rendered NOTHING for OPEN,
// ASSIGNED and ON_HOLD — so the conversation a customer is most likely to be
// in the middle of was the one Home refused to label. One conversation showing
// its state on one screen and no state on the next is the drift a second copy
// of a mapping always produces, so the table lives here once and both shapes
// are read off it.
//
// ── Why one table with two lengths, rather than two tables ────────────────
//
// The two slots are not the same size. A list row gives the status its own
// line and can spell it out; Home's pill sits beside the handler's name in a
// single row (`.dh-home-recent-status` is `flex: none`, so a long pill eats
// the name next to it). Two independent tables would let one gain a status the
// other never hears about — which is exactly how Home ended up three statuses
// short. So there is one entry per status, holding both wordings, and the
// `Record<ChatStatus, …>` makes a seventh status a compile error in both
// places at once.
//
// ── Why ASSIGNED is not called "Assigned" ─────────────────────────────────
//
// "Assigned" is a routing fact about the queue, not about the customer's
// conversation — it answers "which agent owns this row", a question the
// customer never asked. What it MEANS to them is that a person now has it, so
// it reads "With an agent": the same information, phrased as the thing they
// can act on (reply and someone is there). The rest are already plain:
// "Waiting for an agent" is a wait they can decide to keep or abandon, "On
// hold" is paused by the merchant, and "Resolved"/"Closed" are over. Nothing
// here is hidden for being awkward — a row with no label at all is less
// interpretable than an awkward one, and defect 4 is precisely the report that
// a conversation's status was invisible.

import type { ChatStatus } from '@dhaam-ccrm/core';

export interface SessionStatusWords {
  /** Spelled out, for a row that gives the status its own line. */
  readonly label: string;
  /** The short chip, for Home's single-line "Recent conversation" row. */
  readonly pill: string;
}

export const SESSION_STATUS_WORDS: Record<ChatStatus, SessionStatusWords> = {
  OPEN: { label: 'Open', pill: 'Open' },
  WAITING_FOR_AGENT: { label: 'Waiting for an agent', pill: 'Waiting' },
  ASSIGNED: { label: 'With an agent', pill: 'With an agent' },
  ON_HOLD: { label: 'On hold', pill: 'On hold' },
  RESOLVED: { label: 'Resolved', pill: 'Resolved' },
  CLOSED: { label: 'Closed', pill: 'Closed' },
};

/**
 * The spelled-out status for a list row — and, because the rows' `aria-label`s
 * and the Messages screen's search index are built from it too, the one string
 * a status is ever known by outside the pill.
 *
 * A plain lookup, no fallback: the `Record<ChatStatus, …>` above is total, so
 * a seventh wire status is a compile error here rather than a blank pill in
 * front of a customer.
 */
export function statusLabel(status: ChatStatus): string {
  return SESSION_STATUS_WORDS[status].label;
}

/** The same status, short enough for Home's inline pill. */
export function statusPill(status: ChatStatus): string {
  return SESSION_STATUS_WORDS[status].pill;
}
