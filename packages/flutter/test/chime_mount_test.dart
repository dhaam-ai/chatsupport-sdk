/// The chime, mounted.
///
/// `Chime` has been built and unit-tested since T14, and nothing in `lib/`
/// ever constructed one — only a test did. These cases are about the HOST:
/// that `ChatWidget` drives it off the same fact the reference does
/// (`unreadCount` rising, `widget.ts:2088`), that the initial reading is
/// taken silently, and that both gates reach it.
///
/// The rules INSIDE `Chime` — strictly-on-the-way-up, record-even-when-muted,
/// lazy player construction — are `test/ui/header/chime_test.dart`'s and are
/// not re-asserted here.
library;

import 'package:dhaam_chat/dhaam_chat.dart' hide ConnectionState;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'state/fake_widget_chat_client.dart';
import 'support/remote_config_fixtures.dart';

/// A summary carrying [unread], which is the only field this suite reads.
ChatSessionSummary _summary(int unread) => ChatSessionSummary(
      id: 's1',
      status: ChatStatus.open,
      mode: ChatMode.bot,
      createdAt: DateTime.utc(2026, 1, 1),
      unreadCount: unread,
    );

/// The same, for a conversation the merchant has CLOSED — one this widget
/// will not list anywhere (see [ChatWidgetState.customerVisibleSessions] and
/// `test/ui/closed_session_hidden_test.dart` for the rule itself).
ChatSessionSummary _closed(int unread) => ChatSessionSummary(
      id: 'closed_one',
      status: ChatStatus.closed,
      mode: ChatMode.human,
      createdAt: DateTime.utc(2026, 1, 1),
      unreadCount: unread,
    );

void main() {
  late FakeWidgetChatClient client;
  late int plays;
  late Chime chime;

  setUp(() {
    client = FakeWidgetChatClient();
    plays = 0;
    chime = Chime(createPlayer: () => () async => plays++);
  });

  tearDown(() async {
    await client.dispose();
  });

  /// Mounts a widget whose merchant has [sound] configured.
  ///
  /// [initialSessions] is for the cases that need MIXED statuses; the
  /// [initialUnread] shorthand it sits beside is one open conversation and
  /// nothing else, which is what every case above them wants.
  Future<ChatWidgetCubit> pump(
    WidgetTester tester, {
    bool sound = true,
    int initialUnread = 0,
    List<ChatSessionSummary>? initialSessions,
  }) async {
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(sound: sound),
    );
    if (initialSessions != null) {
      cubit.updateSessionSummaries(initialSessions);
    } else if (initialUnread > 0) {
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(initialUnread),
      ]);
    }
    addTearDown(cubit.close);
    await tester.pumpWidget(
      MaterialApp(home: ChatWidget(cubit: cubit, chime: chime)),
    );
    return cubit;
  }

  testWidgets('plays when the unread count rises', (WidgetTester tester) async {
    final ChatWidgetCubit cubit = await pump(tester);

    cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(1)]);
    await tester.pump();

    expect(plays, equals(1));
  });

  testWidgets('is silent on the reading it starts from',
      (WidgetTester tester) async {
    // A restored session's backlog must not greet a returning visitor with a
    // noise about messages they have already read. The mount takes the first
    // reading silently — the counterpart of the reference's
    // `{ immediate: true }`.
    await pump(tester, initialUnread: 7);

    expect(plays, isZero);
  });

  testWidgets('a rise from a NON-zero start still plays',
      (WidgetTester tester) async {
    // The case the silent seed must not break: seeding the watermark at
    // mount is what lets the very next rise be heard. Without the seed this
    // first change would be mistaken for the initial reading and stay
    // silent.
    final ChatWidgetCubit cubit = await pump(tester, initialUnread: 7);

    cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(8)]);
    await tester.pump();

    expect(plays, equals(1));
  });

  testWidgets('is silent when the count FALLS', (WidgetTester tester) async {
    // `unreadCount` drops to zero when the panel is read, and a widget that
    // chimed on any change would announce the customer's own act of reading.
    final ChatWidgetCubit cubit = await pump(tester, initialUnread: 3);

    cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(0)]);
    await tester.pump();

    expect(plays, isZero);
  });

  testWidgets('is silent while this visitor has muted it',
      (WidgetTester tester) async {
    final ChatWidgetCubit cubit = await pump(tester);
    cubit.setMuted(true);
    await tester.pump();

    cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(1)]);
    await tester.pump();

    expect(plays, isZero);
  });

  testWidgets('is silent when the MERCHANT never enabled sound',
      (WidgetTester tester) async {
    // `RemoteConfig.sound` defaults to false, and that default is
    // load-bearing: an unreadable config is not consent to make noise on
    // somebody's device.
    final ChatWidgetCubit cubit = await pump(tester, sound: false);

    cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(1)]);
    await tester.pump();

    expect(plays, isZero);
  });

  testWidgets('un-muting does not then chime for the muted backlog',
      (WidgetTester tester) async {
    // The count is recorded even while the gate refuses, so the rise that
    // happened during the mute is not replayed on un-mute.
    final ChatWidgetCubit cubit = await pump(tester);
    cubit.setMuted(true);
    await tester.pump();
    cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(5)]);
    await tester.pump();

    cubit.setMuted(false);
    await tester.pump();

    expect(plays, isZero);
  });

  testWidgets('allocates no player at all for a muted visitor',
      (WidgetTester tester) async {
    final ChatWidgetCubit cubit = await pump(tester);
    cubit.setMuted(true);
    await tester.pump();
    cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(1)]);
    await tester.pump();

    expect(chime.isInitialised, isFalse);
  });

  // ── The chime obeys the same rule as the badge ─────────────────────────
  //
  // A conversation the merchant has CLOSED is not listed on any of this
  // widget's surfaces ([ChatWidgetState.customerVisibleSessions]), and the
  // Messages tab badge counts only what IS listed. A chime is the louder
  // half of that same promise: a sound with no badge change, no row and
  // nowhere to go is one the customer can neither explain nor act on. So
  // the host drives the chime off `customerVisibleUnreadCount` too — both
  // where the listener reads it and where `initState` seeds the watermark
  // from it.
  //
  // The rules INSIDE `Chime` are still `test/ui/header/chime_test.dart`'s;
  // what these three cases pin is WHICH NUMBER this widget hands it.

  testWidgets('is silent for a rise confined to a CLOSED conversation',
      (WidgetTester tester) async {
    final ChatWidgetCubit cubit = await pump(
      tester,
      initialSessions: <ChatSessionSummary>[_summary(2), _closed(5)],
    );

    // The whole page goes 7 -> 8; what the customer can reach stays at 2.
    cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(2), _closed(6)]);
    await tester.pump();

    expect(cubit.state.unreadCount, equals(8));
    expect(cubit.state.customerVisibleUnreadCount, equals(2));
    expect(plays, isZero);
  });

  testWidgets('still plays for a rise the customer CAN go and read',
      (WidgetTester tester) async {
    // The other half, and the one that stops the narrowing from being
    // implemented as silence: a closed conversation sitting in the page
    // must not swallow a reply that landed somewhere the customer can open.
    final ChatWidgetCubit cubit = await pump(
      tester,
      initialSessions: <ChatSessionSummary>[_summary(2), _closed(5)],
    );

    cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(3), _closed(5)]);
    await tester.pump();

    expect(plays, equals(1));
  });

  testWidgets('seeds its first silent reading from the VISIBLE count',
      (WidgetTester tester) async {
    // `initState` matters as much as the listener. The seed is the
    // watermark every later rise is compared against, so a seed taken from
    // the whole page (6 here) while the listener reads the visible count
    // (1, then 2) would compare 2 against 6 and stay silent for a real
    // reply. Both sites read the same number, or neither is narrowed.
    final ChatWidgetCubit cubit = await pump(
      tester,
      initialSessions: <ChatSessionSummary>[_summary(1), _closed(5)],
    );
    expect(plays, isZero);

    cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(2), _closed(5)]);
    await tester.pump();

    expect(plays, equals(1));
  });

  // ── Joining a closed conversation is not an arrival ─────────────────
  //
  // Added when the chime moved onto the visible count. That narrowing has a
  // consequence the file above does not cover: the number watched can change
  // because WHAT IT COUNTS changed, not because anything came in. Joining a
  // conversation that was already closed brings it back into
  // `customerVisibleSessions` (the exemption for the one being read), so its
  // existing unread enters the sum for the first time and the count jumps.
  //
  // Played, that chimes for a backlog — the one thing `playOnUnreadRise`
  // exists to prevent: "a restored session's backlog must not greet a
  // returning visitor with a noise about messages they have already read."
  // Reachable when a host opens such a conversation directly.
  //
  // `ChatWidget` answers it by watching `session?.sessionId` alongside the
  // count and calling `Chime.recordWithoutPlaying` when THAT is what moved.
  group('a join that reveals a closed conversation', () {
    /// Lets a queued `sessions` event reach the Cubit before the next pump.
    ///
    /// The cases above this group never needed one: they drive
    /// `updateSessionSummaries` directly, which is synchronous. These join a
    /// session, and `FakeWidgetChatClient`'s controllers are built in
    /// `setUp`, OUTSIDE the fake clock — so `add` schedules delivery on a
    /// microtask that a plain `pump()` inside `FakeAsync` will never drain.
    /// `runAsync` steps out to the real clock for that delivery; the `pump`
    /// after it turns the resulting state into a frame. Same helper and same
    /// reasoning as `test/ui/conversation_screen_test.dart`'s own `flush`.
    Future<void> flush(WidgetTester tester) async {
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
    }

    Future<void> join(WidgetTester tester, ChatWidgetCubit cubit, String id,
        {ChatStatus status = ChatStatus.open}) async {
      cubit.openConversation(id);
      client.emitSession(testSession(id: id, status: status));
      await flush(tester);
      await tester.pumpAndSettle();
    }

    testWidgets('is silent — the jump is a reveal, not a reply',
        (WidgetTester tester) async {
      final ChatWidgetCubit cubit = await pump(
        tester,
        initialSessions: <ChatSessionSummary>[_closed(4)],
      );
      expect(cubit.state.customerVisibleUnreadCount, isZero,
          reason: 'hidden at mount, so the watermark is seeded at zero');

      await join(tester, cubit, 'closed_one', status: ChatStatus.closed);

      expect(cubit.state.customerVisibleUnreadCount, equals(4),
          reason: 'the count really does jump — that is not in dispute');
      expect(plays, isZero,
          reason: 'nothing ARRIVED; those four were already sitting there');
    });

    // The half that matters most: a fix that simply silenced this
    // conversation would pass the case above and be worse than the defect.
    testWidgets('but a real message afterwards still plays',
        (WidgetTester tester) async {
      final ChatWidgetCubit cubit = await pump(
        tester,
        initialSessions: <ChatSessionSummary>[_closed(4)],
      );
      await join(tester, cubit, 'closed_one', status: ChatStatus.closed);
      expect(plays, isZero);

      cubit.updateSessionSummaries(<ChatSessionSummary>[_closed(5)]);
      await tester.pump();

      expect(plays, equals(1),
          reason: 'the watermark was RECORDED at 4, not suppressed, so 5 is '
              'still a rise');
    });

    // The control that isolates the cause. An OPEN conversation is already
    // visible, so joining it reveals nothing and must behave exactly as it
    // always did — which is what will catch a future change that re-routes
    // the trigger onto joins in general.
    testWidgets('joining an already-visible conversation is unaffected',
        (WidgetTester tester) async {
      final ChatWidgetCubit cubit = await pump(
        tester,
        initialSessions: <ChatSessionSummary>[_summary(4)],
      );
      expect(cubit.state.customerVisibleUnreadCount, equals(4));

      await join(tester, cubit, 's1');
      expect(plays, isZero);

      cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(5)]);
      await tester.pump();

      expect(plays, equals(1), reason: 'and a real arrival still sounds');
    });
  });
}
