/// The serialization and decode half of `packages/rest/src/identity.test.ts`.
///
/// T7 owns `RestClient.identify` itself and the request/response plumbing
/// around it; this file pins the two model-level facts that method depends on
/// — that an unsupplied optional is OMITTED rather than sent as a JSON null,
/// and that all three receipt fields are required.
library;

import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/models/identity.dart';
import 'package:test/test.dart';

const String _ctx = 'POST /identify';

void main() {
  group('RestIdentityProfile.toJson', () {
    test('puts the full profile on the wire unchanged', () {
      const RestIdentityProfile profile = RestIdentityProfile(
        name: 'Jordan Rivera',
        email: 'jordan@example.com',
        phone: '+919820011223',
        city: 'Mumbai',
        country: 'IN',
        tags: <String>['vip', 'not-a-real-tag'],
        device: RestIdentityDevice(
          deviceId: 'web-9f2c-4b1a',
          deviceToken: 'tkn-1',
          platform: RestDevicePlatform.web,
        ),
      );

      expect(profile.toJson(), <String, Object?>{
        'name': 'Jordan Rivera',
        'email': 'jordan@example.com',
        'phone': '+919820011223',
        'city': 'Mumbai',
        'country': 'IN',
        'tags': <String>['vip', 'not-a-real-tag'],
        'device': <String, Object?>{
          'deviceId': 'web-9f2c-4b1a',
          'deviceToken': 'tkn-1',
          'platform': 'web',
        },
      });
    });

    test('omits an unsupplied optional entirely rather than sending a null',
        () {
      // The load-bearing serialization assertion. Both the body and `device`
      // are `.strict()`, and the route's write matrix distinguishes "not
      // present" from a value — so `{"phone": null}` and no `phone` are
      // different requests, and only one of them is valid.
      const RestIdentityProfile profile =
          RestIdentityProfile(name: 'Jordan Rivera');

      expect(profile.toJson(), <String, Object?>{'name': 'Jordan Rivera'});
      expect(profile.toJson().containsKey('phone'), isFalse);
      expect(profile.toJson().containsKey('device'), isFalse);
    });

    test('an entirely empty profile serializes to an empty body, not nulls',
        () {
      expect(const RestIdentityProfile().toJson(), isEmpty);
    });

    test('omits an unsupplied device field the same way', () {
      const RestIdentityDevice device =
          RestIdentityDevice(deviceId: 'web-9f2c-4b1a');

      expect(device.toJson(), <String, Object?>{'deviceId': 'web-9f2c-4b1a'});
    });

    test('sends the platform lowercase, as the route spells it', () {
      // The one lowercase enum in this package's vocabulary. Sending 'WEB'
      // would be a validation failure, so the wire spelling is not something
      // this package is free to normalize into the house style.
      for (final RestDevicePlatform platform in RestDevicePlatform.values) {
        expect(platform.wire, platform.wire.toLowerCase());
        expect(RestDevicePlatform.fromWire(platform.wire), platform);
      }
      expect(RestDevicePlatform.web.wire, 'web');
      expect(RestDevicePlatform.fromWire('WEB'), isNull);
      expect(RestDevicePlatform.fromWire('desktop'), isNull);
    });
  });

  group('RestIdentityResult.fromJson', () {
    test('reads the receipt, with lastLoginAt as a DateTime', () {
      final RestIdentityResult result = RestIdentityResult.fromJson(
        <String, Object?>{
          'contactId': '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          'externalId': 'usr_9f2',
          'lastLoginAt': '2026-08-21T09:14:03.512Z',
        },
        _ctx,
      );

      expect(result.contactId, '3fa85f64-5717-4562-b3fc-2c963f66afa6');
      expect(result.externalId, 'usr_9f2');
      // A DateTime, not the raw string TS deliberately keeps — contract §5.7.
      // The same consistency argument, applied inside a Dart SDK where every
      // other wire timestamp is a DateTime, inverts TS's concrete answer.
      expect(result.lastLoginAt, isA<DateTime>());
      expect(result.lastLoginAt, DateTime.utc(2026, 8, 21, 9, 14, 3, 512));
    });

    for (final String missing in <String>[
      'contactId',
      'externalId',
      'lastLoginAt',
    ]) {
      test('throws when $missing is absent', () {
        // A receipt missing its contact id is not a partially-successful
        // identify; it is a response this package does not understand.
        final Map<String, Object?> body = <String, Object?>{
          'contactId': 'c1',
          'externalId': 'usr_9f2',
          'lastLoginAt': '2026-08-21T09:14:03.512Z',
        }..remove(missing);

        expect(
          () => RestIdentityResult.fromJson(body, _ctx),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }

    test('throws on an empty-string contactId, not just an absent one', () {
      expect(
        () => RestIdentityResult.fromJson(
          <String, Object?>{
            'contactId': '',
            'externalId': 'usr_9f2',
            'lastLoginAt': '2026-08-21T09:14:03.512Z',
          },
          _ctx,
        ),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('throws on an unparseable lastLoginAt', () {
      expect(
        () => RestIdentityResult.fromJson(
          <String, Object?>{
            'contactId': 'c1',
            'externalId': 'usr_9f2',
            'lastLoginAt': 'not a date',
          },
          _ctx,
        ),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });
  });

  group('RestIssueReport-style omission is the house convention', () {
    test('the identify body and the issue report agree on null handling', () {
      // Both omit rather than null, and for the same reason on both routes:
      // the server runs its own validation on the field, and an empty or null
      // value fails it for a customer who simply left it blank.
      expect(const RestIdentityProfile(email: null).toJson(), isEmpty);
    });
  });
}
