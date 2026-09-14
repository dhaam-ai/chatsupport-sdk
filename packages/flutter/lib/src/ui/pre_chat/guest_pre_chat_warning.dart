/// The debug-only line a host reads when this widget is about to ask a
/// visitor it considers a GUEST for their details.
///
/// ── The report this exists for ─────────────────────────────────────────
///
/// "My signed-in customer is being asked to type their name in", twice, from
/// two different integrators. Both had authenticated the customer, both
/// passed a real customer token, and both were treated as guests —
/// correctly, by the rule `chat_identity.dart` states at length: a guest is a
/// visitor whose `ChatIdentity.profile` is ABSENT. The token cannot be the
/// discriminator (this package cannot read it, by design, and a guest session
/// carries one too) and `userId` cannot be either (chat-service mints one for
/// every visitor). So a host that authenticates perfectly and omits `profile`
/// gets a guest, and — until this — got one SILENTLY.
///
/// ── Why it lives here and not on the Cubit ────────────────────────────
///
/// Its first home was `ChatWidgetCubit.emit`, keyed on `PreChatSurface` being
/// in the slot. `emit` really is the single funnel every surface change
/// passes through, so the mechanism was sound — but the KEY was wrong, and
/// wrong in a way that hid the commonest report. `pre_chat_fields.dart` names
/// three surfaces that ask these questions, and two of them can never raise
/// `PreChatSurface` at all:
///
///  * while a `ComposingNewSurface` holds the slot, `resolveProductSurface`
///    returns `current` under the non-preemption rule, so the standalone gate
///    cannot be raised behind it — and `NewConversationView` folds the same
///    fields in above its message box. From Home, `startNewConversation()` is
///    the only route into a chat, so this is the path a host most often
///    meets;
///  * `shouldCollectOffline` returns `OfflineSurface` from the top of the
///    precedence ladder, so the gate cannot be raised out of hours — and
///    `OfflineFormView` draws the same fields as `extraFields`.
///
/// So the trigger is not a surface at all now. It is
/// [preChatFieldsToAsk] returning something to ask, which is the one fact all
/// three surfaces share and the only thing that can put these questions on a
/// screen. A fourth surface inherits the warning by calling the same
/// function, which is the only way it can draw the fields in the first place.
///
/// ── Why not at construction ───────────────────────────────────────────
///
/// A guest-only deployment is an ordinary deployment. Warning every host that
/// builds a Cubit with the default identity would print a paragraph on every
/// launch of an app that has nothing to fix, and a warning that cries wolf on
/// every launch is the one nobody reads on the day it matters. This fires at
/// the moment the consequence becomes visible instead — a merchant who never
/// switched pre-chat on never reaches it and never hears from this at all.
///
/// ── What it must never carry ──────────────────────────────────────────
///
/// No token, no prefix of one, not even its length — `cognito-verifier.ts` in
/// the backend spells out why a prefix alone is enough to correlate a
/// credential — and no profile contents. There is nothing to redact here
/// because nothing identifying is read: the message is a `const` with no
/// interpolation in it, the condition is a list being non-empty, and the
/// token is not something this library can see in the first place. The same
/// rule `voice_recorder.dart` states for audio.
///
/// Not exported from `pre_chat.dart`, and deliberately: this is a diagnostic
/// the package prints, not a control a host calls. The only thing outside
/// this file that touches it is `preChatFieldsToAsk`, plus the package's own
/// tests reaching in for [debugResetGuestPreChatWarning].
library;

import 'package:flutter/foundation.dart';

/// What a host reads in its debug console, verbatim.
///
/// A constant, and deliberately nothing but a constant — no interpolation, so
/// there is no expression here that could be widened later into one that
/// reads the visitor.
const String kGuestPreChatWarning = '''
dhaam_chat_flutter: about to show the pre-chat form, because this visitor is
being treated as a GUEST. If you believe this customer is signed in, the widget
disagrees, and here is why:

  * `identity.profile` is what makes a visitor identified, and it is the ONLY
    thing that does. Pass one where you build the Cubit —
    `ChatWidgetCubit(identity: ChatIdentity(userId: ..., profile:
    ChatParticipantProfile(name: ..., email: ...)))` — and the form stops
    asking. An empty `ChatParticipantProfile()` is enough if that is all you
    know; presence is the fact, not the fields inside it.
  * `identity.userId` alone does NOT identify anybody. Every anonymous visitor
    is issued one too, so a widget gating on it would ask nobody.
  * A customer token does not identify anybody either. Guest sessions need a
    token as well, and this package cannot read what is inside one, so holding
    a valid token tells the widget nothing about who is holding it.

If this visitor really is a guest, nothing is wrong and you can ignore this.
Printed once per app run, in debug builds only — not in profile, not in
release.''';

/// Whether [warnIfAskingAGuestForDetails] has already said its piece.
///
/// ── Once per app run, not once per Cubit ──────────────────────────────
///
/// The latch used to live on the Cubit, because the trigger did. The trigger
/// is now a top-level function with no instance to hang anything off, so the
/// scope widened — and widening it is the right answer anyway, not a
/// consolation. Three surfaces can each ask, a host can rebuild its
/// `BlocProvider`, and every repaint of two of those surfaces re-runs the
/// gate; scoping the latch per Cubit would have printed the same paragraph
/// once for each, and a paragraph printed four times is a paragraph nobody
/// finishes reading. One line per run says the same thing once.
bool _warned = false;

/// Says, once, that the widget is about to ask a guest for their details.
///
/// Call only when the answer really is "ask them" — [preChatFieldsToAsk] is
/// the only caller, and it calls this only for a NON-EMPTY answer.
///
/// Through [debugPrint] rather than `FlutterError.reportError`: this is
/// advice, not a fault. Reporting it as an error would fail the widget tests
/// of every host with a legitimate guest-only deployment and would put a
/// non-error into whatever crash reporter they wired `FlutterError.onError`
/// to.
///
/// The latch is set BEFORE the print, so a host that has replaced
/// `debugPrint` with something that throws gets at most one attempt rather
/// than one per repaint. The throw itself is not caught: swallowing it would
/// hide a fault in the host's own logging, and every `debugPrint` the Flutter
/// framework itself makes is unguarded for the same reason.
void warnIfAskingAGuestForDetails() {
  if (!kDebugMode) return;
  if (_warned) return;
  _warned = true;
  debugPrint(kGuestPreChatWarning);
}

/// Re-arms the latch so the next ask prints again.
///
/// For the package's own tests, which assert this warning several times in
/// one file and therefore in one isolate. Nothing in `lib/` calls it, and it
/// is not reachable from the public barrel.
@visibleForTesting
void debugResetGuestPreChatWarning() {
  _warned = false;
}
