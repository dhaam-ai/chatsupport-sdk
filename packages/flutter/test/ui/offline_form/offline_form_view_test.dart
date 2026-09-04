// Reproduces `product-surfaces.test.ts`'s "offline form — out of hours" block
// (9 cases, lines 165-303), plus the two facts the reference gets from its DOM
// for free: that the merchant's own field survives the de-duplication, and
// that focus lands where the surface went.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const FieldSpec _name = FieldSpec(
  id: 'p1',
  label: 'Your name',
  type: FieldKind.text,
  isRequired: true,
);
const FieldSpec _email = FieldSpec(
  id: 'p2',
  label: 'Email address',
  type: FieldKind.email,
  isRequired: true,
);
const FieldSpec _order = FieldSpec(
  id: 'p3',
  label: 'Order number',
  type: FieldKind.text,
  isRequired: false,
);

/// Every field label on screen, in render order.
List<String> _labels(WidgetTester tester) => tester
    .widgetList<TextField>(find.byType(TextField))
    .map((TextField field) => field.decoration?.labelText ?? '')
    .toList();

Future<void> _pumpForm(
  WidgetTester tester, {
  List<FieldSpec> extraFields = const <FieldSpec>[],
  required Future<void> Function(OfflineMessage) onSubmit,
  void Function(Object, StackTrace)? onError,
  String? offlineMessage,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: OfflineFormView(
          extraFields: extraFields,
          onSubmit: onSubmit,
          onError: onError ?? (Object error, StackTrace stackTrace) {},
          offlineMessage: offlineMessage,
        ),
      ),
    ),
  );
}

/// Fills the form's boxes by their labels.
Future<void> _fill(
  WidgetTester tester,
  Map<String, String> byLabel,
) async {
  for (final MapEntry<String, String> entry in byLabel.entries) {
    await tester.enterText(
      find.ancestor(
        of: find.text(entry.key),
        matching: find.byType(TextField),
      ),
      entry.value,
    );
  }
}

void main() {
  testWidgets('always asks for name, contact and a message', (tester) async {
    await _pumpForm(tester, onSubmit: (OfflineMessage _) async {});
    expect(
      _labels(tester),
      <String>['Name', 'Email or phone', 'How can we help?'],
    );
  });

  testWidgets('drops console fields that duplicate the built-ins',
      (tester) async {
    await _pumpForm(
      tester,
      extraFields: const <FieldSpec>[_name, _email, _order],
      onSubmit: (OfflineMessage _) async {},
    );
    expect(
      _labels(tester),
      <String>[
        'Name',
        'Email or phone',
        // Optional is marked; required is not — the substrate's own
        // convention, and the console preview's.
        'Order number (optional)',
        'How can we help?',
      ],
    );
  });

  testWidgets('keeps a merchant field that merely CONTAINS a built-in word',
      (tester) async {
    await _pumpForm(
      tester,
      extraFields: const <FieldSpec>[
        FieldSpec(
          id: 'x',
          label: 'Name of the product you ordered',
          type: FieldKind.text,
          isRequired: false,
        ),
      ],
      onSubmit: (OfflineMessage _) async {},
    );
    expect(
      _labels(tester),
      contains('Name of the product you ordered (optional)'),
    );
  });

  testWidgets('flattens answered custom fields into the message body',
      (tester) async {
    OfflineMessage? submitted;
    await _pumpForm(
      tester,
      extraFields: const <FieldSpec>[_order],
      onSubmit: (OfflineMessage message) async => submitted = message,
    );

    await _fill(tester, <String, String>{
      'Name': 'Ada',
      'Email or phone': 'ada@example.com',
      'Order number (optional)': 'ORD-42',
      'How can we help?': 'My parcel never arrived',
    });
    await tester.tap(find.text('Send message'));
    await tester.pump();

    expect(
      submitted,
      const OfflineMessage(
        name: 'Ada',
        contact: 'ada@example.com',
        message: 'My parcel never arrived\n\nOrder number: ORD-42',
      ),
    );
  });

  testWidgets('leaves an unanswered optional field out of the body entirely',
      (tester) async {
    OfflineMessage? submitted;
    await _pumpForm(
      tester,
      extraFields: const <FieldSpec>[_order],
      onSubmit: (OfflineMessage message) async => submitted = message,
    );

    await _fill(tester, <String, String>{
      'Name': 'Ada',
      'Email or phone': 'ada@example.com',
      'How can we help?': 'Where is my order',
    });
    await tester.tap(find.text('Send message'));
    await tester.pump();

    expect(submitted?.message, 'Where is my order');
  });

  // A distinct reason per refusal, and the field it names is the one that
  // gets focus.
  for (final (String label, Map<String, String> values, String expected)
      in <(String, Map<String, String>, String)>[
    (
      'no name',
      <String, String>{
        'Email or phone': 'a@b.c',
        'How can we help?': 'a real message',
      },
      'Please add your name.',
    ),
    (
      'no contact',
      <String, String>{'Name': 'Ada', 'How can we help?': 'a real message'},
      'Please add an email or phone number so we can reply.',
    ),
    (
      'a too-short message',
      <String, String>{
        'Name': 'Ada',
        'Email or phone': 'a@b.c',
        'How can we help?': 'hi',
      },
      'Please tell us a little about what you need.',
    ),
  ]) {
    testWidgets('refuses $label with a specific reason', (tester) async {
      bool submitted = false;
      await _pumpForm(
        tester,
        onSubmit: (OfflineMessage _) async => submitted = true,
      );

      await _fill(tester, values);
      await tester.tap(find.text('Send message'));
      await tester.pump();

      expect(submitted, isFalse);
      expect(find.text(expected), findsOneWidget);
    });
  }

  testWidgets('enforces a required console field', (tester) async {
    bool submitted = false;
    await _pumpForm(
      tester,
      extraFields: const <FieldSpec>[
        FieldSpec(
          id: 'p3',
          label: 'Order number',
          type: FieldKind.text,
          isRequired: true,
        ),
      ],
      onSubmit: (OfflineMessage _) async => submitted = true,
    );

    await _fill(tester, <String, String>{
      'Name': 'Ada',
      'Email or phone': 'a@b.c',
      'How can we help?': 'a real message',
    });
    await tester.tap(find.text('Send message'));
    await tester.pump();

    expect(submitted, isFalse);
    // The substrate's own wording, so a console field is refused in exactly
    // the words every other surface in this package refuses one.
    expect(find.text('Order number is required.'), findsOneWidget);
  });

  // The form is spent once sent; leaving it up invites a duplicate from a
  // customer unsure the first one landed.
  testWidgets('replaces the form with a confirmation naming the contact',
      (tester) async {
    await _pumpForm(tester, onSubmit: (OfflineMessage _) async {});

    await _fill(tester, <String, String>{
      'Name': 'Ada',
      'Email or phone': 'ada@example.com',
      'How can we help?': 'My parcel never arrived',
    });
    await tester.tap(find.text('Send message'));
    await tester.pump();

    expect(find.text('Send message'), findsNothing);
    expect(find.text('Message received'), findsOneWidget);
    expect(
      find.text(
        "We'll reply to ada@example.com as soon as the team is back online.",
      ),
      findsOneWidget,
    );
  });

  testWidgets('keeps the form up when the send rejects', (tester) async {
    Object? reported;
    await _pumpForm(
      tester,
      onSubmit: (OfflineMessage _) async => throw StateError('offline'),
      onError: (Object error, StackTrace stackTrace) => reported = error,
    );

    await _fill(tester, <String, String>{
      'Name': 'Ada',
      'Email or phone': 'a@b.c',
      'How can we help?': 'a real message',
    });
    await tester.tap(find.text('Send message'));
    await tester.pump();

    expect(find.text('Message received'), findsNothing);
    // Re-enabled and back to its resting label — the `finally` the whole form
    // substrate exists for.
    final FilledButton submit =
        tester.widget<FilledButton>(find.byType(FilledButton));
    expect(submit.onPressed, isNotNull);
    expect(find.text('Send message'), findsOneWidget);
    expect(
        find.text('We could not send that. Please try again.'), findsOneWidget);
    // The exception carries a stack and possibly a URL, so it goes to the
    // host and never onto the customer's screen.
    expect(reported, isA<StateError>());
    expect(find.textContaining('StateError'), findsNothing);
  });

  testWidgets('shows the merchant\'s own out-of-hours words when set',
      (tester) async {
    await _pumpForm(
      tester,
      onSubmit: (OfflineMessage _) async {},
      offlineMessage: 'Back at 9am, promise.',
    );
    expect(find.text('Back at 9am, promise.'), findsOneWidget);
  });

  testWidgets('falls back to its own sentence when the merchant set none',
      (tester) async {
    await _pumpForm(tester, onSubmit: (OfflineMessage _) async {});
    expect(
      find.text("Leave us a message and we'll get back to you."),
      findsOneWidget,
    );
  });
}
