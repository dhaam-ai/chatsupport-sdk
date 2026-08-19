// The three seams `createChatClient` requires.
//
// Each is a thin adapter — the interesting logic all lives in core — but "thin"
// is not "pass-through": chat-service's REST path returns raw database rows
// where its WebSocket path returns projected payloads, and core is written
// against the projected shape. Absorbing that difference is this package's
// entire job, and it happens in three shared pieces the adapters below reuse:
// `envelope.ts` (every route replies `{success, data}`), `projection.ts` (rows
// carry integer enums and bury attachments in `metadata`), and `media-type.ts`
// (uploads report an S3 folder name).

import type { RestClient } from './client.js';
import { RestApiError, RestSessionReadBackError, RestTransportError } from './errors.js';
import { unwrapEnvelope } from './envelope.js';
import { normalizeMediaType } from './media-type.js';
import {
  projectHistoryRow,
  toChatSession,
  type RestAttachmentMetadata,
  type RestChatMessage,
  type RestChatSession,
} from './projection.js';

/**
 * Core's `MessagePage`, declared locally rather than imported from
 * `@dhaam-ccrm/core` — as are the message, session, and attachment shapes in
 * projection.ts.
 *
 * Declaring them here keeps this package usable without a value-level
 * dependency on core, and keeps the seam honest: if core's shape changes, the
 * consumer's `createChatClient` call fails to typecheck, which is where the
 * mismatch belongs.
 */
interface WireMessagePage<TMessage> {
  readonly messages: readonly TMessage[];
  readonly hasMore: boolean;
}

/**
 * `GET /chat/sessions/{sessionId}/messages` — backward cursor, `hasMore`, no
 * forward cursor (live messages arrive over the WebSocket, §12.10).
 *
 * The route is under `/chat/…` (`chat.routes.ts:262`); the `/sessions/…` path
 * this used to request is served by nothing, which is one half of why a
 * reloaded conversation came back empty. The other half was the envelope: the
 * body is `{success, data:{messages, hasMore}}`, so reading `messages` off the
 * top level produced an empty page with `hasMore: false` — a silent "no
 * history" rather than a visible failure.
 */
export function createHistorySource<TMessage>(client: RestClient): {
  listMessages(query: {
    readonly sessionId: string;
    readonly before?: string;
    readonly limit: number;
  }): Promise<WireMessagePage<TMessage>>;
} {
  return {
    async listMessages(query) {
      const body = await client.request<unknown>(
        'GET',
        `/chat/sessions/${encodeURIComponent(query.sessionId)}/messages`,
        { query: { before: query.before, limit: query.limit } },
      );

      const page = unwrapEnvelope<{ messages?: unknown; hasMore?: unknown }>(
        body,
        'GET /chat/sessions/{sessionId}/messages',
      );

      // Defended rather than trusted: core prepends this page straight into
      // state, and an absent `messages` would surface as a confusing crash
      // deep inside the message list instead of here.
      const rows = Array.isArray(page.messages) ? page.messages : [];

      // Every row is a raw Prisma row — integer enums, `chatSessionId`, and any
      // attachment still buried in `metadata`. The REST history service does no
      // projection of its own (message.service.ts:285-296, :470-482), so this is
      // the only place it happens for this path. See projection.ts.
      //
      // Per row, not per page: one message this SDK cannot decode — a newly
      // appended enum value, which enums.ts:8 documents as routine — must cost
      // that one message, not the customer's entire history.
      const messages: readonly RestChatMessage[] = rows
        .map(projectHistoryRow)
        .filter((message): message is RestChatMessage => message !== null);

      // The type parameter is the caller's own message type, structurally this
      // shape (core's `ChatMessage`); the assertion is what lets this package
      // stay free of a dependency on core.
      return {
        messages: messages as unknown as readonly TMessage[],
        hasMore: page.hasMore === true,
      };
    },
  };
}

/**
 * `POST /upload` — step one of the two-step upload-then-announce flow. Core
 * sends the returned metadata as a **top-level** `attachment` field on
 * `message.send`, never nested under `metadata` (D4).
 *
 * The route is a single tenant-wide endpoint (`upload.routes.ts:82`), not a
 * per-session sub-resource: `POST /sessions/{id}/attachments` has never existed
 * on this service, so every upload 404'd.
 */
export function createAttachmentUploader<TAttachment>(client: RestClient): {
  upload(request: {
    readonly sessionId: string;
    readonly file: Blob;
    readonly fileName?: string;
  }): Promise<TAttachment>;
} {
  return {
    async upload(request) {
      const form = new FormData();
      // `File`'s own name when there is one, then the caller's override, then a
      // placeholder. Content-Disposition requires *some* filename; omitting it
      // makes several multipart parsers drop the part silently.
      const derived = (request.file as { name?: unknown }).name;
      const fileName =
        request.fileName ?? (typeof derived === 'string' && derived ? derived : 'upload');
      form.append('file', request.file, fileName);

      const body = await client.request<unknown>('POST', '/upload', {
        // ── Query param, never a multipart field ──
        //
        // The route reads `data.fields?.chatSessionId` off `request.file()`
        // (upload.routes.ts:144-147), which only resolves fields parsed BEFORE
        // the file part. This FormData appends `file` first — as it must, so a
        // large body streams rather than buffering behind small fields — so a
        // field here would be silently dropped. The route falls back to
        // `request.query.chatSessionId`, which always arrives.
        //
        // Nothing else is sent with it: the route derives the tenant from the
        // verified token and ignores `X-Tenant-ID` (upload.routes.ts:139-142),
        // and it implements no idempotency key.
        query: { chatSessionId: request.sessionId },
        formData: form,
      });

      const data = unwrapEnvelope<Record<string, unknown>>(body, 'POST /upload');
      const url = data['url'];
      if (typeof url !== 'string' || url === '') {
        // Without a URL there is nothing to announce; core would render a
        // bubble pointing nowhere. Fail here, where the route is still named.
        throw new RestApiError({
          code: 'MALFORMED_RESPONSE',
          message: 'POST /upload returned no attachment url',
          status: 200,
          retryable: false,
        });
      }

      const attachment: RestAttachmentMetadata = {
        url,
        // The route echoes all four, but each falls back to what this side
        // already knows rather than reaching core as `undefined`.
        fileName: typeof data['fileName'] === 'string' ? data['fileName'] : fileName,
        mimeType: typeof data['mimeType'] === 'string' ? data['mimeType'] : request.file.type,
        size: typeof data['size'] === 'number' ? data['size'] : request.file.size,
        // `mediaType` arrives as an S3 folder name (`images`), and core's
        // messageTypeFor only knows `IMAGE|VIDEO|AUDIO` — so unnormalized, every
        // upload degraded to a generic FILE. See media-type.ts.
        mediaType: normalizeMediaType(data['mediaType']),
      };

      // The type parameter is the caller's own attachment type, structurally
      // this shape (core's `AttachmentMetadata`); the assertion is what lets
      // this package stay free of a dependency on core.
      return attachment as unknown as TAttachment;
    },
  };
}

/**
 * How many times the post-mutation read-back is attempted before giving up.
 *
 * Small on purpose: every attempt costs the caller latency on an action whose
 * server-side effect has already happened, and the failures worth surviving
 * here are the momentary ones.
 */
const READ_BACK_ATTEMPTS = 3;

/** Would trying the same request again plausibly produce a different answer? */
function isWorthRetrying(error: unknown): boolean {
  if (error instanceof RestTransportError) return true;
  // Carries the server's own verdict, falling back to the status class — so a
  // 500 retries and a MALFORMED_RESPONSE, which no retry can reshape, does not.
  if (error instanceof RestApiError) return error.retryable;
  return false;
}

/**
 * `POST /chat/sessions/{id}/reopen` and `/close`.
 *
 * These are REST-only: T13 found that neither has a WebSocket frame type in
 * §7.3's catalog at all, even though §6.2 lists both as client methods. That
 * asymmetry is why `SessionActions` exists as a seam rather than a frame.
 *
 * ── Why each action is two round trips ──
 *
 * DO NOT "optimize" the second request away. Core's `SessionActions` contract
 * returns the FULL `ChatSession` — id, status, mode, createdAt, closedAt,
 * assignedAgent, customer, ticket — because that value replaces
 * `ChatState.session` wholesale. The mutating routes return a receipt and
 * nothing more: close gives `{sessionId, status, closedAt}` and reopen gives
 * `{sessionId, status, mode}` (chat.routes.ts:289-292, :310-313). The remaining
 * fields are in neither response, and no other part of them carries the
 * participant profiles.
 *
 * So the mutation is followed by a read of `GET /chat/sessions/{id}/full`
 * (chat.routes.ts:242-257), which is the one route that returns an enriched
 * session. Collapsing this back to one call does not make the second request
 * unnecessary — it makes the returned session half-populated, and a session
 * with `customer: null` and an epoch `createdAt` looks like data rather than
 * like the missing fields it is.
 */
export function createSessionActions<TSession>(client: RestClient): {
  reopenSession(sessionId: string): Promise<TSession>;
  closeSession(sessionId: string): Promise<TSession>;
} {
  /**
   * Reads back the session the mutation settled on.
   *
   * `/full` returns `{session, messages, participants, hasMore}`; only the
   * session is projected here — core loads history through its own seam, and
   * handing it a second, differently-shaped copy of the same messages is how
   * the two disagree.
   */
  async function readFullSession(sessionId: string): Promise<RestChatSession> {
    const body = await client.request<unknown>(
      'GET',
      `/chat/sessions/${encodeURIComponent(sessionId)}/full`,
    );
    const data = unwrapEnvelope<{ session?: unknown }>(
      body,
      'GET /chat/sessions/{sessionId}/full',
    );
    return toChatSession(data.session);
  }

  /**
   * Reads the session back, retrying the GET and only the GET.
   *
   * The mutation has already been applied by the time this runs, and
   * `chatSessionService.closeSession` is not idempotent — a second POST re-runs
   * the status update, re-marks participants as left, and emits another "chat
   * closed" SYSTEM message plus another Kafka event, all of which the customer
   * would see. So the retry surface is deliberately this one read.
   *
   * No delay between attempts: this package has no clock seam, and adding
   * `setTimeout` here would put an untestable timer inside an adapter whose
   * scheduling core already owns. The attempts cover the case worth covering —
   * a single dropped connection or one 5xx from a replica that has not caught
   * up — and anything more persistent is reported rather than waited on.
   */
  async function readBackAfterMutation(sessionId: string): Promise<RestChatSession> {
    let failure: unknown;
    for (let attempt = 1; attempt <= READ_BACK_ATTEMPTS; attempt += 1) {
      try {
        return await readFullSession(sessionId);
      } catch (error) {
        failure = error;
        if (!isWorthRetrying(error)) break;
      }
    }
    // Distinguishable on purpose: the session HAS changed on the server, and a
    // caller that treats this like a failed close is wrong in both directions.
    throw new RestSessionReadBackError({ sessionId, cause: failure });
  }

  /**
   * Runs the mutation and returns the session id it settled on.
   *
   * The id is read back out of the response rather than reused from the
   * request because `reopenSession` may converge onto a DIFFERENT,
   * already-active session and returns that one's id (chat.routes.ts:297-308).
   * Re-reading the requested id would then return the wrong session — and the
   * convergence stays inside the authorization boundary, so the id that comes
   * back is safe to follow.
   */
  async function mutate(path: string, sessionId: string, context: string): Promise<TSession> {
    const body = await client.request<unknown>(
      'POST',
      `/chat/sessions/${encodeURIComponent(sessionId)}/${path}`,
    );
    const receipt = unwrapEnvelope<{ sessionId?: unknown }>(body, context);
    const settled = typeof receipt.sessionId === 'string' ? receipt.sessionId : sessionId;

    // The type parameter is the caller's own session type, structurally this
    // shape (core's `ChatSession`); the assertion is what lets this package stay
    // free of a dependency on core.
    return (await readBackAfterMutation(settled)) as unknown as TSession;
  }

  return {
    reopenSession(sessionId) {
      return mutate('reopen', sessionId, 'POST /chat/sessions/{sessionId}/reopen');
    },
    closeSession(sessionId) {
      return mutate('close', sessionId, 'POST /chat/sessions/{sessionId}/close');
    },
  };
}
