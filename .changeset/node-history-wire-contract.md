---
"@dhaam-ccrm/node": minor
---

Fix message history: correct route, `{success,data}` envelope, and raw-row projection.

`listMessagePages` / `listMessages` / `UserScopedClient.messages()` called
`/sessions/{id}/messages` — the path `openapi/chat-api.yaml` declares and no route
serves. The service serves `/chat/sessions/{sessionId}/messages` under the
`/chat-services/api/v1` prefix, so every history call 404'd against a real deployment.

Reaching the route was not enough on its own. It answers with
`{ success: true, data: { messages, hasMore } }` wrapped around **raw database rows**,
not the bare projected page the spec describes: integer enums (`senderType: 1` rather
than `'CUSTOMER'`) and the attachment still nested at `metadata.attachment`, where the
WebSocket path lifts it from. This package's `ChatMessage` declared the decoded, lifted
shape and had nothing producing it — so history would have arrived undecoded and every
reloaded image would have silently lost its attachment.

**New:** `src/wire.ts`, exported as `toMessagePage`, `toChatMessage`, `unwrapEnvelope`
and `normalizeMediaType`, for callers reaching a chat route this package does not wrap.
A body that is not the route's documented shape now raises `ChatApiError` with code
`MALFORMED_RESPONSE` rather than yielding an empty page a caller would read as "this
session has no history".

**Type change:** `MessageType` gains `'TYPING'`, matching the service's enum and
`@dhaam-ccrm/core`'s union. It is defined upstream but never persisted; it is listed so
the union and the integer decode table mirror the one upstream file entry-for-entry. An
exhaustive `switch` over `MessageType` will need a `TYPING` branch.

**Docs:** the README's "Spec vs. implementation drift" section claimed this package
implemented the spec path and was "consistent with `@dhaam-ccrm/rest`". Both halves were
false. It now records what was fixed, what remains open in the OpenAPI document, and why
the wire logic is duplicated from `@dhaam-ccrm/rest` rather than imported. Separately,
the README documented the retired `dhsk_`/`dhpk_` key prefixes, which `parseSecretKey`
refuses — corrected to `dhk_`/`dhp_`.

No change to token minting, webhook verification, or key handling.
