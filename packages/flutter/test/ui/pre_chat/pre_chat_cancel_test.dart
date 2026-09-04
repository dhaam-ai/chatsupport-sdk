// Reproduces `pre-chat-preemption.test.ts:576-696` — "Cancel returns the
// customer to the screen the form was opened from".
//
// Finishing a detour on the conversation screen strands the customer on an
// empty transcript with the tab bar gone, having pressed Cancel.

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
];

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;

  setUp(() => client = FakeWidgetChatClient());
  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  group('Cancel returns to the screen the form was opened from', () {
    test('opened from Home: Cancel lands back on Home, slot empty', () {
      cubit = ChatWidgetCubit(client: client);
      expect(cubit.state.screen, ScreenName.home);

      cubit.startNewConversation();
      expect(cubit.state.screen, ScreenName.conversation);
      expect(cubit.state.activeSurface, isA<ComposingNewSurface>());

      cubit.cancelNewConversation();

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.screen, ScreenName.home);
    });

    // Not Home, and not the conversation: the screen they were actually on.
    test('opened from Messages: Cancel lands back on Messages', () {
      cubit = ChatWidgetCubit(client: client);
      cubit.switchTab(ScreenName.messages);
      expect(cubit.state.screen, ScreenName.messages);

      cubit.startNewConversation();
      expect(cubit.state.screen, ScreenName.conversation);

      cubit.cancelNewConversation();

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.screen, ScreenName.messages);
    });

    // The asymmetry that makes this not a plain release: opened ON the
    // conversation, the conversation IS where they came from — so the sync
    // runs and whatever was due behind the form comes back.
    test(
        'opened from the conversation: Cancel gives that conversation back, '
        'gate and all', () async {
      cubit = ChatWidgetCubit(
        client: client,
        initialConfig: testRemoteConfig(
          preChatEnabled: true,
          preChatFields: _fields,
        ),
        sessionId: 'sess_1',
      );
      client.emitSession(testSession(id: 'sess_1'));
      await flush();
      expect(cubit.state.activeSurface, isA<PreChatSurface>());

      cubit.startNewConversation();
      expect(cubit.state.activeSurface, isA<ComposingNewSurface>());

      cubit.cancelNewConversation();

      expect(cubit.state.screen, ScreenName.conversation);
      // The gate was parked behind the form, not destroyed by it.
      expect(cubit.state.activeSurface, isA<PreChatSurface>());
    });

    test('Cancel with nothing open is a no-op', () {
      cubit = ChatWidgetCubit(client: client);
      cubit.cancelNewConversation();
      expect(cubit.state.screen, ScreenName.home);
      expect(cubit.state.activeSurface, isNull);
    });

    // Cancelling must not send anything, and must not count as answering the
    // questions the form was folding in.
    test('Cancel sends nothing and leaves the questions still owed', () async {
      cubit = ChatWidgetCubit(
        client: client,
        initialConfig: testRemoteConfig(
          preChatEnabled: true,
          preChatFields: _fields,
        ),
      );
      cubit.startNewConversation();
      cubit.cancelNewConversation();
      await flush();

      expect(client.sentContent, isEmpty);
      expect(cubit.state.preChatAnswered, isFalse);
      expect(cubit.state.preChatAnswers, isNull);
    });
  });

  group('walking away discards the form', () {
    // Non-preemption means no tick will ever clear one of these. Leaving the
    // conversation screen is one of the two moments that mean "I am done",
    // and without it the next conversation is drawn UNDER a stale form.
    test('switching to a tab drops the surface without putting it back', () {
      cubit = ChatWidgetCubit(client: client);
      cubit.startNewConversation();
      expect(cubit.state.activeSurface, isA<ComposingNewSurface>());

      cubit.switchTab(ScreenName.messages);

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.screen, ScreenName.messages);
    });

    test('pressing Back off the form drops it too', () {
      cubit = ChatWidgetCubit(client: client);
      cubit.startNewConversation();

      expect(cubit.back(), isTrue);

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.screen, ScreenName.home);
    });

    // Asking for a DIFFERENT conversation is the other such moment.
    test('opening another conversation drops it', () {
      cubit = ChatWidgetCubit(client: client);
      cubit.startNewConversation();

      cubit.openConversation('sess_other');

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.screen, ScreenName.conversation);
    });

    // The automatic surfaces are deliberately NOT discarded: a gate parked
    // behind Home is exactly what must still be there on return.
    test('an automatic surface parked behind Home survives the trip', () async {
      cubit = ChatWidgetCubit(
        client: client,
        initialConfig: testRemoteConfig(
          preChatEnabled: true,
          preChatFields: _fields,
        ),
        sessionId: 'sess_1',
      );
      client.emitSession(testSession(id: 'sess_1'));
      await flush();
      expect(cubit.state.activeSurface, isA<PreChatSurface>());

      cubit.switchTab(ScreenName.home);
      expect(cubit.state.activeSurface, isA<PreChatSurface>());

      cubit.switchTab(ScreenName.messages);
      expect(cubit.state.activeSurface, isA<PreChatSurface>());
    });
  });
}
