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

  Future<void> connect();

  /// Sends [content] and returns the optimistic local echo immediately —
  /// see `ChatClient.sendMessage` for why there is no `Future` here.
  ChatMessage sendMessage(String content, {String? replyToMessageId});

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
  Future<void> connect() => _client.connect();

  @override
  ChatMessage sendMessage(String content, {String? replyToMessageId}) =>
      _client.sendMessage(content, replyToMessageId: replyToMessageId);

  @override
  void joinSession(String sessionId) => _client.joinSession(sessionId);

  @override
  void markRead({String? upToMessageId}) =>
      _client.markRead(upToMessageId: upToMessageId);
}
