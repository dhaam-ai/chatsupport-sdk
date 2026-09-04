import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

/// The gate armed: a guest, questions configured, unanswered, looking at a
/// conversation they opened whose transcript is empty. The state the
/// preemption bug needed.
const SurfaceSyncInputs kGateArmed = SurfaceSyncInputs(
  isGuest: true,
  preChatEnabled: true,
  hasPreChatFields: true,
  conversationOpened: true,
  hasSession: true,
);

/// The same conversation once a message has landed — the gate is disarmed
/// and a rating is due. What a `confirmEnd` hands back to.
const SurfaceSyncInputs kRatingDue = SurfaceSyncInputs(
  isGuest: true,
  preChatEnabled: true,
  hasPreChatFields: true,
  conversationOpened: true,
  hasSession: true,
  hasMessages: true,
  csatCard: CsatSurface(sessionId: 'sess_1', alreadyRated: false),
);

/// Nothing due at all.
const SurfaceSyncInputs kQuiet = SurfaceSyncInputs(hasSession: true);

void main() {
  group('there is exactly one slot', () {
    test('opening a second surface replaces the first, never joins it', () {
      final slot = ProductSurfaceSlot();
      slot.open(const ComposingNewSurface(), from: ScreenName.home);
      expect(slot.active, const ComposingNewSurface());

      slot.open(const ReportSurface(), from: ScreenName.conversation);
      // `active` is one nullable field. There is nowhere for the first
      // surface to still be, which is the point: two live at once is not a
      // state this class can reach.
      expect(slot.active, const ReportSurface());
    });

    test('the offline gate replaces whatever was in it', () {
      final slot = ProductSurfaceSlot();
      slot.open(const ComposingNewSurface(), from: ScreenName.home);
      expect(
        slot.sync(const SurfaceSyncInputs(shouldCollectOffline: true)),
        isTrue,
      );
      expect(slot.active, const OfflineSurface());
    });
  });

  group('the gate does not preempt a surface the customer opened', () {
    // pre-chat-preemption.test.ts:329-370.

    test('the form opened over an armed gate takes the slot from it', () {
      final slot = ProductSurfaceSlot();
      // The gate is armed — the state the bug needed.
      expect(slot.sync(kGateArmed), isTrue);
      expect(slot.active, const PreChatSurface());

      final SurfaceTicket ticket =
          slot.open(const ComposingNewSurface(), from: ScreenName.conversation);

      expect(ticket.tookTheSlot, isTrue);
      expect(slot.active, const ComposingNewSurface());
    });

    test('a store change that used to re-arm the gate moves nothing', () {
      // The DOM test asserts "same node, not a rebuilt one, and not replaced
      // by the gate", and reads the half-typed values back out. The node
      // identity and the typing are downstream of this layer; what this
      // layer owes them is a sync that reports NO CHANGE, because a change
      // is precisely the cue to tear the surface down and build another.
      final slot = ProductSurfaceSlot();
      slot.sync(kGateArmed);
      slot.open(const ComposingNewSurface(), from: ScreenName.conversation);

      // A session status flip with the transcript still empty: exactly the
      // reading of state the gate used to take as its cue.
      expect(slot.sync(kGateArmed), isFalse);
      expect(slot.active, const ComposingNewSurface());
    });

    test('no tick of any kind clears it — only the customer can', () {
      final slot = ProductSurfaceSlot();
      slot.open(const ComposingNewSurface(), from: ScreenName.conversation);

      for (final SurfaceSyncInputs tick in <SurfaceSyncInputs>[
        kGateArmed,
        kRatingDue,
        kQuiet,
      ]) {
        expect(slot.sync(tick), isFalse, reason: '$tick preempted the form');
        expect(slot.active, const ComposingNewSurface());
      }
    });

    test('the freshly minted, still-empty session cannot re-arm the gate', () {
      // The second half of the reported bug: after Start, `startNewSession`
      // resolves on the new session's ack with an empty transcript, and the
      // gate took the conversation over before the opening line could land.
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket =
          slot.open(const ComposingNewSurface(), from: ScreenName.home);
      final OpeningLineLatch latch = slot.beginOpeningLine();

      // Start pressed: the form stays up for the round trip so a send that
      // rejects has somewhere to say so and keeps the customer's typing.
      expect(slot.sync(kGateArmed), isFalse);
      expect(slot.active, const ComposingNewSurface());

      // The opening line lands and the form hands the slot back. The latch
      // is what stops the gate filling the gap on the way through.
      expect(slot.release(ticket, kGateArmed), isTrue);
      expect(slot.active, isNull);

      latch.release();
    });
  });

  group('a surface walked away from does not cover the next conversation', () {
    // pre-chat-preemption.test.ts:477-575. The other edge of the rule:
    // nothing ever ticks one of these away, so leaving the conversation
    // screen has to be the moment the widget lets go.

    test('Back drops a half-typed new-conversation form', () {
      final slot = ProductSurfaceSlot();
      slot.open(const ComposingNewSurface(), from: ScreenName.home);

      // Leaving the conversation screen.
      expect(slot.discardUserSurface(), isTrue);
      // Gone the moment the customer left — not parked behind Home.
      expect(slot.active, isNull);
    });

    test('the Common Question tapped next gets the screen, uncovered', () {
      final slot = ProductSurfaceSlot();
      slot.open(const ComposingNewSurface(), from: ScreenName.home);
      slot.discardUserSurface();

      // The tapped question mints its own session; the latch covers the
      // window where its transcript is still empty.
      final OpeningLineLatch latch = slot.beginOpeningLine();
      expect(slot.sync(kGateArmed), isFalse);
      // Transcript and composer, with nothing standing in for them.
      expect(slot.active, isNull);
      latch.release();
    });

    test('Back then "Send us a message" opens a FRESH form, not nothing', () {
      final slot = ProductSurfaceSlot();
      final SurfaceTicket stale =
          slot.open(const ComposingNewSurface(), from: ScreenName.home);
      slot.discardUserSurface();

      final SurfaceTicket fresh =
          slot.open(const ComposingNewSurface(), from: ScreenName.home);

      // Had the old one still held the slot, idempotence-by-value would have
      // answered the tap with it and reported no change — the reported
      // "does nothing", where the panel never navigated.
      expect(fresh.tookTheSlot, isTrue);
      // And the abandoned form's own callbacks can no longer close anything:
      // a second Start on a stale form must not mint a conversation nobody
      // asked for.
      expect(slot.release(stale, kQuiet), isFalse);
      expect(slot.active, const ComposingNewSurface());
    });

    test('Back drops the "End this conversation?" question, closing nothing',
        () {
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket = slot.open(
          const ConfirmEndSurface(sessionId: 'sess_1'),
          from: ScreenName.conversation);

      expect(slot.discardUserSurface(), isTrue);
      expect(slot.active, isNull);

      // The recent row picked next opens THAT conversation. The abandoned
      // question's ticket is stale, so a confirm landing late closes nothing.
      expect(slot.release(ticket, kQuiet), isFalse);
      expect(slot.active, isNull);
    });

    test('an automatic surface is left alone — it is parked, not abandoned',
        () {
      // A pre-chat gate parked behind Home is exactly what must still be
      // there when the customer returns to that empty conversation.
      final slot = ProductSurfaceSlot();
      slot.sync(kGateArmed);
      expect(slot.discardUserSurface(), isFalse);
      expect(slot.active, const PreChatSurface());
    });
  });

  group('release hands the slot back and re-runs the sync', () {
    test('a rating that became due behind the question shows at once', () {
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket = slot.open(
          const ConfirmEndSurface(sessionId: 'sess_1'),
          from: ScreenName.conversation);
      // Non-preemption kept the card off screen while the question was up.
      expect(slot.sync(kRatingDue), isFalse);

      expect(slot.release(ticket, kRatingDue), isTrue);
      // Raised on the release rather than waiting for the next unrelated
      // state change.
      expect(slot.active,
          const CsatSurface(sessionId: 'sess_1', alreadyRated: false));
    });

    test('the sync runs even when the ticket no longer holds the slot', () {
      final slot = ProductSurfaceSlot();
      final SurfaceTicket first = slot.open(
          const ConfirmEndSurface(sessionId: 'sess_1'),
          from: ScreenName.conversation);
      // The customer replaced the confirm with a form they are typing into
      // while "Ending…" was still in flight.
      slot.open(const ComposingNewSurface(), from: ScreenName.conversation);

      // The late release must not tear that form down with their text in it.
      expect(slot.release(first, kRatingDue), isFalse);
      expect(slot.active, const ComposingNewSurface());
    });
  });

  group('cancel returns the customer to where the form was opened from', () {
    test('a detour answers with its origin', () {
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket =
          slot.open(const ComposingNewSurface(), from: ScreenName.home);

      final SurfaceCancelOutcome outcome = slot.cancel(ticket, kQuiet);

      expect(outcome, isA<SurfaceReturnedToOrigin>());
      expect((outcome as SurfaceReturnedToOrigin).origin, ScreenName.home);
      expect(slot.active, isNull);
    });

    test('Messages -> New conversation -> Cancel goes back to Messages', () {
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket =
          slot.open(const ComposingNewSurface(), from: ScreenName.messages);

      final SurfaceCancelOutcome outcome = slot.cancel(ticket, kQuiet);

      expect((outcome as SurfaceReturnedToOrigin).origin, ScreenName.messages);
    });

    test('a surface opened mid-chat takes the ordinary route', () {
      // There the conversation IS where they came from, so backing out to it
      // is right rather than a detour to undo.
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket =
          slot.open(const ReportSurface(), from: ScreenName.conversation);

      expect(slot.cancel(ticket, kQuiet), isA<SurfaceReleased>());
      expect(slot.active, isNull);
    });

    test('a stale ticket takes the ordinary route', () {
      final slot = ProductSurfaceSlot();
      final SurfaceTicket stale =
          slot.open(const ComposingNewSurface(), from: ScreenName.home);
      slot.open(const ReportSurface(), from: ScreenName.home);

      final SurfaceCancelOutcome outcome = slot.cancel(stale, kQuiet);

      expect(outcome, isA<SurfaceReleased>());
      // And it closed nothing: the surface it named is long gone.
      expect(slot.active, const ReportSurface());
    });

    test('a second detour is still a detour from where the FIRST started', () {
      // The menu -> "Start new conversation", then the menu -> "Report an
      // issue". The current screen says 'conversation' only because the
      // first surface's own open put it there, so the origin is inherited
      // rather than re-read.
      final slot = ProductSurfaceSlot();
      slot.open(const ComposingNewSurface(), from: ScreenName.home);
      final SurfaceTicket second =
          slot.open(const ReportSurface(), from: ScreenName.conversation);

      final SurfaceCancelOutcome outcome = slot.cancel(second, kQuiet);

      expect((outcome as SurfaceReturnedToOrigin).origin, ScreenName.home);
    });

    test('an automatic surface has no origin to return to', () {
      final slot = ProductSurfaceSlot();
      slot.sync(kGateArmed);
      expect(slot.openedFrom, isNull);
    });
  });

  group('cancel deliberately does NOT re-run the sync', () {
    // The asymmetry with `release`, and it is load-bearing: an automatic
    // surface raised here would put the panel back on the conversation
    // screen and undo the very navigation the cancel is performing.

    test('a gate that is due does not arm on the way out', () {
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket =
          slot.open(const ComposingNewSurface(), from: ScreenName.home);

      slot.cancel(ticket, kGateArmed);

      // The customer pressed Cancel to get back to Home. A gate arming here
      // would drag them straight back to the screen they just left.
      expect(slot.active, isNull);
    });

    test('a rating that is due does not arm on the way out either', () {
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket =
          slot.open(const ReportSurface(), from: ScreenName.messages);

      slot.cancel(ticket, kRatingDue);

      expect(slot.active, isNull);
    });

    test('release with the SAME inputs does raise it — the contrast', () {
      // Same slot, same surface, same inputs; only the hand-back differs.
      // This is the whole asymmetry in one pair.
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket =
          slot.open(const ComposingNewSurface(), from: ScreenName.home);

      slot.release(ticket, kGateArmed);

      expect(slot.active, const PreChatSurface());
    });

    test('the ordinary route out of a cancel DOES re-sync', () {
      // Opened mid-chat, so there is no navigation to undo and the surface
      // is handed back the ordinary way.
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket =
          slot.open(const ReportSurface(), from: ScreenName.conversation);

      slot.cancel(ticket, kGateArmed);

      expect(slot.active, const PreChatSurface());
    });

    test('nothing is lost: the next tick raises what the cancel skipped', () {
      final slot = ProductSurfaceSlot();
      final SurfaceTicket ticket =
          slot.open(const ComposingNewSurface(), from: ScreenName.home);
      slot.cancel(ticket, kGateArmed);

      // The customer walks back into that empty conversation.
      expect(slot.sync(kGateArmed), isTrue);
      expect(slot.active, const PreChatSurface());
    });
  });

  group('the opening-line latch', () {
    test('holds while an exchange is under way', () {
      final slot = ProductSurfaceSlot();
      expect(slot.openingLineInFlight, isFalse);

      final OpeningLineLatch latch = slot.beginOpeningLine();
      expect(slot.openingLineInFlight, isTrue);
      expect(slot.sync(kGateArmed), isFalse);
      expect(slot.active, isNull);

      latch.release();
      expect(slot.openingLineInFlight, isFalse);
      expect(slot.sync(kGateArmed), isTrue);
      expect(slot.active, const PreChatSurface());
    });

    test('two overlapping exchanges both have to finish', () {
      // A customer who presses Back while a mint is still in flight and then
      // taps a Common Question has two alive at once. A shared flag would
      // let the second one's release re-arm the gate on an empty session
      // while the first was still mid-exchange.
      final slot = ProductSurfaceSlot();
      final OpeningLineLatch first = slot.beginOpeningLine();
      final OpeningLineLatch second = slot.beginOpeningLine();

      second.release();
      expect(slot.openingLineInFlight, isTrue);
      expect(slot.sync(kGateArmed), isFalse);

      first.release();
      expect(slot.openingLineInFlight, isFalse);
    });

    test('releasing twice is a no-op, so the count cannot go negative', () {
      // The reference keeps this balance by hand in a `finally`; here the
      // token keeps it, so an unbalanced release is not expressible.
      final slot = ProductSurfaceSlot();
      final OpeningLineLatch first = slot.beginOpeningLine();
      final OpeningLineLatch second = slot.beginOpeningLine();

      first.release();
      first.release();
      first.release();

      expect(slot.openingLineInFlight, isTrue);
      second.release();
      expect(slot.openingLineInFlight, isFalse);
    });

    test('does not itself re-run the sync', () {
      // The reference releases the counter in a `finally` and lets the
      // caller's own release, or the next tick, raise what became due.
      final slot = ProductSurfaceSlot();
      final OpeningLineLatch latch = slot.beginOpeningLine();
      slot.sync(kGateArmed);
      expect(slot.active, isNull);

      latch.release();

      expect(slot.active, isNull);
      expect(slot.sync(kGateArmed), isTrue);
      expect(slot.active, const PreChatSurface());
    });
  });

  group('tickets belong to the slot that issued them', () {
    test('a ticket from another slot closes nothing', () {
      // Multi-instance is the normal case in Flutter — two widgets on one
      // screen each own a slot.
      final a = ProductSurfaceSlot();
      final b = ProductSurfaceSlot();
      final SurfaceTicket fromA =
          a.open(const ComposingNewSurface(), from: ScreenName.home);
      b.open(const ComposingNewSurface(), from: ScreenName.home);

      expect(b.release(fromA, kQuiet), isFalse);
      expect(b.active, const ComposingNewSurface());
    });

    test('re-opening the same surface issues a ticket the old one is not', () {
      // Value equality would make these two indistinguishable; the
      // generation is what separates them.
      final slot = ProductSurfaceSlot();
      final SurfaceTicket first =
          slot.open(const ComposingNewSurface(), from: ScreenName.home);
      slot.discardUserSurface();
      slot.open(const ComposingNewSurface(), from: ScreenName.home);

      expect(slot.release(first, kQuiet), isFalse);
      expect(slot.active, const ComposingNewSurface());
    });

    test('an unchanged re-open keeps the earlier ticket valid', () {
      // Idempotence-by-value means the occupant never moved, so the ticket
      // issued for it still names what is in the slot.
      final slot = ProductSurfaceSlot();
      final SurfaceTicket first =
          slot.open(const ComposingNewSurface(), from: ScreenName.home);
      final SurfaceTicket again =
          slot.open(const ComposingNewSurface(), from: ScreenName.messages);

      expect(again.tookTheSlot, isFalse);
      // The origin is not re-read either: the customer came from Home.
      expect(slot.openedFrom, ScreenName.home);
      expect(slot.release(first, kQuiet), isTrue);
      expect(slot.active, isNull);
    });
  });
}
