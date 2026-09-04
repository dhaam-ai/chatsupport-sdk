// The ended-conversation footer in isolation — the Dart counterpart of
// `ended-footer.test.ts` (6 cases).
//
// Which session states put this footer on screen, and what it replaces, is
// covered in `csat_surface_test.dart` through a real Cubit. This file is only
// about what happens once the two buttons exist.

import 'dart:async';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Finder get _reopen => find.widgetWithText(FilledButton, 'Reopen conversation');
Finder get _busyReopen => find.widgetWithText(FilledButton, 'Reopening…');
Finder get _startNew => find.widgetWithText(TextButton, 'New conversation');

bool _enabled<T extends ButtonStyleButton>(WidgetTester tester, Finder f) =>
    tester.widget<T>(f).onPressed != null;

Future<void> _pump(
  WidgetTester tester, {
  required Future<void> Function() onReopen,
  VoidCallback? onStartNew,
  List<Object>? errors,
}) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: EndedFooter(
          onReopen: onReopen,
          onStartNew: onStartNew ?? () {},
          onError: (Object error, StackTrace stack) => errors?.add(error),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('renders both actions, named for assistive tech', (tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await _pump(tester, onReopen: () async {});

    expect(_reopen, findsOneWidget);
    expect(_startNew, findsOneWidget);
    expect(
      find.bySemanticsLabel(RegExp('This conversation has ended')),
      findsWidgets,
    );
    handle.dispose();
  });

  testWidgets(
      'routes "New conversation" straight to the callback — no surface of '
      'its own', (tester) async {
    int starts = 0;
    await _pump(
      tester,
      onReopen: () async {},
      onStartNew: () => starts += 1,
    );

    await tester.tap(_startNew);
    await tester.pump();

    expect(starts, 1);
  });

  testWidgets('calls onReopen when "Reopen" is pressed', (tester) async {
    int reopens = 0;
    await _pump(tester, onReopen: () async => reopens += 1);

    await tester.tap(_reopen);
    await tester.pumpAndSettle();

    expect(reopens, 1);
  });

  testWidgets('disables BOTH buttons and shows the busy label in flight',
      (tester) async {
    final Completer<void> release = Completer<void>();
    await _pump(tester, onReopen: () => release.future);

    await tester.tap(_reopen);
    await tester.pump();

    expect(_busyReopen, findsOneWidget);
    expect(_enabled<FilledButton>(tester, _busyReopen), isFalse);
    // Starting a brand new conversation while THIS one's reopen is still in
    // flight would leave that request's outcome landing on a footer the
    // customer has already moved away from.
    expect(_enabled<TextButton>(tester, _startNew), isFalse);

    release.complete();
    await tester.pumpAndSettle();

    expect(_enabled<FilledButton>(tester, _reopen), isTrue);
    expect(_enabled<TextButton>(tester, _startNew), isTrue);
  });

  // The exact bug class `submitOnce` exists to make unrepeatable: a rejected
  // reopen must not leave the button stuck reading "Reopening…" with no way
  // to try again.
  testWidgets('comes back to life with an inline error when the reopen rejects',
      (tester) async {
    final List<Object> errors = <Object>[];
    final Exception failure = Exception('network down');
    await _pump(tester, errors: errors, onReopen: () async => throw failure);

    await tester.tap(_reopen);
    await tester.pumpAndSettle();

    expect(_reopen, findsOneWidget);
    expect(_enabled<FilledButton>(tester, _reopen), isTrue);
    expect(
      find.text('We could not reopen this conversation. Please try again.'),
      findsOneWidget,
    );
    // The raw error goes to the host's own channel, never onto the screen.
    expect(errors, <Object>[failure]);
    expect(find.textContaining('network down'), findsNothing);
  });

  testWidgets('clears a previous error on the next attempt', (tester) async {
    int attempts = 0;
    await _pump(
      tester,
      onReopen: () async {
        attempts += 1;
        if (attempts == 1) throw Exception('nope');
      },
    );

    await tester.tap(_reopen);
    await tester.pumpAndSettle();
    expect(
      find.text('We could not reopen this conversation. Please try again.'),
      findsOneWidget,
    );

    await tester.tap(_reopen);
    await tester.pumpAndSettle();
    expect(
      find.text('We could not reopen this conversation. Please try again.'),
      findsNothing,
    );
  });
}
