/// The rule that decides whether a suggestion chip may send, and the seam a
/// chip reaches the composer through.
///
/// Ports the `submit(text)` half of `packages/widget/src/ui/composer.ts`
/// (`:593-608`), whose own doc names the bug this file exists to prevent.
///
/// ── The bug: "Send is disabled" and "the box is empty" are one state ─────
///
/// The send control is disabled whenever the draft is blank. A suggestion
/// chip is tapped INSTEAD of typing, so the box is empty at exactly the
/// moment a chip is used — which means gating the chip path on the send
/// control's disabled state refuses every suggestion ever offered, silently.
/// That is why [chipSubmitRefusal] takes the four facts it actually needs and
/// is not handed the send button's state at all: there is no parameter here
/// that could carry it.
///
/// ── Why a chip goes through the composer rather than round it ────────────
///
/// The alternative — a chip calling the client's send directly — is shorter
/// and wrong. `enabled` is how the consent gate holds the composer shut, so a
/// chip with its own path is a way around consent: a visitor who has not
/// agreed taps "Check my order" and a record is created anyway. Routing every
/// send through one place is what makes the gate a gate.
library;

/// Why a suggestion was refused, or `null` when it may send.
///
/// Exactly four values, and that count is asserted by this module's tests:
/// three states of the composer plus the suggestion being blank. Adding a
/// fifth means widening the contract deliberately rather than by drift.
enum ChipSubmitRefusal {
  /// The composer is disabled — the consent gate, or a closed session.
  composerDisabled,

  /// An attachment is mid-upload. The send that follows would race it.
  uploadInFlight,

  /// The customer has words in the box. Replacing a half-typed message with
  /// a suggestion destroys the customer's own writing; an empty box is the
  /// NORMAL case for a chip, not a refusal.
  draftPresent,

  /// The suggestion itself is blank or whitespace.
  blankSuggestion,
}

/// The one decision. Pure — no widget, no controller, no send button.
///
/// [draft] is the raw contents of the message box; it is trimmed here, so a
/// box holding only spaces counts as empty and a chip still sends. The order
/// of the checks is `composer.ts`'s own, so the reason reported for a
/// composer that is both disabled and uploading matches the reference.
ChipSubmitRefusal? chipSubmitRefusal({
  required String suggestion,
  required String draft,
  required bool enabled,
  required bool uploading,
}) {
  if (!enabled) return ChipSubmitRefusal.composerDisabled;
  if (uploading) return ChipSubmitRefusal.uploadInFlight;
  if (draft.trim().isNotEmpty) return ChipSubmitRefusal.draftPresent;
  if (suggestion.trim().isEmpty) return ChipSubmitRefusal.blankSuggestion;
  return null;
}

/// The handle a caller outside the composer — a suggestion chip, a bot's
/// quick reply — sends through.
///
/// Deliberately tiny: one method, and it is the SAME submit a typed message
/// takes, so a suggestion inherits every rule typing is subject to. The
/// composer registers its own submit here on mount and withdraws it on
/// dispose; nothing else may.
///
/// Modelled on `TextEditingController`/`ScrollController`: the host builds one
/// and hands it to the composer, then holds it for the life of the screen.
class ComposerController {
  ComposerController();

  ChipSubmitRefusal? Function(String text)? _submit;

  /// Whether a composer is currently mounted behind this controller.
  bool get isAttached => _submit != null;

  /// Called by the composer itself on mount. The most recent attach wins.
  ///
  /// Deliberately not `assert(_submit == null)`. Flutter mounts a replacement
  /// widget's state before it disposes the one it replaced, so a legitimate
  /// swap — the composer rebuilding under a new key, a screen replacing its
  /// own subtree — has two states alive for part of a frame. Asserting there
  /// would crash a correct rebuild in debug while doing nothing in release,
  /// which is the worst of both. "Last attach wins" is also the right answer
  /// for a swap: the composer now on screen is the one a chip should fill.
  void attach(ChipSubmitRefusal? Function(String text) submit) {
    _submit = submit;
  }

  /// Called by the composer on dispose.
  ///
  /// Identity-checked, which is the other half of the swap: a stale composer
  /// disposing AFTER its replacement attached must not tear the live one's
  /// seam out from under it. Idempotent.
  void detach(ChipSubmitRefusal? Function(String text) submit) {
    if (identical(_submit, submit)) _submit = null;
  }

  /// Sends [text] as though the customer had typed and submitted it.
  ///
  /// Returns the reason it was refused, or `null` when it was sent. Callers
  /// may ignore the result — a chip that does nothing visible is the correct
  /// outcome of every refusal here — but returning it is what lets the rule
  /// be asserted from outside instead of inferred from a silence.
  ///
  /// With no composer mounted the answer is
  /// [ChipSubmitRefusal.composerDisabled]: there is no box to send from,
  /// which is a stronger form of the same fact.
  ///
  /// Written as an explicit null check rather than
  /// `_submit?.call(text) ?? composerDisabled`, which reads the same and is
  /// wrong: `null` is also what a SUCCESSFUL send returns, so the `??` would
  /// report every accepted suggestion as a refusal.
  ChipSubmitRefusal? submit(String text) {
    final ChipSubmitRefusal? Function(String text)? submitToComposer = _submit;
    if (submitToComposer == null) return ChipSubmitRefusal.composerDisabled;
    return submitToComposer(text);
  }
}
