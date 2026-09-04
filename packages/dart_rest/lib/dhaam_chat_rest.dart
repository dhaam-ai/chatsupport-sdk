/// Dart client for chat-service's REST surface — the Dart mirror of
/// `@dhaam-ccrm/rest`.
///
/// This package implements the seams `dhaam_chat`'s WebSocket protocol
/// deliberately does not: message history pagination, attachment upload,
/// session close/reopen/CSAT, the session picker, and identify. `dhaam_chat`
/// carries no HTTP dependency at all, and that boundary is the reason this
/// package exists rather than living inside it.
///
/// ── The dependency runs one way ───────────────────────────────────────────
///
/// `dhaam_chat_rest` DOES depend on `dhaam_chat`, and reuses its
/// `PublishableKey`, `TokenProvider`, `ChatMessage`, `AttachmentMetadata`,
/// `HandledBy`, `ChatStatus` and `ChatMode` rather than declaring parallel
/// copies. That is the opposite of the TypeScript pair, where
/// `@dhaam-ccrm/rest` imports nothing from `@dhaam-ccrm/core` — an invariant
/// that exists there to keep `rest` installable standalone, because
/// `createChatClient` accepts five independently-substitutable structural
/// seams. Nothing in this workspace composes a Dart `ChatClient` and a REST
/// layer behind such a function, so that invariant protects nothing here while
/// costing two incompatible `TokenProvider` types, a duplicated
/// `PublishableKey.parse` (which carries the secret-key-in-client refusal),
/// and parallel message/attachment hierarchies needing a translation layer in
/// `packages/flutter`.
///
/// The invariant that DOES survive, and IS asserted by a test
/// (`test/no_core_import_test.dart`): **`dhaam_chat` imports nothing from
/// `dhaam_chat_rest`.** Its zero-HTTP boundary is the real constraint.
///
/// ── What is deliberately NOT exported ─────────────────────────────────────
///
/// Everything under `lib/src/internal/`. Those are this package's own
/// decoders and field readers; a consumer that reached for them would be
/// depending on how a route is parsed rather than on what it returns. Matches
/// how `dhaam_chat`'s own `lib/src/protocol/json.dart` is present but absent
/// from its barrel — an established convention in this workspace, not a new
/// one.
library;

export 'src/errors.dart'
    show
        RestApiException,
        RestException,
        RestMalformedResponseException,
        RestSessionReadBackException,
        RestTransportException,
        RestValidationException;
