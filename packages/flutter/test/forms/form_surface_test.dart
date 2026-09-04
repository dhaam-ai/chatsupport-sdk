// The substrate composed the way a real surface composes it.
//
// The unit tests either side of this one check the pieces. This file checks
// the assembly, because the assembly is what the five downstream surfaces
// (pre-chat, offline, report-issue, new-conversation, CSAT) will copy — and
// because two of the assertions in
// `packages/widget/test/product-surfaces.test.ts` are only meaningful once
// fields and a submit are wired together:
//
//   * the customer's typed text SURVIVES a rejected submit. This is the
//     actual harm in the bug the module exists to prevent: not that a button
//     looked wrong, but that a person's typing was stranded behind it.
//   * the failure sentence names no internals, while the exception itself
//     reaches the host.
//
// `_ExampleSurface` below is deliberately the smallest honest version of what
// a downstream node writes: build views in initState, dispose them, then
// requireAll -> collectAnswers -> submitOnce.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const List<FieldSpec> kFields = <FieldSpec>[
  FieldSpec(
      id: 'p1', label: 'Your name', type: FieldKind.text, isRequired: true),
  FieldSpec(
      id: 'p2',
      label: 'Email address',
      type: FieldKind.email,
      isRequired: true),
  FieldSpec(
      id: 'p3', label: 'Order number', type: FieldKind.text, isRequired: false),
];

/// The reference composition. Five downstream surfaces look like this.
class _ExampleSurface extends StatefulWidget {
  const _ExampleSurface({
    required this.specs,
    required this.onSubmit,
    required this.onError,
  });

  final List<FieldSpec> specs;
  final Future<void> Function(Map<String, String> answers) onSubmit;
  final FormErrorReporter onError;

  @override
  State<_ExampleSurface> createState() => _ExampleSurfaceState();
}

class _ExampleSurfaceState extends State<_ExampleSurface> {
  late final List<FieldView> _views =
      widget.specs.map(FieldView.new).toList(growable: false);
  final FormSubmitController _form =
      FormSubmitController(label: 'Start chat', busyLabel: 'Starting…');

  bool submitted = false;

  @override
  void dispose() {
    for (final FieldView view in _views) {
      view.dispose();
    }
    _form.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.requireAll(_views)) return;
    final Map<String, String> answers = collectAnswers(_views);
    final bool ok = await _form.submitOnce(
      run: () => widget.onSubmit(answers),
      failureMessage: 'Sorry, we could not start the chat. Please try again.',
      onError: widget.onError,
    );
    // Advance only when there is something to confirm.
    if (ok && mounted) setState(() => submitted = true);
  }

  @override
  Widget build(BuildContext context) {
    if (submitted) return const Text('Thanks!');
    return Column(
      children: <Widget>[
        for (final FieldView view in _views) FormFieldInput(field: view),
        FormStatusLine(controller: _form),
        FormSubmitButton(controller: _form, onPressed: _submit),
      ],
    );
  }
}

void main() {
  Widget wrap(Widget child) =>
      MaterialApp(home: Scaffold(body: SingleChildScrollView(child: child)));

  Finder boxFor(String label) => find.ancestor(
        of: find.text(label),
        matching: find.byType(TextField),
      );

  FilledButton submitButton(WidgetTester tester) =>
      tester.widget<FilledButton>(find.byType(FilledButton));

  testWidgets(
      'collects trimmed answers keyed by field id, omitting a blank optional',
      (WidgetTester tester) async {
    Map<String, String>? sent;

    await tester.pumpWidget(wrap(_ExampleSurface(
      specs: kFields,
      onSubmit: (Map<String, String> answers) async => sent = answers,
      onError: (Object e, StackTrace s) {},
    )));

    await tester.enterText(boxFor('Your name'), '  Ada  ');
    await tester.enterText(boxFor('Email address'), 'ada@example.com');
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(sent, <String, String>{'p1': 'Ada', 'p2': 'ada@example.com'});
    expect(sent!.containsKey('p3'), isFalse,
        reason: 'an empty optional is absent, never an empty string');
    expect(find.text('Thanks!'), findsOneWidget,
        reason: 'advanced, because there was something to confirm');
  });

  testWidgets(
      'names the missing field and focuses it, rather than "fill in the fields above"',
      (WidgetTester tester) async {
    bool called = false;

    await tester.pumpWidget(wrap(_ExampleSurface(
      specs: kFields,
      onSubmit: (Map<String, String> answers) async => called = true,
      onError: (Object e, StackTrace s) {},
    )));

    await tester.enterText(boxFor('Your name'), 'Ada');
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(called, isFalse);
    expect(find.text('Email address is required.'), findsOneWidget);

    // Focused, not merely named. `enterText` focuses the box it types into,
    // so the name box held focus until requireAll moved it.
    final _ExampleSurfaceState state =
        tester.state<_ExampleSurfaceState>(find.byType(_ExampleSurface));
    expect(state._views[1].focusNode.hasFocus, isTrue);
    expect(state._views[0].focusNode.hasFocus, isFalse);
  });

  // The whole reason this module exists.
  testWidgets(
      'comes back to life when the submit rejects, with the typing intact',
      (WidgetTester tester) async {
    final Exception thrown = Exception('network down: https://internal/bucket');
    final List<Object> reported = <Object>[];

    await tester.pumpWidget(wrap(_ExampleSurface(
      specs: kFields,
      onSubmit: (Map<String, String> answers) async => throw thrown,
      onError: (Object e, StackTrace s) => reported.add(e),
    )));

    await tester.enterText(boxFor('Your name'), 'Ada');
    await tester.enterText(boxFor('Email address'), 'ada@example.com');
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    // The button is alive again and back to its resting label.
    expect(submitButton(tester).onPressed, isNotNull);
    expect(find.text('Start chat'), findsOneWidget);
    expect(find.text('Starting…'), findsNothing);

    // A plain sentence, and nothing from the exception.
    expect(
      find.text('Sorry, we could not start the chat. Please try again.'),
      findsOneWidget,
    );
    expect(find.textContaining('network down'), findsNothing);
    expect(find.textContaining('internal'), findsNothing);

    // The exception object itself went to the host.
    expect(reported, <Object>[thrown]);

    // And the customer's typing survives — the actual harm in the original
    // bug was a person's text stranded behind a dead button.
    expect(find.text('Ada'), findsOneWidget);
    expect(find.text('ada@example.com'), findsOneWidget);

    // Still on the form, not advanced to a confirmation.
    expect(find.text('Thanks!'), findsNothing);
  });

  testWidgets('a retry after a rejection works, and clears the stale failure',
      (WidgetTester tester) async {
    bool failNext = true;

    await tester.pumpWidget(wrap(_ExampleSurface(
      specs: kFields,
      onSubmit: (Map<String, String> answers) async {
        if (failNext) throw Exception('transient');
      },
      onError: (Object e, StackTrace s) {},
    )));

    await tester.enterText(boxFor('Your name'), 'Ada');
    await tester.enterText(boxFor('Email address'), 'ada@example.com');
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();
    expect(find.textContaining('could not start the chat'), findsOneWidget);

    // The blip passes, and the form the customer still has in front of them
    // sends on the second press. This is the path the original bug removed
    // entirely.
    failNext = false;
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(find.text('Thanks!'), findsOneWidget);
    expect(find.textContaining('could not start the chat'), findsNothing);
  });
}
