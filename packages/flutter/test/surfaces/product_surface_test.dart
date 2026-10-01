import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

/// Every surface, once — so a seventh added later has to be added here too
/// and cannot slip through the membership assertions below unexamined.
const List<ProductSurface> kAllSurfaces = <ProductSurface>[
  PreChatSurface(),
  OfflineSurface(),
  CsatSurface(sessionId: 'sess_1', alreadyRated: false),
  ComposingNewSurface(),
  ReportSurface(),
  ConfirmEndSurface(sessionId: 'sess_1'),
];

void main() {
  group('USER_INITIATED_SURFACES is exactly {composingNew, report, confirmEnd}',
      () {
    // The direct assertion of `widget.ts:508`'s set. Written out member by
    // member rather than as a count: the whole rule is WHICH three, and a
    // test that only counted them would pass with the wrong three.

    test('the three the customer opened are user-initiated', () {
      expect(const ComposingNewSurface().isUserInitiated, isTrue);
      expect(const ReportSurface().isUserInitiated, isTrue);
      expect(
          const ConfirmEndSurface(sessionId: 'sess_1').isUserInitiated, isTrue);
    });

    test('the three the widget raised on its own are not', () {
      expect(const PreChatSurface().isUserInitiated, isFalse);
      expect(const OfflineSurface().isUserInitiated, isFalse);
      expect(
        const CsatSurface(sessionId: 'sess_1', alreadyRated: false)
            .isUserInitiated,
        isFalse,
      );
    });

    test('membership is the type, so the two agree by construction', () {
      // `isUserInitiated` is not a second list that could drift from the
      // class hierarchy — it reads the hierarchy. This pins that.
      for (final ProductSurface surface in kAllSurfaces) {
        expect(
          surface.isUserInitiated,
          surface is UserInitiatedSurface,
          reason: '$surface disagrees with its own supertype',
        );
        expect(
          surface.isUserInitiated,
          isNot(surface is AutomaticSurface),
          reason: '$surface is on both sides of the split, or neither',
        );
      }
    });
  });

  group('identity is the idempotence check', () {
    test('the same surface twice is the same occupant, so nothing rebuilds',
        () {
      // `openSurface`'s by-kind idempotence, expressed as `==`: a store tick
      // that re-derives the same surface must not count as a change, or the
      // form is rebuilt under the customer and their typing is gone.
      expect(const PreChatSurface(), const PreChatSurface());
      expect(const ComposingNewSurface(), const ComposingNewSurface());
    });

    test('two field-less surfaces of different kinds are never equal', () {
      // Both carry empty props; only the runtime type separates them. If
      // Equatable compared props alone, the offline gate and the pre-chat
      // gate would be indistinguishable and the ladder could never swap one
      // for the other.
      expect(const PreChatSurface(), isNot(const OfflineSurface()));
      expect(const ComposingNewSurface(), isNot(const ReportSurface()));
    });

    test('confirmEnd is keyed by the session it asks about', () {
      // The second ask means the NEW session. Were these equal, by-kind
      // idempotence would hand back the question built for the old one and
      // its destructive button would close nothing.
      expect(
        const ConfirmEndSurface(sessionId: 'sess_1'),
        isNot(const ConfirmEndSurface(sessionId: 'sess_2')),
      );
      expect(
        const ConfirmEndSurface(sessionId: 'sess_1'),
        const ConfirmEndSurface(sessionId: 'sess_1'),
      );
    });

    test('the CSAT card changes identity when the session becomes rated', () {
      // `${sessionId}:${ask|rated}`. Without the second half the ASK stays
      // on screen over a session that now has a rating on file.
      expect(
        const CsatSurface(sessionId: 'sess_1', alreadyRated: false),
        isNot(const CsatSurface(sessionId: 'sess_1', alreadyRated: true)),
      );
      expect(
        const CsatSurface(sessionId: 'sess_1', alreadyRated: false),
        isNot(const CsatSurface(sessionId: 'sess_2', alreadyRated: false)),
      );
    });
  });
}
