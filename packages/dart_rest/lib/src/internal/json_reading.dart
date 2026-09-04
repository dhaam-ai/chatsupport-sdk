/// Typed readers for untrusted JSON off the REST surface.
///
/// The same job `dhaam_chat`'s `protocol/json.dart` does for frames, with the
/// same shapes and the same reasoning — and a different throw target.
///
/// ── Why these are duplicated rather than imported ─────────────────────────
///
/// Two independent reasons, either of which alone would be sufficient.
///
///  1. Access. `dhaam_chat`'s `json.dart` is not exported from its barrel, so
///     nothing outside that package can reach it.
///  2. Shape, which is the real reason. Every reader there throws
///     `FrameDecodeException`, which carries a `frameType` and is documented as
///     part of the §14 "every inbound FRAME is untrusted" WebSocket contract. A
///     REST decode failure is not a frame failure: it needs a route, not a
///     frame type. So these throw [RestMalformedResponseException] instead.
///
/// This mirrors, almost exactly, why TS's own `projection.ts` declares
/// `asRecord`/`requireString`/`toIso` instead of importing
/// `@dhaam-ccrm/core`'s: two packages solving adjacent but distinct validation
/// problems, each owning its own readers.
///
/// ── The one deliberate divergence from `dhaam_chat`: timestamps ───────────
///
/// `requireIsoTimestamp` there is STRICT — it refuses anything without an
/// explicit `T` separator and an explicit zone, because the WS wire has one
/// documented format and nothing has ever been seen to deviate.
/// [readTimestamp] here is LENIENT, accepting an ISO string OR an epoch-millis
/// number, because it defends against a documented REST-specific
/// inconsistency: chat-service returns a raw `Date` on a cache miss and an ISO
/// string on a Redis cache hit (`projection.ts:94-106`), and by the time
/// either has crossed HTTP and JSON both arrive here as a JSON string or a
/// JSON number. Narrowing this to the WS pattern would resurface the exact bug
/// TS's `toIso` was written to prevent.
///
/// Leniency of INPUT and `DateTime` as OUTPUT (contract §5.7) are two separate
/// decisions made for two separate reasons, and this file keeps both
/// independently rather than adopting one sibling's convention wholesale.
///
/// ── Every reader names a dot path, and none names a value ─────────────────
///
/// Same absolute rule as `dhaam_chat`'s: the exception says which field was
/// wrong, never what was in it. Rows on this service carry customer message
/// bodies and signed attachment URLs (§14), and these exceptions are exactly
/// the kind a Flutter host hands to a crash reporter.
library;

import '../errors.dart';

/// The one failure this file raises. Mirrors `projection.ts`'s `malformed`.
RestMalformedResponseException malformed(String context, String detail) =>
    RestMalformedResponseException(context: context, detail: detail);

/// Requires [value] to be a JSON object.
///
/// A `List` fails this naturally in Dart, unlike TS — where `typeof [] ===
/// 'object'` forces `asRecord` to test `Array.isArray` by hand.
Map<String, Object?> requireObject(
  Object? value,
  String path, {
  required String context,
}) {
  if (value is! Map<String, Object?>) {
    throw malformed(context, '$path must be an object');
  }
  return value;
}

// ── Strings ────────────────────────────────────────────────────────────────

/// Requires `object[key]` to be a non-empty string.
///
/// TS's `requireString` treats `''` as missing, and so does this: a
/// zero-length id or session id is a field-shaped hole that every downstream
/// list would happily key on and nobody would notice until a customer did.
String requireNonEmptyString(
  Map<String, Object?> object,
  String key,
  String path, {
  required String context,
}) {
  final Object? value = object[key];
  if (value is! String || value.isEmpty) {
    throw malformed(context, 'missing $path.$key');
  }
  return value;
}

/// Reads an optional string, folding absent, explicit-null, `''` and
/// wrong-typed all into `null`.
///
/// Deliberately NEVER throws, mirroring TS's `optionalString` exactly. Every
/// field read through this one is additive — `replyToMessageId`, `subject`,
/// `topic`, `lastMessagePreview`, an avatar URL — and losing an additive field
/// is a strictly better outcome than losing the row that carries it.
///
/// This is the inverse of `dhaam_chat`'s `optionalNonEmptyString`, which
/// refuses `''` loudly. The difference is deliberate and follows the wire: on
/// the WS side an empty `displayName` is a server bug worth surfacing, while
/// this service documents `''` and absent as the same claim for exactly these
/// fields.
///
/// Takes no `path` or `context`, unlike its throwing siblings above, because
/// it has nothing to put them in. The shorter signature is the signal: a
/// reader here either names a dot path and can throw, or does neither.
String? optionalString(Map<String, Object?> object, String key) =>
    optionalStringValue(object[key]);

/// [optionalString] for a value already read out of a map.
///
/// Exists for the placeholder path in `message_decode.dart`, which re-reads a
/// row it has already failed to decode and must not throw a second time.
String? optionalStringValue(Object? value) =>
    value is String && value.isNotEmpty ? value : null;

// ── Numbers ────────────────────────────────────────────────────────────────

/// Requires `object[key]` to be an integer.
///
/// Accepts a JSON number that happens to be integral (`3.0`) as well as a Dart
/// `int`, for the same reason `dhaam_chat`'s `requireInt` does: on Flutter Web
/// every Dart number is a double, so `"rating": 3` decodes to `3.0` and an
/// `is int` test alone would reject a valid body on exactly one of the three
/// platforms this package targets. A non-integral `3.5` is still refused.
int requireInt(
  Map<String, Object?> object,
  String key,
  String path, {
  required String context,
}) {
  final int? value = _asInt(object[key]);
  if (value == null) {
    throw malformed(context, 'missing or invalid $path.$key');
  }
  return value;
}

/// Requires `object[key]` to be an integer of at least zero.
///
/// `unreadCount` is documented `minimum: 0`, "`0`, never absent, when nothing
/// is unread" — so, like the enum fields, a value outside that contract is
/// refused rather than clamped or defaulted. A negative or missing count would
/// make a picker's unread badge lie in a direction no caller can detect.
int requireNonNegativeInt(
  Map<String, Object?> object,
  String key,
  String path, {
  required String context,
}) {
  final int value = requireInt(object, key, path, context: context);
  if (value < 0) {
    throw malformed(context, 'missing or invalid $path.$key');
  }
  return value;
}

/// Reads an optional integer, folding absent, null and wrong-typed into
/// `null`. Never throws.
///
/// Used for `seq`, which the WS schema requires but which rows predating
/// sequencing legitimately lack. Failing a whole page of history over one
/// legacy row is a worse outcome than that row arriving unordered, so a
/// missing or non-integral `seq` is simply omitted — matching TS's
/// `if (typeof source['seq'] === 'number')` guard, which likewise assigns or
/// skips and never throws.
int? optionalIntValue(Object? value) => _asInt(value);

/// The lenient integer reading shared by every reader above.
int? _asInt(Object? value) {
  if (value is int) return value;
  if (value is double && value.isFinite && value == value.roundToDouble()) {
    return value.toInt();
  }
  return null;
}

// ── Booleans ───────────────────────────────────────────────────────────────

/// Requires `object[key]` to be a boolean.
///
/// No coercion: `getCsat`'s `rated` is the field this exists for, and reading
/// a truthy non-boolean as `true` there would lock a survey card on a session
/// that was never rated.
bool requireBool(
  Map<String, Object?> object,
  String key,
  String path, {
  required String context,
}) {
  final Object? value = object[key];
  if (value is! bool) {
    throw malformed(context, 'missing or invalid $path.$key');
  }
  return value;
}

// ── Enums ──────────────────────────────────────────────────────────────────

/// Decodes one INTEGER enum through [table], or throws.
///
/// ── Why integers appear here at all ───────────────────────────────────────
///
/// chat-service's org-wide rule is that enums are stored in the DB and
/// transmitted over APIs as INTEGERS — 1-based, append-only, never renumbered
/// and never reused. The WebSocket path converts them before they leave the
/// server; the raw-row REST routes (`/messages`, `/full`) never did. This is
/// the only place in either Dart package that reads that form, and
/// `dhaam_chat`'s own `enums.dart` deliberately parses string names only.
///
/// ── Why an unmapped value throws instead of falling back ──────────────────
///
/// Guessing is what v1 did, and it is how `RESOLVED` and `ON_HOLD` silently
/// became `OPEN` for years (§12.1). Since the tables are append-only, an
/// unknown integer always means this package is behind the service — a code
/// change, not something a retry or a default can paper over. Same refusal,
/// and the same reasoning, as `dhaam_chat`'s `requireEnum`.
T requireIntEnum<T>(
  Map<int, T> table,
  Map<String, Object?> object,
  String key,
  String path, {
  required String context,
}) {
  // Read through `optionalIntValue` rather than `is int`: on Flutter Web the
  // row's `1` has already become `1.0`, and rejecting it there would break
  // this decoder on exactly one of three target platforms.
  final int? raw = optionalIntValue(object[key]);
  final T? decoded = raw == null ? null : table[raw];
  if (decoded == null) {
    // The offending VALUE is not echoed, matching every other reader here.
    throw malformed(context, 'unmappable $path.$key');
  }
  return decoded;
}

/// Decodes one STRING enum through [fromWire], or throws.
///
/// The sibling of [requireIntEnum] for routes that already send v2's canonical
/// string names — `GET /chat/sessions/customer` is the one. Same refusal to
/// guess, for the same reason: an unrecognized value means this package is
/// behind the service.
///
/// A stray INTEGER reaching here is exactly as unmappable as a bogus string,
/// and is refused identically. That is not incidental — this route is
/// documented to send strings, so an integer would mean the raw-row shape had
/// leaked onto a projected route.
T requireStringEnum<T>(
  T? Function(String) fromWire,
  Map<String, Object?> object,
  String key,
  String path, {
  required String context,
}) {
  final Object? raw = object[key];
  final T? decoded = raw is String ? fromWire(raw) : null;
  if (decoded == null) {
    throw malformed(context, 'unmappable $path.$key');
  }
  return decoded;
}

// ── Timestamps ─────────────────────────────────────────────────────────────

/// Reads a wire timestamp leniently — an ISO-8601 string OR epoch millis —
/// returning UTC, or `null` if it is neither.
///
/// See this library's header for why leniency is the right call on THIS wire
/// and strictness is the right call on the WebSocket's. Never throws: callers
/// that require a value use [requireTimestamp], and callers for whom absence
/// is a documented answer (`closedAt` on an open session, `lastMessageAt`
/// before the first public message) use it directly.
DateTime? readTimestamp(Object? value) {
  if (value == null) return null;
  if (value is num) {
    // A non-finite epoch is not a time. `DateTime.fromMillisecondsSinceEpoch`
    // would throw on it rather than return, which would turn a bad optional
    // field into a thrown exception from a function documented not to throw.
    if (!value.isFinite) return null;
    return DateTime.fromMillisecondsSinceEpoch(value.toInt(), isUtc: true);
  }
  if (value is String) return DateTime.tryParse(value)?.toUtc();
  // Anything else — a bool, an object, a list. TS's `toIso` returns null on
  // exactly the same set.
  return null;
}

/// Requires `object[key]` to be a readable timestamp.
DateTime requireTimestamp(
  Map<String, Object?> object,
  String key,
  String path, {
  required String context,
}) {
  final DateTime? value = readTimestamp(object[key]);
  if (value == null) {
    throw malformed(context, 'missing or unparseable $path.$key');
  }
  return value;
}

/// Reads an optional timestamp. Absent, explicit-null and unparseable all
/// collapse to `null` — `closedAt` on an open session is the documented case.
///
/// No `path`/`context`, for the same reason [optionalString] has none.
DateTime? optionalTimestamp(Map<String, Object?> object, String key) =>
    readTimestamp(object[key]);
