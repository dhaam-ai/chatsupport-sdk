/// The ended-conversation footer — "Reopen conversation" and "New
/// conversation", shown where the composer sits once a session has gone
/// CLOSED/RESOLVED and there is nothing else standing in for it.
///
/// A port of `packages/widget/src/ui/ended-footer.ts`.
///
/// ── The gap this closes ─────────────────────────────────────────────────
///
/// A session ending already raises a rating card — but that is a ONE-TIME
/// surface. The moment it is submitted, or was never due (an empty thread, or
/// a session already rated on an earlier visit), nothing replaced it and the
/// composer was left fully visible and enabled. A terminal session reached
/// any other way — a Messages row, a reload landing back on an old
/// conversation, a rating that just landed — left a customer able to type
/// into a dead thread and watch the send go nowhere.
///
/// ── A SIBLING of the composer, not a fourth product surface ─────────────
///
/// The surfaces in `ProductSurfaceSlot` stand in for the WHOLE conversation —
/// transcript and composer both — because a form and the history behind it
/// are alternatives, never both on screen at once. This is a different
/// situation: the customer is looking at their OWN past conversation and
/// deciding what to do with it, and hiding that transcript to show two
/// buttons would take away the very thing being decided about. So this trades
/// places with the composer alone — the same "one at a time" rule, applied
/// one level lower, at the composer's own seam rather than the whole pane's.
///
/// ── "Reopen" reaches the real backend ───────────────────────────────────
///
/// [EndedFooter.onReopen] is expected to call the real
/// `POST /chat/sessions/{id}/reopen`, never a client-side re-enable. This
/// module knows neither the session id nor the client; the caller owns both,
/// so the callback is where that call lives. What THIS module owns is the
/// request's UX, and it gets that from the shared `submitOnce` substrate
/// rather than writing a fourth, possibly different, copy of "disable the
/// button, clear the error, show one on failure, always come back to life".
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../forms/forms.dart';

/// The two things a customer can do with a conversation that has ended.
class EndedFooter extends StatefulWidget {
  const EndedFooter({
    super.key,
    required this.onReopen,
    required this.onStartNew,
    required this.onError,
  });

  /// "Reopen conversation" was pressed. Expected to call the real
  /// `reopenSession` route — see the library header.
  final Future<void> Function() onReopen;

  /// "New conversation" was pressed. Never built here: this fires the ONE
  /// new-conversation flow every other entry point already funnels through.
  final VoidCallback onStartNew;

  /// A reopen rejection, for the host's own error channel — never shown to
  /// the customer verbatim.
  final FormErrorReporter onError;

  @override
  State<EndedFooter> createState() => _EndedFooterState();
}

class _EndedFooterState extends State<EndedFooter> {
  late final FormSubmitController _submit;

  @override
  void initState() {
    super.initState();
    _submit = FormSubmitController(
      label: 'Reopen conversation',
      busyLabel: 'Reopening…',
    );
  }

  @override
  void dispose() {
    _submit.dispose();
    super.dispose();
  }

  Future<void> _run() => _submit.submitOnce(
        run: widget.onReopen,
        failureMessage:
            'We could not reopen this conversation. Please try again.',
        onError: widget.onError,
      );

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'This conversation has ended',
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            FormStatusLine(controller: _submit),
            const SizedBox(height: 8),
            FormSubmitButton(
              controller: _submit,
              // `submitOnce` owns every outcome and never rethrows.
              onPressed: () => unawaited(_run()),
            ),
            const SizedBox(height: 8),
            ListenableBuilder(
              listenable: _submit,
              builder: (BuildContext context, Widget? child) {
                return TextButton(
                  // The secondary action is disabled for the span of the
                  // request too: a press that starts a brand new conversation
                  // while a reopen of THIS one is still in flight would leave
                  // the in-flight reopen's outcome — success, or a status
                  // line — landing on a footer the customer has already moved
                  // away from.
                  onPressed: _submit.isBusy ? null : widget.onStartNew,
                  style: TextButton.styleFrom(
                    minimumSize: const Size.fromHeight(44),
                  ),
                  child: const Text('New conversation'),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
