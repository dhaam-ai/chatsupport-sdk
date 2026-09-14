// The debug-mode diagnostic for the reported "my signed-in customer is being
// asked for their name".
//
// ── The report, and why the code was right ───────────────────────────────
//
// Twice now, from two different integrators: a host authenticates a customer,
// hands the widget a real customer token and the publishable key, and the
// customer is still asked to type their name in. That is working as designed
// — `ChatIdentity.isGuest` keys off the PROFILE and cannot key off anything
// else (see `chat_identity.dart`: the token is opaque to this package, and
// every guest has a `userId` too) — and that is exactly the problem. A host
// that never passes `identity` gets `ChatIdentity.guest` by default and no
// hint anywhere that it has just told the widget its customer is anonymous.
//
// ── Three surfaces ask, so all three are driven here ─────────────────────
//
// The warning's first home was `ChatWidgetCubit.emit`, keyed on
// `PreChatSurface` being in the slot — and that covered ONE of the three
// surfaces `pre_chat_fields.dart` names. The other two are not occasionally
// missed by that key, they are structurally excluded from it:
//
//  * while a `ComposingNewSurface` holds the slot, `resolveProductSurface`
//    returns `current` under the non-preemption rule, so `PreChatSurface`
//    can never be raised behind it — yet `NewConversationView` folds the same
//    fields in above its message box. From Home, `startNewConversation()` is
//    the only route into a chat, which makes this the likeliest path of the
//    two reports;
//  * `shouldCollectOffline` returns `OfflineSurface` from the top of the
//    precedence ladder, so `PreChatSurface` can never be raised out of hours
//    — yet `OfflineFormView` draws the same fields as `extraFields`.
//
// So every test here pumps a real screen and asserts the questions are
// genuinely on it before asserting what was said about them. A test that only
// built a Cubit is what let a trigger covering one surface in three look
// finished.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
// The diagnostic is deliberately not exported from `pre_chat.dart` — it is
// something the package prints, not a control a host calls — so its test-only
// reset is reached through the source path, the same way the voice tests
// reach their own unexported module.
import 'package:dhaam_chat_flutter/src/ui/pre_chat/guest_pre_chat_warning.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/remote_config_fixtures.dart';
import 'fake_widget_chat_client.dart';

const List<PreChatField> _fields = <PreChatField>[
  PreChatField(
    id: 'name',
    label: 'Your name',
    type: PreChatFieldType.text,
    required: true,
  ),
];

/// A merchant question the OUT-OF-HOURS form keeps.
///
/// Not `_fields`: that one is labelled "Your name", and `kOfflineBuiltInLabel`
/// drops any merchant field whose label duplicates one of the offline form's
/// own two built-ins. A question that survives the de-duplication is the one
/// that proves a guest was asked something extra there.
const List<PreChatField> _offlineFields = <PreChatField>[
  PreChatField(
    id: 'order',
    label: 'Order number',
    type: PreChatFieldType.text,
    required: false,
  ),
];

/// The merchant asking for details — the config half of the report.
RemoteConfig _asking() =>
    testRemoteConfig(preChatEnabled: true, preChatFields: _fields);

/// The same merchant, closed for the day.
RemoteConfig _askingOutOfHours() => testRemoteConfig(
      preChatEnabled: true,
      preChatFields: _offlineFields,
      isOpenNow: false,
      offlineMode: OfflineMode.collectMessage,
    );

/// A host that has authenticated somebody. The PROFILE is the fact.
/// Kept field-for-field identical to the README's own snippet under "My
/// signed-in customer is still being asked for their name", so the analyzer
/// keeps that snippet honest.
const ChatIdentity _signedIn = ChatIdentity(
  userId: 'cus_1042',
  profile: ChatParticipantProfile(
    name: 'Jordan Rivera',
    email: 'jordan@example.com',
  ),
);

Widget _wrap(ChatWidgetCubit cubit) => BlocProvider<ChatWidgetCubit>.value(
      value: cubit,
      child: const MaterialApp(home: Scaffold(body: ConversationScreen())),
    );

/// Lets a queued stream event reach its listener before the next frame.
///
/// `runAsync` steps out of the fake clock and onto the real one, which is what
/// lets the controller's queued microtask actually be delivered; the `pump()`
/// after it turns the resulting Cubit state into a frame. The same helper
/// `conversation_screen_test.dart` carries, for the same reason — a plain
/// `Future.delayed` inside `testWidgets` deadlocks.
Future<void> _flush(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  await tester.pump();
}

/// Every field label on screen, in render order — the proof the merchant's
/// questions really are up before anything is asserted about the warning.
List<String> _labels(WidgetTester tester) => tester
    .widgetList<TextField>(find.byType(TextField))
    .map((TextField field) => field.decoration?.labelText ?? '')
    .toList();

void main() {
  late FakeWidgetChatClient client;
  ChatWidgetCubit? cubit;

  setUp(() {
    client = FakeWidgetChatClient();
    // The latch is one per app run, and a test file is one isolate: without
    // this, only the first test in the file could ever see the line.
    debugResetGuestPreChatWarning();
  });
  tearDown(() async {
    await cubit?.close();
    await client.dispose();
  });

  /// Everything the package printed while [drive] ran, in order.
  ///
  /// `debugPrint` is a swappable top-level, which is what makes a diagnostic
  /// observable without it being an ERROR: a warning routed through
  /// `FlutterError.reportError` would fail the widget tests of every host
  /// with a guest-only deployment, which is not a thing an SDK may do to its
  /// integrators for a message that is only advice.
  ///
  /// Restored in a `finally` rather than in a tearDown, because
  /// `testWidgets` runs `debugAssertAllFoundationVarsUnset` at the end of the
  /// test BODY — before any tearDown — and a still-swapped `debugPrint`
  /// fails it with "the value of a foundation debug variable was changed by
  /// the test", whatever the test itself asserted.
  Future<List<String>> printedDuring(Future<void> Function() drive) async {
    final List<String> printed = <String>[];
    final DebugPrintCallback previous = debugPrint;
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) printed.add(message);
    };
    try {
      await drive();
    } finally {
      debugPrint = previous;
    }
    return printed;
  }

  /// The warning's own lines out of everything printed.
  List<String> warnings(List<String> printed) => printed
      .where((String line) => line.contains('identity.profile'))
      .toList(growable: false);

  /// SURFACE 1 — the standalone gate, in front of a conversation the host
  /// mounted the customer straight into. `sessionId` is what makes
  /// `conversationOpened` true and lets the gate arm.
  Future<void> onGate(
    WidgetTester tester, {
    ChatIdentity identity = ChatIdentity.guest,
    RemoteConfig? config,
  }) async {
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: config ?? _asking(),
      sessionId: 'sess_1',
      identity: identity,
    );
    await tester.pumpWidget(_wrap(cubit!));
    client.emitSession(testSession(id: 'sess_1'));
    await _flush(tester);
  }

  /// SURFACE 2 — the new-conversation form, which is where Home's only route
  /// into a chat lands.
  Future<void> onNewConversation(
    WidgetTester tester, {
    ChatIdentity identity = ChatIdentity.guest,
    RemoteConfig? config,
  }) async {
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: config ?? _asking(),
      identity: identity,
    );
    cubit!.startNewConversation();
    await tester.pumpWidget(_wrap(cubit!));
  }

  /// SURFACE 3 — the out-of-hours form. Published rather than passed as
  /// `initialConfig`, because the slot is re-resolved on ticks and never at
  /// construction, which is the path a config really arrives on.
  Future<void> onOfflineForm(
    WidgetTester tester, {
    ChatIdentity identity = ChatIdentity.guest,
    RemoteConfig? config,
  }) async {
    cubit = ChatWidgetCubit(client: client, identity: identity);
    await tester.pumpWidget(_wrap(cubit!));
    cubit!.applyRemoteConfig(config ?? _askingOutOfHours());
    // Two frames, not one: `applyRemoteConfig` emits for the config and again
    // for the slot it re-resolves.
    await tester.pump();
    await tester.pump();
  }

  group('every surface that asks a guest for details says so', () {
    testWidgets('SURFACE 1 — the standalone pre-chat gate',
        (WidgetTester tester) async {
      final List<String> printed = await printedDuring(() => onGate(tester));

      expect(cubit!.state.activeSurface, isA<PreChatSurface>(),
          reason: 'the gate is up — this is the moment being warned about');
      expect(_labels(tester), contains('Your name'));
      expect(warnings(printed), hasLength(1));
    });

    testWidgets('SURFACE 2 — the new-conversation form',
        (WidgetTester tester) async {
      final List<String> printed =
          await printedDuring(() => onNewConversation(tester));

      expect(cubit!.state.activeSurface, isA<ComposingNewSurface>(),
          reason: 'the slot holds the form, so the gate can never be raised');
      expect(_labels(tester), contains('Your name'),
          reason: 'the merchant question really is folded in above the box');
      expect(warnings(printed), hasLength(1));
    });

    testWidgets('SURFACE 3 — the out-of-hours offline form',
        (WidgetTester tester) async {
      final List<String> printed =
          await printedDuring(() => onOfflineForm(tester));

      expect(cubit!.state.activeSurface, isA<OfflineSurface>(),
          reason: 'the offline gate outranks the pre-chat gate outright');
      // The label carries an "(optional)" suffix the form adds itself.
      expect(_labels(tester), anyElement(contains('Order number')),
          reason: 'the merchant question really is on screen');
      expect(warnings(printed), hasLength(1));
    });
  });

  group('what the line says', () {
    testWidgets(
        'names the fix, the two things that are not it, and where to pass it',
        (WidgetTester tester) async {
      final List<String> printed =
          await printedDuring(() => onNewConversation(tester));

      final String message = warnings(printed).single;
      // userId is not the discriminator...
      expect(message, contains('userId'));
      // ...a token proves nothing about identity...
      expect(message, contains('token'));
      // ...this is the thing to pass instead...
      expect(message, contains('ChatParticipantProfile'));
      // ...and this is WHERE to pass it, which a host reading "pass a
      // profile" otherwise still has to go and find out.
      expect(message, contains('ChatWidgetCubit(identity:'));
    });

    // Nothing identifying goes to a log. The package cannot see the token at
    // all — the client owns it — and the userId it CAN see is the host's own
    // customer key, which has no business being correlated out of a console.
    testWidgets('logs nothing that identifies the visitor',
        (WidgetTester tester) async {
      final List<String> printed = await printedDuring(
        () => onNewConversation(
          tester,
          identity: const ChatIdentity(userId: 'cus_secret'),
        ),
      );

      expect(warnings(printed), hasLength(1));
      expect(printed.join('\n'), isNot(contains('cus_secret')));
    });
  });

  group('when it must stay quiet', () {
    // The negative control the whole diagnostic turns on: a host that told
    // the widget who this is must never be told it did not.
    testWidgets('a host that DID pass a profile', (WidgetTester tester) async {
      final List<String> printed = await printedDuring(
          () => onNewConversation(tester, identity: _signedIn));

      expect(cubit!.state.isGuest, isFalse);
      expect(_labels(tester), isNot(contains('Your name')),
          reason: 'and it is not asked, either');
      expect(warnings(printed), isEmpty);
    });

    // The trigger is being ASKED, not being a guest: a guest deployment the
    // merchant never configured pre-chat for is never contradicted by
    // anything, so there is nothing to say.
    testWidgets('a guest nobody asks anything', (WidgetTester tester) async {
      final List<String> printed = await printedDuring(
        () => onNewConversation(tester, config: testRemoteConfig()),
      );

      expect(cubit!.state.isGuest, isTrue);
      expect(_labels(tester), isNot(contains('Your name')));
      expect(warnings(printed), isEmpty);
    });

    // The console's two controls can disagree. A toggle switched on with no
    // fields behind it draws no form, so there is nothing to warn about — the
    // same separation `preChatFieldsToAsk` checks the two conditions for.
    testWidgets('a toggle switched on with no fields behind it',
        (WidgetTester tester) async {
      final List<String> printed = await printedDuring(
        () => onNewConversation(
          tester,
          config: testRemoteConfig(preChatEnabled: true),
        ),
      );

      expect(cubit!.state.isGuest, isTrue);
      expect(warnings(printed), isEmpty);
    });
  });

  group('once, and only once', () {
    // A guest-only deployment is legitimate. It gets one line, not one per
    // tick — noise on every repaint is how a warning gets ignored.
    testWidgets('however many ticks follow', (WidgetTester tester) async {
      final List<String> printed = await printedDuring(() async {
        await onGate(tester);
        client.emitSession(testSession(id: 'sess_1'));
        await _flush(tester);
        client.emitSession(testSession(id: 'sess_1'));
        await _flush(tester);
        client.emitTyping(true);
        await _flush(tester);
      });

      expect(cubit!.state.activeSurface, isA<PreChatSurface>());
      expect(warnings(printed), hasLength(1));
    });

    // And once ACROSS surfaces, not once per surface. Widening the trigger
    // from one surface to three is exactly the change that could have turned
    // one paragraph into three.
    testWidgets('however many of the three surfaces ask',
        (WidgetTester tester) async {
      final List<String> printed = await printedDuring(() async {
        await onGate(tester);
        expect(cubit!.state.activeSurface, isA<PreChatSurface>());
        cubit!.startNewConversation();
        await _flush(tester);
      });

      expect(cubit!.state.activeSurface, isA<ComposingNewSurface>());
      expect(_labels(tester), contains('Your name'),
          reason: 'the second surface really did ask as well');

      expect(warnings(printed), hasLength(1));
    });
  });
}
