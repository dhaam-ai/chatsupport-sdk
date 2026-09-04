// The rating card in isolation — the Dart counterpart of
// `product-surfaces.test.ts:304-460`'s `describe('CSAT survey')` block, plus
// the locked/already-rated assertions from `csat-submit.test.ts:344-430`.
//
// Everything here is about what happens once the card is on screen. WHICH
// session gets a card, and whether one is due at all, is the CSAT machine's
// question and is covered in `csat_surface_test.dart`.

import 'package:dhaam_chat/dhaam_chat.dart' show CsatRated;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// A palette with a primary nothing else in the card uses, so "lit" is
/// unambiguous when the glyph itself cannot say (the emoji scale, where every
/// face is drawn whatever the score).
final ThemeData _theme = ThemeData(
  colorScheme: const ColorScheme.light(primary: Color(0xFF0055FF)),
);

Color get _lit => _theme.colorScheme.primary;

Future<void> _pump(
  WidgetTester tester, {
  CsatStyle style = CsatStyle.stars,
  CsatRated? existing,
  Future<void> Function(int rating, String? comment)? onSubmit,
  List<Object>? errors,
}) {
  return tester.pumpWidget(
    MaterialApp(
      theme: _theme,
      home: Scaffold(
        body: CsatCardView(
          style: style,
          existing: existing,
          onSubmit: onSubmit ?? (int rating, String? comment) async {},
          onError: (Object error, StackTrace stack) => errors?.add(error),
        ),
      ),
    ),
  );
}

Text _glyph(WidgetTester tester, int score) => tester.widget<Text>(
      find.descendant(
        of: find.byKey(csatOptionKey(score)),
        matching: find.byType(Text),
      ),
    );

List<String> _glyphs(WidgetTester tester) => <String>[
      for (int score = 1; score <= kCsatMaxScore; score += 1)
        _glyph(tester, score).data!,
    ];

List<bool> _isLit(WidgetTester tester) => <bool>[
      for (int score = 1; score <= kCsatMaxScore; score += 1)
        _glyph(tester, score).style?.color == _lit,
    ];

List<bool> _isChecked(WidgetTester tester) => <bool>[
      for (int score = 1; score <= kCsatMaxScore; score += 1)
        tester
            .getSemantics(find.byKey(csatOptionKey(score)))
            .hasFlag(SemanticsFlag.isChecked),
    ];

void main() {
  group('the scale', () {
    testWidgets('offers five mutually exclusive options', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester);

      for (int score = 1; score <= kCsatMaxScore; score += 1) {
        expect(
          tester
              .getSemantics(find.byKey(csatOptionKey(score)))
              .hasFlag(SemanticsFlag.isInMutuallyExclusiveGroup),
          isTrue,
          reason: 'option $score should be one answer of five, not a toggle',
        );
      }
      handle.dispose();
    });

    testWidgets('names every option with its score and its word',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester);

      expect(
        <String>[
          for (int score = 1; score <= kCsatMaxScore; score += 1)
            tester.getSemantics(find.byKey(csatOptionKey(score))).label,
        ],
        <String>[
          '1 of 5 — Poor',
          '2 of 5 — Not great',
          '3 of 5 — Okay',
          '4 of 5 — Good',
          '5 of 5 — Excellent',
        ],
      );
      handle.dispose();
    });

    // A star rating is "this many out of five".
    testWidgets('fills stars CUMULATIVELY', (tester) async {
      await _pump(tester);
      await tester.tap(find.byKey(csatOptionKey(4)));
      await tester.pump();

      expect(_glyphs(tester), <String>['★', '★', '★', '★', '☆']);
      expect(_isLit(tester), <bool>[true, true, true, true, false]);
    });

    // Faces are five different answers, not a quantity — a cumulative row
    // would claim the customer felt every mood up to the one they chose.
    testWidgets('lights exactly ONE face', (tester) async {
      await _pump(tester, style: CsatStyle.emoji);
      await tester.tap(find.byKey(csatOptionKey(4)));
      await tester.pump();

      expect(_glyphs(tester), <String>['😞', '🙁', '😐', '🙂', '😄']);
      expect(_isLit(tester), <bool>[false, false, false, true, false]);
    });

    testWidgets('marks exactly one option checked, in either style',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester);
      await tester.tap(find.byKey(csatOptionKey(3)));
      await tester.pump();

      expect(_isChecked(tester), <bool>[false, false, true, false, false]);
      handle.dispose();
    });

    testWidgets('shows the word for the current score, and nothing before one',
        (tester) async {
      await _pump(tester);
      expect(find.text('Excellent'), findsNothing);

      await tester.tap(find.byKey(csatOptionKey(5)));
      await tester.pump();
      expect(find.text('Excellent'), findsOneWidget);
    });
  });

  group('the comment box and submit', () {
    testWidgets('stay hidden until a score exists', (tester) async {
      await _pump(tester);
      expect(find.byType(TextField), findsNothing);
      expect(find.text('Submit feedback'), findsNothing);

      await tester.tap(find.byKey(csatOptionKey(1)));
      await tester.pump();
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Submit feedback'), findsOneWidget);
    });

    testWidgets('submit the score and a TRIMMED comment', (tester) async {
      final List<Object?> sent = <Object?>[];
      await _pump(
        tester,
        onSubmit: (int rating, String? comment) async =>
            sent.add(<Object?>[rating, comment]),
      );

      await tester.tap(find.byKey(csatOptionKey(5)));
      await tester.pump();
      await tester.enterText(find.byType(TextField), '  brilliant  ');
      await tester.tap(find.text('Submit feedback'));
      await tester.pumpAndSettle();

      expect(sent, <Object?>[
        <Object?>[5, 'brilliant']
      ]);
    });

    testWidgets('send null rather than an EMPTY comment', (tester) async {
      final List<Object?> sent = <Object?>[];
      await _pump(
        tester,
        onSubmit: (int rating, String? comment) async =>
            sent.add(<Object?>[rating, comment]),
      );

      await tester.tap(find.byKey(csatOptionKey(3)));
      await tester.pump();
      await tester.tap(find.text('Submit feedback'));
      await tester.pumpAndSettle();

      expect(sent, <Object?>[
        <Object?>[3, null]
      ]);
    });

    testWidgets('thank the customer once it lands, replacing the form',
        (tester) async {
      await _pump(tester);
      await tester.tap(find.byKey(csatOptionKey(4)));
      await tester.pump();
      await tester.tap(find.text('Submit feedback'));
      await tester.pumpAndSettle();

      expect(find.text('Thanks for your feedback!'), findsOneWidget);
      expect(find.byKey(csatOptionKey(4)), findsNothing);
    });

    // The exact bug class `submitOnce` exists to make unrepeatable: a
    // rejected submit must not leave the button reading "Sending…" forever
    // with the customer's typed comment stranded behind it.
    testWidgets('keep the rating on screen when the submit rejects',
        (tester) async {
      final List<Object> errors = <Object>[];
      final Exception boom = Exception('nope');
      await _pump(
        tester,
        errors: errors,
        onSubmit: (int rating, String? comment) async => throw boom,
      );

      await tester.tap(find.byKey(csatOptionKey(4)));
      await tester.pump();
      await tester.enterText(find.byType(TextField), 'still here');
      await tester.tap(find.text('Submit feedback'));
      await tester.pumpAndSettle();

      expect(find.text('Thanks for your feedback!'), findsNothing);
      expect(find.text('Submit feedback'), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNotNull,
        reason: 'the button has to come back to life',
      );
      expect(
        find.text('We could not send your feedback. Please try again.'),
        findsOneWidget,
      );
      // The customer's typed comment survives, and the raw error goes to the
      // host's channel rather than onto the screen.
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller?.text,
        'still here',
      );
      expect(errors, <Object>[boom]);
    });
  });

  group('keyboard', () {
    Future<void> press(
        WidgetTester tester, int from, LogicalKeyboardKey key) async {
      await tester.tap(find.byKey(csatOptionKey(from)));
      await tester.pump();
      await tester.sendKeyEvent(key);
      await tester.pump();
    }

    testWidgets('ArrowRight from 1 moves to 2', (tester) async {
      await _pump(tester);
      await press(tester, 1, LogicalKeyboardKey.arrowRight);
      expect(find.text('Not great'), findsOneWidget);
    });

    testWidgets('ArrowLeft from 3 moves to 2', (tester) async {
      await _pump(tester);
      await press(tester, 3, LogicalKeyboardKey.arrowLeft);
      expect(find.text('Not great'), findsOneWidget);
    });

    testWidgets('ArrowUp from 3 moves to 2', (tester) async {
      await _pump(tester);
      await press(tester, 3, LogicalKeyboardKey.arrowUp);
      expect(find.text('Not great'), findsOneWidget);
    });

    testWidgets('ArrowDown from 3 moves to 4', (tester) async {
      await _pump(tester);
      await press(tester, 3, LogicalKeyboardKey.arrowDown);
      expect(find.text('Good'), findsOneWidget);
    });

    // The headline keyboard rule. Wrapping from "Excellent" round to "Poor"
    // would let one extra keypress set the exact opposite of what the
    // customer meant — which is why this scale clamps and the emoji grid
    // (a picker, where every cell is equivalent) wraps.
    testWidgets('CLAMPS at both ends rather than wrapping', (tester) async {
      await _pump(tester);

      await press(tester, 5, LogicalKeyboardKey.arrowRight);
      expect(find.text('Excellent'), findsOneWidget);
      expect(find.text('Poor'), findsNothing);

      await press(tester, 1, LogicalKeyboardKey.arrowLeft);
      expect(find.text('Poor'), findsOneWidget);
      expect(find.text('Excellent'), findsNothing);
    });

    testWidgets('moves the focus with the selection', (tester) async {
      await _pump(tester);
      await press(tester, 1, LogicalKeyboardKey.arrowRight);

      // Otherwise a second arrow press goes nowhere: the key handler lives on
      // the focused option.
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
      await tester.pump();
      expect(find.text('Okay'), findsOneWidget);
    });
  });

  // ── The already-rated card ───────────────────────────────────────────────
  //
  // `POST …/csat` is an upsert, so a survey over a rated session does not
  // fail — it replaces the score. Withholding the controls is the only place
  // that can be prevented.
  group('a conversation the customer already rated', () {
    testWidgets('shows it filled and locked, with NO submit control at all',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester, existing: const CsatRated(rating: 4));

      expect(find.text('Your rating'), findsWidgets);
      expect(find.text('How was your support experience?'), findsNothing);
      expect(_isChecked(tester), <bool>[false, false, false, true, false]);
      expect(_glyphs(tester), <String>['★', '★', '★', '★', '☆']);

      // Not a DISABLED submit — no submit at all, which is the difference
      // between "you cannot press this" and never inviting the press.
      expect(find.byType(FilledButton), findsNothing);
      expect(find.text('Submit feedback'), findsNothing);
      expect(find.byType(TextField), findsNothing);

      for (int score = 1; score <= kCsatMaxScore; score += 1) {
        expect(
          tester
              .getSemantics(find.byKey(csatOptionKey(score)))
              .hasFlag(SemanticsFlag.isEnabled),
          isFalse,
        );
      }
      handle.dispose();
    });

    testWidgets('ignores a press on a different score, and sends nothing',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final List<Object?> sent = <Object?>[];
      await _pump(
        tester,
        existing: const CsatRated(rating: 4),
        onSubmit: (int rating, String? comment) async => sent.add(rating),
      );

      await tester.tap(find.byKey(csatOptionKey(1)), warnIfMissed: false);
      await tester.pump();

      expect(_isChecked(tester), <bool>[false, false, false, true, false]);
      expect(sent, isEmpty);
      handle.dispose();
    });

    testWidgets('shows the comment they left AS TEXT, not back in the box',
        (tester) async {
      await _pump(
        tester,
        existing: const CsatRated(rating: 5, comment: 'Sorted in a minute'),
      );

      expect(find.text('Sorted in a minute'), findsOneWidget);
      // A filled-in text field reads as something still being edited, which
      // is the opposite of what a locked card is saying.
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('renders no comment paragraph when they left none',
        (tester) async {
      await _pump(tester, existing: const CsatRated(rating: 2));
      expect(find.byType(TextField), findsNothing);
      // The acknowledgement stands ALONGSIDE the locked scale rather than
      // instead of it — hiding the scale would hide the rating this card
      // exists to show.
      expect(find.text('Thanks for your feedback!'), findsOneWidget);
      expect(find.byKey(csatOptionKey(2)), findsOneWidget);
    });

    testWidgets('the arrow keys are inert too', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester, existing: const CsatRated(rating: 4));

      await tester.tap(find.byKey(csatOptionKey(4)), warnIfMissed: false);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
      await tester.pump();

      expect(_isChecked(tester), <bool>[false, false, false, true, false]);
      handle.dispose();
    });
  });
}
