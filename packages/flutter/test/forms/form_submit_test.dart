// The submit half of the shared form substrate.
//
// These reproduce the three assertions `packages/widget/test/
// product-surfaces.test.ts` makes about the substrate itself rather than
// about any one surface — the busy label, the re-enable on rejection, and the
// named-and-focused missing field. The web test reaches those facts through
// `.dh-form-submit`, `.disabled` and `document.activeElement`; the equivalent
// facts live on FormSubmitController and FocusNode here.
//
// The rejection case is the one that matters most: it is the bug this whole
// module exists to make unrepeatable.

import 'dart:async';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const FieldSpec kName = FieldSpec(
    id: 'p1', label: 'Your name', type: FieldKind.text, isRequired: true);
const FieldSpec kEmail = FieldSpec(
    id: 'p2', label: 'Email address', type: FieldKind.email, isRequired: true);

void _ignore(Object error, StackTrace stackTrace) {}

void main() {
  late FormSubmitController controller;

  setUp(() {
    controller =
        FormSubmitController(label: 'Start chat', busyLabel: 'Starting…');
  });

  tearDown(() => controller.dispose());

  group('buttonLabel', () {
    test('reads the resting label until a submit is in flight', () {
      expect(controller.buttonLabel, 'Start chat');
      expect(controller.isBusy, isFalse);
    });

    test('swaps to the busy label DURING the submit, and back after', () async {
      final List<String> seen = <String>[];
      await controller.submitOnce(
        run: () async => seen.add(controller.buttonLabel),
        failureMessage: 'unused',
        onError: _ignore,
      );

      expect(seen, <String>['Starting…'], reason: 'busy while in flight');
      expect(controller.buttonLabel, 'Start chat', reason: 'resting after');
    });
  });

  group('submitOnce — the finally that is the whole point', () {
    test('returns true and says nothing when the submit lands', () async {
      final bool ok = await controller.submitOnce(
        run: () async {},
        failureMessage: 'could not start the chat',
        onError: _ignore,
      );

      expect(ok, isTrue);
      expect(controller.isBusy, isFalse);
      expect(controller.statusMessage, isNull);
    });

    // The React originals leave the button stuck on "Sending…" forever when
    // the submit rejects. This is the one place that is fixed.
    test('comes back to life when the submit rejects', () async {
      final bool ok = await controller.submitOnce(
        run: () async => throw Exception('network down'),
        failureMessage: 'Sorry, we could not start the chat. Please try again.',
        onError: _ignore,
      );

      expect(ok, isFalse, reason: 'nothing to confirm');
      expect(controller.isBusy, isFalse, reason: 're-enabled in finally');
      expect(controller.buttonLabel, 'Start chat', reason: 'label restored');
      expect(controller.statusMessage,
          'Sorry, we could not start the chat. Please try again.');
    });

    // The exception carries a stack and possibly a URL. Neither belongs in
    // front of a customer.
    test('sends the error object to onError and never to the screen', () async {
      final Exception thrown = Exception('https://internal.example/bucket-42');
      Object? reported;
      StackTrace? reportedStack;

      await controller.submitOnce(
        run: () async => throw thrown,
        failureMessage: 'Sorry, we could not send that.',
        onError: (Object error, StackTrace stackTrace) {
          reported = error;
          reportedStack = stackTrace;
        },
      );

      expect(reported, same(thrown), reason: 'the object itself, not a string');
      expect(reportedStack, isNotNull, reason: 'a tracker needs the trace');
      expect(controller.statusMessage, 'Sorry, we could not send that.');
      expect(controller.statusMessage, isNot(contains('internal.example')));
    });

    test('re-enables even when the failure is an Error, not an Exception',
        () async {
      await controller.submitOnce(
        run: () async => throw StateError('bad state'),
        failureMessage: 'Sorry, that did not work.',
        onError: _ignore,
      );

      expect(controller.isBusy, isFalse);
    });

    test('clears a previous failure when a new submit starts', () async {
      await controller.submitOnce(
        run: () async => throw Exception('first'),
        failureMessage: 'Sorry, that did not work.',
        onError: _ignore,
      );
      expect(controller.statusMessage, isNotNull);

      final List<String?> duringSecond = <String?>[];
      await controller.submitOnce(
        run: () async => duringSecond.add(controller.statusMessage),
        failureMessage: 'unused',
        onError: _ignore,
      );

      expect(duringSecond, <String?>[null], reason: 'stale failure cleared');
      expect(controller.statusMessage, isNull);
    });

    // closeSession is not idempotent: a second POST re-emits a "chat closed"
    // system message and a second event.
    test('refuses a re-entrant submit rather than running it twice', () async {
      int runs = 0;
      bool? reentrantResult;

      await controller.submitOnce(
        run: () async {
          runs += 1;
          reentrantResult = await controller.submitOnce(
            run: () async => runs += 1,
            failureMessage: 'unused',
            onError: _ignore,
          );
        },
        failureMessage: 'unused',
        onError: _ignore,
      );

      expect(runs, 1, reason: 'the second call never ran');
      expect(reentrantResult, isFalse,
          reason: 'nothing completed on that call');
      expect(controller.statusMessage, isNull,
          reason: 'nothing FAILED either — the first submit was still running');
    });

    // A surface can be torn down while its request is still in flight. The
    // finally still runs, and must not throw on a disposed notifier.
    test('survives the surface being disposed mid-flight', () async {
      final FormSubmitController short =
          FormSubmitController(label: 'End', busyLabel: 'Ending…');

      await expectLater(
        short.submitOnce(
          run: () async => short.dispose(),
          failureMessage: 'unused',
          onError: _ignore,
        ),
        completion(isTrue),
      );
    });
  });

  group('requireAll — named AND focused', () {
    testWidgets('names the missing field and moves focus to it',
        (WidgetTester tester) async {
      final List<FieldView> views =
          <FieldSpec>[kName, kEmail].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Column(
            children: <Widget>[
              for (final FieldView f in views) FormFieldInput(field: f),
              FormStatusLine(controller: controller),
            ],
          ),
        ),
      ));

      views[0].controller.text = 'Ada';
      final bool ok = controller.requireAll(views);
      await tester.pump();

      expect(ok, isFalse);
      // Named — the same sentence the web original shows, not "fill in the
      // fields above".
      expect(controller.statusMessage, 'Email address is required.');
      expect(find.text('Email address is required.'), findsOneWidget);
      // ...and focused.
      expect(views[1].focusNode.hasFocus, isTrue);
    });

    test('passes when every required field is answered', () {
      final List<FieldView> views =
          <FieldSpec>[kName, kEmail].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      views[0].controller.text = 'Ada';
      views[1].controller.text = 'ada@example.com';

      expect(controller.requireAll(views), isTrue);
      expect(controller.statusMessage, isNull);
    });
  });

  group('FormStatusLine', () {
    Widget wrap(FormSubmitController c) => MaterialApp(
          home: Scaffold(body: FormStatusLine(controller: c)),
        );

    testWidgets('renders nothing at all while there is nothing to say',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(controller));
      // Scoped to this widget's own subtree: MaterialApp and Scaffold bring
      // their own Semantics nodes, so a bare byType finder would be asserting
      // something about the framework rather than about this line.
      expect(
        find.descendant(
            of: find.byType(FormStatusLine), matching: find.byType(Text)),
        findsNothing,
      );
      // No live region node either, so nothing can be announced on an
      // unrelated rebuild.
      expect(
        find.descendant(
            of: find.byType(FormStatusLine), matching: find.byType(Padding)),
        findsNothing,
      );
    });

    testWidgets('announces the message as a live region',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.pumpWidget(wrap(controller));

      controller.showStatus('Email address is required.');
      await tester.pump();

      expect(find.text('Email address is required.'), findsOneWidget);
      expect(
        tester.getSemantics(find.text('Email address is required.')),
        matchesSemantics(
            label: 'Email address is required.', isLiveRegion: true),
      );

      handle.dispose();
    });

    testWidgets('disappears again when cleared', (WidgetTester tester) async {
      await tester.pumpWidget(wrap(controller));
      controller.showStatus('Something went wrong.');
      await tester.pump();
      expect(find.text('Something went wrong.'), findsOneWidget);

      controller.clearStatus();
      await tester.pump();
      expect(find.byType(Text), findsNothing);
    });
  });

  group('FormSubmitButton', () {
    Widget wrap(FormSubmitController c, VoidCallback? onPressed) => MaterialApp(
          home: Scaffold(
            body: FormSubmitButton(controller: c, onPressed: onPressed),
          ),
        );

    FilledButton button(WidgetTester tester) =>
        tester.widget<FilledButton>(find.byType(FilledButton));

    testWidgets('shows the resting label and is pressable',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(controller, () {}));
      expect(find.text('Start chat'), findsOneWidget);
      expect(button(tester).onPressed, isNotNull);
    });

    testWidgets('shows the busy label and disables itself during the flight',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(controller, () {}));

      final Completer<void> gate = Completer<void>();
      final Future<bool> pending = controller.submitOnce(
        run: () => gate.future,
        failureMessage: 'unused',
        onError: _ignore,
      );
      await tester.pump();

      expect(find.text('Starting…'), findsOneWidget);
      expect(find.text('Start chat'), findsNothing);
      expect(button(tester).onPressed, isNull,
          reason: 'un-pressable in flight');

      gate.complete();
      await pending;
      await tester.pump();

      // And back to life — the assertion this module exists for.
      expect(find.text('Start chat'), findsOneWidget);
      expect(button(tester).onPressed, isNotNull);
    });

    testWidgets('stays disabled when the caller has its own reason',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(controller, null));
      expect(button(tester).onPressed, isNull);
    });

    testWidgets('re-enables after a REJECTED submit',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(controller, () {}));

      await controller.submitOnce(
        run: () async => throw Exception('network down'),
        failureMessage: 'Sorry, we could not start the chat.',
        onError: _ignore,
      );
      await tester.pump();

      expect(button(tester).onPressed, isNotNull);
      expect(find.text('Start chat'), findsOneWidget);
      expect(find.text('Starting…'), findsNothing);
    });
  });
}
