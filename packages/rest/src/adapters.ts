// The three seams `createChatClient` requires, implemented against the OpenAPI
// contract. Each is a thin mapping — the interesting logic all lives in core.

import type { RestClient } from './client.js';

/**
 * Wire shapes, declared locally rather than imported from `@dhaam-ccrm/core`.
 *
 * These mirror core's `ChatMessage` / `ChatSession` / `AttachmentMetadata`
 * structurally, and the adapters' return values are checked against core's
 * types at the call site by the consumer. Declaring them here keeps this
 * package usable without a value-level dependency on core, and keeps the
 * seam honest: if core's shape changes, the consumer's `createChatClient`
 * call fails to typecheck, which is where the mismatch belongs.
 */
interface WireMessagePage<TMessage> {
  readonly messages: readonly TMessage[];
  readonly hasMore: boolean;
}

/**
 * `GET /sessions/{sessionId}/messages` — backward cursor, `hasMore`, no forward
 * cursor (live messages arrive over the WebSocket, §12.10).
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
      const page = await client.request<WireMessagePage<TMessage>>(
        'GET',
        `/sessions/${encodeURIComponent(query.sessionId)}/messages`,
        { query: { before: query.before, limit: query.limit } },
      );
      // Defended rather than trusted: core prepends this page straight into
      // state, and an absent `messages` would surface as a confusing crash
      // deep inside the message list instead of here.
      return { messages: page?.messages ?? [], hasMore: page?.hasMore === true };
    },
  };
}

/**
 * `POST /sessions/{sessionId}/attachments` — step one of the two-step
 * upload-then-announce flow. Core sends the returned metadata as a **top-level**
 * `attachment` field on `message.send`, never nested under `metadata` (D4).
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

      return client.request<TAttachment>(
        'POST',
        `/sessions/${encodeURIComponent(request.sessionId)}/attachments`,
        { formData: form },
      );
    },
  };
}

/**
 * `POST /sessions/{id}/reopen` and `/close`.
 *
 * These are REST-only: T13 found that neither has a WebSocket frame type in
 * §7.3's catalog at all, even though §6.2 lists both as client methods. That
 * asymmetry is why `SessionActions` exists as a seam rather than a frame.
 */
export function createSessionActions<TSession>(client: RestClient): {
  reopenSession(sessionId: string): Promise<TSession>;
  closeSession(sessionId: string): Promise<TSession>;
} {
  return {
    reopenSession(sessionId) {
      return client.request<TSession>('POST', `/sessions/${encodeURIComponent(sessionId)}/reopen`);
    },
    closeSession(sessionId) {
      return client.request<TSession>('POST', `/sessions/${encodeURIComponent(sessionId)}/close`);
    },
  };
}
