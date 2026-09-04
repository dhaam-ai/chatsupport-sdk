// The wiring half of the consent gate: that the rules asserted in
// consent_gate_test.dart actually reach the notice and the composer.
//
// This is the half the reference's `remote-config-gating.test.ts` consent
// block asserts through the DOM — `.dh-consent.hidden` and
// `.dh-input.disabled` — and it is worth its own file because the failure is
// silent: a gate nobody read leaves a usable composer under a notice, which
// throws nothing and fails no rules test.

import 'dart:async';

import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../state/fake_widget_chat_client.dart';
import '../../support/remote_config_fixtures.dart';

final PublishableKey _tenant = PublishableKey.parse('dhp_test_abc123');

const String _notice = 'You agree to our privacy policy.';

RemoteConfig _gatingConfig() =>
    testRemoteConfig(consentRequired: true, consentText: _notice);

Widget _wrap(ChatWidgetCubit cubit) {
  return BlocProvider<ChatWidgetCubit>.value(
    value: cubit,
    child: const MaterialApp(home: Scaffold(body: ConversationScreen())),
  );
}

/// The composer's own text field, whatever else is on screen.
TextField _composerField(WidgetTester tester) => tester.widget<TextField>(
      find.descendant(
        of: find.byType(Composer),
        matching: find.byType(TextField),
      ),
    );

void main() {
  late FakeWidgetChatClient client;

  setUp(() => client = FakeWidgetChatClient());
  tearDown(() async => client.dispose());

  testWidgets('holds the composer shut until the visitor agrees',
      (tester) async {
    final ChatWidgetCubit cubit =
        ChatWidgetCubit(client: client, initialConfig: _gatingConfig());
    addTearDown(cubit.close);

    await tester.pumpWidget(_wrap(cubit));

    expect(find.text(_notice), findsOneWidget);
    expect(find.text('I agree'), findsOneWidget);
    expect(_composerField(tester).enabled, isFalse);

    await tester.tap(find.text('I agree'));
    await tester.pump();

    // The notice goes with the agreement — there is nothing left to agree to.
    expect(find.text(_notice), findsNothing);
    expect(_composerField(tester).enabled, isTrue);
  });

  testWidgets('leaves the composer alone when no consent is required',
      (tester) async {
    final ChatWidgetCubit cubit =
        ChatWidgetCubit(client: client, initialConfig: testRemoteConfig());
    addTearDown(cubit.close);

    await tester.pumpWidget(_wrap(cubit));

    expect(find.text('I agree'), findsNothing);
    expect(_composerField(tester).enabled, isTrue);
  });

  // A merchant who switched the toggle on and wrote nothing gates nobody:
  // the alternative is every visitor stranded behind a notice that renders
  // nothing, with no control to agree with and no explanation on screen.
  testWidgets('does not gate on an empty notice', (tester) async {
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(
        consentRequired: true,
        consentText: '  ',
      ),
    );
    addTearDown(cubit.close);

    await tester.pumpWidget(_wrap(cubit));

    expect(find.text('I agree'), findsNothing);
    expect(_composerField(tester).enabled, isTrue);
  });

  // A publish can turn the notice on mid-session.
  testWidgets('closes the gate when a publish turns consent on',
      (tester) async {
    final ChatWidgetCubit cubit = ChatWidgetCubit(client: client);
    addTearDown(cubit.close);

    await tester.pumpWidget(_wrap(cubit));
    expect(_composerField(tester).enabled, isTrue);

    cubit.applyRemoteConfig(_gatingConfig());
    await tester.pump();

    expect(find.text(_notice), findsOneWidget);
    expect(_composerField(tester).enabled, isFalse);
  });

  // ── The stored answer ───────────────────────────────────────────────────

  // The load-bearing half of "read once at construction": a real store reads
  // from disk, so there are frames between the widget going up and the answer
  // arriving. CLOSED is the safe direction across them — a visitor briefly
  // seeing a notice they already dismissed is a smaller failure than a
  // conversation stored before the answer was known.
  testWidgets('the gate stays closed until the stored read lands',
      (tester) async {
    final _DeferredChatStorage storage = _DeferredChatStorage();
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      initialConfig: _gatingConfig(),
      consent: ConsentGate(storage: storage, publishableKey: _tenant),
    );
    addTearDown(cubit.close);

    await tester.pumpWidget(_wrap(cubit));
    expect(find.text(_notice), findsOneWidget);
    expect(_composerField(tester).enabled, isFalse);

    // The stored "yes" finally lands.
    storage.pendingRead.complete(kConsentStoredValue);
    await tester.pump();

    expect(find.text(_notice), findsNothing);
    expect(_composerField(tester).enabled, isTrue);
  });

  // ...and a read that lands as "no" leaves the gate exactly where it was,
  // rather than briefly flickering it open.
  testWidgets('a stored answer of "not agreed" keeps the gate shut',
      (tester) async {
    final _DeferredChatStorage storage = _DeferredChatStorage();
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      initialConfig: _gatingConfig(),
      consent: ConsentGate(storage: storage, publishableKey: _tenant),
    );
    addTearDown(cubit.close);

    await tester.pumpWidget(_wrap(cubit));
    storage.pendingRead.complete(null);
    await tester.pump();

    expect(find.text(_notice), findsOneWidget);
    expect(_composerField(tester).enabled, isFalse);
  });

  // Consent fatigue is itself a reason people stop reading notices, so the
  // answer is remembered across mounts of the same tenant's widget.
  testWidgets('does not ask a second time in the same app', (tester) async {
    final ChatStorage storage = MemoryChatStorage();

    final ChatWidgetCubit first = ChatWidgetCubit(
      client: client,
      initialConfig: _gatingConfig(),
      consent: ConsentGate(storage: storage, publishableKey: _tenant),
    );
    addTearDown(first.close);
    await tester.pumpWidget(_wrap(first));
    await tester.tap(find.text('I agree'));
    // Let the write land before the remount reads it back.
    await tester.pump();

    final ChatWidgetCubit remounted = ChatWidgetCubit(
      client: client,
      initialConfig: _gatingConfig(),
      consent: ConsentGate(storage: storage, publishableKey: _tenant),
    );
    addTearDown(remounted.close);
    await tester.pumpWidget(_wrap(remounted));

    expect(find.text(_notice), findsNothing);
    expect(_composerField(tester).enabled, isTrue);
  });

  // The record is keyed per publishable key, so a second tenant's widget on
  // the same device asks for itself.
  testWidgets('does not let one tenant consent for another', (tester) async {
    final ChatStorage storage = MemoryChatStorage();

    final ChatWidgetCubit first = ChatWidgetCubit(
      client: client,
      initialConfig: _gatingConfig(),
      consent: ConsentGate(storage: storage, publishableKey: _tenant),
    );
    addTearDown(first.close);
    await tester.pumpWidget(_wrap(first));
    await tester.tap(find.text('I agree'));
    await tester.pump();

    final ChatWidgetCubit other = ChatWidgetCubit(
      client: client,
      initialConfig: _gatingConfig(),
      consent: ConsentGate(
        storage: storage,
        publishableKey: PublishableKey.parse('dhp_test_def456'),
      ),
    );
    addTearDown(other.close);
    await tester.pumpWidget(_wrap(other));

    expect(find.text(_notice), findsOneWidget);
    expect(_composerField(tester).enabled, isFalse);
  });

  // The click is honoured whether or not the write lands: refusing to let
  // somebody chat because their device blocks app data would punish them for
  // a setting they are entitled to.
  testWidgets('a failed write does not revoke the click', (tester) async {
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      initialConfig: _gatingConfig(),
      consent: ConsentGate(
        storage: _BrokenChatStorage(),
        publishableKey: _tenant,
      ),
    );
    addTearDown(cubit.close);

    await tester.pumpWidget(_wrap(cubit));
    await tester.pump();
    await tester.tap(find.text('I agree'));
    await tester.pump();

    expect(find.text(_notice), findsNothing);
    expect(_composerField(tester).enabled, isTrue);
  });

  // A visitor who has not agreed may still read everything above the
  // composer. The gate is not a curtain over the widget.
  testWidgets('leaves the transcript readable while the gate is shut',
      (tester) async {
    final ChatWidgetCubit cubit =
        ChatWidgetCubit(client: client, initialConfig: _gatingConfig());
    addTearDown(cubit.close);

    await tester.pumpWidget(_wrap(cubit));

    expect(find.byType(MessageListView), findsOneWidget);
    expect(find.byType(Composer), findsOneWidget);
  });
}

/// A store whose every operation fails.
class _BrokenChatStorage implements ChatStorage {
  @override
  Future<String?> read(String key) async => throw StateError('no store');

  @override
  Future<void> write(String key, String value) async =>
      throw StateError('no store');
}

/// A store whose read does not land until the test says so — a stand-in for
/// the real disk I/O `SharedPreferencesChatStorage` does, which a
/// microtask-fast in-memory map cannot reproduce.
class _DeferredChatStorage implements ChatStorage {
  final Completer<String?> pendingRead = Completer<String?>();

  @override
  Future<String?> read(String key) => pendingRead.future;

  @override
  Future<void> write(String key, String value) async {}
}
