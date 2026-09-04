/// The post-resolution rating card — the survey a customer is asked once a
/// conversation has ended, and the locked read-out of a rating already on
/// file.
///
/// A port of `packages/widget/src/ui/csat.ts`.
///
/// ── Two presentations, because that is what the console offers ──────────
///
/// `csatStyle: 'stars' | 'emoji'`. There is no thumbs style and no NPS scale:
/// the thumbs pair in the React original belongs to the card that asks
/// whether the issue was RESOLVED, which is the gate in front of this rather
/// than a rating.
///
/// Both are 1-5, and the only difference is how the scale reads:
///
///  * **stars — CUMULATIVE.** Picking 4 fills 1..4, because a star rating is
///    "this many out of five".
///  * **emoji — SINGULAR.** Picking 4 lights only the fourth face, because
///    the faces are five different answers to one question rather than a
///    quantity. A cumulative row of faces would claim the customer felt every
///    mood up to and including the one they chose.
///
/// The whole difference is one predicate in [_CsatCardViewState._isLit], and
/// it is written once so the two styles cannot drift.
///
/// ── Where the score goes is the CALLER's decision ───────────────────────
///
/// This takes [CsatCardView.onSubmit] rather than owning the write. The
/// re-check against the server, the `POST …/csat` and the two memories that
/// follow it all live in `ChatWidgetCubit.rateSession`; this module has no
/// business knowing chat-service's URL shape, and a survey that silently
/// discarded the answer because nothing was wired up would be worse than no
/// survey at all.
///
/// ── The locked card, and why it has no submit control ───────────────────
///
/// `POST /chat/sessions/{id}/csat` is an UPSERT, so a survey shown over an
/// already-rated session does not fail — it quietly replaces the score the
/// customer gave. Passing [CsatCardView.existing] builds the card read-only:
/// the score is filled in, nothing is tappable, and there is **no submit
/// control at all** — not a disabled one, which still invites the press.
/// That is the only shape in which a rated session can be shown its own
/// rating without also being handed a way to overwrite it.
library;

import 'dart:async';
import 'dart:math' as math;

import 'package:dhaam_chat/dhaam_chat.dart' show CsatRated;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../config/remote_config.dart' show CsatStyle;
import '../../forms/forms.dart';

/// Lowest to highest. Index 0 is a score of 1.
const List<String> _labels = <String>[
  'Poor',
  'Not great',
  'Okay',
  'Good',
  'Excellent',
];

const List<String> _faces = <String>['😞', '🙁', '😐', '🙂', '😄'];

const String _starFilled = '★';
const String _starEmpty = '☆';

/// The top of the scale. Five, in both styles and in the console.
const int kCsatMaxScore = 5;

/// The `Key` of the option for [score] (1-based), for tests and for a host
/// driving the card programmatically.
Key csatOptionKey(int score) => ValueKey<String>('dh-csat-option-$score');

/// The rating card. Pass [existing] to render it locked — see the library
/// header.
class CsatCardView extends StatefulWidget {
  const CsatCardView({
    super.key,
    required this.style,
    required this.onSubmit,
    required this.onError,
    this.existing,
  });

  /// Stars or faces. From `RemoteConfig.csatStyle`.
  final CsatStyle style;

  /// Writes the rating. `comment` is null when the customer left none —
  /// never `''`, which would assert an answer that was not given.
  ///
  /// Rejecting leaves the card up with a plain sentence and the score still
  /// selected, so a second press retries rather than re-rates.
  final Future<void> Function(int rating, String? comment) onSubmit;

  /// Where an [onSubmit] rejection goes. Never onto the customer's screen:
  /// the error carries a stack and possibly a URL.
  final FormErrorReporter onError;

  /// The rating this session ALREADY carries, read back from the server.
  ///
  /// Non-null builds the locked card. Never a client-only flag — see
  /// `CsatMachine`, which is the single memory of this and survives the
  /// reload a closure variable does not.
  final CsatRated? existing;

  @override
  State<CsatCardView> createState() => _CsatCardViewState();
}

class _CsatCardViewState extends State<CsatCardView> {
  late final FormSubmitController _submit;
  final TextEditingController _comment = TextEditingController();
  late final List<FocusNode> _options;

  /// 0 means nothing picked yet. Seeded from [CsatCardView.existing] so the
  /// locked card renders the score it is reading back.
  int _score = 0;

  /// The card has been rated THROUGH THIS VIEW and is showing its thanks.
  ///
  /// Distinct from [_locked]: that one is a rating the SERVER already held
  /// when this card was built, and it keeps the scale on screen (hiding it
  /// would hide the very rating the card exists to show).
  bool _submitted = false;

  bool get _locked => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _submit = FormSubmitController(
      label: 'Submit feedback',
      busyLabel: 'Sending…',
    );
    _options = <FocusNode>[
      for (int index = 0; index < kCsatMaxScore; index += 1)
        FocusNode(debugLabel: 'csat-option-${index + 1}'),
    ];
    _score = widget.existing?.rating ?? 0;
  }

  @override
  void dispose() {
    for (final FocusNode node in _options) {
      node.dispose();
    }
    _comment.dispose();
    _submit.dispose();
    super.dispose();
  }

  /// The one predicate that is the whole difference between the two styles.
  bool _isLit(int value) =>
      widget.style == CsatStyle.emoji ? value == _score : value <= _score;

  void _choose(int value) {
    if (_locked) return;
    setState(() => _score = value);
    // Selection and focus travel together, matching a native radio group and
    // the reference (where clicking a `<button>` focuses it). Without this a
    // customer who TAPS a score and then reaches for the arrow keys finds
    // them dead, because nothing in the scale holds focus.
    _options[value - 1].requestFocus();
  }

  /// Arrow keys move the selection and the focus together, CLAMPED.
  ///
  /// Clamped, not wrapping — unlike the emoji grid, which wraps in both axes.
  /// A rating scale has a real low end and a real high end, and wrapping from
  /// "Excellent" round to "Poor" would let one extra keypress set the exact
  /// opposite of what the customer meant.
  ///
  /// Relative to the option the key was pressed ON rather than to the current
  /// score, matching the reference: focus and selection travel together, so
  /// the two are the same number except in the moment before anything is
  /// picked.
  KeyEventResult _onKey(int index, KeyEvent event) {
    if (_locked) return KeyEventResult.ignored;
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final int delta = switch (event.logicalKey) {
      LogicalKeyboardKey.arrowRight || LogicalKeyboardKey.arrowDown => 1,
      LogicalKeyboardKey.arrowLeft || LogicalKeyboardKey.arrowUp => -1,
      _ => 0,
    };
    if (delta == 0) return KeyEventResult.ignored;

    final int next = math.min(kCsatMaxScore, math.max(1, index + 1 + delta));
    // Moves the focus too — see [_choose], which is the one place that does
    // it so the two can never disagree about where the scale is.
    _choose(next);
    return KeyEventResult.handled;
  }

  Future<void> _run() async {
    if (_locked || _score == 0) return;
    final String text = _comment.text.trim();
    final bool sent = await _submit.submitOnce(
      // Blank is OMITTED, never sent as `''`: an empty string asserts the
      // customer wrote something and it was nothing.
      run: () => widget.onSubmit(_score, text.isEmpty ? null : text),
      failureMessage: 'We could not send your feedback. Please try again.',
      onError: widget.onError,
    );
    if (sent && mounted) setState(() => _submitted = true);
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    // The submitted card replaces the form outright. The LOCKED card does
    // not — see [_submitted].
    if (_submitted) return _thanks(theme);

    final String? previousComment = widget.existing?.comment?.trim();

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Semantics(
            header: true,
            child: Text(
              _locked ? 'Your rating' : 'How was your support experience?',
              style: theme.textTheme.titleMedium,
            ),
          ),
          const SizedBox(height: 12),
          _scale(theme),
          // Fixed height so the card does not jump the moment a rating is
          // picked — the same reason the React original reserves `h-4` here.
          SizedBox(
            height: 20,
            child: Text(
              _score == 0 ? '' : _labels[_score - 1],
              style: theme.textTheme.bodySmall,
            ),
          ),
          // The comment they left LAST time, as text rather than in a box: a
          // filled-in text field reads as something still being edited, which
          // is the opposite of what a locked card is saying.
          if (_locked && previousComment != null && previousComment.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(previousComment, style: theme.textTheme.bodyMedium),
            ),
          // Never in the locked card. This row carries the submit button, and
          // a rated session must have no way to send a second rating at all.
          if (!_locked && _score > 0) _commentRow(),
          // The same acknowledgement a just-submitted rating gets, and for the
          // same reason: the customer needs to see that the score on screen is
          // one the server holds, not one they are being asked for again.
          // Shown ALONGSIDE the locked scale rather than instead of it.
          if (_locked) _thanks(theme),
        ],
      ),
    );
  }

  Widget _scale(ThemeData theme) {
    return Semantics(
      container: true,
      explicitChildNodes: true,
      // Flutter has no `aria-readonly` for a group. The per-option
      // `enabled: false` below is the honest analogue: it says the same thing
      // to a user who lands on one, and — unlike a truly disabled control —
      // leaves the score itself readable, which is the whole point of this
      // card.
      label: _locked ? 'Your rating' : 'How was your support experience?',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          for (int index = 0; index < kCsatMaxScore; index += 1)
            _option(theme, index),
        ],
      ),
    );
  }

  Widget _option(ThemeData theme, int index) {
    final int value = index + 1;
    final bool lit = _isLit(value);
    final String glyph = widget.style == CsatStyle.emoji
        ? _faces[index]
        : (lit ? _starFilled : _starEmpty);

    return Semantics(
      key: csatOptionKey(value),
      // Five mutually exclusive answers to one question — precisely what a
      // radio group is. The React original used buttons with `aria-pressed`,
      // which tells a screen reader these are five independent toggles.
      inMutuallyExclusiveGroup: true,
      checked: value == _score,
      enabled: !_locked,
      button: !_locked,
      label: '$value of $kCsatMaxScore — ${_labels[index]}',
      child: Focus(
        focusNode: _options[index],
        // Roving tab order, the port of the reference's roving `tabindex`:
        // Tab reaches the scale once and lands on the current answer, then
        // the arrows move within it.
        skipTraversal: !(value == _score || (_score == 0 && index == 0)),
        onKeyEvent: (FocusNode node, KeyEvent event) => _onKey(index, event),
        child: GestureDetector(
          onTap: _locked ? null : () => _choose(value),
          behavior: HitTestBehavior.opaque,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: ExcludeSemantics(
              child: Text(
                glyph,
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: lit ? theme.colorScheme.primary : null,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _commentRow() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        const SizedBox(height: 12),
        TextField(
          controller: _comment,
          maxLines: 2,
          decoration: const InputDecoration(
            labelText: 'Tell us more',
            hintText: 'Tell us more (optional)',
            border: OutlineInputBorder(),
          ),
        ),
        FormStatusLine(controller: _submit),
        const SizedBox(height: 12),
        FormSubmitButton(
          controller: _submit,
          // `submitOnce` owns every outcome — it never rethrows — so there
          // is nothing here to await or catch.
          onPressed: () => unawaited(_run()),
        ),
      ],
    );
  }

  Widget _thanks(ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Semantics(
        liveRegion: true,
        child: Text(
          'Thanks for your feedback!',
          style: theme.textTheme.bodyMedium,
        ),
      ),
    );
  }
}
