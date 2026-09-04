// The in-widget "End this conversation?" surface in isolation — the Dart
// counterpart of `end-conversation.test.ts` (7 cases).
//
// The widget-level half (the menu opening it, the close running on confirm,
// the rating card or the ended footer following) lives in
// `csat_surface_test.dart`, the same split the reference makes between this
// file and `ended-conversation.test.ts`.

import 'dart:async';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

final ThemeData _theme = ThemeData(
  colorScheme: const ColorScheme.light(error: Color(0xFFCC0033)),
);

Finder get _confirm => find.widgetWithText(FilledButton, 'End conversation');
Finder get _busyConfirm => find.widgetWithText(FilledButton, 'Ending…');
Finder get _keep => find.widgetWithText(TextButton, 'Keep chatting');

bool _enabled<T extends ButtonStyleButton>(WidgetTester tester, Finder f) =>
    tester.widget<T>(f).onPressed != null;

Future<void> _pump(
  WidgetTester tester, {
  required Future<void> Function() onConfirm,
  VoidCallback? onCancel,
  List<Object>? errors,
}) {
  return tester.pumpWidget(
    MaterialApp(
      theme: _theme,
      home: Scaffold(
        body: EndConversationConfirm(
          onConfirm: onConfirm,
          onCancel: onCancel ?? () {},
          onError: (Object error, StackTrace stack) => errors?.add(error),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('asks the question, offers the two answers, and names itself',
      (tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await _pump(tester, onConfirm: () async {});

    expect(find.text('End this conversation?'), findsOneWidget);
    expect(
      find.text('You can always start a new one from Home or Messages.'),
      findsOneWidget,
    );
    expect(_confirm, findsOneWidget);
    expect(_keep, findsOneWidget);

    // Named by its own question, so a screen reader announces what the two
    // buttons decide.
    expect(
      find.bySemanticsLabel(RegExp('End this conversation')),
      findsWidgets,
    );
    handle.dispose();
  });

  testWidgets(
      'marks the destructive action as such without losing the shared '
      'submit treatment', (tester) async {
    await _pump(tester, onConfirm: () async {});

    // Still a FormSubmitButton — it keeps the busy label and the disable
    // every other commit action has; only the colour says "this one destroys
    // something".
    expect(find.byType(FormSubmitButton), findsOneWidget);
    final ButtonStyle? style = tester.widget<FilledButton>(_confirm).style;
    expect(
      style?.backgroundColor?.resolve(<WidgetState>{}),
      _theme.colorScheme.error,
    );
  });

  testWidgets(
      'confirm calls onConfirm and shows the busy label until it '
      'settles — with the way out parked too', (tester) async {
    final Completer<void> release = Completer<void>();
    int calls = 0;
    await _pump(
      tester,
      onConfirm: () {
        calls += 1;
        return release.future;
      },
    );

    await tester.tap(_confirm);
    await tester.pump();

    expect(calls, 1);
    expect(_busyConfirm, findsOneWidget);
    expect(_enabled<FilledButton>(tester, _busyConfirm), isFalse);
    // A cancel landing mid-request would tear this surface down under a
    // close whose outcome still has to land somewhere.
    expect(_enabled<TextButton>(tester, _keep), isFalse);

    release.complete();
    await tester.pumpAndSettle();

    // The caller tears the surface down on success; the button itself still
    // comes back to rest, which is `submitOnce`'s guarantee.
    expect(_confirm, findsOneWidget);
    expect(_enabled<FilledButton>(tester, _confirm), isTrue);
    expect(_enabled<TextButton>(tester, _keep), isTrue);
  });

  testWidgets('a second press while one close is in flight is refused',
      (tester) async {
    final Completer<void> release = Completer<void>();
    int calls = 0;
    await _pump(
      tester,
      onConfirm: () {
        calls += 1;
        return release.future;
      },
    );

    await tester.tap(_confirm);
    await tester.pump();
    // The button is disabled, and `submitOnce`'s own re-entrancy guard stands
    // behind it — `closeSession` is not idempotent, and a second POST
    // re-emits a "chat closed" system message and another event.
    await tester.tap(_busyConfirm, warnIfMissed: false);
    await tester.pump();

    expect(calls, 1);
    release.complete();
    await tester.pumpAndSettle();
  });

  testWidgets('"Keep chatting" calls onCancel and never onConfirm',
      (tester) async {
    int cancels = 0;
    int confirms = 0;
    await _pump(
      tester,
      onCancel: () => cancels += 1,
      onConfirm: () async => confirms += 1,
    );

    await tester.tap(_keep);
    await tester.pump();

    expect(cancels, 1);
    expect(confirms, 0);
  });

  testWidgets(
      'a rejected onConfirm shows the failure message, reports it, and '
      're-enables BOTH buttons', (tester) async {
    final List<Object> errors = <Object>[];
    final Exception boom = Exception('close failed');
    await _pump(tester, errors: errors, onConfirm: () async => throw boom);

    await tester.tap(_confirm);
    await tester.pumpAndSettle();

    expect(
      find.text("We couldn't end this conversation. Please try again."),
      findsOneWidget,
    );
    // The error goes to the host's tracker, never onto the screen verbatim.
    expect(errors, <Object>[boom]);
    expect(find.textContaining('close failed'), findsNothing);

    expect(_enabled<FilledButton>(tester, _confirm), isTrue);
    expect(_enabled<TextButton>(tester, _keep), isTrue);
  });

  // A keyboard user who arrived by mistake should have to MOVE to destroy
  // something, not to keep it.
  testWidgets('focus lands on "Keep chatting", not on the destructive button',
      (tester) async {
    await _pump(tester, onConfirm: () async {});
    await tester.pump();

    final BuildContext? focused =
        tester.binding.focusManager.primaryFocus?.context;
    expect(focused, isNotNull);
    expect(focused!.findAncestorWidgetOfExactType<FilledButton>(), isNull);
    final TextButton? button =
        focused.findAncestorWidgetOfExactType<TextButton>();
    expect((button?.child as Text?)?.data, 'Keep chatting');
  });
}
