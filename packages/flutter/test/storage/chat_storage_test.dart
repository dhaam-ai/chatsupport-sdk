import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

final PublishableKey _tenantA = PublishableKey.parse('dhp_test_abc123');
final PublishableKey _tenantB = PublishableKey.parse('dhp_test_def456');

void main() {
  group('chatStorageKey — two tenants on one device', () {
    test('namespaces the key under chatsdk and the publishable key', () {
      expect(
        chatStorageKey(_tenantA, 'consent'),
        'chatsdk:${_tenantA.value}:consent',
      );
    });

    // The whole reason the key is built in one place: a merchant testing
    // their own widget beside a customer app must not consent for both.
    test('gives two tenants two different keys for the same decision', () {
      expect(
        chatStorageKey(_tenantA, 'consent'),
        isNot(chatStorageKey(_tenantB, 'consent')),
      );
    });

    test('gives one tenant two different keys for two decisions', () {
      expect(
        chatStorageKey(_tenantA, 'consent'),
        isNot(chatStorageKey(_tenantA, 'muted')),
      );
    });
  });

  group('MemoryChatStorage', () {
    test('reads back what was written', () async {
      final MemoryChatStorage storage = MemoryChatStorage();
      await storage.write('k', 'true');
      expect(await storage.read('k'), 'true');
    });

    // Absent is null, never the empty string — "nothing was stored" and "an
    // empty answer was stored" are different facts.
    test('reads an unwritten key as null', () async {
      expect(await MemoryChatStorage().read('missing'), isNull);
    });

    test('replaces an existing value', () async {
      final MemoryChatStorage storage = MemoryChatStorage();
      await storage.write('k', 'first');
      await storage.write('k', 'second');
      expect(await storage.read('k'), 'second');
    });

    // Two widgets up at once must not answer for each other any more than two
    // tenants must — the default store is per-instance, not a static map.
    test('does not share state between instances', () async {
      final MemoryChatStorage first = MemoryChatStorage();
      await first.write('k', 'true');
      expect(await MemoryChatStorage().read('k'), isNull);
    });
  });

  group('SharedPreferencesChatStorage', () {
    setUp(() {
      SharedPreferencesAsyncPlatform.instance =
          InMemorySharedPreferencesAsync.empty();
    });

    test('reads back what was written', () async {
      const SharedPreferencesChatStorage storage =
          SharedPreferencesChatStorage();
      await storage.write(chatStorageKey(_tenantA, 'consent'), 'true');
      expect(await storage.read(chatStorageKey(_tenantA, 'consent')), 'true');
    });

    test('reads an unwritten key as null', () async {
      const SharedPreferencesChatStorage storage =
          SharedPreferencesChatStorage();
      expect(await storage.read(chatStorageKey(_tenantA, 'consent')), isNull);
    });

    // The legacy `SharedPreferences` class prefixes every key with `flutter.`;
    // `SharedPreferencesAsync` does not. This asserts the key this package
    // built is the key that reaches the platform, so `chatStorageKey`'s
    // per-publishable-key namespace is not sitting behind a second one.
    test('stores under the exact key it was given, unprefixed', () async {
      const SharedPreferencesChatStorage storage =
          SharedPreferencesChatStorage();
      final String key = chatStorageKey(_tenantA, 'consent');
      await storage.write(key, 'true');
      expect(await SharedPreferencesAsync().getKeys(), contains(key));
    });

    test('keeps two tenants apart on one device', () async {
      const SharedPreferencesChatStorage storage =
          SharedPreferencesChatStorage();
      await storage.write(chatStorageKey(_tenantA, 'consent'), 'true');
      expect(await storage.read(chatStorageKey(_tenantB, 'consent')), isNull);
    });
  });
}
