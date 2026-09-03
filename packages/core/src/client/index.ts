// Client module barrel — internal to this package. packages/core/src/index.ts
// (T13's actual deliverable) re-exports the selection of this that becomes
// @dhaam-ccrm/core's public surface; this file just gathers what client/
// itself produced.

export { createChatClient } from './create-chat-client.js';
export {
  applyAgentJoined,
  applyAgentLeft,
  applySessionClosed,
  applyTicketLinked,
  isHandledByCurrent,
  sessionSnapshotToChatSession,
  statusOrModeChanged,
} from './session.js';
export {
  ChatClientConfigError,
  ConnectionAbortedError,
  ConnectionSuspendedError,
  SessionSwitchError,
} from './types.js';
export type {
  AttachmentUploader,
  AuthToken,
  ChatClient,
  ChatClientConfig,
  CsatStatus,
  CsatSubmission,
  LocalSender,
  MessageHistorySource,
  SendAttachmentOptions,
  SendMessageOptions,
  SessionActions,
  SessionSummarySource,
  TokenProvider,
} from './types.js';
