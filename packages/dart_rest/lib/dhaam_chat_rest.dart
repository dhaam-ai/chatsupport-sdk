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
/// `dhaam_chat_rest`, and carries no HTTP dependency at all.** Its zero-HTTP
/// boundary is the real constraint.
///
/// ── The types this package re-exports, and why ────────────────────────────
///
/// A consumer decoding a message page gets back `dhaam_chat`'s own
/// `ChatMessage` — the SAME type a `message.new` frame decodes into. Rather
/// than make every such consumer import both packages to name one type, the
/// handful of `dhaam_chat` types that appear in THIS package's signatures are
/// re-exported below. Nothing else is: this is not a facade over
/// `dhaam_chat`, and a consumer that wants a `ChatClient` imports that package
/// directly.
///
/// ── What is deliberately NOT exported ─────────────────────────────────────
///
/// Everything under `lib/src/internal/`. Those are this package's own
/// decoders and field readers; a consumer that reached for them would be
/// depending on how a route is parsed rather than on what it returns. Matches
/// how `dhaam_chat`'s own `lib/src/protocol/json.dart` is present but absent
/// from its barrel — an established convention in this workspace, not a new
/// one.
///
/// ```dart
/// final rest = RestClient(
///   apiUrl: 'https://chat.example.com',
///   publishableKey: PublishableKey.parse(const String.fromEnvironment('DH_KEY')),
///   getAccessToken: () => myBackend.mintChatToken(),
/// );
/// ```
library;

/// The `dhaam_chat` types that appear in this package's own signatures.
///
/// `PublishableKey` and `TokenProvider` are `RestClient`'s constructor
/// parameters; `ChatMessage` and `AttachmentMetadata` are what its decoders
/// return; `ChatStatus`, `ChatMode` and `HandledBy` are the leaf vocabulary on
/// the session models. Everything else stays behind `package:dhaam_chat`.
export 'package:dhaam_chat/dhaam_chat.dart'
    show
        AttachmentMetadata,
        ChatMessage,
        ChatMode,
        ChatStatus,
        HandledBy,
        HandledByKind,
        PublishableKey,
        TokenProvider,
        TokenUnavailableError;
export 'src/bootstrap.dart'
    show
        RestIpWatermark,
        fetchIpWatermark,
        fetchWidgetConfig,
        kIpWatermarkTimeout,
        kWidgetConfigTimeout;
export 'src/client.dart'
    show
        RestClient,
        RestMultipartFile,
        kReadBackAttempts,
        kRestBasePath,
        kSessionSummaryLimitMax,
        kSessionSummaryLimitMin;
export 'src/errors.dart'
    show
        RestApiException,
        RestException,
        RestMalformedResponseException,
        RestSessionReadBackException,
        RestTransportException,
        RestValidationException;
export 'src/media.dart'
    show
        ContactInfoSink,
        GeolocationProbe,
        MediaApi,
        RestContactInfo,
        RestGeoPosition,
        captureContactInfo,
        kGeolocationTimeout,
        kUnknownAttachmentMimeType;
export 'src/media_type.dart' show normalizeMediaType;
export 'src/models/csat.dart'
    show RestCsatRated, RestCsatStatus, RestCsatSubmission, RestCsatUnrated;
export 'src/models/identity.dart'
    show
        RestDevicePlatform,
        RestIdentityDevice,
        RestIdentityProfile,
        RestIdentityResult;
export 'src/models/issue_report.dart' show RestIssueReport;
export 'src/models/message_page.dart' show RestMessagePage;
export 'src/models/session.dart'
    show RestChatParticipantProfile, RestChatSession, RestChatTicket;
export 'src/models/session_summary.dart' show RestChatSessionSummary;
export 'src/sessions.dart' show SessionApi;
export 'src/support.dart' show SupportApi;
