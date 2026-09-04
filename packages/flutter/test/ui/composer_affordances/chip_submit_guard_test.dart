import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reproduces the `submit(text)` block of
/// `packages/widget/test/composer.test.ts:304-355`, at the level the rule
/// actually lives: a pure decision over four facts.
void main() {
  ChipSubmitRefusal? refuse({
    String suggestion = 'Check my account',
    String draft = '',
    bool enabled = true,
    bool uploading = false,
  }) =>
      chipSubmitRefusal(
        suggestion: suggestion,
        draft: draft,
        enabled: enabled,
        uploading: uploading,
      );

  group('chipSubmitRefusal — exactly three refusals plus a blank suggestion',
      () {
    // The headline. The bug this guards against: gating on the send control's
    // disabled state refused every chip, because Send is disabled whenever
    // the box is empty — which is exactly the state a chip is tapped in.
    test('an EMPTY draft is the normal case for a chip, and it sends', () {
      expect(refuse(draft: ''), isNull);
    });

    test('a whitespace-only draft is empty too, so it still sends', () {
      expect(refuse(draft: '   \n\t '), isNull);
    });

    test('refuses while the composer is disabled — the consent gate holds', () {
      expect(refuse(enabled: false), ChipSubmitRefusal.composerDisabled);
    });

    test('refuses while an upload is in flight', () {
      expect(refuse(uploading: true), ChipSubmitRefusal.uploadInFlight);
    });

    test('refuses to overwrite a draft the customer is typing', () {
      expect(refuse(draft: 'my order was '), ChipSubmitRefusal.draftPresent);
    });

    test('ignores a blank suggestion', () {
      expect(refuse(suggestion: '   '), ChipSubmitRefusal.blankSuggestion);
      expect(refuse(suggestion: ''), ChipSubmitRefusal.blankSuggestion);
    });

    // Pins the count the module's own doc claims. A fifth value added without
    // a decision behind it fails here rather than in production.
    test('there are four refusals and no more', () {
      expect(ChipSubmitRefusal.values, hasLength(4));
    });

    // Order matters only because the reason reported should match the
    // reference's, which checks `enabled` before `uploading`.
    test('a disabled AND uploading composer reports being disabled', () {
      expect(
        refuse(enabled: false, uploading: true),
        ChipSubmitRefusal.composerDisabled,
      );
    });

    // Every refusal must be reachable from a state the composer can actually
    // be in; a value nothing can produce is a sentence nobody will ever read.
    test('every refusal is producible', () {
      final Set<ChipSubmitRefusal?> produced = <ChipSubmitRefusal?>{
        refuse(enabled: false),
        refuse(uploading: true),
        refuse(draft: 'x'),
        refuse(suggestion: ' '),
        refuse(),
      };
      expect(produced, <ChipSubmitRefusal?>{...ChipSubmitRefusal.values, null});
    });
  });

  group('ComposerController', () {
    test('refuses with composerDisabled while no composer is mounted', () {
      final ComposerController controller = ComposerController();
      expect(controller.isAttached, isFalse);
      expect(
        controller.submit('Check my account'),
        ChipSubmitRefusal.composerDisabled,
      );
    });

    test('routes a suggestion to the attached composer and reports back', () {
      final ComposerController controller = ComposerController();
      final List<String> seen = <String>[];
      ChipSubmitRefusal? submit(String text) {
        seen.add(text);
        return null;
      }

      controller.attach(submit);
      expect(controller.isAttached, isTrue);
      expect(controller.submit('Where is my order'), isNull);
      expect(seen, <String>['Where is my order']);
    });

    // Flutter mounts a replacement before disposing what it replaced, so
    // both orderings below occur in a legitimate swap and neither may leave
    // the seam pointing at a composer that has left the screen.
    test('a swap leaves the seam on the composer that is now on screen', () {
      final ComposerController controller = ComposerController();
      final List<String> oldBox = <String>[];
      final List<String> newBox = <String>[];
      ChipSubmitRefusal? oldComposer(String text) {
        oldBox.add(text);
        return null;
      }

      ChipSubmitRefusal? newComposer(String text) {
        newBox.add(text);
        return null;
      }

      controller.attach(oldComposer);
      // The replacement mounts first...
      controller.attach(newComposer);
      // ...then the one it replaced is disposed.
      controller.detach(oldComposer);

      expect(controller.isAttached, isTrue);
      controller.submit('Check my account');
      expect(newBox, <String>['Check my account']);
      expect(oldBox, isEmpty);
    });

    test('detach withdraws only the closure that was attached', () {
      final ComposerController controller = ComposerController();
      ChipSubmitRefusal? mine(String text) => null;
      ChipSubmitRefusal? someoneElses(String text) => null;

      controller.attach(mine);
      // A stale composer disposing after its replacement already attached
      // must not tear the live one's seam out from under it.
      controller.detach(someoneElses);
      expect(controller.isAttached, isTrue);

      controller.detach(mine);
      expect(controller.isAttached, isFalse);
    });
  });
}
