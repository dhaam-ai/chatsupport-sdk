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
  Future<ChatWidgetCubit> pump(
    WidgetTester tester, {
    bool sound = true,
    int initialUnread = 0,
  }) async {
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(sound: sound),
    );
    if (initialUnread > 0) {
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
}
