/// The narrow slice of `ChatClient` the widget layer actually depends on.
///
/// ── Why this exists instead of depending on ChatClient directly ─────────
///
/// `ChatClient`'s real surface is wider than any one screen needs — presence,
/// retry, `leaveSession`, `dispose`, outbound typing signals — and
/// constructing a real one for a test means driving a full §7/§8 handshake
/// through a fake socket. `dhaam_chat`'s OWN test suite does exactly that
/// (`test/fakes.dart`'s `FakeSocket` + `FakeScheduler`), and that is the
/// right tool for testing the PROTOCOL. It is the wrong tool for testing
/// "does this Cubit correctly merge two `ChatMessage`s that share an id" —
/// that question has nothing to do with envelope encoding or the connect
/// handshake. Narrowing to what this layer actually calls is what lets
/// `ChatWidgetCubit` be tested against a five-line fake instead of a
/// simulated WebSocket.
///
/// This is not a hypothetical seam: [ChatClientAdapter] below is the real
/// implementation (wrapping a live [ChatClient] by delegation) and the test
/// suite's fake is the second — codebase-design's "two adapters means a
/// real one."
library;

import 'package:dhaam_chat/dhaam_chat.dart';

abstract interface class WidgetChatClient {
  ConnectionState get connectionState;
  Stream<ConnectionState> get connectionStates;
  Stream<ChatMessage> get messages;
  Stream<SessionSnapshot> get sessions;
  Stream<TypingEvent> get typing;

  /// One event per scheduled reconnect (§6.5).
  ///
  /// The one input no state snapshot carries. `connectionState` cycles
  /// `connecting → reconnecting → connecting` indefinitely, so it says whether
  /// an attempt is in flight but never how many have already failed — and that
  /// missing number is the whole difference between a healthy first connect
  /// and an outage worth putting a banner up for.
  Stream<ReconnectingEvent> get reconnecting;

  /// How many composed messages are held for the connection to come back.
  ///
  /// The number the offline banner names. Counts only sends that will go out
  /// by themselves; a send the server REFUSED is not in here, because
  /// promising its delivery would be a lie.
  int get queuedCount;

  Future<void> connect();

  /// Abandons an armed reconnect backoff and attempts immediately, returning
  /// whether an attempt actually started.
  ///
  /// A no-op outside [ConnectionState.reconnecting] — see
  /// `ChatClient.retryNow`. Safe to call on a cadence, which is exactly what
  /// [ChatWidgetCubit] does with it.
  bool retryNow();

  /// Sends [content] and returns the optimistic local echo immediately —
  /// see `ChatClient.sendMessage` for why there is no `Future` here.
  ///
  /// [metadata] is structured context to travel WITH the message rather than
  /// inside it — the pre-chat answers a conversation is opened with are the
  /// case that forced it. Omitted from the frame entirely when null.
  ChatMessage sendMessage(
    String content, {
    String? replyToMessageId,
    Map<String, Object?>? metadata,
  });

  /// Signals that the local customer started typing (§6.3).
  ///
  /// The producer side of the agent's typing indicator. Every insertion into
  /// the composer drives this — a typed character as much as a picked emoji —
  /// so the indicator does not stop while the customer is choosing a glyph.
  void startTyping();

  /// Session closure, carrying a structured reason (§12.5).
  ///
  /// The one signal that distinguishes an ENDED conversation from a PARKED
  /// one: a `SWITCHED` close is another tab taking over, not a conversation
  /// the customer finished, and it must raise neither the survey nor the
  /// ended footer.
  Stream<SessionClosed> get sessionClosed;

  /// Agent arrival and departure (§7.3).
  ///
  /// ── What this stream can and cannot tell you ────────────────────────────
  ///
  /// `ChatClient` decodes `agent.joined` and `agent.left` through the SAME
  /// [HandledBy] decoder onto the SAME stream, so an event says WHO but not
  /// WHETHER they arrived or left. That is deliberate on its side — one
  /// canonical identity shape, so a header and a toast can never disagree
  /// about a name — but it means this stream alone cannot drive an identity
  /// header: reading an `agent.left` as an arrival would put the departed
  /// agent's name back on the header at the moment they walked away.
  ///
  /// The authority for "who is handling this conversation" is therefore
  /// [SessionSnapshot.status] + [SessionSnapshot.handledBy], read through
  /// `isHandledByCurrent` — which is exactly what the reference does too
  /// (`widget.ts` folds both frames into its session state and the header
  /// renders from that, never from the frames). Use this stream for things
  /// that are about the EVENT rather than the state: a chime, a toast.
  Stream<AgentEvent> get agentEvents;

  /// Joins an existing session — the Messages/Home "open this past
  /// conversation" path. See `ChatClient.joinSession` on why this does not
  /// move the UI until the server's own snapshot confirms it.
  void joinSession(String sessionId);

  void markRead({String? upToMessageId});
}

/// Wraps a real [ChatClient] to satisfy [WidgetChatClient] by delegation.
///
/// A wrapper rather than having `ChatClient` `implements` this directly,
/// because `packages/dart` is not modified by this package — see this
/// package's README on that boundary.
class ChatClientAdapter implements WidgetChatClient {
  ChatClientAdapter(this._client);

  final ChatClient _client;

  @override
  ConnectionState get connectionState => _client.connectionState;

  @override
  Stream<ConnectionState> get connectionStates => _client.connectionStates;

  @override
  Stream<ChatMessage> get messages => _client.messages;

  @override
  Stream<SessionSnapshot> get sessions => _client.sessions;

  @override
  Stream<TypingEvent> get typing => _client.typing;

  @override
  Stream<ReconnectingEvent> get reconnecting => _client.reconnecting;

  @override
  int get queuedCount => _client.queuedCount;

  @override
  Future<void> connect() => _client.connect();

  @override
  bool retryNow() => _client.retryNow();

  @override
  ChatMessage sendMessage(
    String content, {
    String? replyToMessageId,
    Map<String, Object?>? metadata,
  }) =>
      _client.sendMessage(
        content,
        replyToMessageId: replyToMessageId,
        metadata: metadata,
      );

  @override
  void startTyping() => _client.startTyping();

  @override
  Stream<SessionClosed> get sessionClosed => _client.sessionClosed;

  @override
  Stream<AgentEvent> get agentEvents => _client.agentEvents;

  @override
  void joinSession(String sessionId) => _client.joinSession(sessionId);

  @override
  void markRead({String? upToMessageId}) =>
      _client.markRead(upToMessageId: upToMessageId);
}
