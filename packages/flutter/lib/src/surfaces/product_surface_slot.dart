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
/// are the caller's — see [ProductSurfaceSlot.sync]'s return value and
/// [SurfaceCancelOutcome].
library;

import 'package:equatable/equatable.dart';

import '../nav/chat_screens.dart';
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
///
/// Every default is the "nothing is due" reading, so a caller that has not
/// learned a fact yet raises no surface rather than guessing one. The
/// pre-chat gate in particular needs six of these actively supplied before
/// it can fire — a half-built inputs object cannot put a form in front of
/// anybody.
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

/// A claim on the slot, handed back by [ProductSurfaceSlot.open].
///
/// The port of the reference's identity check, which compares the DOM node
/// it opened against the one currently in the slot. A Dart surface is a
/// value, so reference identity is gone — two `ComposingNewSurface()` are
/// `==` — and comparing values would let a form the customer opened, walked
/// away from, and opened again be closed by the FIRST one's stale callback.
/// So occupancy carries a generation, and the ticket carries the generation
/// it was issued for.
///
/// Why it matters: the two callers with a round trip in them (ending a
/// conversation, minting a new one) come back after an await, and the panel
/// stays live across it. A customer who opened "Start new conversation"
/// while "Ending…" was still in flight has REPLACED the confirm with a form
/// they are typing into, and closing "whatever is active" would tear that
/// form down with their text in it.
final class SurfaceTicket {
  SurfaceTicket._(this._slot, this._generation, this.tookTheSlot);

  final ProductSurfaceSlot _slot;
  final int _generation;

  /// Whether the call that issued this ticket actually PUT the surface in
  /// the slot, as opposed to finding it already there.
  ///
  /// A report about that call, not part of the ticket's identity: a caller
  /// navigates to the conversation screen only when this is true, matching
  /// the reference, whose idempotent path returns the existing view before
  /// it ever reaches `screens.go`. That non-navigating path is deliberate —
  /// a "Send us a message" tap answered by a form still holding the slot is
  /// the reported "does nothing", and the fix for it is
  /// [ProductSurfaceSlot.discardUserSurface] on the way off the conversation
  /// screen, not a second navigation here.
  final bool tookTheSlot;
}

/// A live opening exchange — a new session minted whose first message has
/// not landed yet. Suppresses the pre-chat gate until [release] is called.
///
/// A token rather than a bare increment/decrement pair, because the
/// reference's balance is kept by hand in a `finally` and an unbalanced
/// decrement re-arms the gate on a session that is still mid-exchange.
/// [release] is idempotent and there is no way to release twice.
final class OpeningLineLatch {
  OpeningLineLatch._(this._slot);

  final ProductSurfaceSlot _slot;
  bool _released = false;

  /// Marks this exchange finished. Idempotent.
  ///
  /// Deliberately does NOT re-run the sync: the reference releases the
  /// counter in a `finally` and lets the caller's own release, or the next
  /// store tick, raise whatever became due. Re-syncing here would raise the
  /// gate from inside a `finally` that may be unwinding a failure.
  void release() {
    if (_released) return;
    _released = true;
    _slot._openingLinesInFlight -= 1;
  }
}

/// What the caller should do after [ProductSurfaceSlot.cancel].
sealed class SurfaceCancelOutcome {
  const SurfaceCancelOutcome();
}

/// Ordinary route: the slot was handed back and the sync re-run, so the
/// customer stays on the conversation this surface was about.
///
/// Used for a surface opened while ALREADY on the conversation screen (the
/// menu mid-chat, the ended footer, the inline "Report an issue") — there
/// the conversation IS where they came from — and for a ticket that no
/// longer holds the slot.
final class SurfaceReleased extends SurfaceCancelOutcome {
  const SurfaceReleased({required this.slotChanged});

  /// Whether anything moved, so the caller knows whether to land on the
  /// conversation screen or merely repaint.
  final bool slotChanged;
}

/// Detour route: put the customer back on [origin].
///
/// The caller goes BACK if it can — the surface's own open pushed that
/// origin — and swaps to [origin] otherwise, covering a stack emptied
/// underneath it when the panel closed.
final class SurfaceReturnedToOrigin extends SurfaceCancelOutcome {
  const SurfaceReturnedToOrigin(this.origin);

  final ScreenName origin;
}

/// The ONE slot a product surface can occupy.
///
/// ── One at a time, by construction ─────────────────────────────────────
///
/// The occupant is a single nullable field. Not a list, not a stack, not a
/// map keyed by kind — there is nowhere to put a second surface, so "two
/// surfaces are live at once" is not a state this class can reach and not a
/// rule anything has to remember. All six surfaces stand IN PLACE OF the
/// transcript and composer rather than stacking above them, because a form
/// asking the customer for something and the conversation it gates are
/// alternatives, not a pile.
///
/// ── What it does not do ────────────────────────────────────────────────
///
/// No navigation and no rendering. Every mutator answers with what changed
/// and the caller applies it: a change to the occupant means the panel lands
/// on the conversation screen, [discardUserSurface] deliberately means it
/// does not, and [cancel] answers with which of the two.
class ProductSurfaceSlot {
  ProductSurface? _active;
  ScreenName? _openedFrom;
  int _generation = 0;
  int _openingLinesInFlight = 0;

  /// The surface standing in for the conversation, or null for none.
  ProductSurface? get active => _active;

  /// The screen the customer was actually standing on when the current
  /// user-initiated surface took the slot; null when the slot is empty or
  /// holds an automatic surface.
  ///
  /// Recorded because opening NAVIGATES to the conversation screen, so by
  /// the time a Cancel arrives the current screen says 'conversation' for
  /// every surface and can no longer tell "backed out of a form I opened
  /// from Home" apart from "backed out of a form I opened on top of my
  /// chat". An automatic surface has none: it is derived from state rather
  /// than pressed for, so there is no press to return to.
  ScreenName? get openedFrom => _openedFrom;

  /// Whether an opening exchange is on its way — see [beginOpeningLine].
  bool get openingLineInFlight => _openingLinesInFlight > 0;

  bool _holds(SurfaceTicket ticket) =>
      identical(ticket._slot, this) && ticket._generation == _generation;

  /// Puts [next] in the slot. Answers whether the occupant actually changed.
  bool _place(ProductSurface? next, {ScreenName? from}) {
    // Idempotence by value: the resolver runs on every message and every
    // session change, and treating an unchanged answer as a change would
    // rebuild the form under the customer and wipe what they were halfway
    // through typing.
    if (next == _active) return false;
    _active = next;
    _openedFrom = from;
    _generation += 1;
    return true;
  }

  /// Puts a surface the CUSTOMER opened in the slot, from screen [from].
  ///
  /// Takes a [UserInitiatedSurface] and nothing else: an automatic surface
  /// is derived from state by [sync], never opened by hand, and the type is
  /// what enforces that rather than a comment.
  SurfaceTicket open(UserInitiatedSurface surface, {required ScreenName from}) {
    // The origin is INHERITED when a user-initiated surface is already in
    // the slot. A second detour opened on top of the first (the menu ->
    // "Start new conversation", then the menu -> "Report an issue") is still
    // a detour from wherever the FIRST one started, and the current screen
    // says 'conversation' only because that first surface's own open put it
    // there. An automatic surface is not inherited from — it carries no
    // origin, and the caller's [from] is already right.
    final ProductSurface? replacing = _active;
    final ScreenName? inherited = _openedFrom;
    final ScreenName origin =
        replacing != null && replacing.isUserInitiated && inherited != null
            ? inherited
            : from;
    final bool changed = _place(surface, from: origin);
    return SurfaceTicket._(this, _generation, changed);
  }

  /// Re-derives what belongs in the slot from [inputs] and applies it.
  ///
  /// Answers whether the occupant changed, which is the caller's cue to land
  /// on the conversation screen: a surface stands in place of the
  /// conversation, and emptying the slot puts that conversation back. A
  /// `false` means the answer was the same one already on screen, so nothing
  /// moves and nothing is rebuilt.
  bool sync(SurfaceSyncInputs inputs) {
    final ProductSurface? next = resolveProductSurface(
      inputs: inputs,
      current: _active,
      openingLineInFlight: openingLineInFlight,
    );
    // Any CHANGE a resolve produces is to an automatic surface or to
    // nothing: its only other answer is the current occupant, which is not a
    // change. So a sync never needs an origin, and never overwrites one.
    assert(
      next == null || next == _active || next is AutomaticSurface,
      'sync raised a user-initiated surface; only open() may do that',
    );
    return _place(next, from: null);
  }

  /// Hands the slot back from [ticket] — a surface whose task is DONE — and
  /// re-runs the sync.
  ///
  /// Checked against the slot rather than closed blindly, so only the
  /// surface that started an operation gets to close, and one already
  /// replaced or discarded is skipped. See [SurfaceTicket].
  ///
  /// The sync runs EITHER WAY, and that is the point of it. While the
  /// surface was up the resolver deliberately left it alone (non-preemption),
  /// so a rating that became due behind it — the confirm-end question's own
  /// close is the obvious case — has not been raised yet and would otherwise
  /// wait for the next unrelated state change. Harmless when nothing is due.
  bool release(SurfaceTicket ticket, SurfaceSyncInputs inputs) {
    final bool emptied = _holds(ticket) && _place(null, from: null);
    final bool resynced = sync(inputs);
    return emptied || resynced;
  }

  /// Drops a user-initiated surface the customer WALKED AWAY from, without
  /// putting the conversation back on screen and without re-running the sync.
  ///
  /// Why it exists: non-preemption means no tick will ever clear one of
  /// these — the slot is the customer's until they hand it back. Before the
  /// rule, the next tick's fall-through swept an abandoned form away; now
  /// the moments that mean "I am done with this" have to be recognised as
  /// the hand-back they are, or the next conversation the customer opens is
  /// drawn UNDER a stale form, and a second Start on that form mints a
  /// conversation nobody asked for. Those moments are leaving the
  /// conversation screen, and asking for a different conversation.
  ///
  /// The automatic surfaces are left alone: they are re-derived on the next
  /// sync, and a pre-chat gate parked behind Home is exactly what must still
  /// be there when the customer returns to that empty conversation.
  ///
  /// Answers whether there was one to drop.
  bool discardUserSurface() {
    final ProductSurface? current = _active;
    if (current == null || !current.isUserInitiated) return false;
    return _place(null, from: null);
  }

  /// Backs out of [ticket] — a surface the customer CANCELLED — and answers
  /// where they should end up.
  ///
  /// Not simply [release]: that is right for a surface whose task COMPLETED,
  /// where the conversation is what the customer just started, ended or
  /// reported on, and wrong for one they abandoned. "Send us a message" on
  /// Home, or "New conversation" on Messages, is a detour; finishing that
  /// detour on the conversation screen strands the customer on an empty
  /// transcript with the tab bar gone, having pressed Cancel.
  SurfaceCancelOutcome cancel(SurfaceTicket ticket, SurfaceSyncInputs inputs) {
    final ScreenName? origin = _openedFrom;
    final bool detour = _holds(ticket) &&
        _active != null &&
        origin != null &&
        origin != ScreenName.conversation;
    if (!detour) {
      return SurfaceReleased(slotChanged: release(ticket, inputs));
    }
    // ── The asymmetry, and why it is load-bearing ─────────────────────
    //
    // [release] re-runs the sync; this branch deliberately does not. An
    // automatic surface raised here would put the panel back on the
    // conversation screen, undoing the very navigation this call exists to
    // perform — the customer pressed Cancel to get back to Home or
    // Messages, and a pre-chat gate or a rating card arming on the way out
    // would drag them straight back to the screen they just left. That is
    // the same yank off Home in a different coat.
    //
    // Nothing is lost by skipping it: the surfaces this would have raised
    // are re-derived from state, so the next tick raises them, and a gate
    // that belongs in front of this conversation is still there when the
    // customer returns to it. [discardUserSurface], not an empty-and-sync,
    // for exactly that reason.
    discardUserSurface();
    return SurfaceReturnedToOrigin(origin);
  }

  /// Marks a conversation-opening exchange as under way: a new session has
  /// been asked for and its first message has not landed yet.
  ///
  /// Exists for the pre-chat gate. Minting a session resolves on its
  /// `connection.ack`, at which point the transcript is empty and the
  /// session id has changed — so the tick that follows lands in exactly the
  /// window where "questions configured, no answer yet, no messages" is
  /// momentarily true, and the gate flashed in front of a conversation that
  /// was already starting, or took it over outright. While a latch is held
  /// the gate is skipped: the opening line IS the first message, so there is
  /// nothing to gate. Once it lands the transcript is non-empty and the gate
  /// cannot fire for that session anyway.
  ///
  /// A COUNT, not a flag, because two of these overlap: a customer who
  /// presses Back while a mint is still in flight and then taps a Common
  /// Question has two opening exchanges alive at once, and a shared flag
  /// would let the second one's release re-arm the gate on an empty session
  /// while the first was still mid-exchange — precisely the window this
  /// exists to cover.
  OpeningLineLatch beginOpeningLine() {
    _openingLinesInFlight += 1;
    return OpeningLineLatch._(this);
  }
}
