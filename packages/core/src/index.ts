// @dhaam-ccrm/core — framework-agnostic chat SDK core.
//
// Hard invariant: this package has ZERO framework, UI, and DOM-document
// dependencies. It may reference the `WebSocket` global; it may not reference
// `window` or `document` outside an explicitly isolated platform adapter.
// See docs/spec/chat-sdk-v2-prd.md §4 and §15.
//
// Scaffold only. The public surface is specified in PRD §6 and is built by
// the tasks in docs/spec/chat-sdk-v2-plan.md — not hand-written here.

export const CORE_PROTOCOL_VERSION = 1;
