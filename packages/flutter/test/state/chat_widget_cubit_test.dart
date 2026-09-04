import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_widget_chat_client.dart';

/// Lets a queued stream event actually reach its listener.
///
/// `StreamController.add` (the default, non-`sync` controller — what
/// [FakeWidgetChatClient] uses, matching a real broadcast controller)
/// schedules delivery on a microtask rather than delivering synchronously.
/// Same reasoning `dhaam_chat`'s own `test/fakes.dart` gives for its
/// identically-purposed `flush()`.
Future<void> flush() => Future<void>.delayed(Duration.zero);

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

  group('initial state', () {
    test('starts on Home, disconnected, with the widget defaults', () {
      expect(cubit.state.screen, ScreenName.home);
      expect(cubit.state.canGoBack, isFalse);
      expect(cubit.state.composingNew, isFalse);
      expect(cubit.state.connectionState, ConnectionState.idle);
      expect(cubit.state.config, defaultRemoteConfig);
      expect(cubit.state.messages, isEmpty);
      expect(cubit.state.session, isNull);
      expect(cubit.state.unreadCount, 0);
    });

    test('honours a supplied initial config and screen', () {
      final custom = ChatWidgetCubit(
        client: FakeWidgetChatClient(),
        initialConfig: defaultRemoteConfig.copyWithAccent('#ff0000'),
        initialScreen: ScreenName.messages,
      );
      expect(custom.state.screen, ScreenName.messages);
      expect(custom.state.config.accent, '#ff0000');
      custom.close();
    });
  });

  group('connect()', () {
    test('delegates to the client', () async {
      await cubit.connect();
      expect(fakeClient.connectCalls, 1);
    });
  });

  group('config', () {
    test('applyRemoteConfig replaces the config in state', () {
      final updated = defaultRemoteConfig.copyWithAccent('#00ff00');
      cubit.applyRemoteConfig(updated);
      expect(cubit.state.config.accent, '#00ff00');
    });
  });

  group('session summaries', () {
    test('updateSessionSummaries stores the list and sums unreadCount', () {
      final summaries = [
        ChatSessionSummary(
          id: 'a',
          status: ChatStatus.open,
          mode: ChatMode.human,
          createdAt: DateTime.utc(2026, 1, 1),
          unreadCount: 2,
        ),
        ChatSessionSummary(
          id: 'b',
          status: ChatStatus.resolved,
          mode: ChatMode.bot,
          createdAt: DateTime.utc(2026, 1, 1),
          unreadCount: 3,
        ),
      ];

      cubit.updateSessionSummaries(summaries);

      expect(cubit.state.sessionSummaries, summaries);
      expect(cubit.state.unreadCount, 5);
    });

    test('an empty list zeroes the badge back out', () {
      cubit.updateSessionSummaries([
        ChatSessionSummary(id: 'a', status: ChatStatus.open, mode: ChatMode.human, createdAt: DateTime.utc(2026, 1, 1), unreadCount: 4),
      ]);
      expect(cubit.state.unreadCount, 4);

      cubit.updateSessionSummaries(const []);
      expect(cubit.state.unreadCount, 0);
    });
  });

  group('navigation', () {
    test('switchTab swaps without enabling back', () {
      cubit.switchTab(ScreenName.messages);
      expect(cubit.state.screen, ScreenName.messages);
      expect(cubit.state.canGoBack, isFalse);
    });

    test('startNewConversation goes to conversation in compose mode', () {
      cubit.startNewConversation();
      expect(cubit.state.screen, ScreenName.conversation);
      expect(cubit.state.composingNew, isTrue);
      // `composingNew` is now a GETTER over the surface slot rather than a
      // stored flag, so it and the slot cannot disagree. Asserted together
      // here so a later node re-introducing a parallel field fails loudly
      // instead of quietly recreating the duplication.
      expect(cubit.state.activeSurface, isA<ComposingNewSurface>());
      expect(cubit.surfaces.active, same(cubit.state.activeSurface));
      expect(cubit.state.canGoBack, isTrue);
    });

    test('openConversation joins the session and goes to conversation, not composing', () {
      cubit.openConversation('past-session-1');
      expect(fakeClient.joinedSessionIds, ['past-session-1']);
      expect(cubit.state.screen, ScreenName.conversation);
      expect(cubit.state.composingNew, isFalse);
      expect(cubit.state.activeSurface, isNull);
      // Deliberately putting a conversation on screen is what arms the
      // pre-chat gate — see ChatWidgetState.conversationOpened.
      expect(cubit.state.conversationOpened, isTrue);
    });

    test('back() returns to wherever navigation came from', () {
      cubit.switchTab(ScreenName.messages);
      cubit.startNewConversation();
      expect(cubit.state.screen, ScreenName.conversation);

      final moved = cubit.back();

      expect(moved, isTrue);
      expect(cubit.state.screen, ScreenName.messages);
    });

    test('back() with nothing to go back to answers false and leaves state alone', () {
      final before = cubit.state;
      final moved = cubit.back();
      expect(moved, isFalse);
      expect(cubit.state, same(before));
    });

    test('startNewConversation clears a topic left selected from a compose that never sent', () {
      cubit.startNewConversation();
      cubit.selectTopic(const ConversationTopic(id: 't1', label: 'Delivery issue'));
      expect(cubit.state.selectedTopic, isNotNull);

      cubit.startNewConversation();

      expect(cubit.state.selectedTopic, isNull);
    });

    test('openConversation clears a selected topic — it belongs to a prospective new conversation', () {
      cubit.startNewConversation();
      cubit.selectTopic(const ConversationTopic(id: 't1', label: 'Delivery issue'));

      cubit.openConversation('past-session-1');

      expect(cubit.state.selectedTopic, isNull);
    });
  });

  group('topic selection', () {
    const topic = ConversationTopic(id: 't1', label: 'Delivery issue');
    const otherTopic = ConversationTopic(id: 't2', label: 'Refund');

    test('selectTopic picks a topic', () {
      cubit.selectTopic(topic);
      expect(cubit.state.selectedTopic, topic);
    });

    test('selecting a different topic replaces the previous one', () {
      cubit.selectTopic(topic);
      cubit.selectTopic(otherTopic);
      expect(cubit.state.selectedTopic, otherTopic);
    });

    test('selecting the SAME topic again un-picks it — a single-select toggle', () {
      cubit.selectTopic(topic);
      cubit.selectTopic(topic);
      expect(cubit.state.selectedTopic, isNull);
    });
  });

  group('sending', () {
    test('sendMessage delegates to the client', () {
      cubit.sendMessage('hello there');
      expect(fakeClient.sentContent, ['hello there']);
    });

    test('sendMessage while composing a new conversation clears composingNew', () {
      cubit.startNewConversation();
      expect(cubit.state.composingNew, isTrue);

      cubit.sendMessage('hi');

      expect(cubit.state.composingNew, isFalse);
      // The form's task COMPLETED, so the slot went back through `release`
      // and the customer stays on the conversation they just started.
      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.screen, ScreenName.conversation);
    });

    test('sendMessage while composing also clears a selected topic — its job for this compose is done', () {
      cubit.startNewConversation();
      cubit.selectTopic(const ConversationTopic(id: 't1', label: 'Delivery issue'));

      cubit.sendMessage('my order never arrived');

      expect(cubit.state.selectedTopic, isNull);
    });

    test('sendMessage NOT composing (an existing conversation) leaves no topic to clear either way', () {
      cubit.openConversation('past-session-1');
      cubit.sendMessage('a follow-up message');
      expect(cubit.state.selectedTopic, isNull);
    });

    test('markRead delegates to the client', () {
      cubit.markRead(upToMessageId: 'm5');
      expect(fakeClient.markReadCalls, ['m5']);
    });
  });

  group('inbound messages', () {
    test('a new message is appended to the transcript', () async {
      fakeClient.emitMessage(testMessage(id: 'm1', content: 'Hi!'));
      await flush();
      expect(cubit.state.messages, hasLength(1));
      expect(cubit.state.messages.single.content, 'Hi!');
    });

    test('a second frame with the SAME id replaces rather than duplicates', () async {
      // Mirrors ChatClient.sendMessage's own contract: a message this
      // client sent appears twice with the same id — pending, then
      // confirmed — and a host keys its list on it.
      fakeClient.emitMessage(testMessage(id: 'm1', delivery: MessageDelivery.pending, seq: null));
      await flush();
      fakeClient.emitMessage(testMessage(id: 'm1', delivery: MessageDelivery.confirmed, seq: 42));
      await flush();

      expect(cubit.state.messages, hasLength(1));
      expect(cubit.state.messages.single.delivery, MessageDelivery.confirmed);
      expect(cubit.state.messages.single.seq, 42);
    });

    test('arrival order is preserved even though the map is keyed by id', () async {
      fakeClient.emitMessage(testMessage(id: 'm1', content: 'first'));
      await flush();
      fakeClient.emitMessage(testMessage(id: 'm2', content: 'second'));
      await flush();
      // Updating m1 in place must not move it to the end.
      fakeClient.emitMessage(testMessage(id: 'm1', content: 'first (edited)'));
      await flush();

      expect(cubit.state.messages.map((m) => m.id).toList(), ['m1', 'm2']);
    });
  });

  group('inbound session/typing/connection', () {
    test('a session snapshot updates state.session', () async {
      final session = testSession(id: 's42', status: ChatStatus.waitingForAgent);
      fakeClient.emitSession(session);
      await flush();
      expect(cubit.state.session, session);
    });

    test('typing events flip isTyping', () async {
      fakeClient.emitTyping(true);
      await flush();
      expect(cubit.state.isTyping, isTrue);
      fakeClient.emitTyping(false);
      await flush();
      expect(cubit.state.isTyping, isFalse);
    });

    test('connection state changes are mirrored', () async {
      fakeClient.emitConnectionState(ConnectionState.connecting);
      await flush();
      expect(cubit.state.connectionState, ConnectionState.connecting);
      fakeClient.emitConnectionState(ConnectionState.connected);
      await flush();
      expect(cubit.state.connectionState, ConnectionState.connected);
    });
  });
}

extension on RemoteConfig {
  /// Test-only convenience: a copy with just `accent` changed, since
  /// RemoteConfig itself has no copyWith (it is a parse result, not
  /// something production code mutates piecemeal).
  RemoteConfig copyWithAccent(String accent) => RemoteConfig(
        enabled: enabled,
        accent: accent,
        title: title,
        theme: theme,
        position: position,
        offsetX: offsetX,
        offsetY: offsetY,
        launcher: launcher,
        launcherLabel: launcherLabel,
        launcherIcon: launcherIcon,
        launcherShadow: launcherShadow,
        design: design,
        header: header,
        logoUrl: logoUrl,
        subtitle: subtitle,
        avatarMode: avatarMode,
        avatarInitials: avatarInitials,
        showBranding: showBranding,
        brandingText: brandingText,
        brandingUrl: brandingUrl,
        thread: thread,
        cornerRadius: cornerRadius,
        fontFamily: fontFamily,
        greeting: greeting,
        greetingDelaySec: greetingDelaySec,
        autoOpen: autoOpen,
        autoOpenDelaySec: autoOpenDelaySec,
        typingIndicator: typingIndicator,
        sound: sound,
        transcriptEmail: transcriptEmail,
        consentRequired: consentRequired,
        consentText: consentText,
        supportEmail: supportEmail,
        handoffKeywords: handoffKeywords,
        reportIssue: reportIssue,
        preChatEnabled: preChatEnabled,
        preChatFields: preChatFields,
        commonQuestions: commonQuestions,
        conversationTopics: conversationTopics,
        csatStyle: csatStyle,
        offlineMode: offlineMode,
        offlineMessage: offlineMessage,
        fileUploads: fileUploads,
        isOpenNow: isOpenNow,
        flows: flows,
        botDisplayName: botDisplayName,
        publishedVersion: publishedVersion,
      );
}
