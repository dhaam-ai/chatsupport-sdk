/// The ONE place `preChatFields` is gated, and the ONE place the answers map
/// distinguishes "never asked" from "asked and skipped".
///
/// ── Three surfaces, one gate ───────────────────────────────────────────
///
/// The merchant's pre-chat questions appear in three places, and the bug
/// this module exists to prevent is them appearing in only some of them:
///
///  * the standalone gate (`PreChatSurface`), in front of an empty
///    conversation the customer opened;
///  * the new-conversation form, where they are folded in ABOVE the message
///    box rather than shown as a separate step;
///  * the out-of-hours offline form, for the same reason — a visitor who
///    arrives after closing time is still a visitor the merchant wanted
///    details from.
///
/// All three call [preChatFieldsToAsk] and none of them decides anything for
/// itself. A fourth surface added later gets the same answer by calling the
/// same function, and gets it wrong only by not calling it.
///
/// ── What this function does NOT decide ────────────────────────────────
///
/// It does not decide whether the visitor is a guest. [preChatFieldsToAsk]
/// takes `isGuest` as a parameter and never computes it — see
/// `chat_identity.dart` for the single derivation and for what happened when
/// there were two. Same discipline `SurfaceSyncInputs` states for every one
/// of its own fields.
///
/// It also does not decide whether the standalone SURFACE should be up: that
/// is `resolveProductSurface`'s precedence ladder, which additionally weighs
/// the offline gate, non-preemption, an in-flight opening line and an empty
/// transcript. This function answers the narrower question every surface has
/// once it is already on screen — "which fields do I draw?" — and answers it
/// with an empty list when the answer is "none".
library;

import '../../config/remote_config.dart';
import '../../forms/forms.dart';

/// The pre-chat questions to put in front of this visitor, or an empty list.
///
/// Empty means "ask nothing here" and callers must render no field block at
/// all for it — not an empty bordered box, and not a heading with nothing
/// under it. A toggle switched on with no fields behind it is the console
/// state that raised an empty form the first time round.
///
/// The four conditions, and why each is separate:
///
///  * **[isGuest]** — the merchant asked for details they do not already
///    have. A host that vouched for this customer has already supplied them,
///    and asking anyway is asking a signed-in customer to type their own
///    email address back.
///  * **[RemoteConfig.preChatEnabled]** — the merchant's toggle.
///  * **[RemoteConfig.preChatFields] non-empty** — a separate console
///    control from the toggle, and the reason it is checked separately: the
///    two can disagree, and gating on the toggle alone put an empty form on
///    screen.
///  * **[alreadyAnswered]** — asked once per conversation, not once per
///    repaint. Every rebuild of these surfaces re-runs this function, so
///    without it the form returns the instant it is dismissed.
List<FieldSpec> preChatFieldsToAsk({
  required RemoteConfig config,
  required bool isGuest,
  required bool alreadyAnswered,
}) {
  if (!isGuest) return const <FieldSpec>[];
  if (!config.preChatEnabled) return const <FieldSpec>[];
  if (alreadyAnswered) return const <FieldSpec>[];
  return config.preChatFields.map(toFieldSpec).toList(growable: false);
}

/// Translates one wire-shaped [PreChatField] into the form substrate's
/// [FieldSpec].
///
/// Two vocabularies for one thing, deliberately: `PreChatField` is what the
/// console publishes and `FieldSpec` is what all seven form surfaces render,
/// only three of which have anything to do with pre-chat. This is the seam
/// between them and it is the only place the two names meet.
///
/// The switch over [PreChatFieldType] is exhaustive by construction — a
/// fourth type arriving on the wire is a compile error here rather than a
/// silent fall-through to a plain text box, which is the same rule
/// `FieldKind`'s own doc states for itself.
FieldSpec toFieldSpec(PreChatField field) => FieldSpec(
      id: field.id,
      label: field.label,
      type: switch (field.type) {
        PreChatFieldType.text => FieldKind.text,
        PreChatFieldType.email => FieldKind.email,
        PreChatFieldType.phone => FieldKind.phone,
      },
      isRequired: field.required,
    );

/// The answers to report for a submit on which [shown] fields were drawn.
///
/// ── Absent and empty are different answers ────────────────────────────
///
/// `null` means the customer was never asked — no fields showed, because the
/// merchant configured none, or the toggle was off, or this visitor is not a
/// guest. An empty map means they WERE asked and left every (optional)
/// question blank.
///
/// An agent picking up the conversation reads those as different things:
/// absent says "this merchant does not collect details", empty says "this
/// customer declined to give them". Collapsing the two — which is what
/// happens the moment anything writes `?? {}` over this — turns the first
/// into the second and quietly blames the customer for the merchant's
/// configuration.
///
/// The blank-omission inside a non-null map is [collectAnswers]' rule, not a
/// second one: an unanswered optional is absent from the map rather than
/// present as `''`, for the same reason at one level down.
Map<String, String>? preChatAnswersFor(Iterable<FieldView> shown) {
  final List<FieldView> fields = shown.toList(growable: false);
  if (fields.isEmpty) return null;
  return collectAnswers(fields);
}
