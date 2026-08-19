// @dhaam-ccrm/rest — fetch-based implementations of the seams
// `@dhaam-ccrm/core` declares but deliberately does not implement (PRD §4).
//
// Kept out of core so core keeps its zero-dependency, no-DOM invariants, and so
// the REST base path lives in exactly one place.

export { RestClient, BASE_PATH } from './client.js';
export type { RestClientOptions } from './client.js';

export { RestApiError, RestSessionReadBackError, RestTransportError } from './errors.js';
export type { RestErrorCode } from './errors.js';

export {
  createHistorySource,
  createAttachmentUploader,
  createSessionActions,
} from './adapters.js';

// The pieces the adapters are built from, exported because writing a fourth
// adapter against this service means reusing all three: every route replies
// with the same envelope, every message row carries the same integer enums, and
// every upload reports the same S3 folder name.
export { unwrapEnvelope } from './envelope.js';

export { normalizeMediaType } from './media-type.js';
export type { MediaTypeName } from './media-type.js';

export {
  UNSUPPORTED_MESSAGE_MARKER,
  isAttachmentMetadata,
  projectHistoryRow,
  toChatMessage,
  toChatSession,
} from './projection.js';
export type {
  RestAttachmentMetadata,
  RestChatMessage,
  RestChatMode,
  RestChatParticipantProfile,
  RestChatSession,
  RestChatStatus,
  RestChatTicket,
  RestMessageType,
  RestSenderType,
} from './projection.js';
