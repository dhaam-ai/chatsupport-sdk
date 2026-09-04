// That the out-of-hours form is actually REACHABLE.
//
// `resolveProductSurface` has read `SurfaceSyncInputs.shouldCollectOffline`
// since the slot landed and nothing supplied it, so until this wave the
// highest-precedence branch in the whole ladder could not fire: a merchant on
// COLLECT_MESSAGE got the ordinary composer outside business hours and their
// customers' messages went into a conversation nobody was reading.
//
// The failure is silent from both ends — the slot's own tests pass with the
// input set by hand, and the form's own tests pass with the widget pumped
// directly — which is exactly why the seam between them needs its own file.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../state/fake_widget_chat_client.dart';
import '../../support/remote_config_fixtures.dart';

const PreChatField _consoleName = PreChatField(
  id: 'p1',
  label: 'Your name',
  type: PreChatFieldType.text,
  required: true,
);
const PreChatField _consoleOrder = PreChatField(
  id: 'p3',
  label: 'Order number',
  type: PreChatFieldType.text,
  required: false,
);

RemoteConfig _outOfHours({
  bool preChatEnabled = false,
  List<PreChatField> preChatFields = const <PreChatField>[],
}) =>
    testRemoteConfig(
      isOpenNow: false,
      offlineMode: OfflineMode.collectMessage,
      preChatEnabled: preChatEnabled,
      preChatFields: preChatFields,
    );

Widget _wrap(ChatWidgetCubit cubit) => BlocProvider<ChatWidgetCubit>.value(
      value: cubit,
      child: const MaterialApp(home: Scaffold(body: ConversationScreen())),
    );

/// Two frames, not one.
///
/// `applyRemoteConfig` emits TWICE — once for the config and once for the
/// slot it re-resolves — and a Cubit's state stream delivers on a microtask
/// rather than synchronously, so the second emit lands after the frame the
/// first `pump()` builds. The same lag `conversation_screen_test.dart`'s own
/// `flush()` helper exists for, in its stream-event form.
Future<void> _publishAndSettle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump();
}

List<String> _labels(WidgetTester tester) => tester
    .widgetList<TextField>(find.byType(TextField))
    .map((TextField field) => field.decoration?.labelText ?? '')
    .toList();

void main() {
  late FakeWidgetChatClient client;

  setUp(() => client = FakeWidgetChatClient());
  tearDown(() async => client.dispose());

  ChatWidgetCubit build({ChatIdentity identity = ChatIdentity.guest}) {
    final ChatWidgetCubit cubit =
        ChatWidgetCubit(client: client, identity: identity);
    addTearDown(cubit.close);
    return cubit;
  }

  /// Mounts the screen and then PUBLISHES [config], which is how a config
  /// reaches this Cubit in life.
  ///
  /// Not `initialConfig`: the slot is re-resolved on ticks, never at
  /// construction, so a config handed to the constructor raises no surface
  /// until something syncs. That is the reference's own shape —
  /// `syncProductSurfaces` runs off the store subscription and off the
  /// config-applied path, not at init — and `initialConfig` is the host's
  /// pre-fetch placeholder, which is `defaultRemoteConfig` and never
  /// out of hours. Asserting through `applyRemoteConfig` is therefore
  /// asserting the path that actually runs.
  Future<ChatWidgetCubit> pumpWith(
    WidgetTester tester,
    RemoteConfig config, {
    ChatIdentity identity = ChatIdentity.guest,
  }) async {
    final ChatWidgetCubit cubit = build(identity: identity);
    await tester.pumpWidget(_wrap(cubit));
    cubit.applyRemoteConfig(config);
    await _publishAndSettle(tester);
    return cubit;
  }

  testWidgets('raises the offline form when the server says the team is closed',
      (tester) async {
    await pumpWith(tester, _outOfHours());

    expect(find.byType(OfflineFormView), findsOneWidget);
    // IN PLACE OF the transcript and composer, never alongside: a form asking
    // the customer for something and the conversation it replaces are
    // alternatives, not a pile.
    expect(find.byType(Composer), findsNothing);
    expect(find.text("We're currently offline."), findsOneWidget);
  });

  // SHOW_MESSAGE says the team is closed and leaves the composer alone; only
  // COLLECT_MESSAGE replaces it.
  testWidgets('leaves the composer alone on SHOW_MESSAGE', (tester) async {
    await pumpWith(
      tester,
      testRemoteConfig(
        isOpenNow: false,
        offlineMode: OfflineMode.showMessage,
      ),
    );

    expect(find.byType(OfflineFormView), findsNothing);
    expect(find.byType(Composer), findsOneWidget);
  });

  // `isOpenNow == null` means the tenant does not follow business hours, so
  // there is no "outside" to be outside of.
  testWidgets('does not raise the form when the tenant keeps no hours',
      (tester) async {
    await pumpWith(
      tester,
      testRemoteConfig(offlineMode: OfflineMode.collectMessage),
    );

    expect(find.byType(OfflineFormView), findsNothing);
    expect(find.byType(Composer), findsOneWidget);
  });

  testWidgets('raises the form when a publish closes the team mid-session',
      (tester) async {
    final ChatWidgetCubit cubit = await pumpWith(tester, testRemoteConfig());
    expect(find.byType(OfflineFormView), findsNothing);

    cubit.applyRemoteConfig(_outOfHours());
    await _publishAndSettle(tester);

    expect(find.byType(OfflineFormView), findsOneWidget);
  });

  // ── The pre-chat gate reaches this surface too ─────────────────────────

  testWidgets('folds the merchant\'s pre-chat questions in for a guest',
      (tester) async {
    await pumpWith(
      tester,
      _outOfHours(
        preChatEnabled: true,
        preChatFields: const <PreChatField>[_consoleName, _consoleOrder],
      ),
    );

    // "Your name" is dropped as a duplicate of the built-in; "Order number"
    // survives.
    expect(
      _labels(tester),
      <String>[
        'Name',
        'Email or phone',
        'Order number (optional)',
        'How can we help?',
      ],
    );
  });

  // The gate's own rule, on the one path where the reference had originally
  // forgotten it: a signed-in customer is not asked to type their own details
  // back just because the team happens to be closed.
  testWidgets('does not ask a signed-in visitor the merchant\'s questions',
      (tester) async {
    await pumpWith(
      tester,
      _outOfHours(
        preChatEnabled: true,
        preChatFields: const <PreChatField>[_consoleOrder],
      ),
      identity: const ChatIdentity(
        profile: ChatParticipantProfile(name: 'Ada'),
      ),
    );

    // The two built-ins stay: they are the reply channel for an answer that
    // arrives out of band, not a question about who the visitor is.
    expect(
      _labels(tester),
      <String>['Name', 'Email or phone', 'How can we help?'],
    );
  });

  // ── What reaches the wire ──────────────────────────────────────────────

  testWidgets('sends the message as prose AND as a structured copy',
      (tester) async {
    await pumpWith(tester, _outOfHours());

    for (final MapEntry<String, String> entry in <String, String>{
      'Name': 'Ada',
      'Email or phone': 'ada@example.com',
      'How can we help?': 'My parcel never arrived',
    }.entries) {
      await tester.enterText(
        find.ancestor(
          of: find.text(entry.key),
          matching: find.byType(TextField),
        ),
        entry.value,
      );
    }
    await tester.tap(find.text('Send message'));
    await tester.pump();

    expect(client.sentContent, hasLength(1));
    expect(
      client.sentContent.single,
      'Offline message from Ada (ada@example.com):'
      '\n\nMy parcel never arrived',
    );
    // The structured half rides the SAME frame, so the two can never describe
    // different people.
    expect(client.sentMetadata.single, <String, Object?>{
      'kind': 'offline_message',
      'name': 'Ada',
      'contact': 'ada@example.com',
    });
  });
}
