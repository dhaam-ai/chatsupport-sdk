/// Dart client for the Dhaam chat v2 wire protocol.
///
/// Implements §7 (frame protocol), §8 (connection state machine), the D2
/// resume path and §10's auth model, for Flutter iOS/Android/Web hosts.
///
/// Pure Dart — no Flutter import anywhere — so the whole client is testable in
/// a plain `dart test` process.
///
/// ```dart
/// final client = ChatClient(
///   wsUrl: Uri.parse('wss://chat.example.com/v2'),
///   publishableKey: PublishableKey.parse(const String.fromEnvironment('DH_KEY')),
///   getToken: () => myBackend.mintChatToken(),
/// );
///
/// client.messages.listen((message) => setState(() => _messages[message.id] = message));
/// client.gaps.listen((gap) => refetchOverRest(gap.fromSeq, gap.toSeq));
///
/// await client.connect();
/// client.sendMessage('Hello');
/// ```
library;

export 'src/auth/keys.dart'
    show
        InvalidPublishableKeyError,
        PublishableKey,
        PublishableKeyEnvironment,
        SecretKeyInClientError;
export 'src/auth/token.dart' show TokenProvider, TokenUnavailableError;
export 'src/client.dart'
    show
        ChatClient,
        RetryOutcome,
        RetryRefusalReason,
        RetryRefused,
        RetryRetried,
        TypingEvent,
        kDefaultRetryable;
export 'src/connection/backoff.dart' show Backoff, BackoffPolicy;
export 'src/connection/connection.dart'
    show
        ConnectionClosedError,
        ConnectionController,
        ConnectionState,
        ReconnectingEvent,
        SuspendReason;
export 'src/connection/socket.dart'
    show
        Cancellable,
        ChatSocket,
        ChatSocketFactory,
        Scheduler,
        SocketProtocolException,
        SystemScheduler,
        WebSocketChatSocket;
export 'src/logic/csat.dart'
    show
        CsatCard,
        CsatLoading,
        CsatLookup,
        CsatLookupFn,
        CsatMachine,
        CsatRated,
        CsatRouteMissing,
        CsatStatus,
        CsatUnknown,
        CsatUnrated,
        CsatUnsupported;
export 'src/logic/agent_presence.dart' show applyAgentJoined, applyAgentLeft;
export 'src/logic/handoff_keywords.dart' show asksForAHuman;
export 'src/logic/linkify.dart' show TextLink, findLinks;
export 'src/logic/url_safety.dart' show safeLinkUrl;
export 'src/protocol/enums.dart';
export 'src/protocol/envelope.dart'
    show
        AckFailureFrame,
        AckSuccessFrame,
        ClientFrame,
        ErrorFrame,
        PushFrame,
        ServerFrame,
        kProtocolVersion;
export 'src/protocol/errors.dart'
    show ErrorCode, ErrorPayload, FrameDecodeException;
export 'src/protocol/frames.dart'
    show
        AgentEvent,
        AttachmentMetadata,
        ChatMessage,
        ConnectionAck,
        ContactGeo,
        HandledBy,
        MessageDelivered,
        MessageDelivery,
        ParticipantSnapshot,
        PresenceEntry,
        MessageRead,
        SessionClosed,
        SessionSnapshot,
        TicketLinked;
export 'src/protocol/ulid.dart' show UlidGenerator, isValidUlid;
export 'src/resume/resume_tracker.dart' show ResumeGap, ResumeTracker, seqOf;
