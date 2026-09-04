/// Reproduces `packages/widget/test/remote-config-gating.test.ts`'s
/// "report an issue" block (:943-1061) end to end — the ⋯ menu row, the
/// surface it opens, both cancel routes, and the confirmation's own way out.
///
/// ── Why this file exists beside `ui/header/report_issue_form_test.dart` ──
///
/// That file unit-tests the WIDGET and passes with the form reachable by
/// nobody, which is exactly what it was: built, tested, and referenced from
/// zero library files. Everything here is about the MOUNTING — the row being
/// offered, the slot being taken, and the slot being handed back — and none
/// of it can be asserted from a form pumped on its own in a `Scaffold`.
///
/// ── Two of the reference's cases are NOT reproduced here ────────────────
///
///  * "refuses to submit without the two required fields, and says which" is
///    the form's own decision and is already pinned, twice, in
///    `report_issue_form_test.dart`. Asserting it a second time through a
///    menu and an app bar would test the same branch through more machinery.
///  * The reference drives its first three cases from an INLINE
///    `.dh-report-open` button beside the composer (widget.ts:1399). There is
///    no Flutter counterpart — adding one means editing `composer.dart` — so
///    the ⋯ menu, which the reference's own "opened from Home" case uses, is
///    the single entry point here. Recorded rather than silently dropped.
library;

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'state/fake_widget_chat_client.dart';
import 'support/remote_config_fixtures.dart';

/// The merchant's pre-chat questions, used ONLY by the non-preemption group.
///
/// They are what makes an ordinary session tick a surface-RAISING tick, so
/// "the report form survived it" says something. See that group's own note.
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
  late List<RestIssueReport> filed;

  setUp(() {
    client = FakeWidgetChatClient();
    filed = <RestIssueReport>[];
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  /// A cubit whose report route records instead of reaching the network.
  ///
  /// [reporter] is null for the "host wired nothing up" case, which is the
  /// half of the gate the reference has no counterpart for — a DOM widget
  /// always has its own `fetch`.
  void build({
    bool reportIssue = true,
    bool wireReporter = true,
    bool preChatEnabled = false,
  }) {
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(
        reportIssue: reportIssue,
        preChatEnabled: preChatEnabled,
        preChatFields: preChatEnabled ? _fields : const <PreChatField>[],
      ),
      issueReporter: wireReporter
          ? (RestIssueReport report) async => filed.add(report)
          : null,
    );
  }

  Future<void> pump(WidgetTester tester) =>
      tester.pumpWidget(MaterialApp(home: ChatWidget(cubit: cubit)));

  /// Lets a queued stream event reach the Cubit before the next frame — the
  /// same helper, and the same reasoning, as `identity_header_mount_test.dart`
  /// and `chat_widget_test.dart` both use.
  Future<void> flush(WidgetTester tester) async {
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();
  }

  /// The ⋯ menu lives in the app bar, which only exists on a DRILL-DOWN —
  /// `canGoBack`. So every case here arrives on the conversation the way a
  /// customer does, through one of its two writers.
  Future<void> openMenu(WidgetTester tester) async {
    await tester.tap(find.byTooltip('Conversation options'));
    await tester.pumpAndSettle();
  }

  Future<void> chooseReport(WidgetTester tester) async {
    await openMenu(tester);
    await tester.tap(find.text('Report an issue'));
    await tester.pumpAndSettle();
  }

  Finder fieldByLabel(String label) =>
      find.ancestor(of: find.text(label), matching: find.byType(TextField));

  group('the ⋯ menu offers the row only when it is backed', () {
    testWidgets('offers nothing until the merchant turns it on',
        (WidgetTester tester) async {
      build(reportIssue: false);
      await pump(tester);
      cubit.openConversation('sess_1');
      await tester.pumpAndSettle();

      await openMenu(tester);
      expect(find.text('Report an issue'), findsNothing);
    });

    testWidgets('offers the form when the merchant turned it on',
        (WidgetTester tester) async {
      build();
      await pump(tester);
      cubit.openConversation('sess_1');
      await tester.pumpAndSettle();

      await openMenu(tester);
      expect(find.text('Report an issue'), findsOneWidget);
    });

    // The half the reference has no case for. `IssueReporter` is a seam the
    // HOST wires, exactly as `ChatSessionActions` is, so a merchant flag with
    // nothing behind it must hide the row rather than offer a form whose Send
    // can only ever fail — `header_menu.dart`'s "hidden, never disabled".
    testWidgets('hides the row when the merchant turned it on but the host '
        'wired no reporter', (WidgetTester tester) async {
      build(wireReporter: false);
      await pump(tester);
      cubit.openConversation('sess_1');
      await tester.pumpAndSettle();

      expect(cubit.canReportIssue, isFalse);
      await openMenu(tester);
      expect(find.text('Report an issue'), findsNothing);
    });
  });

  group('the form stands IN PLACE OF the conversation', () {
    testWidgets('replaces the transcript and the composer rather than '
        'covering them', (WidgetTester tester) async {
      build();
      await pump(tester);
      cubit.openConversation('sess_1');
      await tester.pumpAndSettle();
      // The conversation is genuinely on screen first, so its disappearance
      // below means something.
      expect(find.byType(MessageListView), findsOneWidget);
      expect(find.byType(Composer), findsOneWidget);

      await chooseReport(tester);

      expect(find.byType(ReportIssueForm), findsOneWidget);
      expect(cubit.state.activeSurface, isA<ReportSurface>());
      expect(find.byType(MessageListView), findsNothing);
      expect(find.byType(Composer), findsNothing);
    });
  });

  group('cancel returns the customer to where they opened it from', () {
    testWidgets('opened mid-conversation: the conversation comes back',
        (WidgetTester tester) async {
      build();
      await pump(tester);
      cubit.openConversation('sess_1');
      await tester.pumpAndSettle();

      await chooseReport(tester);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(find.byType(ReportIssueForm), findsNothing);
      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.screen, ScreenName.conversation);
      expect(find.byType(Composer), findsOneWidget);
    });

    // The reference's "goes back to Home on cancel when it was opened from
    // Home". Its widget offers the ⋯ menu on every screen; here the app bar
    // exists only on a drill-down, so the customer reaches the menu from Home
    // the way they actually can — through the new-conversation form, whose
    // origin the report surface then INHERITS (`ProductSurfaceSlot.open`: a
    // second detour opened on top of the first is still a detour from where
    // the FIRST one started). Cancelling must not deposit them on a
    // conversation screen they never navigated to.
    testWidgets('opened from Home by way of the new-conversation form: '
        'Cancel lands back on Home', (WidgetTester tester) async {
      build();
      await pump(tester);
      expect(cubit.state.screen, ScreenName.home);

      cubit.startNewConversation();
      await tester.pumpAndSettle();
      expect(cubit.state.screen, ScreenName.conversation);

      await chooseReport(tester);
      expect(cubit.state.activeSurface, isA<ReportSurface>());

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.screen, ScreenName.home);
    });
  });

  // The defect D38 names. A submitted report replaces the form with a
  // confirmation IN THE SAME SLOT, and nothing sweeps a user-initiated
  // surface away on a state tick — so a confirmation with no control of its
  // own would hold the slot for good: transcript and composer hidden for the
  // rest of the visit, and on a panel opened straight onto a conversation
  // there is no Back either.
  group('the confirmation carries its own way out', () {
    testWidgets('files the report, then hands the conversation back on Done',
        (WidgetTester tester) async {
      build();
      await pump(tester);
      cubit.openConversation('sess_1');
      await tester.pumpAndSettle();

      await chooseReport(tester);
      await tester.enterText(
          fieldByLabel('What went wrong?'), 'Checkout is broken');
      await tester.enterText(
          fieldByLabel('Details'), 'The pay button does nothing.');
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      // Filed, through the mounted Cubit and its seam.
      expect(filed, hasLength(1));
      expect(filed.single.subject, 'Checkout is broken');
      expect(filed.single.details, 'The pay button does nothing.');
      // Omitted rather than sent empty — the route's own `.email()` check
      // rejects `''` for a customer who simply left it blank.
      expect(filed.single.contactEmail, isNull);

      // The confirmation replaced the form, and it carries a Done.
      expect(find.text('Report sent'), findsOneWidget);
      expect(find.text('Send report'), findsNothing);
      expect(find.text('Done'), findsOneWidget);
      // Still holding the slot at this point — which is precisely why the
      // Done below has to exist.
      expect(cubit.state.activeSurface, isA<ReportSurface>());

      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(cubit.state.activeSurface, isNull);
      expect(find.byType(ReportIssueForm), findsNothing);
      expect(find.byType(MessageListView), findsOneWidget);
      expect(find.byType(Composer), findsOneWidget);
    });
  });

  // The whole reason this is a `UserInitiatedSurface` rather than a seventh
  // automatic one. `resolveProductSurface` returns `current` unchanged for
  // any surface the customer opened, so a connection ack, a session landing
  // or a message arriving cannot swap a half-typed report out from under
  // their finger.
  group('no state tick preempts a report the customer opened', () {
    // The control. Without it, "the form survived the tick" is consistent
    // with the tick being inert — and this run has already been burned once
    // by a component test that stayed green beside a live bug.
    testWidgets('CONTROL: the same tick raises the pre-chat gate when no '
        'report is open', (WidgetTester tester) async {
      build(preChatEnabled: true);
      await pump(tester);
      cubit.openConversation('sess_1');
      await tester.pumpAndSettle();

      client.emitSession(testSession(id: 'sess_1'));
      await flush(tester);

      expect(cubit.state.activeSurface, isA<PreChatSurface>());
    });

    testWidgets('the report form survives a session tick that would '
        'otherwise raise the pre-chat gate', (WidgetTester tester) async {
      build(preChatEnabled: true);
      await pump(tester);
      cubit.openConversation('sess_1');
      await tester.pumpAndSettle();

      await chooseReport(tester);
      expect(cubit.state.activeSurface, isA<ReportSurface>());

      client.emitSession(testSession(id: 'sess_1'));
      await flush(tester);

      expect(cubit.state.activeSurface, isA<ReportSurface>());
      expect(find.byType(ReportIssueForm), findsOneWidget);
    });

    // The same rule, against the tick that actually reported the bug this
    // non-preemption exists for: a message landing mid-form.
    testWidgets('and survives a message arriving', (WidgetTester tester) async {
      build(preChatEnabled: true);
      await pump(tester);
      cubit.openConversation('sess_1');
      await tester.pumpAndSettle();

      await chooseReport(tester);
      await tester.enterText(
          fieldByLabel('What went wrong?'), 'Half-typed subject');

      client.emitSession(testSession(id: 'sess_1'));
      await flush(tester);
      client.emitMessage(testMessage(id: 'm1', content: 'Hi, how can I help?'));
      await flush(tester);

      expect(cubit.state.activeSurface, isA<ReportSurface>());
      // And what they had typed is still there — the point of not being
      // preempted is not the surface, it is the words in it.
      expect(find.text('Half-typed subject'), findsOneWidget);
    });
  });
}
