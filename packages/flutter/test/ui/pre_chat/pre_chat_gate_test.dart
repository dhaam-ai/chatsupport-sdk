// Reproduces `pre-chat-form.ts`'s own behaviour: which controls exist, the
// required-field refusal, and the details message the answers become.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const FieldSpec _name = FieldSpec(
  id: 'name',
  label: 'Your name',
  type: FieldKind.text,
  isRequired: true,
);
const FieldSpec _email = FieldSpec(
  id: 'email',
  label: 'Email address',
  type: FieldKind.email,
  isRequired: false,
);
const FieldSpec _order = FieldSpec(
  id: 'order',
  label: 'Order number',
  type: FieldKind.text,
  isRequired: false,
);

void main() {
  group('PreChatGate', () {
    late List<Map<String, String>> submitted;
    late int skips;
    late List<Object> errors;

    setUp(() {
      submitted = <Map<String, String>>[];
      skips = 0;
      errors = <Object>[];
    });

    Widget wrap(
      List<FieldSpec> fields, {
      Future<void> Function(Map<String, String>)? onSubmit,
    }) {
      return MaterialApp(
        home: Scaffold(
          body: PreChatGate(
            fields: fields,
            onSubmit: onSubmit ??
                (Map<String, String> answers) async => submitted.add(answers),
            onSkip: () => skips += 1,
            onError: (Object e, StackTrace _) => errors.add(e),
          ),
        ),
      );
    }

    testWidgets('greets with the merchant questions under its own heading',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(<FieldSpec>[_name, _email]));

      // Not the merchant's greeting: that has its own surface, and borrowing
      // it opened this form with a welcome already given.
      expect(find.text('Before we start'), findsOneWidget);
      expect(find.text(kPreChatSubtitle), findsOneWidget);
      expect(find.text('Your name'), findsOneWidget);
      // Optional is marked; required is not — the console preview's own rule.
      expect(find.text('Email address (optional)'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Start chat'), findsOneWidget);
    });

    // A form where every question is optional and there is no way past it
    // asks for nothing and blocks everything.
    testWidgets('offers Skip when the merchant made nothing required',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(<FieldSpec>[_email, _order]));
      expect(find.text('Skip for now'), findsOneWidget);

      await tester.tap(find.text('Skip for now'));
      await tester.pump();
      expect(skips, 1);
    });

    // An escape hatch next to a required field is the merchant's setting
    // quietly overruled.
    testWidgets('withholds Skip the moment anything is required',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(<FieldSpec>[_name, _email]));
      expect(find.text('Skip for now'), findsNothing);
    });

    testWidgets('refuses a missing required field, naming AND focusing it',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(<FieldSpec>[_email, _name]));

      await tester.tap(find.widgetWithText(FilledButton, 'Start chat'));
      await tester.pump();

      expect(submitted, isEmpty);
      expect(find.text('Your name is required.'), findsOneWidget);
      // Named alone leaves a screen-reader user hunting; focused alone leaves
      // a sighted user wondering why the cursor moved.
      final EditableText nameBox = tester.widget<EditableText>(
        find.descendant(
          of: find.ancestor(
            of: find.text('Your name'),
            matching: find.byType(TextField),
          ),
          matching: find.byType(EditableText),
        ),
      );
      expect(nameBox.focusNode.hasFocus, isTrue);
    });

    testWidgets('submits the trimmed answers, omitting a blank optional',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(<FieldSpec>[_name, _email, _order]));

      await tester.enterText(
        find.widgetWithText(TextField, 'Your name'),
        '  Ada  ',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Email address (optional)'),
        'ada@example.com',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Start chat'));
      await tester.pump();

      expect(submitted, <Map<String, String>>[
        <String, String>{'name': 'Ada', 'email': 'ada@example.com'},
      ]);
    });

    // Asked and declined is a real answer — an EMPTY record, not absence.
    testWidgets('submits an empty record when every optional was left blank',
        (WidgetTester tester) async {
      await tester.pumpWidget(wrap(<FieldSpec>[_order]));

      await tester.tap(find.widgetWithText(FilledButton, 'Start chat'));
      await tester.pump();

      expect(submitted, hasLength(1));
      expect(submitted.single, isEmpty);
    });

    testWidgets(
        're-enables with a plain sentence when the submit fails, '
        'routing the error object off-screen', (WidgetTester tester) async {
      await tester.pumpWidget(wrap(
        <FieldSpec>[_order],
        onSubmit: (Map<String, String> _) async => throw StateError('boom'),
      ));

      await tester.tap(find.widgetWithText(FilledButton, 'Start chat'));
      await tester.pump();

      expect(find.text(kPreChatFailure), findsOneWidget);
      // The error carries a stack and possibly a URL. Neither is on screen.
      expect(find.textContaining('boom'), findsNothing);
      expect(errors.single, isA<StateError>());
      // The whole reason submitOnce exists: a failed submit must not leave a
      // dead button reading "Starting…" forever.
      final FilledButton button = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Start chat'),
      );
      expect(button.onPressed, isNotNull);
    });
  });

  group('preChatDetailsMessage', () {
    test('renders "Label: value" lines in the MERCHANT\'s field order', () {
      expect(
        preChatDetailsMessage(
          fields: <FieldSpec>[_name, _email],
          // Deliberately the other way round: the map's order is the order
          // boxes happened to be filled in, not the order the form was
          // designed in, and an agent reads the result.
          answers: <String, String>{
            'email': 'ada@example.com',
            'name': 'Ada',
          },
        ),
        'Your name: Ada\nEmail address: ada@example.com',
      );
    });

    test('skips a field with no answer', () {
      expect(
        preChatDetailsMessage(
          fields: <FieldSpec>[_name, _email],
          answers: <String, String>{'name': 'Ada'},
        ),
        'Your name: Ada',
      );
    });

    // The `preChatAnswers == {}` path: asked and declined still counts as
    // answered, but there is nothing to relay, so no message is sent at all.
    test('reports null — not an empty string — when nothing was answered', () {
      expect(
        preChatDetailsMessage(
          fields: <FieldSpec>[_name],
          answers: const <String, String>{},
        ),
        isNull,
      );
    });
  });
}
