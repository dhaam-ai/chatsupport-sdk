/// The pre-chat question block itself — the part that is IDENTICAL on all
/// three surfaces that ask these questions — and the message the answers
/// become.
///
/// ── Why a block rather than three forms ────────────────────────────────
///
/// The standalone gate asks these questions on their own. The
/// new-conversation form folds them in ABOVE its message box, under its own
/// heading, with its own submit. The out-of-hours offline form does the same
/// alongside its two built-in reply-channel fields. Only the first is a form
/// in its own right; the other two are surfaces that happen to contain these
/// questions.
///
/// So what is shared is a BLOCK of fields and the lifetime that goes with
/// them, not a form. [PreChatFieldSet] owns the lifetime,
/// [PreChatFieldsBlock] draws them, and each surface keeps its own heading,
/// submit and validation order.
library;

import 'package:flutter/material.dart';

import '../../forms/forms.dart';
import 'pre_chat_fields.dart';

/// The subtitle that sits under a surface's heading whenever these questions
/// are being asked.
///
/// One constant because two surfaces show it and a third will: the gate
/// always (it exists only when there are questions), the new-conversation
/// form only when fields were folded in, and the offline form likewise. In
/// the reference the new-conversation copy of it is a node that is always
/// built and conditionally `hidden`; here [PreChatFieldsBlock] simply
/// renders nothing when there is nothing to introduce, which is the same
/// outcome without a hidden node to forget to hide.
const String kPreChatSubtitle = 'A few details so we can help you faster.';

/// The live state of one run of pre-chat questions.
///
/// Owns a [FieldView] per question, and therefore owns a lifetime — a
/// [TextEditingController] and a [FocusNode] each. Every surface that builds
/// one must [dispose] it, exactly as it would for controllers it created
/// itself.
///
/// Built from [preChatFieldsToAsk]'s answer, never from `config.preChatFields`
/// directly: that function is where the guest check and the merchant's two
/// console controls are weighed, and a surface reaching past it to the raw
/// list is a second gate with a second set of bugs.
class PreChatFieldSet {
  PreChatFieldSet(List<FieldSpec> specs)
      : views = specs.map(FieldView.new).toList(growable: false);

  /// No questions — what a signed-in visitor, an unconfigured merchant or an
  /// already-answered gate all produce. Cheap to build and safe to dispose.
  PreChatFieldSet.none() : views = const <FieldView>[];

  final List<FieldView> views;

  bool get isEmpty => views.isEmpty;
  bool get isNotEmpty => views.isNotEmpty;

  /// The answers to report, or null when nothing was asked.
  ///
  /// Delegates to [preChatAnswersFor] rather than restating its rule, so the
  /// absent-vs-empty distinction has exactly one implementation.
  Map<String, String>? get answers => preChatAnswersFor(views);

  void dispose() {
    for (final FieldView view in views) {
      view.dispose();
    }
  }
}

/// Draws a [PreChatFieldSet], or nothing at all when it is empty.
///
/// Rendering NOTHING for an empty set is the load-bearing half: a surface can
/// place this unconditionally and get the right answer for a signed-in
/// visitor, a merchant who configured no questions, and a customer who
/// already answered — without three `if`s of its own, which is three places
/// to get the gate wrong.
class PreChatFieldsBlock extends StatelessWidget {
  const PreChatFieldsBlock({super.key, required this.fields});

  final PreChatFieldSet fields;

  @override
  Widget build(BuildContext context) {
    if (fields.isEmpty) return const SizedBox.shrink();

    final List<FieldView> views = fields.views;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          kPreChatSubtitle,
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 12),
        for (int i = 0; i < views.length; i++) ...<Widget>[
          if (i > 0) const SizedBox(height: 12),
          FormFieldInput(
            field: views[i],
            // "Next" through the run and "done" on the last one, so a
            // customer working down the block with the on-screen keyboard is
            // not sent back to hunt for the next box.
            textInputAction: i == views.length - 1
                ? TextInputAction.done
                : TextInputAction.next,
          ),
        ],
      ],
    );
  }
}

/// The opening message the pre-chat answers become, or null when there is
/// nothing to say.
///
/// ── The answers are CONTENT, not identity ─────────────────────────────
///
/// They are sent as a message, never assembled into a profile and never
/// upserted through `POST /identify`: a guest has asserted nothing, and a
/// name typed into a form is a claim about this conversation rather than a
/// verified fact about a person. chat-service consumes it into a
/// customer-asserted contact on its own terms.
///
/// ── Ordered by the CONFIG, not by the answers ─────────────────────────
///
/// Iterates [fields] and looks each one up, rather than walking [answers].
/// The map's order is insertion order, which is the order the customer
/// happened to fill boxes in; the merchant chose the order of their form and
/// an agent reads the result. Skipping the map's own order is what keeps the
/// two the same.
///
/// Returns null — not an empty string — when every answer was blank, so the
/// caller sends no message at all rather than an empty one. That is the
/// `preChatAnswers == {}` path: the customer was asked and declined, which
/// still counts as answered but has nothing to relay.
String? preChatDetailsMessage({
  required List<FieldSpec> fields,
  required Map<String, String> answers,
}) {
  final List<String> lines = <String>[
    for (final FieldSpec field in fields)
      if (answers[field.id] case final String value) '${field.label}: $value',
  ];
  if (lines.isEmpty) return null;
  return lines.join('\n');
}
