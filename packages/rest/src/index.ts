// @dhaam-ccrm/rest — fetch-based implementations of the seams
// `@dhaam-ccrm/core` declares but deliberately does not implement (PRD §4).
//
// Kept out of core so core keeps its zero-dependency, no-DOM invariants, and so
// the REST base path lives in exactly one place.

export { RestClient, BASE_PATH } from './client.js';
export type { RestClientOptions } from './client.js';

export { RestApiError, RestTransportError } from './errors.js';
export type { RestErrorCode } from './errors.js';

export {
  createHistorySource,
  createAttachmentUploader,
  createSessionActions,
} from './adapters.js';
