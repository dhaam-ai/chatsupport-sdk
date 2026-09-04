/// The submit half of the shared form substrate: the busy flag, the one
/// status line, and the `finally` that is the entire reason this module
/// exists.
///
/// See `forms.dart` for the full story. The short version: all three React
/// originals wrote `setBusy(true); await onSubmit(); setBusy(false);` with no
/// `try`/`finally`, so a rejected submit left the button disabled and reading
/// "Sending…" forever with the customer's typed text stranded behind it.
/// [FormSubmitController.submitOnce] is the single place that is fixed.
///
/// This file deliberately does not depend on there being any fields to
/// submit — two of the seven surfaces built on it (end-conversation, the
/// ended-conversation footer) have none at all.
library;

import 'package:flutter/material.dart';

import 'form_fields.dart';

/// Where a submit's exception is sent.
///
/// Both halves are passed on: Dart keeps the stack in a separate object, and
/// a host error tracker that receives the error without it gets a string
/// where it needed a trace.
typedef FormErrorReporter = void Function(Object error, StackTrace stackTrace);

/// One form's submit state — whether it is in flight, and the one sentence it
/// is currently telling the customer.
///
/// A [ChangeNotifier] rather than seven surfaces each calling `setState`,
/// because busy-ness is not private to the submit button. The
/// end-conversation dialog disables its "Keep chatting" button during the
/// flight too — a cancel landing mid-request would tear the surface down
/// under an outcome that still has to land somewhere — so a second control
/// has to be able to read the same flag. Wrap any such control in a
/// `ListenableBuilder` on this controller and read [isBusy].
///
/// Owns a lifetime: every caller that constructs one must [dispose] it.
class FormSubmitController extends ChangeNotifier {
  FormSubmitController({required this.label, required this.busyLabel});

  /// The submit control's resting label, e.g. "Start chat".
  final String label;

  /// What the control reads while a submit is in flight, e.g. "Starting…".
  final String busyLabel;

  bool _busy = false;
  String? _status;

  /// True while a submit is in flight. Read by the submit button to disable
  /// itself, and by any sibling control that must not be usable mid-request.
  bool get isBusy => _busy;

  /// The sentence currently shown, or `null` when there is nothing to say.
  ///
  /// Always a plain sentence written for a customer. The exception that
  /// caused it goes to the [FormErrorReporter], never here — see
  /// [submitOnce].
  String? get statusMessage => _status;

  /// What the submit control should read right now.
  String get buttonLabel => _busy ? busyLabel : label;

  /// Guards against `notifyListeners()` after the surface is gone.
  ///
  /// Not paranoia: a submit can still be in flight when its surface is torn
  /// down, and [submitOnce]'s `finally` runs regardless. Without this, the
  /// re-enable that makes this module worth having would itself throw.
  bool _disposed = false;

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  /// Shows [message] to the customer.
  void showStatus(String message) {
    if (_status == message) return;
    _status = message;
    _notify();
  }

  /// Clears the status line.
  void clearStatus() {
    if (_status == null) return;
    _status = null;
    _notify();
  }

  void _setBusy(bool busy) {
    if (_busy == busy) return;
    _busy = busy;
    _notify();
  }

  /// Checks every required field, and if one is empty, says which and focuses
  /// it. Returns whether the caller may proceed.
  ///
  /// The composed form of [firstMissingRequired] that all five field-bearing
  /// surfaces should call, so that "which field, named how, focused when"
  /// is answered once rather than five times. The primitive stays public for
  /// a surface that needs the field for some other reason.
  bool requireAll(Iterable<FieldView> fields) {
    final FieldView? missing = firstMissingRequired(fields);
    if (missing == null) return true;
    showStatus(missingRequiredMessage(missing.spec));
    // Named AND focused. The message alone leaves a screen-reader user
    // hunting for the field it named; the focus alone leaves a sighted user
    // wondering why the cursor moved.
    missing.focus();
    return false;
  }

  /// Runs one submit, guaranteeing the form comes back to life afterwards.
  ///
  /// The `finally` is the entire point — see the library header. On rejection
  /// the customer gets [failureMessage] and their typed input back, and the
  /// error goes to [onError] rather than onto the screen: it carries a stack
  /// and possibly a URL, and neither belongs in front of a customer.
  ///
  /// Returns whether a submit actually completed, so callers advance to a
  /// confirmation state only when there is something to confirm.
  ///
  /// ── Why a re-entrancy guard the web original does not have ─────────────
  ///
  /// There, a second submit is prevented by the button being disabled, and
  /// the button is the only way in. Here the controller is shared with
  /// sibling controls and reachable from a caller that is not a button at
  /// all, so "already in flight" has to be answered by the thing that knows.
  /// The cost of being wrong is not symmetric: `closeSession` is not
  /// idempotent, and a second POST re-emits a "chat closed" system message
  /// and a second event. A re-entrant call returns `false` — nothing
  /// completed on THIS call — and deliberately shows no failure message,
  /// because nothing has failed and the first submit is still running.
  Future<bool> submitOnce({
    required Future<void> Function() run,
    required String failureMessage,
    required FormErrorReporter onError,
  }) async {
    if (_busy) return false;
    _setBusy(true);
    clearStatus();
    try {
      await run();
      return true;
    } catch (error, stackTrace) {
      showStatus(failureMessage);
      onError(error, stackTrace);
      return false;
    } finally {
      _setBusy(false);
    }
  }
}

/// The one status line per form. Silent when there is nothing to say.
///
/// ── Why a live region ──────────────────────────────────────────────────────
///
/// This is the Flutter equivalent of the web original's `role="alert"`: the
/// message appears in response to something the customer just did, while
/// their attention is on the control they pressed rather than on this line.
/// [Semantics.liveRegion] is what makes the platform announce it without
/// stealing focus — which matters, because on the missing-required-field path
/// focus is simultaneously being moved to the field itself.
class FormStatusLine extends StatelessWidget {
  const FormStatusLine({super.key, required this.controller});

  final FormSubmitController controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        final String? message = controller.statusMessage;
        // Nothing rendered at all when silent, rather than an empty box: an
        // empty live region that is present the whole time is a node screen
        // readers may announce on every unrelated rebuild.
        if (message == null) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Semantics(
            liveRegion: true,
            child: Text(
              message,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: Theme.of(context).colorScheme.error),
            ),
          ),
        );
      },
    );
  }
}

/// The submit control, which disables itself and swaps its own label while a
/// submit is in flight.
///
/// The label swap is the visible half of [FormSubmitController.buttonLabel]
/// and the disable is the half that prevents a second submit. Both come from
/// the controller, so a surface cannot render a busy label without also
/// having become un-pressable, or the reverse.
///
/// Flutter has no `aria-busy` counterpart, so the state reaches assistive tech
/// the two ways the framework does offer: the accessible name changes with
/// [FormSubmitController.busyLabel], and the control reports itself disabled.
class FormSubmitButton extends StatelessWidget {
  const FormSubmitButton({
    super.key,
    required this.controller,
    required this.onPressed,
    this.style,
  });

  final FormSubmitController controller;

  /// What to run when pressed. Passing `null` disables the control for a
  /// reason of the caller's own — an empty CSAT rating, say — on top of the
  /// disabling this widget already does while busy.
  final VoidCallback? onPressed;

  /// Lets a surface apply the merchant's corner radius (`chatCornerRadius`)
  /// or a destructive tint without this module having to know about
  /// `RemoteConfig` or about which submits are destructive.
  final ButtonStyle? style;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        return FilledButton(
          onPressed: controller.isBusy ? null : onPressed,
          style: style ??
              FilledButton.styleFrom(minimumSize: const Size.fromHeight(44)),
          child: Text(controller.buttonLabel),
        );
      },
    );
  }
}
