// The field half of the shared form substrate.
//
// These reproduce the field-level assertions of
// `packages/widget/test/product-surfaces.test.ts` — the label/optional
// convention, the type→keyboard mapping, trimming, and the omit-a-blank rule.
// Translated as assertions, not as DOM: the web test reaches for
// `.dh-field-label` and `inputmode` because that is where jsdom keeps those
// facts, and the equivalent facts live on `InputDecoration` and
// `TextInputType` here.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const FieldSpec kName = FieldSpec(
    id: 'p1', label: 'Your name', type: FieldKind.text, isRequired: true);
const FieldSpec kEmail = FieldSpec(
    id: 'p2', label: 'Email address', type: FieldKind.email, isRequired: true);
const FieldSpec kOrder = FieldSpec(
    id: 'p3', label: 'Order number', type: FieldKind.text, isRequired: false);

Widget _wrap(List<FieldView> fields) {
  return MaterialApp(
    home: Scaffold(
      body: Column(
        children: <Widget>[
          for (final FieldView f in fields) FormFieldInput(field: f)
        ],
      ),
    ),
  );
}

void main() {
  group('FieldSpec', () {
    test('compares by value, so a rebuilt spec is the same spec', () {
      expect(
        const FieldSpec(
            id: 'p1',
            label: 'Your name',
            type: FieldKind.text,
            isRequired: true),
        kName,
      );
      expect(
        const FieldSpec(
            id: 'p1',
            label: 'Your name',
            type: FieldKind.text,
            isRequired: false),
        isNot(kName),
      );
    });
  });

  group('displayLabel — optional is marked, required is not', () {
    test('marks an optional field', () {
      final FieldView view = FieldView(kOrder);
      addTearDown(view.dispose);
      expect(view.displayLabel, 'Order number (optional)');
    });

    // The inverse of the usual asterisk convention, and deliberate: it matches
    // the console preview the merchant designed the form against.
    test('leaves a required field unmarked — no asterisk, no "required"', () {
      final FieldView view = FieldView(kName);
      addTearDown(view.dispose);
      expect(view.displayLabel, 'Your name');
    });
  });

  group('keyboardTypeFor', () {
    // The difference between a numeric keypad and a full keyboard on mobile.
    test('phone gets the phone keypad', () {
      expect(keyboardTypeFor(FieldKind.phone), TextInputType.phone);
    });

    test('email gets the email keyboard, text gets the plain one', () {
      expect(keyboardTypeFor(FieldKind.email), TextInputType.emailAddress);
      expect(keyboardTypeFor(FieldKind.text), TextInputType.text);
    });
  });

  group('autofillHintsFor', () {
    test('reads the TYPE first — structured data beats merchant prose', () {
      expect(autofillHintsFor(kEmail), const <String>[AutofillHints.email]);
      expect(
        autofillHintsFor(const FieldSpec(
            id: 'x',
            label: 'Mobile',
            type: FieldKind.phone,
            isRequired: false)),
        const <String>[AutofillHints.telephoneNumber],
      );
    });

    test('falls back to the label only for an untyped text field', () {
      expect(autofillHintsFor(kName), const <String>[AutofillHints.name]);
      expect(autofillHintsFor(kOrder), isEmpty);
    });
  });

  group('value', () {
    test('is trimmed', () {
      final FieldView view = FieldView(kName);
      addTearDown(view.dispose);
      view.controller.text = '  Ada  ';
      expect(view.value, 'Ada');
    });

    test('treats a whitespace-only answer as no answer', () {
      final FieldView view = FieldView(kName);
      addTearDown(view.dispose);
      view.controller.text = '   ';
      expect(view.value, isEmpty);
    });
  });

  group('firstMissingRequired', () {
    test('returns the FIELD, not a boolean, so the caller can focus it', () {
      final List<FieldView> views =
          <FieldSpec>[kName, kEmail].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      views[0].controller.text = 'Ada';

      final FieldView? missing = firstMissingRequired(views);
      expect(missing, isNotNull);
      expect(missing!.spec, kEmail);
      expect(
          missingRequiredMessage(missing.spec), 'Email address is required.');
    });

    test('returns the FIRST one missed, not the last one checked', () {
      final List<FieldView> views =
          <FieldSpec>[kName, kEmail].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      expect(firstMissingRequired(views)?.spec, kName);
    });

    test('ignores an empty optional field', () {
      final List<FieldView> views =
          <FieldSpec>[kName, kOrder].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      views[0].controller.text = 'Ada';
      expect(firstMissingRequired(views), isNull);
    });

    test('a whitespace-only answer does not satisfy a required field', () {
      final List<FieldView> views =
          <FieldSpec>[kName].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      views[0].controller.text = '   ';
      expect(firstMissingRequired(views)?.spec, kName);
    });
  });

  group('collectAnswers', () {
    test('keys the answers by field id and trims them', () {
      final List<FieldView> views =
          <FieldSpec>[kName, kEmail].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      views[0].controller.text = '  Ada  ';
      views[1].controller.text = 'ada@example.com';

      expect(collectAnswers(views),
          <String, String>{'p1': 'Ada', 'p2': 'ada@example.com'});
    });

    // An empty string is an answer; absence is not. They reach an agent's
    // screen as different things and one of them is a lie.
    test('omits an empty optional answer rather than sending a blank string',
        () {
      final List<FieldView> views =
          <FieldSpec>[kName, kOrder].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      views[0].controller.text = 'Ada';

      final Map<String, String> answers = collectAnswers(views);
      expect(answers, <String, String>{'p1': 'Ada'});
      expect(answers.containsKey('p3'), isFalse);
    });

    test('is empty — not null — when every field was left blank', () {
      final List<FieldView> views =
          <FieldSpec>[kOrder].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      expect(collectAnswers(views), isEmpty);
    });
  });

  group('FormFieldInput', () {
    testWidgets('renders one box per field, in the order given',
        (WidgetTester tester) async {
      final List<FieldView> views =
          <FieldSpec>[kName, kEmail, kOrder].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      await tester.pumpWidget(_wrap(views));

      final List<TextField> boxes =
          tester.widgetList<TextField>(find.byType(TextField)).toList();
      expect(boxes, hasLength(3));
      expect(
        boxes.map((TextField b) => b.decoration?.labelText),
        <String>['Your name', 'Email address', 'Order number (optional)'],
      );
    });

    testWidgets('wires each field kind to its keyboard',
        (WidgetTester tester) async {
      final List<FieldView> views = <FieldSpec>[
        kName,
        kEmail,
        const FieldSpec(
            id: 'p3',
            label: 'Order number',
            type: FieldKind.phone,
            isRequired: false),
      ].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      await tester.pumpWidget(_wrap(views));

      final List<TextField> boxes =
          tester.widgetList<TextField>(find.byType(TextField)).toList();
      expect(
        boxes.map((TextField b) => b.keyboardType),
        <TextInputType>[
          TextInputType.text,
          TextInputType.emailAddress,
          TextInputType.phone
        ],
      );
    });

    // The web original associates label and input with `<label for>`. Here the
    // association is `InputDecoration.labelText`, which InputDecorator folds
    // into the field's own semantics node — so the assertion is that the
    // accessible name of the text field CONTAINS the label, not that some
    // attribute points at some id.
    testWidgets('the label is part of the field accessible name',
        (WidgetTester tester) async {
      // Disposed inside the body, not via addTearDown: the framework's
      // end-of-test verification runs BEFORE tear-downs and fails on a live
      // handle.
      final SemanticsHandle handle = tester.ensureSemantics();
      final FieldView view = FieldView(kOrder);
      addTearDown(view.dispose);

      await tester.pumpWidget(_wrap(<FieldView>[view]));

      expect(
        find.bySemanticsLabel(RegExp('Order number \\(optional\\)')),
        findsAtLeastNWidgets(1),
      );

      handle.dispose();
    });

    testWidgets('focus() moves the keyboard to the field the caller was handed',
        (WidgetTester tester) async {
      final List<FieldView> views =
          <FieldSpec>[kName, kEmail].map(FieldView.new).toList();
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });
      await tester.pumpWidget(_wrap(views));

      views[0].controller.text = 'Ada';
      firstMissingRequired(views)!.focus();
      await tester.pump();

      expect(views[1].focusNode.hasFocus, isTrue);
      expect(views[0].focusNode.hasFocus, isFalse);
    });
  });
}
