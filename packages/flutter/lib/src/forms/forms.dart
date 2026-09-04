/// The form substrate shared by every data-collecting surface in the widget.
///
/// Seven surfaces are built on this: the pre-chat form, the out-of-hours
/// offline form, the CSAT survey, report-issue, new-conversation,
/// end-conversation and the ended-conversation footer. Two of those seven
/// (end-conversation, ended-footer) have no fields at all and use only the
/// submit half — which is why this module is split across two files rather
/// than one, and why `form_submit.dart` does not depend on having any fields
/// to submit.
///
/// ── The bug this module exists to make unrepeatable ──────────────────────
///
/// All three React originals are written as:
///
///     setBusy(true); await onSubmit(); setBusy(false);
///
/// with no `try`/`finally` and no rejection branch. A failed submit therefore
/// leaves the button disabled and reading "Sending…" forever, with the
/// customer's typed message still on screen and no way to send it. A network
/// blip becomes a dead form: the one state where the customer has already
/// done all the work is also the one state the form cannot recover from.
/// [FormSubmitController.submitOnce] is the single place that is fixed, and
/// every one of the seven surfaces goes through it.
///
/// ── Why the fix has to live behind an interface, not in a comment ────────
///
/// "Remember to use try/finally" is the instruction that produced the bug
/// three times. The re-enable is therefore not something a surface can
/// forget: it is in a `finally` inside the only method that runs a submit,
/// and a surface that wants a busy button gets that method with it.
///
/// ── Why a controller rather than seven `setState` calls ─────────────────
///
/// Busy-ness is not private to the button. The end-conversation dialog
/// disables its "Keep chatting" button during the flight too — a cancel
/// landing mid-request would tear the surface down under an outcome that
/// still has to land somewhere — so a second control has to be able to read
/// the same flag. A `ChangeNotifier` is the smallest thing that lets two
/// widgets rebuild from one submit's state.
///
/// It also keeps the `await` away from `BuildContext` entirely: no surface
/// needs to hold a context across the submit, so none of the seven has to
/// reason about `use_build_context_synchronously`.
///
/// ── Parity note ──────────────────────────────────────────────────────────
///
/// Ported from `packages/widget/src/ui/forms.ts`. Behaviour is kept in step
/// with it; DOM idioms are not. Where the web original reaches for
/// `<label for>`, `role="alert"` and `inputmode`, this reaches for
/// `InputDecoration.labelText`, `Semantics(liveRegion:)` and `TextInputType`
/// — the same three facts, obtained the way the framework already provides.
library;

export 'form_fields.dart';
export 'form_submit.dart';
