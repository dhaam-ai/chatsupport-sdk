// Protocol module barrel.
//
// This re-exports the wire protocol contract defined in this directory:
// envelope shapes, the frame type catalog, domain enums, wire-level domain
// snapshot shapes, error codes, and the runtime frame validator.
//
// Downstream (T13's packages/core/src/index.ts, not this file) is expected
// to import from here and re-export the parts of this surface that belong
// in core's public API — this module does not decide what's public beyond
// core, only what protocol/ itself exposes to the rest of core.

export type { AckFrame, ErrorFrame, ErrorPayload, Frame } from './envelope.js';

export { CORE_PROTOCOL_VERSION } from './version.js';

export { ERROR_CODE_VALUES, isErrorCode } from './errors.js';
export type { ErrorCode } from './errors.js';

export {
  SENDER_TYPE_VALUES,
  isSenderType,
  MESSAGE_TYPE_VALUES,
  isMessageType,
  CHAT_STATUS_VALUES,
  isChatStatus,
  CHAT_MODE_VALUES,
  isChatMode,
  DELIVERY_STATUS_VALUES,
  isDeliveryStatus,
  PRESENCE_STATUS_VALUES,
  isPresenceStatus,
  MESSAGE_VISIBILITY_VALUES,
  isMessageVisibility,
  PARTICIPANT_TYPE_VALUES,
  isParticipantType,
  CLOSE_REASON_VALUES,
  isCloseReason,
  PARKED_CLOSE_REASONS,
  isParkedCloseReason,
} from './enums.js';
export type {
  SenderType,
  MessageType,
  ChatStatus,
  ChatMode,
  DeliveryStatus,
  PresenceStatus,
  MessageVisibility,
  ParticipantType,
  CloseReason,
} from './enums.js';

export type {
  AttachmentMetadata,
  MessageMetadata,
  ParticipantSnapshot,
  SessionSnapshot,
  PresenceEntry,
} from './domain.js';

export {
  CLIENT_TO_SERVER_FRAME_TYPES,
  SERVER_PUSH_FRAME_TYPES,
  SERVER_TO_CLIENT_FRAME_TYPES,
  ALL_FRAME_TYPES,
} from './frames.js';
export type {
  EmptyPayload,
  ConnectionHelloPayload,
  ConnectionReauthPayload,
  SessionJoinPayload,
  SessionRequestAgentPayload,
  MessageSendPayload,
  MessageMarkReadPayload,
  TypingPayload,
  PresenceSetPayload,
  PresenceQueryPayload,
  ConnectionAckPayload,
  SessionUpdatedPayload,
  SessionClosedPayload,
  AgentEventPayload,
  MessagePayload,
  MessageReadPayload,
  PresenceUpdatePayload,
  TicketLinkedPayload,
  MessageSendAckData,
  PresenceQueryAckData,
  AckExtraData,
  ClientToServerFrameType,
  ServerPushFrameType,
  ServerToClientFrameType,
  FrameType,
  ClientFramePayloadMap,
  ServerPushFramePayloadMap,
  ClientFrame,
  ServerPushFrame,
  ServerFrame,
  AnyFrame,
} from './frames.js';

export {
  isValidUlid,
  isIsoTimestamp,
  isKnownFrameType,
  isClientToServerFrameType,
  isServerPushFrameType,
  validateFrame,
  isFrame,
  validateErrorPayload,
} from './validate.js';
export type { FrameValidationFailure, FrameValidationResult } from './validate.js';
