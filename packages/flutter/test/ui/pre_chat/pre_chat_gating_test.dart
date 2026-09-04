// Reproduces the widget-level acceptance criteria for the guest-only
// pre-chat gate, at the Cubit/slot level:
//
//   * pre-chat-guest-only.test.ts  — guest vs logged-in, all three surfaces
//   * pre-chat-preemption.test.ts:330-476 — no preemption, no flash, the
//     Common Questions skip, and preChatAnswered latching
//   * common-questions-mount.test.ts — the gate NEVER fires at mount
//
// The Cancel-returns-to-origin half lives in
// `pre_chat_cancel_test.dart`, and the new-conversation form's own
// behaviour in `new_conversation_view_test.dart`.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../state/fake_widget_chat_client.dart';
import '../../support/remote_config_fixtures.dart';

Future<void> flush() => Future<void>.delayed(Duration.zero);

const List<PreChatField> _fields = <PreChatField>[
  PreChatField(
    id: 'name',
    label: 'Your name',
    type: PreChatFieldType.text,
    required: true,
  ),
  PreChatField(
    id: 'email',
    label: 'Email address',
    type: PreChatFieldType.email,
    required: true,
  ),
];

/// A host that has authenticated somebody. The PROFILE is the fact — see
/// ChatIdentity.isGuest.
const ChatIdentity _signedIn = ChatIdentity(
  userId: 'cus_1',
  profile: ChatParticipantProfile(name: 'Jordan Rivera'),
);

RemoteConfig _asking({
  List<PreChatField> fields = _fields,
  List<CommonQuestion> commonQuestions = const <CommonQuestion>[],
}) =>
    testRemoteConfig(
      preChatEnabled: true,
      preChatFields: fields,
      commonQuestions: commonQuestions,
    );

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;

  setUp(() => client = FakeWidgetChatClient());
  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  /// A visitor the host mounted straight into a conversation — the Dart
  /// equivalent of `connectedOnConversation()`, whose `sessionId: 'sess_1'`
  /// is what makes `conversationOpened` true at mount.
  Future<void> onConversation({
    ChatIdentity identity = ChatIdentity.guest,
    RemoteConfig? config,
  }) async {
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: config ?? _asking(),
      sessionId: 'sess_1',
      identity: identity,
    );
    client.emitSession(testSession(id: 'sess_1'));
    await flush();
  }

  group('the standalone pre-chat gate', () {
    test("greets a GUEST with the merchant's questions", () async {
      await onConversation();
      expect(cubit.state.activeSurface, isA<PreChatSurface>());
    });

    // The conversation is what a signed-in customer gets. Asking anyway is
    // asking them to type their own email address back.
    test('never shows them to a LOGGED-IN visitor', () async {
      await onConversation(identity: _signedIn);
      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.isGuest, isFalse);
    });

    test('never shows them when the merchant toggle is off', () async {
      await onConversation(
        config: testRemoteConfig(preChatFields: _fields),
      );
      expect(cubit.state.activeSurface, isNull);
    });

    // Two independent console controls. Gating on the toggle alone raised an
    // empty form.
    test('never shows them when the toggle is on but no fields exist',
        () async {
      await onConversation(
        config: testRemoteConfig(preChatEnabled: true),
      );
      expect(cubit.state.activeSurface, isNull);
    });

    // A thread with something in it is a conversation already under way.
    test('never shows them in front of a transcript that has something in it',
        () async {
      await onConversation();
      expect(cubit.state.activeSurface, isA<PreChatSurface>());

      client.emitMessage(testMessage(id: 'm1'));
      await flush();

      expect(cubit.state.activeSurface, isNull);
    });
  });

  // The boot-time half of the reported bug. chat-service mints a session on
  // `connection.hello`, so `state.session` is non-null here — and the gate
  // must still be down, because the customer has not opened anything.
  group('the gate NEVER fires at mount', () {
    test('a first visit lands on Home with no form, session or not', () async {
      cubit = ChatWidgetCubit(client: client, initialConfig: _asking());
      client.emitSession(testSession(id: 'sess_live'));
      await flush();

      expect(cubit.state.session, isNotNull, reason: 'a session DOES exist');
      expect(cubit.state.conversationOpened, isFalse);
      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.screen, ScreenName.home);
    });

    // The one that pins the distinction: same state, one fact different.
    test('the same state gates once the customer actually opens one', () async {
      cubit = ChatWidgetCubit(client: client, initialConfig: _asking());
      client.emitSession(testSession(id: 'sess_live'));
      await flush();
      expect(cubit.state.activeSurface, isNull);

      cubit.openConversation('sess_past');
      client.emitSession(testSession(id: 'sess_past'));
      await flush();

      expect(cubit.state.conversationOpened, isTrue);
      expect(cubit.state.activeSurface, isA<PreChatSurface>());
    });
  });

  group('the gate does not preempt a surface the customer opened', () {
    test('the new-conversation form replaces an armed gate, not the reverse',
        () async {
      await onConversation();
      expect(cubit.state.activeSurface, isA<PreChatSurface>());

      cubit.startNewConversation();

      expect(cubit.state.activeSurface, isA<ComposingNewSurface>());
      expect(cubit.state.composingNew, isTrue);
    });

    // The reported "New conversation does nothing": a store tick used to
    // re-arm the gate over the form the customer was typing into.
    test('a session tick does NOT re-arm the gate over the open form',
        () async {
      await onConversation();
      cubit.startNewConversation();

      client.emitSession(testSession(id: 'sess_1', status: ChatStatus.open));
      await flush();

      expect(cubit.state.activeSurface, isA<ComposingNewSurface>());
    });
  });

  group('a Common Questions tap skips the fields', () {
    const CommonQuestion track = CommonQuestion(
      id: 'track',
      label: 'Track my order',
      prompt: 'Where is my order?',
    );

    test('goes straight to the conversation with no flash of the gate',
        () async {
      cubit = ChatWidgetCubit(
        client: client,
        initialConfig: _asking(commonQuestions: const <CommonQuestion>[track]),
      );
      client.emitSession(testSession(id: 'sess_live'));
      await flush();

      cubit.startCommonQuestion(track);
      await flush();

      expect(cubit.state.screen, ScreenName.conversation);
      expect(cubit.state.activeSurface, isNull);
      // The PROMPT, not the label: the label is the chip's wording.
      expect(client.sentContent, <String>['Where is my order?']);
    });

    // They were never asked, so the next form still asks. This is the
    // difference between "skipped" and "answered".
    test('does NOT count as having answered the questions', () async {
      cubit = ChatWidgetCubit(
        client: client,
        initialConfig: _asking(commonQuestions: const <CommonQuestion>[track]),
      );
      await flush();

      cubit.startCommonQuestion(track);
      await flush();

      expect(cubit.state.preChatAnswered, isFalse);
      expect(
        preChatFieldsToAsk(
          config: cubit.state.config,
          isGuest: cubit.state.isGuest,
          alreadyAnswered: cubit.state.preChatAnswered,
        ),
        hasLength(2),
      );
    });

    // It still counts as opening a conversation — so a LATER empty one does
    // meet the gate.
    test('still records that a conversation was opened', () async {
      cubit = ChatWidgetCubit(
        client: client,
        initialConfig: _asking(commonQuestions: const <CommonQuestion>[track]),
      );
      await flush();

      cubit.startCommonQuestion(track);
      await flush();

      expect(cubit.state.conversationOpened, isTrue);
    });
  });

  group('answering the gate puts it away for good', () {
    test('submit relays the answers as the opening message and latches',
        () async {
      await onConversation();
      expect(cubit.state.activeSurface, isA<PreChatSurface>());

      await cubit.submitPreChat(<String, String>{
        'name': 'Ada',
        'email': 'ada@example.com',
      });
      await flush();

      // Lines in the MERCHANT's field order, not the map's.
      expect(
        client.sentContent,
        <String>['Your name: Ada\nEmail address: ada@example.com'],
      );
      expect(cubit.state.preChatAnswered, isTrue);
      expect(cubit.state.activeSurface, isNull);
    });

    // Asked and declined: nothing to relay, but it still counts.
    test('an empty submit sends nothing yet still counts as answered',
        () async {
      await onConversation();

      await cubit.submitPreChat(const <String, String>{});
      await flush();

      expect(client.sentContent, isEmpty);
      expect(cubit.state.preChatAnswered, isTrue);
      expect(cubit.state.activeSurface, isNull);
    });

    test('skip counts as answered and the gate does not come back', () async {
      await onConversation();

      cubit.skipPreChat();
      await flush();

      expect(client.sentContent, isEmpty);
      expect(cubit.state.activeSurface, isNull);

      // A later empty conversation must not re-raise it.
      cubit.openConversation('sess_2');
      client.emitSession(testSession(id: 'sess_2'));
      await flush();
      expect(cubit.state.activeSurface, isNull);
    });
  });

  group('a config publish can arm the gate', () {
    test('turning the questions on mid-session raises it', () async {
      cubit = ChatWidgetCubit(client: client, sessionId: 'sess_1');
      client.emitSession(testSession(id: 'sess_1'));
      await flush();
      expect(cubit.state.activeSurface, isNull);

      cubit.applyRemoteConfig(_asking());

      expect(cubit.state.activeSurface, isA<PreChatSurface>());
    });
  });
}
