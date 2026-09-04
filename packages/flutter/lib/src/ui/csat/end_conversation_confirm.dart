/// "End this conversation?" — the confirmation that stands in for the
/// transcript while the customer decides.
///
/// A port of `packages/widget/src/ui/end-conversation.ts`.
///
/// ── Why this is a widget and not a platform confirm ─────────────────────
///
/// The ⋯ menu's "End conversation" used to ask through the browser's own
/// `confirm()` — the HOST PAGE's modal, in the browser's chrome, unstyleable,
/// and suppressed outright by some embedded browsers. On the one page the
/// widget is meant to disappear into, the one dialog it ever raised looked
/// like it belonged to somebody else.
///
/// The Flutter counterpart of that mistake is not `showDialog` (which is
/// already the app's own tree) — it is reaching for a native/OS alert. This
/// asks the question in the same surface slot every other form uses
/// (`ConfirmEndSurface`), so it is drawn by this package, in this package's
/// theme, and it cannot be suppressed by anything outside it.
///
/// ── Two buttons, one destructive, and the safe one holds focus ──────────
///
/// The destructive action is the [FormSubmitButton], so it inherits the
/// busy/failure contract every other commit action has: a close that rejects
/// re-enables the button and says so, rather than leaving "Ending…" up
/// forever. "Keep chatting" is the safe way out and is where focus lands — a
/// keyboard user who arrived by mistake should have to MOVE to destroy
/// something, not to keep it.
///
/// ── Why "Keep chatting" is disabled during the flight too ───────────────
///
/// A cancel landing while the close is in flight would tear this surface down
/// under a request whose outcome — success, or the failure line — still has
/// to land somewhere. Both controls read the one [FormSubmitController], so
/// they cannot disagree about whether a close is running. That shared flag is
/// the reason `isBusy` is public on a `ChangeNotifier` at all.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../forms/forms.dart';

/// The confirmation surface. What happens AFTER "End conversation" — the
/// rating card for a thread that had messages, the ended footer for one that
/// did not — is the same path an agent-side close already takes and is not
/// this widget's business. It asks the question and reports the answer.
class EndConversationConfirm extends StatefulWidget {
  const EndConversationConfirm({
    super.key,
    required this.onConfirm,
    required this.onCancel,
    required this.onError,
  });

  /// Ends the conversation. Rejecting keeps this surface up with a plain
  /// sentence and both controls live again.
  final Future<void> Function() onConfirm;

  /// The customer changed their mind.
  final VoidCallback onCancel;

  /// Where an [onConfirm] rejection goes — never onto the screen verbatim.
  final FormErrorReporter onError;

  @override
  State<EndConversationConfirm> createState() => _EndConversationConfirmState();
}

class _EndConversationConfirmState extends State<EndConversationConfirm> {
  late final FormSubmitController _submit;

  @override
  void initState() {
    super.initState();
    _submit = FormSubmitController(
      label: 'End conversation',
      busyLabel: 'Ending…',
    );
  }

  @override
  void dispose() {
    _submit.dispose();
    super.dispose();
  }

  Future<void> _run() => _submit.submitOnce(
        run: widget.onConfirm,
        failureMessage: "We couldn't end this conversation. Please try again.",
        onError: widget.onError,
      );

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Semantics(
      container: true,
      label: 'End this conversation?',
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Semantics(
              header: true,
              child: Text(
                'End this conversation?',
                style: theme.textTheme.titleMedium,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'You can always start a new one from Home or Messages.',
              style: theme.textTheme.bodyMedium,
            ),
            FormStatusLine(controller: _submit),
            const SizedBox(height: 16),
            FormSubmitButton(
              controller: _submit,
              // `submitOnce` owns every outcome and never rethrows.
              onPressed: () => unawaited(_run()),
              // Layered on the shared submit treatment rather than replacing
              // it: the button keeps the size and busy behaviour every other
              // commit action has, and only its colour says "this one
              // destroys something".
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
                backgroundColor: theme.colorScheme.error,
                foregroundColor: theme.colorScheme.onError,
              ),
            ),
            const SizedBox(height: 8),
            ListenableBuilder(
              listenable: _submit,
              builder: (BuildContext context, Widget? child) {
                return TextButton(
                  // Focus lands here, not on the destructive button — see the
                  // library header. `autofocus` is Flutter's answer to the
                  // reference's imperative `view.focus()`: the same fact,
                  // declared where the control is rather than remembered by
                  // whoever mounts it.
                  autofocus: true,
                  // Disabled for the span of the request too. See the header.
                  onPressed: _submit.isBusy ? null : widget.onCancel,
                  style: TextButton.styleFrom(
                    minimumSize: const Size.fromHeight(44),
                  ),
                  child: const Text('Keep chatting'),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
