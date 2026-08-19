// @dhaam-ccrm/angular — the public barrel. PRD §4: this package owns "mapping
// core's observable store to [Angular's] re-renders" and nothing else. It has
// no WS/REST calls, no reconnect logic, no dedup logic, and no business rules;
// every one of those lives in `@dhaam-ccrm/core` and is tested there.
//
// The whole binding is three ideas:
//
//   provideChatClient(clientOrConfig)   wires one ChatClient into an injector
//   inject(CHAT_STORE)                  the state, as Angular signals
//   store.on(event, handler)            the §6.5 event catalog
//
// ```ts
// @Component({
//   template: `
//     <p *ngIf="chat.typing().isTyping">typing…</p>
//     <li *ngFor="let m of chat.messages()">{{ m.content }}</li>
//     <span>{{ chat.unreadCount() }}</span>
//   `,
// })
// export class ChatPanel {
//   readonly chat = inject(CHAT_STORE);
//   constructor() {
//     this.chat.on('error', (e) => console.warn(e.message)); // auto-unsubscribes
//   }
// }
// ```
//
// Signals rather than Observables, and how zone-safety is guaranteed: see
// chat-store.ts's module header. `@angular/core` is a PEER dependency
// (>=18.0.0); `rxjs` is not a dependency of this package at all.

export { CHAT_CLIENT, CHAT_STORE, injectChatClient, injectChatStore, provideChatClient } from './di.js';

export { createChatStore } from './chat-store.js';
export type { ChatEventOptions, ChatStore, ChatStoreOptions, MaybeSignal, ZoneRunner } from './chat-store.js';

export { defaultIsEqual, shallowEqual } from './equality.js';

// ---------------------------------------------------------------------------
// Re-exported from @dhaam-ccrm/core so a consumer never needs a second
// `dependencies` entry (or a deep import) just to type a component field as
// `ChatState`/`ChatMessage`/etc. PRD §15: the binding's exposed `ChatState`
// shape is byte-for-byte identical to core's — enforced by a shared TypeScript
// type import, not hand-copied. This block is that import, re-exported one
// level further so it survives being re-exported at all.
//
// `deriveTickState`/`deriveTickStateFromState`/`MESSAGE_TICK_STATES` are
// forwarded for the same reason `ChatStore.tickState` exists: there is exactly
// ONE tick derivation and it is core's. A component that wants the tick for a
// message it already holds calls `deriveTickStateFromState(store.state(), message, id)`
// and is guaranteed to agree with every other binding.
// ---------------------------------------------------------------------------

export { MESSAGE_TICK_STATES, deriveTickState, deriveTickStateFromState } from '@dhaam-ccrm/core';
export { compareBySeq, prependPage, sortMessages, upsertMessage } from '@dhaam-ccrm/core';
export { ChatClientConfigError, ConnectionAbortedError, ConnectionSuspendedError } from '@dhaam-ccrm/core';
export type {
  ChatClient,
  ChatClientConfig,
  ChatError,
  ChatEventHandler,
  ChatEventMap,
  ChatEventName,
  ChatMessage,
  ChatParticipantProfile,
  ChatSession,
  ChatSessionSummary,
  ChatState,
  ChatTicket,
  ConnectionState,
  MessageDelivery,
  MessageTickState,
  PresenceEntry,
  PresenceStatus,
  SendAttachmentOptions,
  SendFailureReason,
  SendMessageOptions,
  Unsubscribe,
} from '@dhaam-ccrm/core';
