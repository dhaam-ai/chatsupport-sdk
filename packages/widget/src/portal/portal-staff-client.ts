// The admin/staff data path for the widget's "Customers" tab in portal mode
// (`userRole: 'admin'`) — a second path, parallel to and independent from
// `client.ts`'s customer flow, never a branch inside it.
//
// ── Why a second path instead of a branch ──────────────────────────────────
//
// `client.ts` always builds a `ChatClient` (`@dhaam-ccrm/core`'s customer
// surface): a KEYED hello carrying `publishableKey`, one active session plus
// that SAME identity's own past-session history. `userRole` never changed
// that — it only ever selected which tab labels `ui/messages-screen.ts`
// draws — which is exactly the bug this module fixes: for an admin, "my own
// past sessions" is an empty, irrelevant list; the tenant's real customer
// conversations live behind a different protocol entirely.
//
// `@dhaam-ccrm/core`'s OTHER client, `createConversationClient`, is that
// protocol: a KEYLESS hello (no `publishableKey` — its absence is what
// selects chat-service's staff flow), N sessions held at once rather than
// one, and no "my own history" concept at all. The two clients do not share
// a session model or a config shape, so there is nothing safe to unify them
// into — this module builds the second one, the UI-facing wiring lives in
// `widget.ts`, and the read/render surface (`ui/portal-thread.ts`) is
// deliberately small rather than a retrofit of `ui/message-list.ts` +
// `ui/composer.ts`, because neither attachments, voice, emoji, typing nor
// CSAT exist on this protocol in this SDK slice.
//
// Ported from chatsupport-sdk/examples/admin-panel/src/admin-api.ts, the
// proven reference for this exact backend contract:
//   - GET /chat-services/api/v1/agent/queue                     (queue list)
//   - GET /chat-services/api/v1/agent/sessions/{id}/messages    (history)
//   - keyless v2 WS hello                                        (send/join)
// See that example's README for why `@dhaam-ccrm/rest`'s `RestClient` can't
// serve this surface: it requires a `publishableKey` and sends
// `X-Publishable-Key` on every request, which would put the connection back
// on the customer flow.

import { projectHistoryRow, unwrapEnvelope } from '@dhaam-ccrm/rest';
import type { RestChatMessage } from '@dhaam-ccrm/rest';
import { createConversationClient, isChatStatus } from '@dhaam-ccrm/core';
import type { ChatMessage, ConversationClient, MessageHistorySource } from '@dhaam-ccrm/core';

export interface PortalStaffOptions {
  /** Origin only — scheme and host, no path, no trailing slash. */
  readonly apiUrl: string;
  readonly wsUrl: string;
  /**
   * The dh-auth bearer token this admin session already holds — the SAME
   * value `WidgetConfig.auth.getToken` resolves to. Async and read per call
   * (never cached) so a re-login is picked up without rebuilding the client.
   */
  readonly getToken: () => Promise<string>;
  /** Local-echo hint only; the server derives the real sender from the token. */
  readonly senderId: string;
}

/** Anything the staff REST surface refused, with the HTTP status attached. */
export class PortalApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PortalApiError';
    this.status = status;
  }
}

const BASE_PATH = '/chat-services/api/v1';

function trimOrigin(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '');
}

async function getJson(options: PortalStaffOptions, path: string, query: Record<string, string>): Promise<unknown> {
  const url = new URL(`${trimOrigin(options.apiUrl)}${BASE_PATH}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  let response: Response;
  try {
    const token = await options.getToken();
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    // A CORS rejection and a dead host are indistinguishable to page
    // JavaScript — both surface as a `TypeError` with no status.
    throw new PortalApiError(`could not reach ${url.origin} (network error, or blocked by CORS)`, 0);
  }

  if (!response.ok) {
    throw new PortalApiError(`${path} returned ${response.status}`, response.status);
  }

  return (await response.json()) as unknown;
}

/** The `history` seam `createConversationClient` requires at construction. */
function createStaffHistorySource(options: PortalStaffOptions): MessageHistorySource {
  return {
    async listMessages(query) {
      try {
        const body = await getJson(options, `/agent/sessions/${encodeURIComponent(query.sessionId)}/messages`, {
          limit: String(query.limit),
          ...(query.before === undefined ? {} : { before: query.before }),
        });

        const page = unwrapEnvelope<{ messages?: unknown; hasMore?: unknown }>(
          body,
          'GET /agent/sessions/{sessionId}/messages',
        );

        const rows = Array.isArray(page.messages) ? page.messages : [];
        const messages = rows
          .map(projectHistoryRow)
          .filter((message): message is RestChatMessage => message !== null);

        return {
          messages: messages as unknown as readonly ChatMessage[],
          hasMore: page.hasMore === true,
        };
      } catch (error) {
        // Merchant/manager identities are admitted to WebSocket v2 keyless hello
        // and session.join, but /agent/* REST routes are strictly staff-only (401/403).
        // Catch gracefully so conversation open & live pushes remain functional.
        if (error instanceof PortalApiError && (error.status === 401 || error.status === 403)) {
          return { messages: [], hasMore: false };
        }
        throw error;
      }
    },
  };
}

/** Builds the keyless staff `ConversationClient` behind the widget's portal (admin) mode. */
export function createPortalConversationClient(options: PortalStaffOptions): ConversationClient {
  return createConversationClient({
    wsUrl: options.wsUrl,
    // No publishableKey: its ABSENCE is what selects chat-service's staff
    // flow (sessions accumulate instead of evicting on join).
    getToken: async () => ({ token: await options.getToken(), expiresInMs: 5 * 60 * 1000 }),
    localSender: { senderId: options.senderId, senderType: 'AGENT' },
    history: createStaffHistorySource(options),
    pageSize: 20,
  });
}

/** One row of `GET /agent/queue`, narrowed to what the Customers & Merchants tabs render. */
export interface PortalQueueRow {
  readonly sessionId: string;
  readonly status: string;
  readonly customerName: string | null;
  readonly customerEmail: string | null;
  readonly lastMessage: string | null;
  readonly hasMessage: boolean;
  readonly chatType: string | null;
  readonly targetRole: string | null;
  readonly targetId: string | null;
  readonly storeName: string | null;
  readonly merchantName: string | null;
  readonly merchantEmail?: string | null;
  readonly subject?: string | null;
  readonly topic?: string | null;
}

// `/agent/queue` is a REST endpoint, not the v2 WS protocol §12.1 talks about
// above — it leaks chat-service's raw DB integer (`ChatStatus.OPEN = 1`, …)
// rather than the canonical string name the rest of this SDK deals in
// exclusively. Widening a string-typed field to `1 | '1'` at the type level
// gets this wrong just as badly as ignoring it: `ui/session-status.ts`'s
// `SESSION_STATUS_WORDS[status]` is a plain object keyed by the six string
// names, so an unmapped numeric code (or its naive `String(...)`, `'1'`)
// looks up as `undefined` and throws reading `.label` off it — a live crash
// on every row this endpoint returns, not a cosmetic wrong label.
// chat-service-node's `ChatStatus` enum (shared/constants/enums.ts) — the DB
// integer this REST endpoint leaks. Not exported anywhere this SDK can import
// it from, so mirrored here; `isChatStatus` (from @dhaam-ccrm/core) covers
// the "already a valid name" half instead of a second copy of that list.
const QUEUE_STATUS_BY_CODE: Record<number, string> = {
  1: 'OPEN',
  2: 'WAITING_FOR_AGENT',
  3: 'ASSIGNED',
  4: 'CLOSED',
  5: 'RESOLVED',
  6: 'ON_HOLD',
};

function readQueueStatus(value: unknown): string {
  if (typeof value === 'string' && isChatStatus(value)) return value;
  if (typeof value === 'number') {
    const named = QUEUE_STATUS_BY_CODE[value];
    if (named !== undefined) return named;
  }
  // Neither a known name nor a known code — 'OPEN' rather than the crash
  // above, matching `widget.ts`'s own `?? 'OPEN'` fallback for a missing one.
  return 'OPEN';
}

function readQueueRow(row: unknown): PortalQueueRow | null {
  if (typeof row !== 'object' || row === null) return null;
  const source = row as Record<string, unknown>;
  const sessionId = source['id'];
  if (typeof sessionId !== 'string') return null;

  const customer = source['customer'];
  const customerName =
    (typeof customer === 'object' && customer !== null
      ? ((customer as Record<string, unknown>)['displayName'] as string | undefined) ?? null
      : null) ??
    (typeof source['customerName'] === 'string' ? source['customerName'] : null);

  const customerEmail =
    (typeof customer === 'object' && customer !== null
      ? ((customer as Record<string, unknown>)['email'] as string | undefined) ?? null
      : null) ??
    (typeof source['customerEmail'] === 'string' ? source['customerEmail'] : null);

  const lastMessage = source['lastMessage'];
  const lastContent =
    typeof lastMessage === 'object' && lastMessage !== null
      ? ((lastMessage as Record<string, unknown>)['content'] as string | undefined) ?? null
      : null;

  const targetRole = typeof source['targetRole'] === 'string' ? source['targetRole'] : null;
  const targetId = typeof source['targetId'] === 'string' ? source['targetId'] : null;
  const subject = typeof source['subject'] === 'string' ? source['subject'] : null;
  const topic = typeof source['topic'] === 'string' ? source['topic'] : null;

  const chatType =
    typeof source['chatType'] === 'string'
      ? source['chatType']
      : (targetRole?.toLowerCase() === 'merchant' ? 'merchant' : 'customer');

  let storedTargetInfo: { storeName?: string; storeEmail?: string; merchantName?: string } | null = null;
  if (targetId && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('dhaam_target_store_' + targetId) || sessionStorage.getItem('dhaam_target_store_' + targetId);
      if (raw) storedTargetInfo = JSON.parse(raw);
    } catch {}
  }

  const merchantName =
    (typeof source['merchantName'] === 'string' ? source['merchantName'] : null) ??
    (typeof source['storeName'] === 'string' ? source['storeName'] : null) ??
    storedTargetInfo?.storeName ??
    storedTargetInfo?.merchantName ??
    (subject && subject !== 'admin' ? subject : null) ??
    (chatType === 'merchant' && customerName && !customerName.toLowerCase().includes('admin') && customerName.toLowerCase() !== 'tse' ? customerName : null);

  const storeName =
    (typeof source['storeName'] === 'string' ? source['storeName'] : null) ??
    storedTargetInfo?.storeName ??
    merchantName;

  const merchantEmail =
    (typeof source['merchantEmail'] === 'string' ? source['merchantEmail'] : null) ??
    (typeof source['storeEmail'] === 'string' ? source['storeEmail'] : null) ??
    storedTargetInfo?.storeEmail ??
    null;

  const hasMessage =
    'lastMessage' in source
      ? (source['lastMessage'] !== null && source['lastMessage'] !== undefined)
      : true;

  return {
    sessionId,
    status: readQueueStatus(source['status']),
    customerName,
    customerEmail,
    lastMessage: lastContent,
    hasMessage,
    chatType,
    targetRole,
    targetId,
    storeName,
    merchantName,
    merchantEmail,
    subject,
    topic,
  };
}

/**
 * Lists this token's visible sessions — the Customers tab's real data source.
 *
 * `GET /agent/queue`, scoped server-side from the verified role: admin /
 * super_admin / supervisor see the tenant's whole queue. Merchant and manager
 * tokens are refused before reaching this call at all (chat-service's
 * staff-role mapping gap) — `widget.ts` only wires this path in for
 * `userRole === 'admin'` for exactly that reason.
 *
 * Returns what the endpoint sent, in the order it sent it, and filters
 * nothing by status: `includeClosed: 'false'` below is a REQUEST to the
 * server, not a promise about the rows that come back, and a row that
 * arrives `CLOSED` (status code 4) is still parsed and still returned here.
 * Which of these rows the Customers and Merchants tabs SHOW is decided one
 * layer up, by `widget.ts`'s `portalVisibleSessions` — closed conversations
 * are withheld from the rendered list and its tab counts, RESOLVED ones are
 * not. The full list stays available to `widget.ts` on purpose: its
 * `portalQueueIds` decides whether a click routes to the portal client or
 * the customer one, and that has to recognise a closed session too.
 */
export async function listPortalQueue(options: PortalStaffOptions, limit = 50): Promise<readonly PortalQueueRow[]> {
  const body = (await getJson(options, '/agent/queue', {
    limit: String(limit),
    includeClosed: 'false',
    hasMessagesOnly: 'true',
  })) as { data?: unknown };

  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows.map(readQueueRow).filter((row): row is PortalQueueRow => row !== null);
}

function readPartyConversationRow(row: unknown): PortalQueueRow | null {
  if (typeof row !== 'object' || row === null) return null;
  const source = row as Record<string, unknown>;
  const sessionId = source['sessionId'] ?? source['id'];
  if (typeof sessionId !== 'string') return null;

  const customer = source['customer'];
  const customerName =
    (typeof customer === 'object' && customer !== null
      ? ((customer as Record<string, unknown>)['displayName'] as string | undefined) ??
        ((customer as Record<string, unknown>)['name'] as string | undefined) ?? null
      : null) ??
    (typeof source['customerName'] === 'string' ? source['customerName'] : null) ??
    (typeof source['name'] === 'string' ? source['name'] : null);

  const customerEmail =
    (typeof customer === 'object' && customer !== null
      ? ((customer as Record<string, unknown>)['email'] as string | undefined) ?? null
      : null) ??
    (typeof source['customerEmail'] === 'string' ? source['customerEmail'] : null) ??
    (typeof source['email'] === 'string' ? source['email'] : null);
  const targetRole = typeof source['targetRole'] === 'string' ? source['targetRole'] : 'merchant';
  const targetId = typeof source['targetId'] === 'string' ? source['targetId'] : null;
  const subject = typeof source['subject'] === 'string' ? source['subject'] : null;
  const topic = typeof source['topic'] === 'string' ? source['topic'] : null;

  const isCustomerAdmin =
    (typeof customerName === 'string' && customerName.toLowerCase().includes('admin')) ||
    (typeof customerEmail === 'string' && customerEmail.toLowerCase().includes('admin')) ||
    (typeof customerName === 'string' && customerName.toLowerCase() === 'tse') ||
    (typeof customerEmail === 'string' && customerEmail.toLowerCase().includes('tse')) ||
    source['chatType'] === 'admin' ||
    topic === 'admin';

  let storedTargetInfo: { storeName?: string; storeEmail?: string; merchantName?: string } | null = null;
  if (targetId && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('dhaam_target_store_' + targetId) || sessionStorage.getItem('dhaam_target_store_' + targetId);
      if (raw) storedTargetInfo = JSON.parse(raw);
    } catch {}
  }

  const storeName =
    (typeof source['storeName'] === 'string' ? source['storeName'] : null) ??
    storedTargetInfo?.storeName ??
    (subject && subject !== 'admin' ? subject : null);

  const merchantName =
    (typeof source['merchantName'] === 'string' ? source['merchantName'] : null) ??
    storedTargetInfo?.merchantName ??
    storeName;

  const merchantEmail =
    (typeof source['merchantEmail'] === 'string' ? source['merchantEmail'] : null) ??
    storedTargetInfo?.storeEmail ??
    null;

  return {
    sessionId,
    status: readQueueStatus(source['status']),
    customerName,
    customerEmail,
    lastMessage: null,
    hasMessage: true,
    chatType: isCustomerAdmin ? 'admin' : (typeof source['chatType'] === 'string' ? source['chatType'] : 'merchant'),
    targetRole,
    targetId,
    storeName,
    merchantName,
    merchantEmail,
    subject,
    topic,
  };
}

export interface PartyConversationQuery {
  readonly limit?: number;
  readonly outletIds?: readonly string[];
}

/**
 * Lists conversations addressed to the caller's merchant / manager role or outlets.
 *
 * `GET /chat-services/api/v1/party/conversations` (Wire Contract §6).
 * Strictly formats ?outletIds=a,b (comma-separated string, never bracket array ?outletIds[]).
 * Omits ?outletIds when empty or not provided.
 */
export async function listPartyConversations(
  options: PortalStaffOptions,
  query?: PartyConversationQuery,
): Promise<readonly PortalQueueRow[]> {
  const queryParams: Record<string, string> = {
    limit: String(query?.limit ?? 50),
  };

  if (query?.outletIds && query.outletIds.length > 0) {
    const cleaned = query.outletIds.map((id) => id.trim()).filter((id) => id.length > 0);
    if (cleaned.length > 0) {
      queryParams['outletIds'] = cleaned.join(',');
    }
  }

  const body = (await getJson(options, '/party/conversations', queryParams)) as {
    data?: { conversations?: unknown[] };
  };

  const rows = Array.isArray(body?.data?.conversations) ? body.data.conversations : [];
  return rows.map(readPartyConversationRow).filter((row): row is PortalQueueRow => row !== null);
}

