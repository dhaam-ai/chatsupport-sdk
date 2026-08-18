// Messages module barrel — PRD §6.3 (message operations), §6.4/§6.5 (state
// and events), §9.2–9.4 (ordering, dedup, conflict), §12.10 (pagination and
// upload shapes).
//
// `MessageController` is the seam. It owns every message a binding can see:
// the optimistic send path, the attachment upload-then-announce flow,
// backward pagination, and the inbound `message.new` push. It owns three of
// §6.5's events outright — `message`, `messageAck`, `sendFailed` — and
// nothing else in core emits them. That is why queue/ deliberately holds no
// `ChatStore`: a second emitter would double-fire every one of them.
//
// What leaves this module is small on purpose:
//
//   MessageController      the operations themselves
//   the three seams        EnqueueSend, MessageHistorySource,
//                          AttachmentUploader — core does no HTTP and touches
//                          no DOM, so the binding supplies all three
//   LocalSender            who this client sends as; §6.3 does not say, and
//                          guessing would mislabel every agent-side message
//   the list algebra       compareBySeq / sortMessages / upsertMessage /
//                          prependPage, exported because ordering and dedup
//                          are protocol rules (D1, D2) that a binding writing
//                          its own optimistic UI has to honour identically
//
// As with the other barrels, this decides what *this module* exposes to the
// rest of core; T13's src/index.ts decides what leaves the package. §6.3
// names the pagination operation `loadOlderMessages` — the controller spells
// it `loadMore`, and mapping the public name is T13's job.
//
// Two things v1 did are deleted rather than ported (§12.9): the
// `clientMessageId` ack-mapping table and the ten-second content-matching
// echo suppressor. Under D1 a message's ULID is its permanent id from the
// moment it is queued, so dedup is structural and there is no id to swap.

export { MessageController } from './controller.js';
export type { MessageControllerOptions } from './controller.js';

export { compareBySeq, prependPage, sortMessages, upsertMessage } from './list.js';

export { DEFAULT_PAGE_SIZE, NoActiveSessionError } from './types.js';
export type {
  AttachmentUploader,
  EnqueueSend,
  LocalSender,
  MessageHistorySource,
  MessagePage,
  SendAttachmentOptions,
  SendMessageOptions,
} from './types.js';
