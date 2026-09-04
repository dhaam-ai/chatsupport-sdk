/// The standalone pre-chat gate — the surface `PreChatSurface` names.
///
/// A port of `packages/widget/src/ui/pre-chat-form.ts`.
///
/// ── When this is on screen, and when it is not ─────────────────────────
///
/// Never at mount. `resolveProductSurface` puts this up only in front of a
/// conversation the customer actually OPENED whose transcript is empty — see
/// `SurfaceSyncInputs.conversationOpened` for why "a session exists" is the
/// wrong question and what gating on it did.
///
/// It is also not the only place these questions get asked: a customer who
/// starts a conversation from the new-conversation form meets them folded
/// into that form instead, and one who taps a Common Question skips them
/// entirely. This widget is the third case — an empty conversation the
/// customer arrived at some other way.
///
/// ── Skip exists only when nothing is required ─────────────────────────
///
/// A form where every question is optional and there is no way past it is a
/// form that asks for nothing and blocks everything. Where the merchant made
/// something required, there is deliberately no Skip: they asked for it, and
/// an escape hatch next to a required field is the merchant's setting
/// quietly overruled.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../forms/forms.dart';
import 'pre_chat_form.dart';

/// The heading, when the caller supplies none.
///
/// The reference took the merchant's greeting here and deliberately stopped:
/// the greeting has its own surface, and borrowing it made this form open
/// with a welcome the customer had already been given.
const String kPreChatHeading = 'Before we start';

/// What the customer sees when the submit itself fails.
///
/// A plain sentence. The error object goes to `onError` — it carries a stack
/// and possibly a URL, and neither belongs in front of a customer. That
/// split is [FormSubmitController.submitOnce]'s, not restated here.
const String kPreChatFailure = 'We could not start the chat. Please try again.';

class PreChatGate extends StatefulWidget {
  const PreChatGate({
    super.key,
    required this.fields,
    required this.onSubmit,
    required this.onSkip,
    required this.onError,
    this.heading = kPreChatHeading,
  });

  /// The questions to ask — [preChatFieldsToAsk]'s answer, and never
  /// `config.preChatFields` read directly.
  final List<FieldSpec> fields;

  /// The customer answered. Receives the answers with blanks omitted; may be
  /// an EMPTY map when every optional question was left blank, which is a
  /// real answer and not the same as never having been asked.
  final Future<void> Function(Map<String, String> answers) onSubmit;

  /// The customer declined. Counts as answered — the gate does not return.
  final VoidCallback onSkip;

  /// Where a failed submit's error object goes.
  final FormErrorReporter onError;

  final String heading;

  @override
  State<PreChatGate> createState() => _PreChatGateState();
}

class _PreChatGateState extends State<PreChatGate> {
  late final PreChatFieldSet _fields = PreChatFieldSet(widget.fields);
  late final FormSubmitController _submit = FormSubmitController(
    label: 'Start chat',
    busyLabel: 'Starting…',
  );

  /// Whether the merchant made anything mandatory — the one input to whether
  /// Skip exists. Read from the specs rather than from what is currently
  /// typed: it is a property of the merchant's form, not of this attempt.
  bool get _anyRequired =>
      widget.fields.any((FieldSpec spec) => spec.isRequired);

  @override
  void dispose() {
    _fields.dispose();
    _submit.dispose();
    super.dispose();
  }

  Future<void> _run() async {
    // Names the missing field and moves focus to it. See
    // `FormSubmitController.requireAll` on why both, and why the message
    // never says "the fields above".
    if (!_submit.requireAll(_fields.views)) return;
    // Non-null by construction: this surface exists only when there are
    // questions, so `preChatAnswersFor` cannot report "never asked" here.
    final Map<String, String> answers =
        _fields.answers ?? const <String, String>{};
    await _submit.submitOnce(
      run: () => widget.onSubmit(answers),
      failureMessage: kPreChatFailure,
      onError: widget.onError,
    );
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(widget.heading, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          PreChatFieldsBlock(fields: _fields),
          const SizedBox(height: 8),
          FormStatusLine(controller: _submit),
          const SizedBox(height: 12),
          // `unawaited` rather than a bare call: the controller already owns
          // the busy state, the failure sentence and the re-enable, so there
          // is nothing left for the button to await — said out loud so
          // `unawaited_futures` stays meaningful everywhere else.
          FormSubmitButton(
            controller: _submit,
            onPressed: () => unawaited(_run()),
          ),
          if (!_anyRequired) ...<Widget>[
            const SizedBox(height: 4),
            TextButton(
              onPressed: widget.onSkip,
              child: const Text('Skip for now'),
            ),
          ],
        ],
      ),
    );
  }
}
