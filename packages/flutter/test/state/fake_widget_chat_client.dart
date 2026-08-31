// A hand-driven WidgetChatClient — no socket, no handshake, no envelope
// encoding. This is the payoff of narrowing ChatWidgetCubit's dependency to
// WidgetChatClient instead of the concrete ChatClient: testing "does the
// Cubit merge two messages with the same id" does not require simulating
// dhaam_chat's §7/§8 protocol at all. See widget_chat_client.dart's header.

import 'dart:async';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';

class FakeWidgetChatClient implements WidgetChatClient {
  final StreamController<ConnectionState> _connectionStates = StreamController<ConnectionState>.broadcast();
  final StreamController<ChatMessage> _messages = StreamController<ChatMessage>.broadcast();
  final StreamController<SessionSnapshot> _sessions = StreamController<SessionSnapshot>.broadcast();
  final StreamController<TypingEvent> _typing = StreamController<TypingEvent>.broadcast();

  ConnectionState _state = ConnectionState.idle;
  int connectCalls = 0;
  final List<String> joinedSessionIds = <String>[];
  final List<String> sentContent = <String>[];
  final List<String?> markReadCalls = <String?>[];

  @override
  ConnectionState get connectionState => _state;
  @override
  Stream<ConnectionState> get connectionStates => _connectionStates.stream;
  @override
  Stream<ChatMessage> get messages => _messages.stream;
  @override
  Stream<SessionSnapshot> get sessions => _sessions.stream;
  @override
  Stream<TypingEvent> get typing => _typing.stream;

  @override
  Future<void> connect() async {
    connectCalls += 1;
  }

  @override
  ChatMessage sendMessage(String content, {String? replyToMessageId}) {
    sentContent.add(content);
    final ChatMessage message = ChatMessage(
      id: 'sent-${sentContent.length}',
      sessionId: 's1',
      senderId: '',
      senderType: SenderType.customer,
      type: MessageType.text,
      content: content,
      seq: null,
      createdAt: DateTime.utc(2026, 1, 1),
      replyToMessageId: replyToMessageId,
      delivery: MessageDelivery.pending,
    );
    _messages.add(message);
    return message;
  }

  @override
  void joinSession(String sessionId) => joinedSessionIds.add(sessionId);

  @override
  void markRead({String? upToMessageId}) => markReadCalls.add(upToMessageId);

  // ── Test-only inbound simulation ─────────────────────────────────────

  void emitConnectionState(ConnectionState next) {
    _state = next;
    _connectionStates.add(next);
  }

  void emitMessage(ChatMessage message) => _messages.add(message);

  void emitSession(SessionSnapshot session) => _sessions.add(session);

  void emitTyping(bool isTyping) => _typing.add(TypingEvent(isTyping: isTyping));

  Future<void> dispose() async {
    await _connectionStates.close();
    await _messages.close();
    await _sessions.close();
    await _typing.close();
  }
}

/// A minimal, otherwise-default ChatMessage for tests that only care about
/// id/content.
ChatMessage testMessage({
  required String id,
  String content = 'hello',
  int? seq,
  MessageDelivery delivery = MessageDelivery.confirmed,
  SenderType senderType = SenderType.agent,
  Map<String, Object?>? metadata,
}) {
  return ChatMessage(
    id: id,
    sessionId: 's1',
    senderId: senderType == SenderType.customer ? '' : 'agent-1',
    senderType: senderType,
    type: MessageType.text,
    content: content,
    seq: seq,
    createdAt: DateTime.utc(2026, 1, 1),
    delivery: delivery,
    metadata: metadata,
  );
}

/// A minimal SessionSnapshot for tests.
SessionSnapshot testSession({String id = 's1', ChatStatus status = ChatStatus.open}) {
  return SessionSnapshot(
    sessionId: id,
    status: status,
    mode: ChatMode.human,
    participants: const <ParticipantSnapshot>[],
    createdAt: DateTime.utc(2026, 1, 1),
  );
}
