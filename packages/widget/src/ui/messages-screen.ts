// The Messages screen — the conversation list, with search and category tabs.
//
// It said "every conversation" until 2026-09-15, and that is no longer true
// of either branch below. `widget.ts` withholds CLOSED conversations from
// what it hands to `render()` — from the customer's own list
// (`customerVisibleSessions`) and from the portal queue's Customers and
// Merchants tabs (`portalVisibleSessions`) — with one exemption for the
// conversation that is on screen right now. RESOLVED is untouched and still
// listed. This screen renders and counts exactly what it is given: keeping
// the rule upstream is what stops the tab count badges `applyFilter()`
// derives from disagreeing with the rows beside them.
//
// ── Redesign: Dhaam UI (Role-based tabs) ──────────────────────────────────
//
// Shows two tabs at the top:
// - When Admin is logged in: "Customers" and "Merchants"
// - When Merchant is logged in: "Customers" and "Admin"
// - Display name replaces generic "Conversation" with real merchant / customer / admin names.
// - Avatar circle shows the first letter of that specific entity's name.
// - "New conversation" button is removed.

import type { ChatSessionSummary } from '@dhaam-ccrm/js';

import { ICONS, el, icon } from './dom.js';
import { preserveListFocus, type ListFocusOutcome } from './focus.js';
import { relativeTimeLabel } from './session-picker.js';
import { statusLabel, statusPill } from './session-status.js';

export type ActiveConversationTab = 'customers' | 'merchants' | 'admin';

export interface MessagesScreenCallbacks {
  /**
   * The customer picked a row — including a terminal one, which reactivates it
   * server-side.
   *
   * `displayName` is OPTIONAL because the two screens behind this one callback
   * genuinely have different amounts to say, and only one of them has a name:
   *
   *   - the PORTAL list ({@link createPortalMessagesScreen}) knows who is on
   *     the other end and passes all three. `createMessageRow`'s `onSelect`
   *     still requires a `displayName`, and that does guard the row's own
   *     call site (its click handler, :341) — but it does NOT guard the
   *     forwarding lambda at :758, in `createPortalMessagesScreen`'s own
   *     `render()`. Widening this signature made that forward compile, so
   *     nothing in the type system protects that hop anymore. What protects
   *     it now is a test, not a type:
   *     `packages/widget/test/portal-open-conversation.test.ts` asserts the
   *     call arity is 3 and that `displayName` is a non-empty string — and
   *     it has already caught this exact regression once in practice.
   *   - the CUSTOMER list ({@link createCustomerMessagesScreen}) has nothing
   *     but the id: `createCustomerMessageRow`'s `onSelect` is
   *     `(sessionId: string)`, because a customer row is a conversation the
   *     customer is already a party to and the name belongs to the widget's
   *     own session list, not to the row.
   *
   * Handing over an id alone is therefore the DESIGNED customer path, not a
   * gap. `widget.ts`'s `selectSession` resolves the name itself out of
   * `pastSessions` via {@link getCustomerConversationTitle}, and reads an
   * absent `subtitle` as "leave the status line alone" rather than as "blank
   * it"; `openPortalConversation` has its own `?? 'Conversation'` fallback for
   * the same reason. This parameter was declared required until 2026-09-14,
   * which made the customer call site a type error (TS2554) describing a hole
   * that was never there — both implementations were honest about the two
   * paths and only this signature was not.
   */
  readonly onOpenConversation: (sessionId: string, displayName?: string, subtitle?: string) => void;
  /** Optional start-new callback. */
  readonly onStartNew?: () => void;
  /**
   * Portal (merchant/outlet) Admin tab's "Message Admin" button. Fires with
   * no arguments — this screen has no `role: 'admin'` target id to hand
   * over, so resolving one (the host's job; see `WidgetConfig.onStartPartnerConversation`)
   * is entirely on whoever set this callback.
   */
  readonly onStartNewPartner?: () => void;
  /** Current user role in the portal ('admin' | 'merchant' | 'customer'). */
  readonly userRole?: string;
}

export interface MessagesScreenView {
  readonly node: HTMLElement;
  /**
   * The polite region that narrates a focus rescue. Handed out SEPARATELY
   * from `node` and mounted by `widget.ts` beside the other two, exactly as
   * `MessageListView.liveRegion` and `IdentityHeaderView.liveRegion` are.
   *
   * Not merely a tidiness point. The panel holds several
   * `.dh-sr[role="status"]` elements and more than one test reaches for
   * "the" live region with an unscoped `querySelector`, which resolves to
   * whichever comes FIRST in the shadow tree. `messagesScreen.node` sits
   * high in the panel — above `messageList.log` — so leaving this region
   * inside it silently stole the transcript's region from
   * `session-closed.test.ts`. The panel already carries a comment about the
   * same hazard with `.dh-input`. Keeping every region in one late,
   * deliberate group is what stops the next one being an accident.
   */
  readonly liveRegion: HTMLElement;
  /** @param currentSessionId the conversation on screen behind this tab, or `null`. */
  render(sessions: readonly ChatSessionSummary[], currentSessionId: string | null): void;
  setStartingNew(busy: boolean): void;
  /** Moves focus to the search field. Call after navigating to this screen. */
  focus(): void;
  destroy(): void;
}

/** Heroicons' `magnifying-glass` outline, stroked like every other glyph `icon()` draws. */
const SEARCH_ICON = ['m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z'];

/** Chevron-right icon for conversation row. */
const CHEVRON_ICON = ['M8.25 4.5l7.5 7.5-7.5 7.5'];

/** Resolve the appropriate display name for a conversation row. */
export function getRowDisplayName(
  summary: ChatSessionSummary,
  tab: ActiveConversationTab,
  userRole?: string
): string {
  const s = summary as any;
  const isMerchantUser = userRole === 'merchant';

  if (isMerchantUser) {
    if (tab === 'admin' || tab === 'merchants') {
      // Merchant viewing Admin chat.
      //
      // `customerName`/`customerEmail` are only the ADMIN's real identity
      // when the ADMIN started this conversation (`direction` absent, or
      // `'incoming'` from this merchant/outlet's own point of view — the
      // wire contract's `/party/conversations` `direction` field). When the
      // merchant/outlet itself started it instead (`'outgoing'`, e.g. via
      // "Message Admin"), those same fields are the VIEWER's own name and
      // email — the backend reuses the `customerId`/`customerName` columns
      // for whoever started the chat, regardless of role — so trusting them
      // here showed the outlet its own name back at itself instead of the
      // admin's. `direction` was previously dropped between the wire
      // response and this summary (see widget.ts's `portalQueueRowToSummary`);
      // `undefined` (never sent, e.g. a legacy/non-partner row) keeps the
      // old behaviour so nothing else regresses.
      const startedByMe = s.direction === 'outgoing';
      if (s.adminName && typeof s.adminName === 'string' && s.adminName.trim()) return s.adminName.trim();
      if (!startedByMe && s.customerName && typeof s.customerName === 'string' && s.customerName.trim()) {
        const cName = s.customerName.trim();
        if (cName.toLowerCase().includes('admin') || cName !== 'Customer') return cName;
      }
      if (s.targetName && typeof s.targetName === 'string' && s.targetName.trim() && s.targetName.toLowerCase().includes('admin')) {
        return s.targetName.trim();
      }
      if (!startedByMe && s.customerEmail && typeof s.customerEmail === 'string' && s.customerEmail.includes('@')) {
        return s.customerEmail.split('@')[0];
      }
      if (s.handledBy?.displayName && s.handledBy.displayName !== 'Support Bot' && s.handledBy.displayName !== 'Dhaam Bot') {
        return s.handledBy.displayName;
      }
      return 'Store Admin';
    } else {
      // Merchant viewing Customer chat
      if (s.customerName && typeof s.customerName === 'string' && s.customerName.trim() && !s.customerName.toLowerCase().includes('admin') && s.customerName.toLowerCase() !== 'tse') {
        return s.customerName.trim();
      }
      if (s.handledBy?.displayName) return s.handledBy.displayName;
      return 'Customer';
    }
  } else {
    // Admin user
    if (tab === 'merchants' || tab === 'admin') {
      // Admin viewing Merchant chat
      let storedTargetName: string | null = null;
      if (s.targetId && typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('dhaam_target_store_' + s.targetId) || sessionStorage.getItem('dhaam_target_store_' + s.targetId);
          if (raw) {
            const p = JSON.parse(raw);
            storedTargetName = p.storeName || p.merchantName || (p.storeEmail ? p.storeEmail.split('@')[0] : null);
          }
        } catch {}
      }

      if (s.storeName && typeof s.storeName === 'string' && s.storeName.trim() && s.storeName.trim() !== 'Merchant' && s.storeName.trim() !== s.customerName) {
        return s.storeName.trim();
      }
      if (s.merchantName && typeof s.merchantName === 'string' && s.merchantName.trim() && s.merchantName.trim() !== 'Merchant' && s.merchantName.trim() !== s.customerName) {
        return s.merchantName.trim();
      }
      if (s.targetName && typeof s.targetName === 'string' && s.targetName.trim() && s.targetName.trim() !== 'Merchant') {
        return s.targetName.trim();
      }
      if (storedTargetName && storedTargetName.trim()) {
        return storedTargetName.trim();
      }
      if (s.subject && typeof s.subject === 'string' && s.subject.trim() && s.subject.trim() !== 'admin') {
        return s.subject.trim();
      }
      if (s.merchantEmail && typeof s.merchantEmail === 'string' && s.merchantEmail.includes('@')) {
        return s.merchantEmail.split('@')[0];
      }
      if (s.targetEmail && typeof s.targetEmail === 'string' && s.targetEmail.includes('@')) {
        return s.targetEmail.split('@')[0];
      }
      if (s.customerName && typeof s.customerName === 'string' && s.customerName.trim() &&
          !s.customerName.toLowerCase().includes('admin') && s.customerName.toLowerCase() !== 'tse') {
        return s.customerName.trim();
      }
      if (s.handledBy?.displayName && s.handledBy.displayName !== 'Support Bot' && s.handledBy.displayName !== 'Dhaam Bot') {
        return s.handledBy.displayName;
      }
      if (s.targetId) return `Store #${String(s.targetId).slice(0, 8)}`;
      return 'Merchant';
    } else {
      // Admin viewing Customer chat
      // A chat the ADMIN started with a customer (targetRole 'customer',
      // outgoing): the backend reuses `customerId`/`customerName` for whoever
      // started it, so those name the admin, not the customer — never show
      // them as the customer's name.
      const startedByAdmin = s.targetRole === 'customer' && s.direction === 'outgoing';
      let storedCustomerName: string | null = null;
      if (s.targetId && typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('dhaam_target_customer_' + s.targetId) || sessionStorage.getItem('dhaam_target_customer_' + s.targetId);
          if (raw) {
            const p = JSON.parse(raw);
            storedCustomerName = p.customerName || (p.customerEmail ? p.customerEmail.split('@')[0] : null);
          }
        } catch {}
      }
      if (storedCustomerName && storedCustomerName.trim()) {
        return storedCustomerName.trim();
      }
      if (s.targetName && typeof s.targetName === 'string' && s.targetName.trim() && s.targetName.trim() !== 'Customer') {
        return s.targetName.trim();
      }
      if (startedByAdmin) return s.targetId ? `Customer #${s.targetId}` : 'Customer';
      if (s.customerName && typeof s.customerName === 'string' && s.customerName.trim() && s.customerName !== 'Store Admin') {
        return s.customerName.trim();
      }
      if (s.customerEmail && typeof s.customerEmail === 'string' && s.customerEmail.includes('@')) {
        return s.customerEmail.split('@')[0];
      }
      if (s.handledBy?.displayName) return s.handledBy.displayName;
      return 'Customer';
    }
  }
}

/** Resolve subtitle / email info for a conversation row and header status. */
export function getRowSubtitle(
  summary: ChatSessionSummary,
  tab: ActiveConversationTab,
  userRole?: string
): string {
  const s = summary as any;
  const isMerchantUser = userRole === 'merchant';

  if (isMerchantUser) {
    if (tab === 'admin' || tab === 'merchants') {
      // Merchant viewing Admin chat: display Admin's email. Same
      // `direction` caveat as getRowDisplayName above — `customerEmail` is
      // the viewer's OWN email when they started the conversation.
      const startedByMe = s.direction === 'outgoing';
      const email =
        s.adminEmail ||
        (!startedByMe && s.customerEmail && typeof s.customerEmail === 'string' && s.customerEmail.includes('@') ? s.customerEmail : null) ||
        s.targetEmail ||
        (s.handledBy?.email) ||
        '';
      if (email) return `Admin • ${email}`;
      return 'Admin';
    } else {
      // Merchant viewing Customer chat: display Customer's email
      if (s.customerEmail) return `Customer • ${s.customerEmail}`;
      return 'Customer';
    }
  } else {
    // Admin user viewing chat
    if (tab === 'merchants' || tab === 'admin') {
      // Admin viewing Merchant chat: display Merchant's email
      let storedEmail: string | null = null;
      if (s.targetId && typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('dhaam_target_store_' + s.targetId) || sessionStorage.getItem('dhaam_target_store_' + s.targetId);
          if (raw) {
            const p = JSON.parse(raw);
            storedEmail = p.storeEmail || null;
          }
        } catch {}
      }

      const email =
        s.merchantEmail ||
        s.storeEmail ||
        storedEmail ||
        s.targetEmail ||
        (s.customerEmail && !s.customerEmail.toLowerCase().includes('admin') && !s.customerEmail.toLowerCase().includes('tse') ? s.customerEmail : '');
      if (email) return `Merchant • ${email}`;
      return s.targetId ? `Outlet #${s.targetId}` : 'Merchant Chat';
    } else {
      // Admin viewing Customer chat: display Customer's email
      let storedCustomerEmail: string | null = null;
      if (s.targetId && typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('dhaam_target_customer_' + s.targetId) || sessionStorage.getItem('dhaam_target_customer_' + s.targetId);
          if (raw) {
            const p = JSON.parse(raw);
            storedCustomerEmail = p.customerEmail || null;
          }
        } catch {}
      }
      const startedByAdmin = s.targetRole === 'customer' && s.direction === 'outgoing';
      const email =
        storedCustomerEmail ||
        s.targetEmail ||
        (!startedByAdmin && s.customerEmail && !s.customerEmail.toLowerCase().includes('admin') && !s.customerEmail.toLowerCase().includes('tse') ? s.customerEmail : null);
      if (email) return `Customer • ${email}`;
      return 'Customer';
    }
  }
}

/** Extract initial for avatar circle from the display name. */
export function getRowInitials(displayName: string): string {
  const clean = displayName.trim();
  if (clean.length > 0) return clean.charAt(0).toUpperCase();
  return 'A';
}

/** Determine which tab a session belongs to. */
export function sessionBelongsToTab(
  summary: ChatSessionSummary,
  tab: ActiveConversationTab,
  userRole?: string
): boolean {
  const s = summary as any;
  const isMerchantUser = userRole === 'merchant';

  const isInitiatorAdmin =
    (typeof s.customerName === 'string' && s.customerName.toLowerCase().includes('admin')) ||
    (typeof s.customerEmail === 'string' && s.customerEmail.toLowerCase().includes('admin')) ||
    (typeof s.customerName === 'string' && s.customerName.toLowerCase() === 'tse') ||
    (typeof s.customerEmail === 'string' && s.customerEmail.toLowerCase().includes('tse')) ||
    s.topic === 'admin' ||
    s.chatType === 'admin' ||
    (s.adminName && !s.customerName);

  if (isMerchantUser) {
    // When Merchant is logged in:
    // Tab 1: Customers
    // Tab 2: Admin
    if (tab === 'admin' || tab === 'merchants') {
      return isInitiatorAdmin || s.targetRole === 'admin';
    }
    if (tab === 'customers') {
      return !isInitiatorAdmin && s.targetRole !== 'admin';
    }
    return false;
  } else {
    // When Admin is logged in:
    // Tab 1: Customers — every conversation a genuine customer is a party
    //   to, INCLUDING a customer's own DM to an outlet (targetRole
    //   'merchant') — the admin is observing that one, not a participant.
    // Tab 2: Merchants — only conversations the ADMIN itself started (or is
    //   addressed by) with a store/outlet. `targetRole === 'merchant'` alone
    //   cannot tell "admin messaged this outlet" apart from "a customer
    //   messaged this outlet" — both share it. `isInitiatorAdmin` is the
    //   signal that can, and this branch used to skip it entirely, which is
    //   why a customer's own outlet chat used to land here under the
    //   customer's name instead of in Customers.
    if (s.chatType === 'admin') {
      return tab === 'merchants' || tab === 'admin';
    }
    if ((s.targetRole === 'merchant' || s.chatType === 'merchant') && isInitiatorAdmin) {
      return tab === 'merchants' || tab === 'admin';
    }
    if (s.targetRole === 'admin') {
      return tab === 'merchants' || tab === 'admin';
    }
    if (tab === 'merchants' || tab === 'admin') {
      return false;
    }
    // tab === 'customers': everything else, including a customer's own DM to
    // an outlet — see the comment above.
    return true;
  }
}

/** Whether `session` should stay visible under `query` — `''` matches everything. */
function matchesQuery(
  session: ChatSessionSummary,
  query: string,
  tab: ActiveConversationTab,
  userRole?: string
): boolean {
  if (query === '') return true;
  const name = getRowDisplayName(session, tab, userRole);
  const haystack = `${name} ${statusLabel(session.status)} ${session.lastMessagePreview ?? ''}`.toLowerCase();
  return haystack.includes(query);
}

/** Map a status string to a display label for the pill. */
function pillLabel(status: string): string {
  switch (status) {
    case 'OPEN': return 'Open';
    case 'CLOSED': return 'Closed';
    case 'RESOLVED': return 'Resolved';
    case 'ON_HOLD': return 'On Hold';
    case 'WAITING_FOR_AGENT': return 'Waiting';
    case 'ASSIGNED': return 'Assigned';
    default: return statusLabel(status as any);
  }
}

interface MessageRow {
  readonly node: HTMLLIElement;
  update(
    summary: ChatSessionSummary,
    isCurrent: boolean,
    tab: ActiveConversationTab,
    userRole?: string
  ): void;
}

function createMessageRow(onSelect: (sessionId: string, displayName: string, subtitle?: string) => void): MessageRow {
  // Avatar circle (initial letter)
  const avatarText = el('span', { attrs: { class: 'dh-mrow-avatar-text' } });
  const avatar = el('div', { attrs: { class: 'dh-mrow-avatar' }, children: [avatarText] });

  // Name (bold, left)
  const name = el('span', { attrs: { class: 'dh-mrow-name' } });
  // Status pill
  const statusPill = el('span', { attrs: { class: 'dh-mrow-status-pill' } });
  // Unread badge (circle, right side)
  const unreadBadge = el('span', { attrs: { class: 'dh-mrow-unread-badge', hidden: true } });
  // Chevron
  const chevron = el('span', { attrs: { class: 'dh-mrow-chevron', 'aria-hidden': 'true' }, children: [icon(CHEVRON_ICON, 14)] });

  // Top row: name + pill | badge + chevron
  const nameRow = el('div', { attrs: { class: 'dh-mrow-name-row' }, children: [name, statusPill] });
  const rightCol = el('div', { attrs: { class: 'dh-mrow-right' }, children: [unreadBadge, chevron] });
  const topRow = el('div', { attrs: { class: 'dh-mrow-top' }, children: [nameRow, rightCol] });

  // Preview text
  const preview = el('span', { attrs: { class: 'dh-mrow-preview', hidden: true } });
  // Timestamp
  const time = el('time', { attrs: { class: 'dh-mrow-time' } });

  // Body: preview + time
  const body = el('div', { attrs: { class: 'dh-mrow-body' }, children: [topRow, preview, time] });

  const button = el('button', {
    attrs: { class: 'dh-mrow-btn', type: 'button' },
    children: [avatar, body],
  });
  const node = el('li', { attrs: { class: 'dh-mrow-item' }, children: [button] });

  let current: ChatSessionSummary | null = null;
  let currentTab: ActiveConversationTab = 'merchants';
  let currentUserRole: string | undefined = undefined;

  button.addEventListener('click', () => {
    if (current !== null) {
      const displayName = getRowDisplayName(current, currentTab, currentUserRole);
      const subtitle = getRowSubtitle(current, currentTab, currentUserRole);
      onSelect(current.id, displayName, subtitle);
    }
  });

  return {
    node,
    update(summary, isCurrent, tab, userRole) {
      current = summary;
      currentTab = tab;
      currentUserRole = userRole;

      node.setAttribute('data-status', summary.status);
      if (isCurrent) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');

      // Display name and avatar initials based on active tab and role
      const displayName = getRowDisplayName(summary, tab, userRole);
      name.textContent = displayName;
      avatarText.textContent = getRowInitials(displayName);

      // Status pill
      statusPill.textContent = pillLabel(summary.status);
      statusPill.setAttribute('data-status', summary.status);

      const whenIso = summary.lastMessageAt ?? summary.createdAt;
      if (time.getAttribute('datetime') !== whenIso) time.setAttribute('datetime', whenIso);
      time.textContent = relativeTimeLabel(whenIso);

      const hasPreview = summary.lastMessagePreview !== undefined && summary.lastMessagePreview !== '';
      preview.textContent = hasPreview ? (summary.lastMessagePreview as string) : '';
      preview.hidden = !hasPreview;

      const hasUnread = summary.unreadCount > 0;
      unreadBadge.textContent = hasUnread ? (summary.unreadCount > 99 ? '99+' : String(summary.unreadCount)) : '';
      unreadBadge.hidden = !hasUnread;

      const parts = [displayName, statusLabel(summary.status)];
      if (isCurrent) parts.push('current conversation');
      const relative = relativeTimeLabel(whenIso);
      if (relative !== '') parts.push(relative);
      if (hasPreview) parts.push(summary.lastMessagePreview as string);
      if (hasUnread) {
        parts.push(`${summary.unreadCount} unread ${summary.unreadCount === 1 ? 'message' : 'messages'}`);
      }
      button.setAttribute('aria-label', parts.join(', '));
    },
  };
}

/**
 * Resolves the name of the entity the customer is chatting with:
 * Store name, Merchant name, assigned Agent name, this conversation's own
 * subject, or Support.
 *
 * `GET /chat/sessions/customer` (the customer's own session list) sends none
 * of `storeName`/`merchantName`/`targetName`/`adminName` — those are portal
 * (`/party/*`, `/agent/*`) enrichment fields this same function is also
 * asked to read (see the call sites in widget.ts), and a customer's own
 * list carries no such row. `subject` is what IS on that response, and for a
 * store-targeted chat it already IS the entity's name: `resolveConfig`
 * defaults a mint's `subject` to its `title` when the title isn't one of the
 * SDK's own generic defaults (config.ts), and a store-targeted mount's title
 * is `storeTarget.outletName` — so `subject` reaching here already went
 * through that same "not a generic placeholder" filter once, at mint time.
 * Read below `handledBy` deliberately: an agent who is actually on the
 * conversation right now outranks what it was originally about.
 */
export function getCustomerConversationTitle(summary: ChatSessionSummary, fallbackTitle = 'Support'): string {
  const s = summary as any;
  if (s.storeName && typeof s.storeName === 'string' && s.storeName.trim() && s.storeName.trim() !== 'General Support') {
    return s.storeName.trim();
  }
  if (s.merchantName && typeof s.merchantName === 'string' && s.merchantName.trim() && s.merchantName.trim() !== 'Merchant') {
    return s.merchantName.trim();
  }
  if (s.targetName && typeof s.targetName === 'string' && s.targetName.trim() && s.targetName.trim() !== 'Merchant') {
    return s.targetName.trim();
  }
  if (s.handledBy?.displayName && typeof s.handledBy.displayName === 'string' && s.handledBy.displayName.trim() && s.handledBy.displayName !== 'Support Bot') {
    return s.handledBy.displayName.trim();
  }
  if (s.adminName && typeof s.adminName === 'string' && s.adminName.trim() && s.adminName.trim() !== 'Admin') {
    return s.adminName.trim();
  }
  if (s.subject && typeof s.subject === 'string' && s.subject.trim() && s.subject.trim().toLowerCase() !== 'admin') {
    return s.subject.trim();
  }
  // A chat an admin opened with this customer (PARTNER, conversationType 4):
  // nothing else names the other side to the customer.
  if (s.conversationType === 4) return 'Admin';
  return fallbackTitle;
}

interface CustomerMessageRow {
  readonly node: HTMLLIElement;
  update(summary: ChatSessionSummary, isCurrent: boolean): void;
}

function createCustomerMessageRow(
  onSelect: (sessionId: string) => void,
): CustomerMessageRow {
  // Avatar circle (initial letter)
  const avatarText = el('span', { attrs: { class: 'dh-mrow-avatar-text' } });
  const avatar = el('div', { attrs: { class: 'dh-mrow-avatar' }, children: [avatarText] });

  // Title / Name (bold, left)
  const title = el('span', { attrs: { class: 'dh-messages-title dh-mrow-name' } });
  // Status pill
  const status = el('span', { attrs: { class: 'dh-messages-status dh-mrow-status-pill' } });
  // Unread badge (circle, right side)
  const unread = el('span', { attrs: { class: 'dh-messages-unread dh-mrow-unread-badge', hidden: true } });
  // Chevron icon
  const chevron = el('span', { attrs: { class: 'dh-mrow-chevron', 'aria-hidden': 'true' }, children: [icon(CHEVRON_ICON, 14)] });

  // Top row: name + pill | badge + chevron
  const nameRow = el('div', { attrs: { class: 'dh-mrow-name-row' }, children: [title, status] });
  const rightCol = el('div', { attrs: { class: 'dh-mrow-right' }, children: [unread, chevron] });
  const top = el('div', { attrs: { class: 'dh-messages-row-top dh-mrow-top' }, children: [nameRow, rightCol] });

  // Preview text
  const preview = el('span', { attrs: { class: 'dh-messages-preview dh-mrow-preview', hidden: true } });
  // Timestamp
  const time = el('time', { attrs: { class: 'dh-messages-time dh-mrow-time' } });

  // Body: top + preview + time
  const body = el('div', { attrs: { class: 'dh-mrow-body' }, children: [top, preview, time] });

  const button = el('button', {
    attrs: { class: 'dh-messages-row dh-mrow-btn', type: 'button' },
    children: [avatar, body],
  });
  const node = el('li', { attrs: { class: 'dh-messages-item dh-mrow-item' }, children: [button] });

  let current: ChatSessionSummary | null = null;
  button.addEventListener('click', () => {
    if (current !== null) {
      onSelect(current.id);
    }
  });

  return {
    node,
    update(summary, isCurrent) {
      current = summary;
      node.setAttribute('data-status', summary.status);
      if (isCurrent) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');

      status.textContent = statusPill(summary.status);
      status.setAttribute('data-status', summary.status);

      const displayName = getCustomerConversationTitle(summary);
      title.textContent = displayName;
      avatarText.textContent = getRowInitials(displayName);

      const whenIso = summary.lastMessageAt ?? summary.createdAt;
      if (time.getAttribute('datetime') !== whenIso) time.setAttribute('datetime', whenIso);
      time.textContent = relativeTimeLabel(whenIso);

      const previewContent = (summary.lastMessagePreview && summary.lastMessagePreview !== '')
        ? summary.lastMessagePreview
        : (summary.subject && summary.subject !== '')
        ? summary.subject
        : '';
      const hasPreview = previewContent !== '';
      preview.textContent = hasPreview ? previewContent : '';
      preview.hidden = !hasPreview;

      const hasUnread = summary.unreadCount > 0;
      unread.textContent = hasUnread ? (summary.unreadCount > 99 ? '99+' : String(summary.unreadCount)) : '';
      unread.hidden = !hasUnread;

      const parts = [displayName, statusLabel(summary.status)];
      if (isCurrent) parts.push('current conversation');
      const relative = relativeTimeLabel(whenIso);
      if (relative !== '') parts.push(relative);
      if (hasPreview) parts.push(previewContent);
      if (hasUnread) {
        parts.push(`${summary.unreadCount} unread ${summary.unreadCount === 1 ? 'message' : 'messages'}`);
      }
      button.setAttribute('aria-label', parts.join(', '));
    },
  };
}

function createCustomerMessagesScreen(callbacks: MessagesScreenCallbacks): MessagesScreenView {
  const searchInput = el('input', {
    attrs: {
      class: 'dh-messages-search-input',
      type: 'search',
      placeholder: 'Search conversations',
      'aria-label': 'Search conversations',
      autocomplete: 'off',
    },
    on: { input: () => applyFilter() },
  });
  const search = el('div', {
    attrs: { class: 'dh-messages-search' },
    children: [
      el('span', { attrs: { class: 'dh-messages-search-icon', 'aria-hidden': 'true' }, children: [icon(SEARCH_ICON, 16)] }),
      searchInput,
    ],
  });

  const empty = el('li', { attrs: { class: 'dh-messages-empty' }, text: 'No conversations yet.' });
  const list = el('ul', {
    attrs: { class: 'dh-messages-list', role: 'list', 'aria-label': 'Your conversations' },
    children: [empty],
  });

  const newLabel = el('span', { text: 'New conversation' });
  const newButton = el('button', {
    attrs: { class: 'dh-messages-new', type: 'button' },
    children: [icon(ICONS.squarePen, 18), newLabel],
    on: { click: () => callbacks.onStartNew?.() },
  });
  const footer = el('div', { attrs: { class: 'dh-messages-footer' }, children: [newButton] });

  // Says out loud what the focus rescue just did, and NOTHING else.
  //
  // Same shape as the widget's three existing regions (ui/message-list.ts,
  // ui/identity-header.ts, ui/message-actions.ts): visually hidden via
  // `dh-sr`, `role="status"`, polite, atomic.
  //
  // Deliberately NOT `aria-live` on the list container. `applyFilter()`
  // rewrites every in-tab row's name, status, preview and relative timestamp
  // on every render, and those timestamps drift on their own, so a
  // container-level region would announce something on essentially every
  // 20-second poll, forever, to somebody who is not even looking. An
  // announcement nobody asked for on a timer is its own defect. This fires
  // only when the user's own focus had to be moved because the row it was on
  // stopped existing — an event they are, by definition, present for.
  //
  // Handed to `widget.ts` rather than parked in `node` — see
  // `MessagesScreenView.liveRegion` for why its POSITION in the panel is
  // load-bearing and not a matter of taste.
  const live = el('span', {
    attrs: { class: 'dh-sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });

  const node = el('div', { attrs: { class: 'dh-messages' }, children: [search, list, footer] });

  const rows = new Map<string, CustomerMessageRow>();
  let allSessions: readonly ChatSessionSummary[] = [];
  let currentId: string | null = null;

  function applyFilter(): void {
    const query = searchInput.value.trim().toLowerCase();
    let anyVisible = false;
    for (const summary of allSessions) {
      const s = summary as any;
      if (s.hasMessage === false && summary.id !== currentId) {
        const row = rows.get(summary.id);
        if (row) row.node.hidden = true;
        continue;
      }

      const row = rows.get(summary.id);
      if (row === undefined) continue;

      const titleName = getCustomerConversationTitle(summary);
      const haystack = `${titleName} ${statusLabel(summary.status)} ${summary.lastMessagePreview ?? ''} ${summary.subject ?? ''}`.toLowerCase();
      const matches = query === '' || haystack.includes(query);
      row.node.hidden = !matches;
      if (matches) anyVisible = true;
    }

    const nothingAtAll = allSessions.length === 0;
    const emptyText = nothingAtAll
      ? 'No conversations yet.'
      : 'No conversations match your search.';
    // Written only when it actually differs. Assigning an identical string
    // still replaces the text node, and a live-region implementation reading
    // this element would be entitled to treat that as a fresh change — so an
    // unconditional write turns a 20-second poll into a 20-second
    // announcement. Nothing announces this element today (the region above
    // is the one that speaks), and this is what keeps giving it a role later
    // a one-line change rather than a new defect.
    if (empty.textContent !== emptyText) empty.textContent = emptyText;
    empty.hidden = nothingAtAll ? false : anyVisible;
  }

  /**
   * Only the two outcomes the user did not ask for get said out loud; see
   * `ListFocusOutcome` for why `restored` stays quiet.
   */
  function announceRescue(outcome: ListFocusOutcome): void {
    if (outcome.kind === 'moved') {
      const landed = allSessions.find((summary) => summary.id === outcome.id);
      // "no longer listed", not "closed": the row is gone from this list and
      // that is all this code actually knows. Asserting a status it has not
      // been told would be a guess spoken with confidence.
      const name = landed === undefined ? 'another conversation' : getCustomerConversationTitle(landed);
      live.textContent = `The conversation you were on is no longer listed. You are now on ${name}.`;
      return;
    }
    if (outcome.kind === 'emptied') {
      live.textContent = 'The conversation you were on is no longer listed. Your list is now empty.';
    }
  }

  return {
    node,
    liveRegion: live,
    render(sessions, currentSessionId) {
      // The portal list below has the identical guard — the two screens keep
      // a `row.node.remove()` loop each and share no removal path, so this
      // has to be stated twice or it protects half the users. See
      // `preserveListFocus` for what removing the focused row costs.
      const rescueFocus = preserveListFocus(
        allSessions.map((summary) => summary.id),
        (id) => rows.get(id)?.node,
        searchInput,
      );

      allSessions = sessions;
      currentId = currentSessionId;

      const live = new Set<string>();
      let previous: Node = empty;
      for (const summary of sessions) {
        live.add(summary.id);
        let row = rows.get(summary.id);
        if (row === undefined) {
          row = createCustomerMessageRow((sessionId) =>
            callbacks.onOpenConversation(sessionId)
          );
          rows.set(summary.id, row);
        }
        row.update(summary, summary.id === currentId);
        if (previous.nextSibling !== row.node) list.insertBefore(row.node, previous.nextSibling);
        previous = row.node;
      }
      for (const [id, row] of rows) {
        if (live.has(id)) continue;
        row.node.remove();
        rows.delete(id);
      }

      applyFilter();
      // After `applyFilter`, never before: it is what decides which surviving
      // rows the search query has hidden, and a hidden row is not somewhere
      // focus may land.
      announceRescue(rescueFocus());
    },
    setStartingNew(busy) {
      newButton.disabled = busy;
      newLabel.textContent = busy ? 'Starting…' : 'New conversation';
    },
    focus() {
      searchInput.focus({ preventScroll: true });
    },
    destroy() {
      rows.clear();
    },
  };
}

function createPortalMessagesScreen(callbacks: MessagesScreenCallbacks): MessagesScreenView {
  const isMerchantUser = callbacks.userRole === 'merchant';
  const secondTabKey: ActiveConversationTab = isMerchantUser ? 'admin' : 'merchants';
  // Label only — an admin here is messaging specific OUTLETS
  // (OutletChatModal), never a store/merchant as a whole, so the tab reads
  // "Outlets". `secondTabKey` stays 'merchants' — an internal state key
  // other code branches on, not copy.
  const secondTabLabel = isMerchantUser ? 'Admin' : 'Outlets';

  // ── Tab bar: Customers | [Outlets / Admin] ──────────────────────────────
  //
  // Neither tab starts with `--active`/`aria-selected="true"` baked into its
  // markup any more — `switchTab()` (called once at the bottom of this
  // function, with the real default) is now the ONLY place that sets those
  // classes, so the visible active tab and the `activeTab` state driving
  // `applyFilter()` can never start out of sync with each other.
  const customersCountBadge = el('span', { attrs: { class: 'dh-mtab-count' }, text: '0' });
  const secondTabCountBadge = el('span', { attrs: { class: 'dh-mtab-count' }, text: '0' });

  const customersTab = el('button', {
    attrs: { class: 'dh-mtab', type: 'button', 'aria-selected': 'false', role: 'tab' },
    children: [
      el('span', { text: 'Customers' }),
      customersCountBadge,
    ],
    on: { click: () => switchTab('customers') },
  });
  const secondTab = el('button', {
    attrs: { class: 'dh-mtab', type: 'button', 'aria-selected': 'false', role: 'tab' },
    children: [
      el('span', { text: secondTabLabel }),
      secondTabCountBadge,
    ],
    on: { click: () => switchTab(secondTabKey) },
  });

  const tabBar = el('div', {
    attrs: { class: 'dh-mtab-bar', role: 'tablist', 'aria-label': 'Conversation categories' },
    children: [customersTab, secondTab],
  });

  // ── Search bar ──────────────────────────────────────────────────────────
  const searchInput = el('input', {
    attrs: {
      class: 'dh-messages-search-input',
      type: 'search',
      placeholder: 'Search conversations',
      'aria-label': 'Search conversations',
      autocomplete: 'off',
    },
    on: { input: () => applyFilter() },
  });
  const search = el('div', {
    attrs: { class: 'dh-messages-search' },
    children: [
      el('span', { attrs: { class: 'dh-messages-search-icon', 'aria-hidden': 'true' }, children: [icon(SEARCH_ICON, 16)] }),
      searchInput,
    ],
  });

  // ── Conversation list ────────────────────────────────────────────────────
  const empty = el('li', { attrs: { class: 'dh-messages-empty' }, text: 'No conversations yet.' });
  const list = el('ul', {
    attrs: { class: 'dh-messages-list', role: 'list', 'aria-label': 'Your conversations' },
    children: [empty],
  });

  // Says out loud what the focus rescue just did, and NOTHING else.
  //
  // Same shape as the widget's three existing regions (ui/message-list.ts,
  // ui/identity-header.ts, ui/message-actions.ts): visually hidden via
  // `dh-sr`, `role="status"`, polite, atomic.
  //
  // Deliberately NOT `aria-live` on the list container. `applyFilter()`
  // rewrites every in-tab row's name, status, preview and relative timestamp
  // on every render, and those timestamps drift on their own, so a
  // container-level region would announce something on essentially every
  // 20-second poll, forever, to somebody who is not even looking. An
  // announcement nobody asked for on a timer is its own defect. This fires
  // only when the user's own focus had to be moved because the row it was on
  // stopped existing — an event they are, by definition, present for.
  //
  // Handed to `widget.ts` rather than parked in `node` — see
  // `MessagesScreenView.liveRegion` for why its POSITION in the panel is
  // load-bearing and not a matter of taste.
  const live = el('span', {
    attrs: { class: 'dh-sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });

  // ── "Message Admin" — a merchant/outlet's own way to reach out FIRST ────
  //
  // Admin's side of this pairing already has one: `OutletChatModal` (the
  // host app) lets an admin pick a store/outlet and open a chat targeted at
  // it. A merchant/outlet had no equivalent — this screen's Admin tab could
  // only ever show a conversation an admin had already started, same as
  // `onStartNew` not existing at all here until now (see the module header,
  // "'New conversation' button is removed").
  //
  // `callbacks.onStartNewPartner` — not `onStartNew`, which is the customer
  // screen's own callback with a different shape and no equivalent here —
  // is left to `widget.ts`/the host to actually resolve a target for
  // `role: 'admin'`: this screen has no way to know which id that is (a
  // tenant may have more than one admin), so it only ever fires the request.
  //
  // Merchant-only (never 'admin' or 'manager' itself): admin's own
  // "Merchants" tab already has `OutletChatModal` for starting new outlet
  // conversations, so this would be a second, redundant entry point there.
  const messageAdminButton = isMerchantUser && callbacks.onStartNewPartner
    ? el('button', {
        attrs: { class: 'dh-messages-new', type: 'button' },
        children: [icon(ICONS.chat, 18), el('span', { text: 'Message Admin' })],
        on: { click: () => callbacks.onStartNewPartner?.() },
      })
    : null;

  const node = el('div', {
    attrs: { class: 'dh-messages' },
    children: messageAdminButton
      ? [tabBar, search, list, messageAdminButton]
      : [tabBar, search, list],
  });

  const rows = new Map<string, MessageRow>();
  let allSessions: readonly ChatSessionSummary[] = [];
  let currentId: string | null = null;
  // Both viewers default to 'customers'. This used to read `isMerchantUser
  // ? secondTabKey : 'customers'` — a merchant/outlet's 'admin' tab was the
  // only one with real data back when GET /party/conversations (default,
  // no `with=partner`) 401'd for that identity (the dh-auth outlet-role gap
  // — see chat-service-node's role-mapping.ts / session-access.ts history).
  // Now that that's fixed, 'customers' is real for a merchant/outlet too,
  // and is the tab a store owner actually wants first: their own shoppers,
  // not the platform admin. Admin viewers were already defaulting here —
  // 'merchants' has never been wired to anything for an admin viewer, so
  // opening there first showed an always-empty tab ahead of the one that
  // works.
  const initialTab: ActiveConversationTab = 'customers';
  let activeTab: ActiveConversationTab = initialTab;

  function switchTab(tab: ActiveConversationTab): void {
    activeTab = tab;
    if (messageAdminButton) messageAdminButton.hidden = tab !== secondTabKey;
    if (tab === 'customers') {
      customersTab.classList.add('dh-mtab--active');
      customersTab.setAttribute('aria-selected', 'true');
      secondTab.classList.remove('dh-mtab--active');
      secondTab.setAttribute('aria-selected', 'false');
      customersCountBadge.classList.add('dh-mtab-count--active');
      secondTabCountBadge.classList.remove('dh-mtab-count--active');
    } else {
      secondTab.classList.add('dh-mtab--active');
      secondTab.setAttribute('aria-selected', 'true');
      customersTab.classList.remove('dh-mtab--active');
      customersTab.setAttribute('aria-selected', 'false');
      secondTabCountBadge.classList.add('dh-mtab-count--active');
      customersCountBadge.classList.remove('dh-mtab-count--active');
    }
    applyFilter();
  }

  function applyFilter(): void {
    const query = searchInput.value.trim().toLowerCase();
    let anyVisible = false;
    let totalInTab = 0;
    let customerCount = 0;
    let secondTabCount = 0;

    for (const summary of allSessions) {
      // Every count below — the two tab badges and `totalInTab` (which
      // decides the empty-state text) — comes from this ONE pass over
      // `allSessions`, so none of them can disagree with each other. The
      // previous code counted the badges separately in `render()` and
      // gated `totalInTab` on `rows.get(...)` existing here, which let the
      // badge say "88" while this said "No conversations yet." whenever a
      // row had not been created yet.
      const s = summary as any;
      if (s.hasMessage === false && summary.id !== currentId) {
        const row = rows.get(summary.id);
        if (row) row.node.hidden = true;
        continue;
      }

      if (sessionBelongsToTab(summary, 'customers', callbacks.userRole)) customerCount++;
      if (sessionBelongsToTab(summary, secondTabKey, callbacks.userRole)) secondTabCount++;

      const inTab = sessionBelongsToTab(summary, activeTab, callbacks.userRole);
      if (inTab) totalInTab++;

      const row = rows.get(summary.id);
      if (row === undefined) continue;

      if (!inTab) {
        row.node.hidden = true;
        continue;
      }
      row.update(summary, summary.id === currentId, activeTab, callbacks.userRole);

      const matches = matchesQuery(summary, query, activeTab, callbacks.userRole);
      row.node.hidden = !matches;
      if (matches) anyVisible = true;
    }

    secondTabCountBadge.textContent = String(secondTabCount);
    customersCountBadge.textContent = String(customerCount);

    const nothingInTab = totalInTab === 0;
    const emptyText = !nothingInTab
      ? 'No conversations match your search.'
      : activeTab === 'customers'
      ? 'No customer conversations yet.'
      : isMerchantUser
      ? 'No admin conversations yet.'
      : 'No outlet conversations yet.';
    // Conditional for the same reason as the customer list's copy of this —
    // see that one for the whole argument. Short version: an identical
    // re-assignment still replaces the text node, and this element is
    // rewritten on every 20-second poll.
    if (empty.textContent !== emptyText) empty.textContent = emptyText;
    empty.hidden = nothingInTab ? false : anyVisible;
  }

  /**
   * Only the two outcomes the user did not ask for get said out loud; see
   * `ListFocusOutcome` for why `restored` stays quiet.
   */
  function announceRescue(outcome: ListFocusOutcome): void {
    if (outcome.kind === 'moved') {
      const landed = allSessions.find((summary) => summary.id === outcome.id);
      // Named through `getRowDisplayName` with the CURRENT tab and role, so
      // the announcement says exactly the name the row itself is showing
      // rather than a second opinion about who the conversation is with.
      const name = landed === undefined
        ? 'another conversation'
        : getRowDisplayName(landed, activeTab, callbacks.userRole);
      live.textContent = `The conversation you were on is no longer listed. You are now on ${name}.`;
      return;
    }
    if (outcome.kind === 'emptied') {
      live.textContent = 'The conversation you were on is no longer listed. Your list is now empty.';
    }
  }

  // Applies `initialTab`'s classes/aria-selected to the tab bar — see the
  // comment on the (now class-less) markup above for why this is the only
  // place those get set.
  switchTab(initialTab);

  return {
    node,
    liveRegion: live,
    render(sessions, currentSessionId) {
      // Captured before a single node moves: `allSessions` is still the
      // PREVIOUS render's array, which is the order the rows are currently
      // in — and `rows` still holds the ones this render is about to delete.
      // See `preserveListFocus` for why a removal is a focus event at all.
      const rescueFocus = preserveListFocus(
        allSessions.map((summary) => summary.id),
        (id) => rows.get(id)?.node,
        searchInput,
      );

      allSessions = sessions;
      currentId = currentSessionId;

      const live = new Set<string>();
      let previous: Node = empty;
      for (const summary of sessions) {
        live.add(summary.id);
        let row = rows.get(summary.id);
        if (row === undefined) {
          row = createMessageRow((sessionId, displayName, subtitle) => callbacks.onOpenConversation(sessionId, displayName, subtitle));
          rows.set(summary.id, row);
        }
        row.update(summary, summary.id === currentId, activeTab, callbacks.userRole);
        if (previous.nextSibling !== row.node) list.insertBefore(row.node, previous.nextSibling);
        previous = row.node;
      }
      for (const [id, row] of rows) {
        if (live.has(id)) continue;
        row.node.remove();
        rows.delete(id);
      }

      applyFilter();
      // After `applyFilter`, never before: it is what decides which surviving
      // rows are hidden by the active tab and the search query, and a hidden
      // row is not somewhere focus may land.
      announceRescue(rescueFocus());
    },
    setStartingNew(_busy) {},
    focus() {
      searchInput.focus({ preventScroll: true });
    },
    destroy() {
      rows.clear();
    },
  };
}

export function createMessagesScreen(callbacks: MessagesScreenCallbacks): MessagesScreenView {
  const isPortalUser = callbacks.userRole === 'merchant' || callbacks.userRole === 'admin';
  if (!isPortalUser) {
    return createCustomerMessagesScreen(callbacks);
  }
  return createPortalMessagesScreen(callbacks);
}
