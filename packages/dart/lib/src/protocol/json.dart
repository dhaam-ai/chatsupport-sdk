/// Typed readers for untrusted JSON — PRD §14, §7.2.
///
/// §14 requires every inbound frame to be validated against §7.2 BEFORE any
/// business logic runs, and never partially applied. These helpers are how
/// that is enforced without a hand-written `is!` ladder at every field: each
/// either returns a correctly-typed value or throws [FrameDecodeException].
/// There is no third outcome and no coercion (D4).
///
/// Every reader takes a dot `path` so a failure names the field a developer
/// has to go and fix. None of them put the offending VALUE in the exception —
/// see [FrameDecodeException].
library;

import 'errors.dart';

/// Requires [value] to be a JSON object.
Map<String, Object?> requireObject(
  Object? value,
  String path, {
  String? frameType,
}) {
  if (value is! Map<String, Object?>) {
    throw FrameDecodeException(path, 'must be an object', frameType: frameType);
  }
  return value;
}

/// Requires `object[key]` to be a string.
String requireString(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  final Object? value = object[key];
  if (value is! String) {
    throw FrameDecodeException(
      '$path.$key',
      'must be a string',
      frameType: frameType,
    );
  }
  return value;
}

/// Requires `object[key]` to be a non-empty string.
String requireNonEmptyString(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  final String value = requireString(object, key, path, frameType: frameType);
  if (value.isEmpty) {
    throw FrameDecodeException(
      '$path.$key',
      'must be a non-empty string',
      frameType: frameType,
    );
  }
  return value;
}

/// Reads an optional string. Absent and explicit-null are both `null`.
String? optionalString(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  final Object? value = object[key];
  if (value == null) return null;
  if (value is! String) {
    throw FrameDecodeException(
      '$path.$key',
      'must be a string when present',
      frameType: frameType,
    );
  }
  return value;
}

/// Reads a string that may be ABSENT, but which must be a non-empty string
/// whenever the key is present at all.
///
/// Deliberately stricter than [optionalString], which folds an explicit `null`
/// into the same answer as a missing key. For the identity fields added by the
/// v2 wire contract — `ParticipantSnapshot.displayName` — absent and null are
/// different claims and the server only ever makes the first: absent means "no
/// display name was resolved for this participant, render your own label",
/// while `null` or `""` is a name-shaped hole that a binding will happily
/// render as an empty header and nobody will notice until a customer does.
/// Refusing them here is the only place that decision can be made once.
String? optionalNonEmptyString(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  if (!object.containsKey(key)) return null;
  final Object? value = object[key];
  if (value is! String || value.isEmpty) {
    throw FrameDecodeException(
      '$path.$key',
      'must be a non-empty string when present',
      frameType: frameType,
    );
  }
  return value;
}

/// Requires `object[key]` to be an integer.
///
/// Accepts a JSON number that happens to be integral (`3.0`) as well as a Dart
/// `int`. On Flutter Web every Dart number is a double, so `"seq": 3` decodes
/// to `3.0` and an `is int` test alone would reject a perfectly valid frame on
/// exactly one of the three platforms this package targets. A non-integral
/// value like `3.5` is still refused.
int requireInt(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  final Object? value = object[key];
  if (value is int) return value;
  if (value is double && value.isFinite && value == value.roundToDouble()) {
    return value.toInt();
  }
  throw FrameDecodeException(
    '$path.$key',
    'must be an integer',
    frameType: frameType,
  );
}

/// Reads an optional integer. Absent and explicit-null are both `null`.
int? optionalInt(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  if (object[key] == null) return null;
  return requireInt(object, key, path, frameType: frameType);
}

/// Requires `object[key]` to be a non-negative integer `seq` watermark.
///
/// `seq` is allocated by the server starting at 1, so a negative is not a
/// value any honest peer can hold. Refusing it here means no downstream code
/// has to decide what a negative watermark means.
int requireSeq(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  final int value = requireInt(object, key, path, frameType: frameType);
  if (value < 0) {
    throw FrameDecodeException(
      '$path.$key',
      'must be a non-negative integer seq',
      frameType: frameType,
    );
  }
  return value;
}

/// Requires `object[key]` to be a boolean.
bool requireBool(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  final Object? value = object[key];
  if (value is! bool) {
    throw FrameDecodeException(
      '$path.$key',
      'must be a boolean',
      frameType: frameType,
    );
  }
  return value;
}

/// ISO-8601 with an explicit `T` separator and an explicit zone.
///
/// Deliberately stricter than [DateTime.parse], which also accepts a space
/// separator and — the dangerous part — accepts a string with NO zone and
/// silently interprets it as DEVICE-LOCAL time. A `createdAt` that arrived
/// without a `Z` would then be read as local on a phone in IST and be five and
/// a half hours wrong, with nothing failing. This pattern refuses it instead.
///
/// Matches the server's `ISO_8601_PATTERN` character for character.
final RegExp _iso8601 = RegExp(
  r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$',
);

/// Requires `object[key]` to be an ISO-8601 timestamp, returned in UTC.
///
/// §7.2: "Every timestamp field is ISO-8601". This is for PAYLOAD timestamps
/// (`createdAt`, `readAt`, `lastSeen`) ONLY. The envelope's `ts` is epoch
/// millis and is read by [requireEpochMillis] — see the note there.
DateTime requireIsoTimestamp(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  final String raw = requireString(object, key, path, frameType: frameType);
  if (!_iso8601.hasMatch(raw)) {
    throw FrameDecodeException(
      '$path.$key',
      'must be an ISO-8601 timestamp with an explicit timezone',
      frameType: frameType,
    );
  }
  return DateTime.parse(raw).toUtc();
}

/// Reads an optional ISO-8601 timestamp.
DateTime? optionalIsoTimestamp(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  if (object[key] == null) return null;
  return requireIsoTimestamp(object, key, path, frameType: frameType);
}

/// Requires `object[key]` to be epoch millis, returned in UTC.
///
/// ── The one type confusion this protocol punishes hardest ─────────────────
///
/// The envelope's `ts` is a NUMBER of epoch milliseconds (§7.2). Payload
/// timestamps such as `createdAt` are ISO-8601 STRINGS (§7.2's payload rules).
/// Both are "a timestamp" in English and they are different types on the wire.
/// Getting it backwards on an outbound frame earns
/// `VALIDATION_FAILED: ts must be a finite epoch-millis number`.
///
/// This package's structural answer is that both become a Dart [DateTime], and
/// the SERIALISER is chosen by position rather than by the caller: the
/// envelope encoder only ever writes `millisecondsSinceEpoch`, and payload
/// encoders only ever write `toIso8601String()`. A caller holding a [DateTime]
/// cannot pick the wrong one, because they never pick.
DateTime requireEpochMillis(
  Map<String, Object?> object,
  String key,
  String path, {
  String? frameType,
}) {
  final Object? value = object[key];
  final double millis;
  if (value is int) {
    millis = value.toDouble();
  } else if (value is double) {
    millis = value;
  } else {
    // A string lands here — including a well-formed ISO-8601 one. That is the
    // symmetric version of the outbound mistake above and is refused with the
    // same words the server uses, so the two halves of the bug read alike.
    throw FrameDecodeException(
      '$path.$key',
      'must be a finite epoch-millis number',
      frameType: frameType,
    );
  }
  if (!millis.isFinite) {
    throw FrameDecodeException(
      '$path.$key',
      'must be a finite epoch-millis number',
      frameType: frameType,
    );
  }
  return DateTime.fromMillisecondsSinceEpoch(millis.toInt(), isUtc: true);
}

/// Requires `object[key]` to be one of an enum's wire values.
T requireEnum<T>(
  Map<String, Object?> object,
  String key,
  String path,
  T? Function(String) parse,
  String label, {
  String? frameType,
}) {
  final String raw = requireString(object, key, path, frameType: frameType);
  final T? parsed = parse(raw);
  if (parsed == null) {
    // The value is NOT echoed. An unknown enum is the one case where echoing
    // is tempting and still wrong: `d` on a `connection.hello` holds a token,
    // and a rule with an exception is a rule nobody applies consistently.
    throw FrameDecodeException(
      '$path.$key',
      'must be a valid $label',
      frameType: frameType,
    );
  }
  return parsed;
}
