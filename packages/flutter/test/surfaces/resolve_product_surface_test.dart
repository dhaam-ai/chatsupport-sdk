import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

/// The state in which the pre-chat gate is armed and nothing else is due:
/// a guest, questions configured, unanswered, looking at a conversation they
/// opened whose transcript is empty. Every test below starts from this and
/// changes exactly the one fact it is about.
const SurfaceSyncInputs kGateArmed = SurfaceSyncInputs(
  isGuest: true,
  preChatEnabled: true,
  hasPreChatFields: true,
  conversationOpened: true,
  hasSession: true,
);

ProductSurface? resolve(
  SurfaceSyncInputs inputs, {
  ProductSurface? current,
  bool openingLineInFlight = false,
}) =>
    resolveProductSurface(
      inputs: inputs,
      current: current,
      openingLineInFlight: openingLineInFlight,
    );

void main() {
  group('precedence', () {
    test('the offline gate outranks a surface the customer opened', () {
      // The one branch that may replace a user-initiated surface, because it
      // means the conversation cannot happen at all.
      for (final UserInitiatedSurface open in <UserInitiatedSurface>[
        const ComposingNewSurface(),
        const ReportSurface(),
        const ConfirmEndSurface(sessionId: 'sess_1'),
      ]) {
        expect(
          resolve(
            const SurfaceSyncInputs(shouldCollectOffline: true),
            current: open,
          ),
          const OfflineSurface(),
          reason: 'offline must outrank $open',
        );
      }
    });

    test('the offline gate outranks the pre-chat gate and the rating card', () {
      expect(
        resolve(
          const SurfaceSyncInputs(
            shouldCollectOffline: true,
            isGuest: true,
            preChatEnabled: true,
            hasPreChatFields: true,
            conversationOpened: true,
            hasSession: true,
            csatCard: CsatSurface(sessionId: 'sess_1', alreadyRated: false),
          ),
        ),
        const OfflineSurface(),
      );
    });

    test('a user-initiated surface outranks the pre-chat gate', () {
      // The gate is armed — the state the bug needed — and the form still
      // holds the slot.
      expect(
        resolve(kGateArmed, current: const ComposingNewSurface()),
        const ComposingNewSurface(),
      );
    });

    test('a user-initiated surface outranks the rating card', () {
      expect(
        resolve(
          const SurfaceSyncInputs(
            hasSession: true,
            hasMessages: true,
            csatCard: CsatSurface(sessionId: 'sess_1', alreadyRated: false),
          ),
          current: const ConfirmEndSurface(sessionId: 'sess_1'),
        ),
        const ConfirmEndSurface(sessionId: 'sess_1'),
      );
    });

    test('the pre-chat gate outranks the rating card', () {
      // A thread with no messages cannot be rated, so the gate is asked
      // first and the card second.
      expect(
        resolve(
          const SurfaceSyncInputs(
            isGuest: true,
            preChatEnabled: true,
            hasPreChatFields: true,
            conversationOpened: true,
            hasSession: true,
            csatCard: CsatSurface(sessionId: 'sess_1', alreadyRated: false),
          ),
        ),
        const PreChatSurface(),
      );
    });

    test('the rating card is what is left', () {
      expect(
        resolve(
          const SurfaceSyncInputs(
            hasSession: true,
            hasMessages: true,
            csatCard: CsatSurface(sessionId: 'sess_1', alreadyRated: true),
          ),
        ),
        const CsatSurface(sessionId: 'sess_1', alreadyRated: true),
      );
    });

    test('nothing due leaves the slot empty', () {
      expect(resolve(const SurfaceSyncInputs()), isNull);
    });
  });

  group('automatic surfaces replace each other freely', () {
    // Three readings of the same facts, re-derived on every tick. Unlike a
    // user-initiated surface, none of them is a task in progress.

    test('the offline gate replaces a pre-chat gate already up', () {
      expect(
        resolve(
          const SurfaceSyncInputs(shouldCollectOffline: true),
          current: const PreChatSurface(),
        ),
        const OfflineSurface(),
      );
    });

    test('a rating card replaces a pre-chat gate once a message lands', () {
      // The transcript filling is exactly what disarms the gate and arms the
      // card — the same fact read from both sides.
      expect(
        resolve(
          const SurfaceSyncInputs(
            isGuest: true,
            preChatEnabled: true,
            hasPreChatFields: true,
            conversationOpened: true,
            hasSession: true,
            hasMessages: true,
            csatCard: CsatSurface(sessionId: 'sess_1', alreadyRated: false),
          ),
          current: const PreChatSurface(),
        ),
        const CsatSurface(sessionId: 'sess_1', alreadyRated: false),
      );
    });

    test('an automatic surface no longer due is cleared', () {
      expect(
        resolve(const SurfaceSyncInputs(), current: const PreChatSurface()),
        isNull,
      );
      expect(
        resolve(const SurfaceSyncInputs(), current: const OfflineSurface()),
        isNull,
      );
    });
  });

  group('the pre-chat gate needs every one of its preconditions', () {
    // Each case flips exactly one fact off the armed baseline, so a failure
    // names the precondition that stopped mattering.
    final Map<String, SurfaceSyncInputs> disarmed = <String, SurfaceSyncInputs>{
      'a logged-in visitor is never asked': const SurfaceSyncInputs(
        preChatEnabled: true,
        hasPreChatFields: true,
        conversationOpened: true,
        hasSession: true,
      ),
      'the merchant turned the questions off': const SurfaceSyncInputs(
        isGuest: true,
        hasPreChatFields: true,
        conversationOpened: true,
        hasSession: true,
      ),
      'the toggle is on but no questions are configured':
          const SurfaceSyncInputs(
        isGuest: true,
        preChatEnabled: true,
        conversationOpened: true,
        hasSession: true,
      ),
      'the customer already answered or skipped': const SurfaceSyncInputs(
        isGuest: true,
        preChatEnabled: true,
        hasPreChatFields: true,
        preChatAnswered: true,
        conversationOpened: true,
        hasSession: true,
      ),
      'the panel is open but no conversation was opened':
          const SurfaceSyncInputs(
        isGuest: true,
        preChatEnabled: true,
        hasPreChatFields: true,
        hasSession: true,
      ),
      'there is no session yet': const SurfaceSyncInputs(
        isGuest: true,
        preChatEnabled: true,
        hasPreChatFields: true,
        conversationOpened: true,
      ),
      'the transcript already has messages': const SurfaceSyncInputs(
        isGuest: true,
        preChatEnabled: true,
        hasPreChatFields: true,
        conversationOpened: true,
        hasSession: true,
        hasMessages: true,
      ),
    };

    disarmed.forEach((String why, SurfaceSyncInputs inputs) {
      test('no gate when $why', () {
        expect(resolve(inputs), isNull);
      });
    });

    test('the gate is up when all of them hold', () {
      // Proves the baseline the seven cases above are measured against is
      // genuinely armed, so none of them is passing for a second reason.
      expect(resolve(kGateArmed), const PreChatSurface());
    });
  });

  group('the opening-line latch', () {
    // `startNewSession` resolves on the new session's `connection.ack`, at
    // which point the transcript is empty and the session id has changed —
    // so the tick that follows lands in exactly the window where "pre-chat
    // enabled, no answer yet, no messages" is momentarily true, and the gate
    // flashed in front of a conversation that was already starting.

    test('suppresses the gate while an opening line is on its way', () {
      expect(resolve(kGateArmed, openingLineInFlight: true), isNull);
    });

    test('the gate arms again once the latch clears', () {
      expect(resolve(kGateArmed, openingLineInFlight: false),
          const PreChatSurface());
    });

    test('does not suppress the offline gate or a rating card', () {
      // It exists for the one window the pre-chat gate misreads. Nothing
      // else is fooled by an empty transcript, so nothing else is latched.
      expect(
        resolve(
          const SurfaceSyncInputs(shouldCollectOffline: true),
          openingLineInFlight: true,
        ),
        const OfflineSurface(),
      );
      expect(
        resolve(
          const SurfaceSyncInputs(
            hasSession: true,
            hasMessages: true,
            csatCard: CsatSurface(sessionId: 'sess_1', alreadyRated: false),
          ),
          openingLineInFlight: true,
        ),
        const CsatSurface(sessionId: 'sess_1', alreadyRated: false),
      );
    });
  });
}
