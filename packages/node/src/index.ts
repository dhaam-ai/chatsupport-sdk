// @dhaam-ccrm/node — the backend SDK.
//
// Runs on the customer's OWN SERVER and holds the secret key. This is the
// opposite side of the wire from `@dhaam-ccrm/core`, which runs in a browser,
// and there is deliberately no dependency edge between them in either
// direction: that edge is how a secret key ends up in a client bundle (§14).
//
// If you are looking for the browser SDK, you want `@dhaam-ccrm/core`.

export { ChatServerClient, UserScopedClient } from './client.js';
export type {
  BoundWebhookVerifyOptions,
  ChatServerClientOptions,
} from './client.js';

export {
  ChatApiError,
  ChatTransportError,
  InvalidSecretKeyError,
  PublishableKeyAsSecretError,
  WebhookVerificationError,
} from './errors.js';
export type { ChatErrorCode, WebhookVerificationFailure } from './errors.js';

export {
  isSecretKey,
  maskSecretKey,
  parseSecretKey,
  secretKeyEnvironment,
} from './keys.js';
export type { SecretKey, SecretKeyEnvironment } from './keys.js';

export { BASE_PATH, HttpClient } from './http.js';
export type { HeaderProvider, HttpClientOptions } from './http.js';

export { InvalidMintRequestError, buildMintTokenBody, mintAccessToken } from './tokens.js';

export {
  DEFAULT_TOLERANCE_SECONDS,
  assertWebhookSignature,
  constructWebhookEvent,
  isKnownWebhookEvent,
  signWebhookPayload,
  verifyWebhookSignature,
} from './webhooks.js';
export type {
  ReceivedWebhookEvent,
  UnknownWebhookEvent,
  WebhookEvent,
  WebhookMessageCreatedEvent,
  WebhookPayload,
  WebhookSessionClosedEvent,
  WebhookSessionUpdatedEvent,
  WebhookTicketLinkedEvent,
  WebhookVerifyOptions,
} from './webhooks.js';

// The wire seam. Exported for the same reason `HttpClient` and `BASE_PATH` are:
// a caller reaching a chat route this package does not wrap still needs the
// envelope taken off and the row decoded, and hand-rolling that is how an
// attachment gets lost or an integer enum renders as a message type.
export { normalizeMediaType, toChatMessage, toMessagePage, unwrapEnvelope } from './wire.js';

export { flatten, listMessagePages, listMessages, paginate } from './pagination.js';
export type {
  CursorOf,
  ListMessagesOptions,
  Page,
  PageFetcher,
  PaginateOptions,
} from './pagination.js';

export type {
  Attachment,
  ChatMessage,
  ChatMode,
  ChatSession,
  ChatSessionSummary,
  ChatStatus,
  CloseReason,
  MediaType,
  MessagePage,
  MessageReplyPreview,
  MessageType,
  MintTokenRequest,
  MintTokenResponse,
  Profile,
  SenderType,
  SessionSummaryPage,
  Ticket,
} from './types.js';
