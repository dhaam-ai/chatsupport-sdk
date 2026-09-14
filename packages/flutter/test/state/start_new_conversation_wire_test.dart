// The route from "Start a new conversation" to the frame that actually mints
// one.
//
// The reported bug, from an app developer testing against a live server:
// "when we try to start a new conversation from inside a chat, it takes the
// user back to the same chat." `startConversationFrom` sent the opening line
// and nothing else, so from Home — where no session exists yet — the server
// minted one on the hello and it looked correct, while from INSIDE a
// conversation the message simply landed in the conversation the customer
// was trying to leave.
//
// `ChatClient.startNewSession` is the half that was already built and
// already tested (packages/dart): it carries the `newSession: true` latch,
// the `forgetResumeAnchor` teardown, and the abandonment of undelivered
// sends that stops the old conversation's queue leaking into the new one.
// Nothing in this package called it. These tests are the wire.

import 'dart:async';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/remote_config_fixtures.dart';
import 'fake_widget_chat_client.dart';

const List<ConversationTopic> _topics = <ConversationTopic>[
  ConversationTopic(id: 'billing', label: 'Billing'),
];

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;

  setUp(() {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(conversationTopics: _topics),
    );
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  /// Puts the customer INSIDE a conversation, the way the bug report
  /// describes: a session opened, and a snapshot for it landed.
  ///
  /// Pumped, because the snapshot arrives on a stream: without the pump the
  /// Cubit has not folded it yet and `state.session` is still null, which is
  /// the from-HOME case wearing a conversation's clothes.
  Future<void> openAConversation({String id = 's1'}) async {
    cubit.openConversation(id);
    client.emitSession(testSession(id: id));
    await pumpEventQueue();
  }

  group('starting a new conversation from inside one', () {
    test('asks for a NEW session instead of sending into the current one',
        () async {
      await openAConversation();

      await cubit.startConversationFrom(message: 'My order is late');

      // The whole bug in one assertion: without this the opening line is
      // addressed to the conversation the customer just asked to leave.
      expect(client.newSessionTopics, hasLength(1),
          reason: 'startNewSession was never called');
      expect(client.sentContent, <String>['My order is late']);
    });

    test('the new session is asked for BEFORE the opening line goes out',
        () async {
      // Order is not cosmetic. `startNewSession` fails every undelivered send
      // on the way out (`_abandonUndeliveredSends`), so an opening line
      // composed first is either addressed to the closed session or dropped.
      await openAConversation();
      final Completer<void> ack = Completer<void>();
      client.newSessionGate = ack;

      final Future<void> started =
          cubit.startConversationFrom(message: 'My order is late');
      await pumpEventQueue();

      expect(client.newSessionTopics, hasLength(1));
      expect(client.sentContent, isEmpty,
          reason: 'the opening line went out before the session was minted');

      ack.complete();
      await started;
      expect(client.sentContent, <String>['My order is late']);
    });

    test('the topic the customer picked rides the handshake that mints it',
        () async {
      // `topic` can travel on nothing else — see ChatClient.startNewSession
      // on why it cannot be a later frame. Resolved at the form as the chip's
      // LABEL and, until this wire existed, stored on state and discarded.
      await openAConversation();

      await cubit.startConversationFrom(
        message: 'My order is late',
        topic: 'Billing',
      );

      expect(client.newSessionTopics, <String?>['Billing']);
      expect(cubit.state.startedTopicLabel, 'Billing');
    });

    test('no subject is invented — the form has no field for one', () async {
      // `startNewSession` takes one, and this screen collects nothing that is
      // a subject: the topic is a chip, the message is the opening line.
      // Absent, rather than the message text under another name.
      await openAConversation();

      await cubit.startConversationFrom(
        message: 'My order is late',
        topic: 'Billing',
      );

      expect(client.newSessionSubjects, <String?>[null]);
    });

    test('the pre-chat details go into the NEW session, not the old one',
        () async {
      await cubit.close();
      client = FakeWidgetChatClient();
      cubit = ChatWidgetCubit(
        client: client,
        initialConfig: testRemoteConfig(
          preChatEnabled: true,
          preChatFields: const <PreChatField>[
            PreChatField(
              id: 'name',
              label: 'Your name',
              type: PreChatFieldType.text,
              required: false,
            ),
          ],
        ),
      );
      await openAConversation();

      await cubit.startConversationFrom(
        message: 'My order is late',
        answers: <String, String>{'name': 'Jordan'},
      );

      // Both sends land after the mint, in the order the agent reads them.
      expect(client.newSessionTopics, hasLength(1));
      expect(client.sentContent, <String>[
        'Your name: Jordan',
        'My order is late',
      ]);
    });
  });

  group('starting a new conversation from Home', () {
    test('tears down nothing, because there is no session to tear down',
        () async {
      // No snapshot has landed, so this client is in no conversation. The
      // server mints one on the hello and the opening line lands in it —
      // the path that always worked. A teardown here would disconnect and
      // re-handshake for nothing.
      expect(cubit.state.session, isNull);

      await cubit.startConversationFrom(
        message: 'My order is late',
        topic: 'Billing',
      );

      expect(client.newSessionTopics, isEmpty);
      expect(client.sentContent, <String>['My order is late']);
      expect(cubit.state.startedTopicLabel, 'Billing');
    });
  });

  group('the opening-line latch spans the mint', () {
    test('the pre-chat gate cannot flash while the new session is in flight',
        () async {
      // `startNewSession` resolves on the new session's `connection.ack`, and
      // that snapshot lands with an EMPTY transcript and a new id — exactly
      // the window where "pre-chat enabled, unanswered, no messages" is
      // momentarily true. Releasing the latch before the mint is under way
      // puts the gate in front of a conversation that is already starting.
      await cubit.close();
      client = FakeWidgetChatClient();
      cubit = ChatWidgetCubit(
        client: client,
        initialConfig: testRemoteConfig(
          preChatEnabled: true,
          preChatFields: const <PreChatField>[
            PreChatField(
              id: 'name',
              label: 'Your name',
              type: PreChatFieldType.text,
              required: false,
            ),
          ],
        ),
      );
      await openAConversation();
      // The baseline the assertion below is measured against: this gate is
      // genuinely armed, so its absence during the mint means something.
      expect(cubit.state.activeSurface, const PreChatSurface());

      final Completer<void> ack = Completer<void>();
      client.newSessionGate = ack;
      final Future<void> started =
          cubit.startConversationFrom(message: 'My order is late');
      await pumpEventQueue();

      // The ack for the new session arrives — the tick that used to raise the
      // gate over a conversation that was already starting.
      client.emitSession(testSession(id: 's2'));
      await pumpEventQueue();
      expect(cubit.state.activeSurface, isNot(const PreChatSurface()));

      ack.complete();
      await started;
    });
  });
}
