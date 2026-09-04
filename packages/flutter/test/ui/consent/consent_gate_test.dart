// The rules half of the consent gate: what makes a notice actually gating,
// what makes the composer usable, and what the remembered answer survives.
//
// Reproduces `remote-config-gating.test.ts`'s consent block. The reference
// drives it through a mounted widget and reads `.dh-consent.hidden` and
// `.dh-input.disabled`; both of those are one function here
// (`consentGating` / `consentSatisfied`), so the rules are asserted directly
// and the wiring that reads them is asserted in consent_wiring_test.dart.

import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/remote_config_fixtures.dart';

final PublishableKey _tenantA = PublishableKey.parse('dhp_test_abc123');
final PublishableKey _tenantB = PublishableKey.parse('dhp_test_def456');

/// A store whose every operation fails — a device that blocks app data, a
/// full disk, a keystore that will not open.
class _BrokenChatStorage implements ChatStorage {
  @override
  Future<String?> read(String key) async => throw StateError('no store');

  @override
  Future<void> write(String key, String value) async =>
      throw StateError('no store');
}

void main() {
  group('consentGating — is the notice actually in force?', () {
    test('gates when the merchant required consent and wrote a notice', () {
      expect(
        consentGating(testRemoteConfig(
          consentRequired: true,
          consentText: 'You agree to our privacy policy.',
        )),
        isTrue,
      );
    });

    test('does not gate when the merchant required nothing', () {
      expect(consentGating(testRemoteConfig()), isFalse);
    });

    // A notice switched on with nothing written in it has nothing to agree
    // to, and must not strand the visitor behind a composer they cannot use.
    test('does not gate on an absent notice', () {
      expect(
        consentGating(testRemoteConfig(consentRequired: true)),
        isFalse,
      );
    });

    test('does not gate on a notice that is only whitespace', () {
      expect(
        consentGating(
          testRemoteConfig(consentRequired: true, consentText: '  '),
        ),
        isFalse,
      );
    });

    // The text alone is not a gate either: a merchant who wrote a notice and
    // left the toggle off has not asked for one.
    test('does not gate on text without the toggle', () {
      expect(
        consentGating(testRemoteConfig(consentText: 'Anything at all.')),
        isFalse,
      );
    });
  });

  group('consentSatisfied — may the composer be used?', () {
    test('holds the composer shut while gating and not yet agreed', () {
      expect(consentSatisfied(gating: true, agreed: false), isFalse);
    });

    test('opens the composer once the visitor agrees', () {
      expect(consentSatisfied(gating: true, agreed: true), isTrue);
    });

    test('leaves the composer alone when nothing is gating', () {
      expect(consentSatisfied(gating: false, agreed: false), isTrue);
    });
  });

  group('ConsentGate — the remembered answer', () {
    test('reads a first visit as not agreed', () async {
      final ConsentGate gate = ConsentGate(
        storage: MemoryChatStorage(),
        publishableKey: _tenantA,
      );
      expect(await gate.readAgreed(), isFalse);
    });

    // Consent fatigue is itself a reason people stop reading notices, so the
    // answer is remembered.
    test('does not ask a second time once recorded', () async {
      final ChatStorage storage = MemoryChatStorage();
      await ConsentGate(storage: storage, publishableKey: _tenantA)
          .recordAgreed();

      // A fresh gate over the same store — the port of the reference's
      // unmount/remount.
      final ConsentGate remounted =
          ConsentGate(storage: storage, publishableKey: _tenantA);
      expect(await remounted.readAgreed(), isTrue);
    });

    // Two tenants sharing one device must not answer for one another.
    test('does not let one tenant consent for another', () async {
      final ChatStorage storage = MemoryChatStorage();
      await ConsentGate(storage: storage, publishableKey: _tenantA)
          .recordAgreed();

      final ConsentGate other =
          ConsentGate(storage: storage, publishableKey: _tenantB);
      expect(await other.readAgreed(), isFalse);
    });

    test('writes under chatsdk:<publishable key>:consent', () async {
      final MemoryChatStorage storage = MemoryChatStorage();
      await ConsentGate(storage: storage, publishableKey: _tenantA)
          .recordAgreed();
      expect(
        await storage.read(chatStorageKey(_tenantA, kConsentStorageName)),
        kConsentStoredValue,
      );
    });

    // Something else's data under this key is not an agreement.
    test('reads a value that is not the stored literal as not agreed',
        () async {
      final MemoryChatStorage storage = MemoryChatStorage();
      await storage.write(chatStorageKey(_tenantA, kConsentStorageName), 'yes');
      expect(
        await ConsentGate(storage: storage, publishableKey: _tenantA)
            .readAgreed(),
        isFalse,
      );
    });

    // Storage that is unavailable is NOT treated as consent — a read that
    // fails is the same as a first visit, which is the safe direction.
    test('reads a failing store as not agreed, and reports why', () async {
      Object? reported;
      final ConsentGate gate = ConsentGate(
        storage: _BrokenChatStorage(),
        publishableKey: _tenantA,
        onError: (Object error, StackTrace stackTrace) => reported = error,
      );
      expect(await gate.readAgreed(), isFalse);
      expect(reported, isA<StateError>());
    });

    // A failed write must not throw at the caller: the click has already been
    // honoured, and the only cost of the failure is being asked again.
    test('never rejects on a failed write, and reports why', () async {
      Object? reported;
      final ConsentGate gate = ConsentGate(
        storage: _BrokenChatStorage(),
        publishableKey: _tenantA,
        onError: (Object error, StackTrace stackTrace) => reported = error,
      );
      await expectLater(gate.recordAgreed(), completes);
      expect(reported, isA<StateError>());
    });
  });

  group('ConsentGate.unremembered — the default', () {
    test('honours the answer for this gate', () async {
      final ConsentGate gate = ConsentGate.unremembered();
      await gate.recordAgreed();
      expect(await gate.readAgreed(), isTrue);
    });

    // ...and asks again next mount, which is the reference's own documented
    // behaviour for a browser with site data blocked.
    test('forgets it for the next one', () async {
      await ConsentGate.unremembered().recordAgreed();
      expect(await ConsentGate.unremembered().readAgreed(), isFalse);
    });
  });
}
