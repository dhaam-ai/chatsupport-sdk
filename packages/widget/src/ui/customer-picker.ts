// "New chat" customer picker — an overlay on the portal Messages screen.
//
// The widget knows nothing about the customer API: the host supplies
// `fetchCustomers` (search + paging) and gets `onSelect` back. Search is
// server-side (debounced); the list pages in on scroll.

import { ICONS, el, icon } from './dom.js';
import { getRowInitials } from './messages-screen.js';

export interface WidgetCustomer {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly phone?: string;
  readonly email?: string;
}

export interface CustomerPage {
  readonly customers: readonly WidgetCustomer[];
  readonly hasMore: boolean;
}

export type FetchCustomers = (query: { search: string; page: number }) => Promise<CustomerPage>;

const CHEVRON_ICON = ['M8.25 4.5l7.5 7.5-7.5 7.5'];
const USERS_ICON = ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M3 20a6 6 0 0 1 12 0Z', 'M15.5 5.2a3 3 0 0 1 0 5.6', 'M17 14.3A6 6 0 0 1 21 20h-3'];
const SEARCH_ICON = ['m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z'];

/** "+91 98••• ••482" — first 2 and last 3 of the 10-digit number. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return phone;
  const cc = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : '';
  const n = digits.slice(-10);
  return `${cc}${n.slice(0, 2)}••• ••${n.slice(-3)}`;
}

export interface CustomerPicker {
  readonly node: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function createCustomerPicker(
  fetchCustomers: FetchCustomers,
  onSelect: (customer: WidgetCustomer) => void,
  /** Fired on open/close — the widget header owns the "New chat" title and Back. */
  onToggle: (open: boolean) => void,
): CustomerPicker {
  let search = '';
  let page = 1;
  let hasMore = false;
  let loading = false;
  let seq = 0; // drops responses from a superseded search
  let timer: ReturnType<typeof setTimeout> | undefined;

  const input = el('input', {
    attrs: { class: 'dh-messages-search-input', type: 'search', placeholder: 'Search by name, phone or email', 'aria-label': 'Search customers', autocomplete: 'off' },
    on: {
      input: () => {
        clear.hidden = input.value === '';
        clearTimeout(timer);
        timer = setTimeout(() => { search = input.value.trim(); void load(true); }, 300);
      },
    },
  });
  const clear = el('button', {
    attrs: { class: 'dh-messages-search-clear', type: 'button', 'aria-label': 'Clear search', hidden: true },
    children: [icon(ICONS.close, 14)],
    on: {
      click: () => {
        input.value = '';
        clear.hidden = true;
        clearTimeout(timer);
        search = '';
        void load(true);
        input.focus({ preventScroll: true });
      },
    },
  });
  const status = el('li', { attrs: { class: 'dh-cpick-status' } });
  const none = el('li', {
    attrs: { class: 'dh-cpick-none' },
    children: [
      el('div', { attrs: { class: 'dh-empty-icon dh-empty-icon--muted' }, children: [icon(USERS_ICON, 40)] }),
      el('div', { attrs: { class: 'dh-empty-title' }, text: 'No customer found' }),
      el('div', { attrs: { class: 'dh-empty-text' }, text: 'Try a different name, phone number or email.' }),
    ],
  });
  const list = el('ul', {
    attrs: { class: 'dh-cpick-list', role: 'list' },
    on: { scroll: () => { if (hasMore && !loading && list.scrollTop + list.clientHeight >= list.scrollHeight - 80) void load(false); } },
  });

  const node = el('div', {
    attrs: { class: 'dh-cpick', hidden: true },
    children: [
      el('div', {
        attrs: { class: 'dh-messages-search' },
        children: [el('span', { attrs: { class: 'dh-messages-search-icon', 'aria-hidden': 'true' }, children: [icon(SEARCH_ICON, 16)] }), input, clear],
      }),
      el('div', {
        attrs: { class: 'dh-cpick-banner' },
        children: [icon(ICONS.chat, 18), el('span', { text: 'Pick a customer to start a conversation.' })],
      }),
      el('div', { attrs: { class: 'dh-cpick-label' }, text: 'CUSTOMERS' }),
      list,
    ],
  });

  function row(c: WidgetCustomer): HTMLElement {
    const sub = c.phone ? maskPhone(c.phone) : c.email ?? '';
    return el('li', {
      children: [
        el('button', {
          attrs: { class: 'dh-cpick-row', type: 'button' },
          children: [
            el('span', { attrs: { class: 'dh-cpick-avatar', 'aria-hidden': 'true' }, text: getRowInitials(c.name) }),
            el('span', {
              attrs: { class: 'dh-cpick-meta' },
              children: [el('span', { attrs: { class: 'dh-cpick-name' }, text: c.name }), el('span', { attrs: { class: 'dh-cpick-sub' }, text: sub })],
            }),
            icon(CHEVRON_ICON, 16),
          ],
          on: { click: () => { close(); onSelect(c); } },
        }),
      ],
    });
  }

  async function load(reset: boolean): Promise<void> {
    const mine = ++seq;
    if (reset) { page = 1; none.remove(); list.replaceChildren(status); }
    loading = true;
    status.textContent = 'Loading…';
    status.hidden = false;
    try {
      const res = await fetchCustomers({ search, page });
      if (mine !== seq) return;
      status.remove();
      for (const c of res.customers) list.append(row(c));
      hasMore = res.hasMore;
      page += 1;
      if (list.children.length === 0) list.append(none);
    } catch {
      if (mine !== seq) return;
      hasMore = false;
      status.textContent = 'Could not load customers.';
      list.append(status);
    } finally {
      if (mine === seq) loading = false;
    }
  }

  function close(): void {
    if (node.hidden) return;
    node.hidden = true;
    onToggle(false);
    clearTimeout(timer);
    seq++;
  }

  return {
    node,
    open() {
      input.value = '';
      clear.hidden = true;
      search = '';
      node.hidden = false;
      onToggle(true);
      void load(true);
      input.focus({ preventScroll: true });
    },
    close,
    isOpen: () => !node.hidden,
  };
}
