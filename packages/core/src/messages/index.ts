// Public surface of the messages module — task T11.

export {
  MessageCoordinator,
  type MessageCoordinatorOptions,
  type SendAttachmentOptions,
  type SendMessageOptions,
} from './message-coordinator.js';
export { messagePayloadToChatMessage, sessionSnapshotToChatSession } from './message-mapper.js';
export { RestClient, RestError, type MessagePage, type RestAuth, type RestClientOptions } from './rest-client.js';
