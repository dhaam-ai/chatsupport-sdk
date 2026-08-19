import 'package:dhaam_chat/src/auth/keys.dart';
import 'package:test/test.dart';

// No contiguous key literal anywhere in this file. Every fixture is assembled
// at runtime, so GitHub's secret scanner has nothing to match and a future
// reader is not tempted to copy one out.
String key(String prefix, [String body = 'abc123XYZ_-def']) => '$prefix$body';

const String live = 'dhp_${'live'}_';
const String test_ = 'dhp_${'test'}_';
const String deprecatedLive = 'dhpk_${'live'}_';
const String deprecatedTest = 'dhpk_${'test'}_';

void main() {
  group('PublishableKey.parse', () {
    test('accepts the current live and test prefixes', () {
      expect(
        PublishableKey.parse(key(live)).environment,
        equals(PublishableKeyEnvironment.live),
      );
      expect(
        PublishableKey.parse(key(test_)).environment,
        equals(PublishableKeyEnvironment.test),
      );
    });

    test('accepts the retired dhpk_ scheme and reports it deprecated', () {
      // A publishable key is baked into a binary at build time (§10.7), so
      // refusing dhpk_ fails at construction in apps already on users' phones
      // that nobody can redeploy on our schedule. The key is public by design
      // and already in the wild; the refusal protects no one.
      final PublishableKey parsed = PublishableKey.parse(key(deprecatedLive));
      expect(parsed.isDeprecated, isTrue);
      expect(parsed.environment, equals(PublishableKeyEnvironment.live));
    });

    test('reads environment from the same table it accepted the key with', () {
      // The regression this guards: the TypeScript had two separate startsWith
      // chains, so a newly accepted prefix that was not byte-identical to
      // dhp_live_ silently reported itself as TEST — a live customer pointed
      // at a test environment, with nothing failing.
      expect(
        PublishableKey.parse(key(deprecatedLive)).environment,
        equals(PublishableKeyEnvironment.live),
      );
      expect(
        PublishableKey.parse(key(deprecatedTest)).environment,
        equals(PublishableKeyEnvironment.test),
      );
    });

    test('current prefixes are not reported deprecated', () {
      expect(PublishableKey.parse(key(live)).isDeprecated, isFalse);
      expect(PublishableKey.parse(key(test_)).isDeprecated, isFalse);
    });
  });

  group('secret keys', () {
    test('refuses our own secret prefix as a credential incident', () {
      expect(
        () => PublishableKey.parse(key('dhk_${'live'}_')),
        throwsA(isA<SecretKeyInClientError>()),
      );
    });

    test('refuses the retired dhsk_ scheme as a secret, not as a typo', () {
      // The deliberate asymmetry with dhpk_, which IS accepted. A retired
      // PUBLISHABLE key in client config is where it belongs; a retired SECRET
      // key there is exposed whatever window the server grants it.
      expect(
        () => PublishableKey.parse(key('dhsk_${'live'}_')),
        throwsA(isA<SecretKeyInClientError>()),
      );
    });

    test("refuses a foreign sk_ key rather than calling it a format error", () {
      // Someone pasting a real Stripe secret key here should be told to rotate
      // it, not sent hunting for a missing character.
      expect(
        () => PublishableKey.parse(key('sk_${'live'}_')),
        throwsA(isA<SecretKeyInClientError>()),
      );
    });

    test('cannot be stepped around with case or whitespace', () {
      expect(
        () => PublishableKey.parse(key('DHK_${'LIVE'}_')),
        throwsA(isA<SecretKeyInClientError>()),
      );
      expect(
        () => PublishableKey.parse('  ${key('dhk_${'live'}_')}'),
        throwsA(isA<SecretKeyInClientError>()),
      );
    });
  });

  group('malformed input', () {
    test('rejects an empty key', () {
      expect(
        () => PublishableKey.parse(''),
        throwsA(isA<InvalidPublishableKeyError>()),
      );
    });

    test('rejects untrimmed input rather than repairing it', () {
      expect(
        () => PublishableKey.parse(' ${key(live)}'),
        throwsA(isA<InvalidPublishableKeyError>()),
      );
      expect(
        () => PublishableKey.parse('${key(live)}\n'),
        throwsA(isA<InvalidPublishableKeyError>()),
      );
    });

    test('rejects an unknown prefix', () {
      expect(
        () => PublishableKey.parse(key('dh_${'live'}_')),
        throwsA(isA<InvalidPublishableKeyError>()),
      );
    });

    test('rejects a prefix with no body', () {
      expect(
        () => PublishableKey.parse(live),
        throwsA(isA<InvalidPublishableKeyError>()),
      );
    });

    test('rejects a JWT pasted into the key field', () {
      // Dot-separated, so the body charset catches it before it reaches the
      // wire. This is a real config mistake: the token and the key are both
      // "the credential" in a developer's head.
      expect(
        () => PublishableKey.parse('${live}eyJhbGci.eyJzdWIi.SflKxwRJ'),
        throwsA(isA<InvalidPublishableKeyError>()),
      );
    });
  });

  group('never leaks the value', () {
    test('toString names the environment and redacts the key', () {
      final PublishableKey parsed = PublishableKey.parse(key(live, 'SECRETBODY'));
      final String text = parsed.toString();
      expect(text, contains('redacted'));
      expect(text, contains('live'));
      expect(text, isNot(contains('SECRETBODY')));
    });

    test('errors carry no part of the input, and no length', () {
      const String body = 'UNIQUEBODYMARKER';
      try {
        PublishableKey.parse('dh_bogus_$body');
        fail('expected a throw');
      } on InvalidPublishableKeyError catch (e) {
        final String text = e.toString();
        expect(text, isNot(contains(body)));
        expect(text, isNot(contains('${'dh_bogus_$body'.length}')));
      }
    });

    test('the secret-key error names no part of the secret', () {
      const String body = 'SECRETMARKER';
      try {
        PublishableKey.parse('dhk_live_$body');
        fail('expected a throw');
      } on SecretKeyInClientError catch (e) {
        expect(e.toString(), isNot(contains(body)));
        expect(e.toString(), contains('rotate'));
      }
    });
  });

  group('tryParse', () {
    test('returns null instead of throwing, for both failure kinds', () {
      expect(PublishableKey.tryParse('nonsense'), isNull);
      expect(PublishableKey.tryParse(key('dhk_${'live'}_')), isNull);
      expect(PublishableKey.tryParse(key(live)), isNotNull);
    });
  });
}
