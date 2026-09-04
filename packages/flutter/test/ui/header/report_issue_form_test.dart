import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reproduces the `report an issue` block of
/// `packages/widget/test/remote-config-gating.test.ts:943-1061`, and the
/// shared-substrate assertions `product-surfaces.test.ts` makes of this form.
///
/// Two of that block's cases belong to the caller, not to this widget: whether
/// the ⋯ menu offers the row at all (asserted in `header_menu_test.dart`) and
/// which screen Cancel returns to (the surface slot's, and its own tests').
/// What is here is everything the form itself decides.
void main() {
  Future<void> mount(
    WidgetTester tester, {
    required IssueReporter onSubmit,
    VoidCallback? onCancel,
    FormErrorReporter? onError,
  }) =>
      tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReportIssueForm(
              onSubmit: onSubmit,
              onCancel: onCancel ?? () {},
              onError: onError ?? (Object _, StackTrace __) {},
            ),
          ),
        ),
      );

  Finder fieldByLabel(String label) =>
      find.ancestor(of: find.text(label), matching: find.byType(TextField));

  Future<void> fillValidReport(WidgetTester tester) async {
    await tester.enterText(fieldByLabel('What went wrong?'), 'Checkout broken');
    await tester.enterText(
        fieldByLabel('Details'), 'The pay button does nothing.');
  }

  group('the form the customer sees', () {
    testWidgets('asks two questions and explains what happens next',
        (WidgetTester tester) async {
      await mount(tester, onSubmit: (_) async {});
      expect(find.text('Report an issue'), findsOneWidget);
      expect(
        find.text('Tell us what happened and we will open a ticket.'),
        findsOneWidget,
      );
      expect(find.text('What went wrong?'), findsOneWidget);
      expect(find.text('Details'), findsOneWidget);
      expect(find.text('Send report'), findsOneWidget);
      expect(find.text('Cancel'), findsOneWidget);
    });

    testWidgets(
        'marks the OPTIONAL field, and marks nothing else — the '
        'substrate appends it, so it is never doubled',
        (WidgetTester tester) async {
      await mount(tester, onSubmit: (_) async {});
      expect(
          find.text('Reply to a different email (optional)'), findsOneWidget);
      expect(find.text('Reply to a different email (optional) (optional)'),
          findsNothing);
      // Required fields carry no marker at all — the inverse of the usual
      // asterisk convention, matching the console's own preview.
      expect(find.text('What went wrong?'), findsOneWidget);
    });
  });

  group('refuses to file an incomplete report, and says which field', () {
    testWidgets('names the missing subject and files nothing',
        (WidgetTester tester) async {
      final List<RestIssueReport> filed = <RestIssueReport>[];
      await mount(tester, onSubmit: (RestIssueReport r) async => filed.add(r));

      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      expect(find.text('What went wrong? is required.'), findsOneWidget);
      expect(filed, isEmpty);
      // Still on the form.
      expect(find.text('Send report'), findsOneWidget);
    });

    testWidgets(
        'names missing details separately — they are a box, not a '
        'field, so the substrate does not cover them',
        (WidgetTester tester) async {
      final List<RestIssueReport> filed = <RestIssueReport>[];
      await mount(tester, onSubmit: (RestIssueReport r) async => filed.add(r));

      await tester.enterText(
        fieldByLabel('What went wrong?'),
        'Checkout broken',
      );
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      expect(find.text(kReportDetailsRequiredMessage), findsOneWidget);
      expect(filed, isEmpty);
    });

    testWidgets('treats whitespace-only details as empty',
        (WidgetTester tester) async {
      final List<RestIssueReport> filed = <RestIssueReport>[];
      await mount(tester, onSubmit: (RestIssueReport r) async => filed.add(r));

      await tester.enterText(
        fieldByLabel('What went wrong?'),
        'Checkout broken',
      );
      await tester.enterText(fieldByLabel('Details'), '    ');
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      expect(find.text(kReportDetailsRequiredMessage), findsOneWidget);
      expect(filed, isEmpty);
    });
  });

  group('what reaches the route', () {
    testWidgets('sends the subject and the trimmed details',
        (WidgetTester tester) async {
      final List<RestIssueReport> filed = <RestIssueReport>[];
      await mount(tester, onSubmit: (RestIssueReport r) async => filed.add(r));

      await tester.enterText(
        fieldByLabel('What went wrong?'),
        '  Checkout broken  ',
      );
      await tester.enterText(
        fieldByLabel('Details'),
        '  The pay button does nothing.  ',
      );
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      expect(filed.single.toJson(), <String, Object?>{
        'subject': 'Checkout broken',
        'details': 'The pay button does nothing.',
      });
    });

    testWidgets('omits contactEmail entirely when the box is left blank',
        (WidgetTester tester) async {
      // Load-bearing rather than tidy: the route runs its own `.email()`
      // check on the field, and `''` fails it for no reason — a customer who
      // chose not to leave an address would have their report rejected.
      final List<RestIssueReport> filed = <RestIssueReport>[];
      await mount(tester, onSubmit: (RestIssueReport r) async => filed.add(r));

      await fillValidReport(tester);
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      expect(filed.single.contactEmail, isNull);
      expect(filed.single.toJson().containsKey('contactEmail'), isFalse);
    });

    testWidgets('omits contactEmail for a whitespace-only entry too',
        (WidgetTester tester) async {
      final List<RestIssueReport> filed = <RestIssueReport>[];
      await mount(tester, onSubmit: (RestIssueReport r) async => filed.add(r));

      await fillValidReport(tester);
      await tester.enterText(
        fieldByLabel('Reply to a different email (optional)'),
        '   ',
      );
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      expect(filed.single.toJson().containsKey('contactEmail'), isFalse);
    });

    testWidgets(
        'sends contactEmail when the customer wants the reply '
        'elsewhere', (WidgetTester tester) async {
      final List<RestIssueReport> filed = <RestIssueReport>[];
      await mount(tester, onSubmit: (RestIssueReport r) async => filed.add(r));

      await fillValidReport(tester);
      await tester.enterText(
        fieldByLabel('Reply to a different email (optional)'),
        'jordan@example.com',
      );
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      expect(filed.single.contactEmail, 'jordan@example.com');
    });
  });

  group('the confirmation replaces the form and carries its own way out', () {
    testWidgets('swaps the form for a confirmation once the report is filed',
        (WidgetTester tester) async {
      await mount(tester, onSubmit: (_) async {});
      await fillValidReport(tester);
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      // Replaced, not covered — so pressing the button again cannot file the
      // same report twice.
      expect(find.text('Send report'), findsNothing);
      expect(find.text('Report sent'), findsOneWidget);
      expect(
        find.text('Our team has it and will follow up by email.'),
        findsOneWidget,
      );
    });

    testWidgets('quotes no ticket reference, because the route returns none',
        (WidgetTester tester) async {
      await mount(tester, onSubmit: (_) async {});
      await fillValidReport(tester);
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();
      expect(find.textContaining('shortly'), findsNothing);
      expect(find.textContaining('#'), findsNothing);
    });

    testWidgets('carries a Done button, so the surface slot is handed back',
        (WidgetTester tester) async {
      // This surface is never preempted by a state tick, so a confirmation
      // with no control of its own would hold the slot for good: transcript
      // and composer hidden for the rest of the visit.
      int cancels = 0;
      await mount(
        tester,
        onSubmit: (_) async {},
        onCancel: () => cancels += 1,
      );
      await fillValidReport(tester);
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      expect(find.text('Done'), findsOneWidget);
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(cancels, 1);
    });

    testWidgets(
        'moves focus onto Done — the button just pressed is gone from '
        'the tree', (WidgetTester tester) async {
      await mount(tester, onSubmit: (_) async {});
      await fillValidReport(tester);
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      final FocusNode done =
          tester.widget<TextButton>(find.byType(TextButton)).focusNode!;
      expect(done.hasFocus, isTrue);
    });
  });

  group('a failed submit keeps the form alive and what was typed with it', () {
    testWidgets(
        'shows a plain sentence and never advances to the '
        'confirmation', (WidgetTester tester) async {
      await mount(
        tester,
        onSubmit: (_) async => throw StateError('the network is down'),
      );
      await fillValidReport(tester);
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      expect(find.text(kReportFailureMessage), findsOneWidget);
      expect(find.text('Report sent'), findsNothing);
      // Re-enabled, and the customer's words are still there.
      expect(find.text('Send report'), findsOneWidget);
      expect(
        tester.widget<TextField>(fieldByLabel('Details')).controller!.text,
        'The pay button does nothing.',
      );
    });

    testWidgets('routes the raw error to onError, never onto the screen',
        (WidgetTester tester) async {
      // It carries a stack and possibly a URL, and neither belongs in front
      // of a customer.
      final List<Object> reported = <Object>[];
      await mount(
        tester,
        onSubmit: (_) async => throw StateError('https://internal.host/trace'),
        onError: (Object error, StackTrace _) => reported.add(error),
      );
      await fillValidReport(tester);
      await tester.tap(find.text('Send report'));
      await tester.pumpAndSettle();

      expect(reported, hasLength(1));
      expect(find.textContaining('internal.host'), findsNothing);
    });

    testWidgets(
        'a second press files a second report only after the first '
        'settled', (WidgetTester tester) async {
      // The re-entrancy guard: `closeSession` is not idempotent and neither
      // is a ticket, so an in-flight submit refuses a second one outright.
      final List<RestIssueReport> filed = <RestIssueReport>[];
      await mount(
        tester,
        onSubmit: (RestIssueReport r) async {
          filed.add(r);
          await Future<void>.delayed(const Duration(milliseconds: 50));
        },
      );
      await fillValidReport(tester);

      await tester.tap(find.text('Send report'));
      await tester.pump();
      // Busy: the label swapped and the control reports itself disabled.
      expect(find.text('Sending…'), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );

      await tester.pumpAndSettle();
      expect(filed, hasLength(1));
    });
  });

  group('Cancel', () {
    testWidgets('hands the slot back without filing anything',
        (WidgetTester tester) async {
      int cancels = 0;
      final List<RestIssueReport> filed = <RestIssueReport>[];
      await mount(
        tester,
        onSubmit: (RestIssueReport r) async => filed.add(r),
        onCancel: () => cancels += 1,
      );

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(cancels, 1);
      expect(filed, isEmpty);
    });

    testWidgets('is unusable while a submit is in flight',
        (WidgetTester tester) async {
      // A cancel landing mid-request would tear the surface down under an
      // outcome that still has to land somewhere.
      int cancels = 0;
      await mount(
        tester,
        onSubmit: (_) async =>
            Future<void>.delayed(const Duration(milliseconds: 50)),
        onCancel: () => cancels += 1,
      );
      await fillValidReport(tester);
      await tester.tap(find.text('Send report'));
      await tester.pump();

      expect(
        tester
            .widget<TextButton>(
              find.widgetWithText(TextButton, 'Cancel'),
            )
            .onPressed,
        isNull,
      );
      await tester.pumpAndSettle();
      expect(cancels, 0);
    });
  });
}
