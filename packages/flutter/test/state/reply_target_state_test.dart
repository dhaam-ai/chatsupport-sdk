// Where the reply target LIVES, and what it survives.
//
// The whole reason this is on ChatWidgetState rather than in
// ConversationScreen's local state is that the send which consumes it is the
// Cubit's, and a copy held beside the screen would be a second answer the
// Cubit could not see and the screen could not clear in step with a send.
// The "survives" group is the other half of that argument: a target held by a
// widget dies with the widget, and a customer who pressed Reply and then
// rotated the device would find their next message quietly not a reply.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/remote_config_fixtures.dart';
import 'fake_widget_chat_client.dart';

Future<void> flush() => Future<void>.delayed(Duration.zero);

final ChatMessage _quoted = ChatMessage(
  id: 'm-quoted',
  sessionId: 's1',
  senderId: 'agent-1',
  senderType: SenderType.agent,
  type: MessageType.text,
  content: 'Have you tried turning it off and on again?',
  seq: 1,
  createdAt: DateTime.utc(2026, 1, 1),
  delivery: MessageDelivery.confirmed,
);

SessionSnapshot _session({String id = 's1'}) => SessionSnapshot(
      sessionId: id,
      status: ChatStatus.open,
      mode: ChatMode.human,
      participants: const <ParticipantSnapshot>[],
      createdAt: DateTime.utc(2026, 1, 1),
    );

void main() {
  late FakeWidgetChatClient fakeClient;
  late ChatWidgetCubit cubit;

  setUp(() {
    fakeClient = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(client: fakeClient);
  });

  tearDown(() async {
    await cubit.close();
    await fakeClient.dispose();
  });

  ReplyTarget target() => ReplyTarget.from(_quoted, senderName: 'Alex');

  group('replyTo', () {
    test('nothing is being replied to on a fresh state', () {
      expect(cubit.state.replyingTo, isNull);
    });

    test('stores the target the transcript handed over', () {
      cubit.replyTo(target());

      expect(cubit.state.replyingTo, isNotNull);
      expect(cubit.state.replyingTo!.messageId, 'm-quoted');
      expect(cubit.state.replyingTo!.senderName, 'Alex');
      expect(
        cubit.state.replyingTo!.excerpt,
        'Have you tried turning it off and on again?',
      );
    });

    test('null CLEARS it — a customer who taps Reply by mistake can back out',
        () {
      cubit.replyTo(target());
      expect(cubit.state.replyingTo, isNotNull);

      cubit.replyTo(null);

      // `??` cannot express this. If the copyWith sentinel were dropped the
      // target would be un-clearable and every message after the first one
      // would silently be a reply too.
      expect(cubit.state.replyingTo, isNull);
    });

    test('replacing one target with another addresses the newer message', () {
      cubit.replyTo(target());
      cubit.replyTo(
        ReplyTarget.from(
          ChatMessage(
            id: 'm-other',
            sessionId: 's1',
            senderId: 'agent-1',
            senderType: SenderType.agent,
            type: MessageType.text,
            content: 'Second thought',
            seq: 2,
            createdAt: DateTime.utc(2026, 1, 1),
            delivery: MessageDelivery.confirmed,
          ),
          senderName: 'Alex',
        ),
      );

      expect(cubit.state.replyingTo!.messageId, 'm-other');
    });

    test('setting the same target twice emits nothing new', () {
      cubit.replyTo(target());
      final ChatWidgetState first = cubit.state;

      cubit.replyTo(target());

      // Equatable compares by value, so an idempotent set repaints nothing.
      expect(cubit.state, first);
    });
  });

  group('the target survives an unrelated rebuild', () {
    test('a config change does not drop it', () {
      cubit.replyTo(target());

      cubit.applyRemoteConfig(testRemoteConfig(accent: '#00ff00'));

      expect(cubit.state.replyingTo, isNotNull);
      expect(cubit.state.replyingTo!.messageId, 'm-quoted');
    });

    test('an unrelated message arriving does not drop it', () async {
      cubit.replyTo(target());

      fakeClient.emitMessage(
        ChatMessage(
          id: 'm-noise',
          sessionId: 's1',
          senderId: 'agent-1',
          senderType: SenderType.agent,
          type: MessageType.text,
          content: 'Still there?',
          seq: 3,
          createdAt: DateTime.utc(2026, 1, 1),
          delivery: MessageDelivery.confirmed,
        ),
      );
      await flush();

      expect(cubit.state.messages, hasLength(1));
      expect(cubit.state.replyingTo, isNotNull);
    });

    test('a session snapshot landing does not drop it', () async {
      cubit.replyTo(target());

      fakeClient.emitSession(_session());
      await flush();

      expect(cubit.state.session, isNotNull);
      expect(cubit.state.replyingTo, isNotNull);
    });

    test('every other copyWith call carries it through untouched', () {
      // The clause is `clearReplyingTo ? null : (replyingTo ?? this)`, so a
      // caller that names neither must leave it exactly as it was — the
      // property every unrelated emit in this class depends on.
      final ChatWidgetState withTarget =
          ChatWidgetState.initial().copyWith(replyingTo: target());

      expect(withTarget.copyWith(isTyping: true).replyingTo, target());
      expect(withTarget.copyWith(unreadCount: 4).replyingTo, target());
      expect(withTarget.copyWith(muted: true).replyingTo, target());
    });

    test('it participates in equality, so setting it actually repaints', () {
      final ChatWidgetState blank = ChatWidgetState.initial();

      // Absent from `props` it would be invisible to Equatable, `super.emit`
      // would dedupe the change away, and the chip would never appear.
      expect(blank.copyWith(replyingTo: target()), isNot(blank));
    });
  });
}
