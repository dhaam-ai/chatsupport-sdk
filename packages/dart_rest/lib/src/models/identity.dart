/// `POST /identify` — upserting the logged-in customer into the CRM.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show WireEnum;

import '../internal/json_reading.dart';

/// The request body for `RestClient.identify`.
///
/// ── Every optional is a plain `String?`, never a tri-state ────────────────
///
/// The route's own write matrix collapses absent, `null` and `''` to the same
/// "not present" server-side, so this side only ever needs to OMIT a field and
/// never to send an explicit null. [toJson] therefore omits every null field
/// entirely: an absent Dart value never becomes a JSON `null`.
///
/// That matters more than it looks. The route body is `.strict()`, so a field
/// present with a null value is not the same request as a field that is
/// absent, and sending `{"email": null}` is how an identify call starts
/// failing validation for a customer who simply has no email on file.
class RestIdentityProfile {
  const RestIdentityProfile({
    this.name,
    this.email,
    this.phone,
    this.city,
    this.country,
    this.tags,
    this.device,
  });

  final String? name;
  final String? email;
  final String? phone;
  final String? city;
  final String? country;
  final List<String>? tags;
  final RestIdentityDevice? device;

  Map<String, Object?> toJson() => <String, Object?>{
        if (name != null) 'name': name,
        if (email != null) 'email': email,
        if (phone != null) 'phone': phone,
        if (city != null) 'city': city,
        if (country != null) 'country': country,
        if (tags != null) 'tags': tags,
        if (device != null) 'device': device!.toJson(),
      };
}

/// The optional `device` block on an identify request.
class RestIdentityDevice {
  const RestIdentityDevice({
    required this.deviceId,
    this.deviceToken,
    this.platform,
  });

  final String deviceId;
  final String? deviceToken;
  final RestDevicePlatform? platform;

  Map<String, Object?> toJson() => <String, Object?>{
        'deviceId': deviceId,
        if (deviceToken != null) 'deviceToken': deviceToken,
        if (platform != null) 'platform': platform!.wire,
      };
}

/// `'ios' | 'android' | 'web'` on the wire.
///
/// Lowercase, unlike every other enum in this package's vocabulary, which are
/// all upper-snake. That is the route's own spelling, not a normalization this
/// package is free to tidy — sending `'IOS'` is a validation failure.
enum RestDevicePlatform implements WireEnum {
  ios('ios'),
  android('android'),
  web('web');

  const RestDevicePlatform(this.wire);

  @override
  final String wire;

  static RestDevicePlatform? fromWire(String value) =>
      _lookupWire(values, value);
}

/// Linear scan over three constants.
///
/// `dhaam_chat` exports [WireEnum] but keeps its own `_lookup` private, and
/// `packages/flutter` declares a public `lookupWire` for its config enums. A
/// third public copy here would put a general-purpose utility on this
/// package's API surface to serve exactly one enum, so this one stays private.
/// A prebuilt map would be faster and would also need one static per enum; at
/// three values the scan is not measurable next to the JSON decode before it.
T? _lookupWire<T extends WireEnum>(List<T> values, String wire) {
  for (final T value in values) {
    if (value.wire == wire) return value;
  }
  return null;
}

/// `POST /identify`'s response — the `data` on a 200.
class RestIdentityResult {
  const RestIdentityResult({
    required this.contactId,
    required this.externalId,
    required this.lastLoginAt,
  });

  /// Throws `RestMalformedResponseException` if any of the three documented
  /// response fields is absent or unusable. All three are required: a receipt
  /// missing its contact id is not a partially-successful identify, it is a
  /// response this package does not understand.
  factory RestIdentityResult.fromJson(
    Map<String, Object?> json,
    String context,
  ) =>
      RestIdentityResult(
        contactId: requireNonEmptyString(
          json,
          'contactId',
          'identity',
          context: context,
        ),
        externalId: requireNonEmptyString(
          json,
          'externalId',
          'identity',
          context: context,
        ),
        lastLoginAt: requireTimestamp(
          json,
          'lastLoginAt',
          'identity',
          context: context,
        ),
      );

  final String contactId;
  final String externalId;

  /// A [DateTime], NOT the raw string TS deliberately keeps here.
  ///
  /// ── The same principle, producing the opposite concrete choice ────────
  ///
  /// `identity.ts`'s own comment is explicit that it does NOT parse this into
  /// a `Date`, "because the value is a receipt to log rather than a clock to
  /// read, and a `Date` here would be the only place in this package that
  /// reinterprets a server timestamp." That is a CONSISTENCY argument:
  /// `packages/rest` keeps every timestamp everywhere as a raw string, and
  /// `identity.ts` is declining to be the one field that breaks the pattern.
  ///
  /// Applying the same principle inside `dart_rest` inverts the answer.
  /// `dhaam_chat`'s convention — `ChatMessage.createdAt`,
  /// `SessionSnapshot.createdAt`, `ParticipantSnapshot.lastReadAt` — is that
  /// every wire timestamp is a [DateTime], with zero exceptions. Making this
  /// field the one `String` in an otherwise all-`DateTime` Dart SDK would be
  /// the identical inconsistency TS's comment argues against, just inverted
  /// (contract §5.7).
  final DateTime lastLoginAt;
}
