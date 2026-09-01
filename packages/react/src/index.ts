// @dhaam-ccrm/react — the public barrel. PRD §4: "Hooks/context/provider
// wrapping one core client instance; mapping core's observable store to
// React re-renders" and nothing else. Every hook below is a thin selector
// over `ChatClient.getState()`/`subscribe()` (§6.4) plus, at most, a
// `useMemo`'d bag of one-line delegations to `ChatClient` methods (§6.2/6.3)
// — no reconnect, backoff, dedup, ordering, queueing, token refresh, or
// watermark logic lives here; all of it is core's (packages/core), tested
// there.
//
// `ChatState` and every other type below is a type-only re-export from
// `@dhaam-ccrm/core` (see each hook file) — never a hand-copied shape (PRD
// §15).

export { ChatProvider, useChatClient } from './context.js';
export type { ChatProviderProps } from './context.js';

export { defaultIsEqual, shallowEqual, useChatSelector } from './use-chat-selector.js';

export { useChatState } from './use-chat-state.js';

export { useChannel } from './use-channel.js';
export type { UseChannelResult } from './use-channel.js';

export { useHandledBy } from './use-handled-by.js';
export type { UseHandledByResult } from './use-handled-by.js';

export { useSessionList } from './use-session-list.js';
export type {
  SessionSwitchOutcome,
  UseSessionListOptions,
  UseSessionListResult,
  UseSessionListStatus,
} from './use-session-list.js';

export { useMessages } from './use-messages.js';
export type { UseMessagesResult } from './use-messages.js';

export { useTypingIndicator } from './use-typing-indicator.js';
export type { UseTypingIndicatorResult } from './use-typing-indicator.js';

export { useUnreadCount } from './use-unread-count.js';
export type { UseUnreadCountResult } from './use-unread-count.js';

export { useChatError } from './use-chat-error.js';

// ---------------------------------------------------------------------------
// Offline. The banner's state and the reconnect behaviour behind it, plus the
// one rendered component this package ships — see offline-banner.tsx for why
// that exception exists in an otherwise headless package.
// ---------------------------------------------------------------------------

export {
  DEFAULT_RECONNECT_INTERVAL_MS,
  isNavigatorOnline,
  useNetworkStatus,
  useOfflineBanner,
} from './use-offline-banner.js';
export type {
  OfflineBannerTone,
  OfflineBannerView,
  UseOfflineBannerOptions,
  UseOfflineBannerResult,
} from './use-offline-banner.js';

export { OfflineBanner } from './offline-banner.js';
export type { OfflineBannerProps } from './offline-banner.js';

// ---------------------------------------------------------------------------
// DOM-side hooks. Unlike everything above, these are not selectors over
// `ChatState` — they are the browser-facing half a chat UI needs and core
// deliberately does not own (§4: core has "ZERO framework, UI, and DOM-document
// dependencies"). `WatermarkTracker` states the split for the read/delivery
// pair directly: "core decides WHAT to report; the caller decides WHEN",
// because "whether a row is on screen is a DOM question core cannot answer
// from a state snapshot."
//
// All three are SSR-safe: no `window`/`navigator`/`IntersectionObserver`/
// `MediaRecorder`/`AudioContext` is touched at module scope or during a render
// pass — only inside effects and event handlers, which never run on a server.
// ---------------------------------------------------------------------------

export { DEFAULT_READ_DEBOUNCE_MS, DEFAULT_READ_THRESHOLD, useReadTracker } from './use-read-tracker.js';
export type { UseReadTrackerOptions, UseReadTrackerResult } from './use-read-tracker.js';

export { DEFAULT_AMPLITUDE_INTERVAL_MS, DEFAULT_VOICE_MIME_TYPES, useVoiceRecorder } from './use-voice-recorder.js';
export type {
  UseVoiceRecorderOptions,
  UseVoiceRecorderResult,
  VoiceRecorderError,
  VoiceRecorderErrorCode,
  VoiceRecording,
} from './use-voice-recorder.js';

export { computeWaveformPeaks, DEFAULT_WAVEFORM_BUCKETS, useAudioWaveform } from './use-audio-waveform.js';
export type {
  AudioWaveformErrorCode,
  AudioWaveformStatus,
  UseAudioWaveformOptions,
  UseAudioWaveformResult,
} from './use-audio-waveform.js';

// ---------------------------------------------------------------------------
// Core's tick derivation, re-exported unchanged.
//
// Every binding renders the single/double/blue tick from these, and a binding
// computing its own is precisely the divergence the conformance suite exists
// to catch — v1 drew the double tick from presence ("the other party is
// connected"), which reported a fact about a socket as a fact about a human.
// @dhaam-ccrm/js and @dhaam-ccrm/angular already re-export them; React did
// not, which left a React consumer importing @dhaam-ccrm/core directly for
// them or, worse, writing the three-line derivation again.
// ---------------------------------------------------------------------------

export { MESSAGE_TICK_STATES, deriveTickState, deriveTickStateFromState } from '@dhaam-ccrm/core';
export type { MessageTickState } from '@dhaam-ccrm/core';

// ---------------------------------------------------------------------------
// The message-list algebra, for a consumer writing custom optimistic UI. Same
// reasoning as the ticks above: one implementation, in core.
// ---------------------------------------------------------------------------

export { compareBySeq, prependPage, sortMessages, upsertMessage } from '@dhaam-ccrm/core';

// ---------------------------------------------------------------------------
// Re-exported from @dhaam-ccrm/core so a consumer never needs a second
// `dependencies` entry (or a deep import) just to type a prop as
// `ChatState`/`ChatMessage`/etc. — the same shapes this package's own hooks
// return. PRD §15: "The React binding's exposed ChatState shape is
// byte-for-byte identical to core's ChatState — enforced by a shared
// TypeScript type import, not hand-copied." This block is that import,
// re-exported one level further so it survives being re-exported at all.
// ---------------------------------------------------------------------------

export type {
  ChatClient,
  ChatClientConfig,
  ChatError,
  ChatEventMap,
  ChatEventName,
  ChatMessage,
  ChatParticipantProfile,
  ChatSession,
  ChatSessionSummary,
  ChatState,
  ChatTicket,
  ConnectionState,
  HandledBy,
  IdentityProfile,
  IdentitySync,
  MessageDelivery,
  QueuedSend,
  RetryOutcome,
  SendAttachmentOptions,
  SendFailureReason,
  SendMessageOptions,
  Unsubscribe,
} from '@dhaam-ccrm/core';
export {
  ChatClientConfigError,
  ConnectionAbortedError,
  ConnectionSuspendedError,
  // What `switchSession` rejects with. Re-exported as a value so a consumer
  // can `instanceof` it (and read `.sessionId`/`.cause`) without adding
  // @dhaam-ccrm/core as a second dependency.
  SessionSwitchError,
} from '@dhaam-ccrm/core';
