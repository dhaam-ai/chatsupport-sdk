/// The surfaces that can stand IN PLACE OF the conversation, and the split
/// that decides which of them a state tick is allowed to replace.
///
/// A port of `packages/widget/src/widget.ts:495-530` — its `SurfaceKind`
/// union and the `USER_INITIATED_SURFACES` set built over it.
///
/// ── Values, not views ──────────────────────────────────────────────────
///
/// The TypeScript `ProductSurface` is a live DOM node with `focus()` and
/// `destroy()`. Here it is a plain immutable VALUE describing what should be
/// on screen; the widgets that render it are downstream. That is what keeps
/// this layer free of `BuildContext` — the slot decides what may be shown,
/// and nothing here knows how to show it.
///
/// ── Why the union is split in two ──────────────────────────────────────
///
/// `widget.ts` carries one flat union plus a runtime set:
///
/// ```ts
/// const USER_INITIATED_SURFACES: ReadonlySet<SurfaceKind> =
///   new Set(['composingNew', 'report', 'confirmEnd']);
/// ```
///
/// The set is the non-preemption rule's whole input, and membership of it is
/// a permanent property of a surface rather than anything that varies at
/// runtime — so here it is a TYPE, [UserInitiatedSurface], and the three
/// members of that TS set are exactly the three subclasses of it. Two things
/// fall out that the set could not give:
///
///  * `ProductSurfaceSlot.open` accepts only a [UserInitiatedSurface], so
///    "a downstream widget raises the pre-chat gate by hand" is a compile
///    error rather than a rule nobody enforces. An automatic surface is
///    derived from state, never opened.
///  * A seventh surface added later cannot silently default to preemptable.
///    It has no parent to extend until somebody chooses one, and choosing is
///    the decision the flat set let you skip.
///
/// ── What identity means here ───────────────────────────────────────────
///
/// `openSurface` is idempotent by `kind` plus an optional `key`, because
/// rebuilding a surface under the customer wipes what they were halfway
/// through typing. Equality here IS that idempotence check: two values are
/// the same slot occupant when they are the same class carrying the same
/// fields. So the fields a subclass declares are precisely `widget.ts`'s
/// `key` and nothing else — the rendered CONTENT (which pre-chat fields to
/// draw, which rating to show) is read from state by the widget downstream,
/// exactly as `build()`'s closure reads `remote` in the reference.
library;

import 'package:equatable/equatable.dart';

/// One of the six surfaces. Their ABSENCE is `ProductSurfaceSlot.active`
/// being null — there is no "none" member, because a surface that is not on
/// screen is not a surface.
sealed class ProductSurface extends Equatable {
  const ProductSurface();

  /// Whether a state tick may replace this surface.
  ///
  /// The port of `widget.ts`'s `isUserInitiated`. Answered by the type
  /// rather than by a set lookup, so there is no membership list to forget
  /// to update.
  bool get isUserInitiated => this is UserInitiatedSurface;

  @override
  List<Object?> get props => const <Object?>[];
}

/// A surface the widget raised ON ITS OWN from config or session state.
///
/// The three of these are three readings of the same facts, re-derived on
/// every store tick, and they may replace each other freely — see
/// [resolveProductSurface] in `product_surface_slot.dart`.
sealed class AutomaticSurface extends ProductSurface {
  const AutomaticSurface();
}

/// A surface the CUSTOMER opened — a task they are in the middle of.
///
/// The port of `USER_INITIATED_SURFACES`. A half-typed form or a half-
/// answered question is not a reading of state, and no state tick may swap
/// it out: a connection ack, the session list landing or a message arriving
/// would otherwise replace the form under the customer's finger. That is the
/// reported "New conversation does nothing" — after Start, the freshly
/// minted, still-empty session re-armed the pre-chat gate before the opening
/// line could land.
///
/// Only the offline gate outranks these, because it means the conversation
/// cannot happen at all.
sealed class UserInitiatedSurface extends ProductSurface {
  const UserInitiatedSurface();
}

/// The merchant's "ask for details first" questions, in front of a
/// conversation the customer opened whose transcript is empty.
final class PreChatSurface extends AutomaticSurface {
  const PreChatSurface();
}

/// The out-of-hours form. Outranks everything, including a surface the
/// customer opened.
final class OfflineSurface extends AutomaticSurface {
  const OfflineSurface();
}

/// The rating card owed to an ended conversation.
///
/// Carries `widget.ts`'s composite key — `${sessionId}:${ask|rated}` — as
/// two fields. Both halves earn their place: the card for ONE session
/// changes shape when the customer's own rating is recorded, and by-kind
/// idempotence alone would keep the ASK on screen over a session that is now
/// rated.
final class CsatSurface extends AutomaticSurface {
  const CsatSurface({required this.sessionId, required this.alreadyRated});

  /// The session being rated. Named explicitly rather than read from the
  /// live state at render time: this card outlives a session change.
  final String sessionId;

  /// `false` asks; `true` shows the rating already on file, locked.
  ///
  /// A flag, not the rating itself. What the customer scored and wrote is
  /// server truth held in the CSAT lookup downstream — carrying a copy here
  /// would make the slot a second memory of it, and the one that goes stale.
  final bool alreadyRated;

  @override
  List<Object?> get props => <Object?>[sessionId, alreadyRated];
}

/// The new-conversation form — "Send us a message" on Home, "New
/// conversation" on Messages.
final class ComposingNewSurface extends UserInitiatedSurface {
  const ComposingNewSurface();
}

/// The "Report an issue" form.
final class ReportSurface extends UserInitiatedSurface {
  const ReportSurface();
}

/// The "End this conversation?" question.
///
/// Keyed by the session it is asking ABOUT, and that is not decoration: the
/// menu stays reachable while this is up, so a customer whose session
/// changed underneath the question can ask again meaning the NEW one.
/// Without the key, by-kind idempotence would answer the second ask with the
/// question built for the old session, and the destructive button would
/// close nothing at all and say nothing about it.
final class ConfirmEndSurface extends UserInitiatedSurface {
  const ConfirmEndSurface({required this.sessionId});

  final String sessionId;

  @override
  List<Object?> get props => <Object?>[sessionId];
}
