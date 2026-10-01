// The Tickets tab — a logged-in customer only (widget.ts's `isGuest` gates
// whether `ui/nav.ts` even builds the tab that opens this screen).
//
// A placeholder for now: there is no ticket-listing endpoint yet anywhere in
// this widget's surface, only two fire-and-forget FILING forms
// (`ui/report-issue.ts`, `ui/webform-form.ts`) that hand a ticket to the
// backend and never read one back. Building a real list is follow-up work
// once that endpoint exists; this screen is the tab's destination in the
// meantime, not a stand-in for the feature.

import { el, icon } from './dom.js';
import { TICKET_ICON_PATHS } from './nav.js';

export interface TicketsScreenView {
  readonly node: HTMLElement;
}

export function createTicketsScreen(): TicketsScreenView {
  // Reuses `.dh-unavail-*` (ui/styles.ts) rather than a new ruleset of its
  // own — same centred icon/title/body layout `ui/unavailable.ts` already
  // pays for, just with a different icon and copy.
  const node = el('div', {
    attrs: { class: 'dh-unavail', hidden: true },
    children: [
      el('span', {
        attrs: { class: 'dh-unavail-icon', 'aria-hidden': 'true' },
        children: [icon(TICKET_ICON_PATHS, 26)],
      }),
      el('p', { attrs: { class: 'dh-unavail-title' }, text: 'Tickets' }),
      el('p', { attrs: { class: 'dh-unavail-body' }, text: 'Coming soon.' }),
    ],
  });

  return { node };
}
