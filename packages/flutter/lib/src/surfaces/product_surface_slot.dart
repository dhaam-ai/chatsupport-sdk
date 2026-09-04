/// The one slot a product surface can occupy, and the precedence rule that
/// decides what goes in it.
///
/// A port of `packages/widget/src/widget.ts:2718-2800`'s
/// `syncProductSurfaces` and the slot mutators around it — `openSurface`,
/// `closeSurface`, `releaseSurface`, `discardUserSurface` and
/// `cancelUserSurface`.
///
/// Re-exports `product_surface.dart`: the union and the slot are one module
/// split across two files, so this is the whole surface vocabulary.
///
/// ── Pure state ─────────────────────────────────────────────────────────
///
/// Nothing here imports Flutter. This layer decides WHAT may be rendered;
/// the widgets that render it, and the navigation that follows a change,
/// are the caller's.
library;

import 'package:equatable/equatable.dart';

import 'product_surface.dart';

export 'product_surface.dart';

/// The facts [resolveProductSurface] judges, gathered from their owners.
///
/// Every field is a fact DERIVED ELSEWHERE and handed in, never re-derived
/// here. That is deliberate and it is the same discipline the reference
/// states about `isGuest`: two derivations of one fact is exactly how the
/// pre-chat form ended up shown on one path and not the other. The slot owns
/// precedence and non-preemption. It does not own "is this a guest", "is it
/// out of hours" or "is a rating due", and asking those questions a second
/// time here would make this the second place each answer could be wrong.
class SurfaceSyncInputs extends Equatable {
  const SurfaceSyncInputs({
    this.shouldCollectOffline = false,
    this.isGuest = false,
    this.preChatEnabled = false,
    this.hasPreChatFields = false,
    this.preChatAnswered = false,
    this.conversationOpened = false,
    this.hasSession = false,
    this.hasMessages = false,
    this.csatCard,
  });

  /// The server says the merchant is out of hours and wants a message taken.
  ///
  /// A plain boolean, and it must stay one: business hours are the server's
  /// to decide, so no schedule and no timezone reaches this layer.
  final bool shouldCollectOffline;

  /// Nobody the host page has vouched for.
  ///
  /// The discriminator is `identity.profile` being ABSENT — not "has no
  /// userId", since every visitor has one of those. Derived once by the
  /// caller and passed in.
  final bool isGuest;

  /// The merchant's "ask for details first" toggle.
  final bool preChatEnabled;

  /// The merchant actually configured at least one question to ask.
  ///
  /// Separate from [preChatEnabled] because they are two independent console
  /// controls: a toggle switched on with no fields behind it has nothing to
  /// put on screen, and gating on the toggle alone raised an empty form.
  final bool hasPreChatFields;

  /// The customer answered or skipped the gate already.
  final bool preChatAnswered;

  /// The customer has actually OPENED a conversation, as opposed to merely
  /// having one on the server.
  ///
  /// chat-service mints or resumes a session on `connection.hello`, so a
  /// brand-new visitor has a live, zero-message session as soon as the
  /// socket acks — at mount, before the panel has ever been opened. "A
  /// session exists" is therefore NOT the same question as "this visitor is
  /// looking at a conversation", and the gate needs the second one: asked
  /// the first, it went up at MOUNT and took the panel straight to the
  /// conversation screen, leaving Home reachable only by pressing Back off a
  /// form nobody had asked for.
  final bool conversationOpened;

  /// There is a session at all.
  final bool hasSession;

  /// The transcript has something in it.
  final bool hasMessages;

  /// The rating card this conversation is owed, or null for none.
  ///
  /// A decision, not the inputs to one. Whether a rating is due is the CSAT
  /// machine's question — it turns on an ENDED session (and a `SWITCHED`
  /// close is parked, not ended), on a server-truth lookup that withholds on
  /// an unknown answer, and on an empty transcript having nothing to rate.
  /// None of that is precedence, so none of it is re-asked here: the ladder
  /// honours whatever the caller decided and only says WHERE it ranks.
  final CsatSurface? csatCard;

  @override
  List<Object?> get props => <Object?>[
        shouldCollectOffline,
        isGuest,
        preChatEnabled,
        hasPreChatFields,
        preChatAnswered,
        conversationOpened,
        hasSession,
        hasMessages,
        csatCard,
      ];
}

/// What belongs in the slot given [inputs], the [current] occupant, and
/// whether an opening line is on its way.
///
/// Returning [current] means "leave it alone"; returning null means "empty
/// the slot". Pure and total — the caller applies the answer.
///
/// ── The precedence, and why it is that order ───────────────────────────
///
/// 1. **The offline gate.** Outranks everything, INCLUDING a surface the
///    customer opened, because it means the conversation cannot happen at
///    all. It is also the reason the guest check has to reach this branch
///    upstream: this branch outranks both gates below, so without it an
///    out-of-hours visit was the one path on which a logged-in customer
///    still met the merchant's pre-chat questions.
/// 2. **The customer's own surface** — the non-preemption rule.
/// 3. **The pre-chat gate**, in front of a conversation with nothing in it.
/// 4. **The rating card**, which is what is left once a session has ended.
///
/// The middle two are ordered by what they are about: a thread with no
/// messages cannot be rated, so the gate is asked first and the card second.
ProductSurface? resolveProductSurface({
  required SurfaceSyncInputs inputs,
  required ProductSurface? current,
  required bool openingLineInFlight,
}) {
  if (inputs.shouldCollectOffline) return const OfflineSurface();

  // ── Non-preemption ───────────────────────────────────────────────────
  //
  // Only the offline gate above may replace a surface the customer opened.
  // Everything below is a reading of state that the customer's own task
  // outranks: a half-typed new-conversation form or issue report, or the
  // "end this conversation?" question, must not be swapped for the pre-chat
  // gate or a rating because a connection tick or a message happened to
  // arrive.
  //
  // The slot comes back through `ProductSurfaceSlot.release`, which re-runs
  // this resolve so anything that became due behind it shows then — or
  // through `ProductSurfaceSlot.discardUserSurface` when the customer walks
  // off to Home, Messages or a different conversation, since no tick here
  // ever will.
  if (current != null && current.isUserInitiated) return current;

  // ── Only ever in front of a conversation the customer OPENED ─────────
  //
  // See `SurfaceSyncInputs.conversationOpened` for why the session merely
  // existing is the wrong question, and `openingLineInFlight` for the window
  // where an empty transcript does not mean "the customer has not spoken".
  final bool gateOnPreChat = inputs.isGuest &&
      inputs.preChatEnabled &&
      inputs.hasPreChatFields &&
      !inputs.preChatAnswered &&
      !openingLineInFlight &&
      inputs.conversationOpened &&
      inputs.hasSession &&
      !inputs.hasMessages;
  if (gateOnPreChat) return const PreChatSurface();

  return inputs.csatCard;
}
