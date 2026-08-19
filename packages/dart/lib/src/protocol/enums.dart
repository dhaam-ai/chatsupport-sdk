/// Wire enums — PRD §0.5 D4, §12.1.
///
/// D4: "One wire format: string-name enums, camelCase keys, ISO-8601
/// timestamps, one canonical name per concept [...] Core ships ZERO enum/key
/// coercion." This package holds that line. Each enum below carries the exact
/// canonical string it occupies on the wire, and [fromWire] returns `null` for
/// anything else rather than guessing.
///
/// That null matters. v1's clients each grew a `normalizeChatStatus` that
/// accepted the integer form OR the string form and fell back to a default
/// when it recognised neither (§12.2) — which is how `RESOLVED` and `ON_HOLD`
/// silently became `OPEN` for years (§12.1). A fallback here would rebuild
/// that bug in a new language. An unrecognised value is a protocol violation
/// and is surfaced as one.
///
/// The INTEGER values in §12.1 are the backend's internal representation and
/// never appear on this endpoint (D4). Nothing in this package parses them.
library;

/// Implemented by every enum in this file.
///
/// Exists so [_lookup] can read `.wire` through a static type. The obvious
/// alternative — `(value as dynamic).wire` — compiles, and then fails at
/// runtime the first time someone adds an enum and forgets the field.
abstract interface class WireEnum {
  /// The canonical string this value occupies on the wire (D4).
  String get wire;
}

/// Who sent a message (§12.1).
///
/// Note that v2 is customer-only today: the server hardcodes `senderType` to
/// `CUSTOMER` for anything a client sends. [agent], [bot] and [system] are
/// receive-only — they arrive on `message.new`, and no client can produce one.
enum SenderType implements WireEnum {
  customer('CUSTOMER'),
  agent('AGENT'),
  bot('BOT'),
  system('SYSTEM');

  const SenderType(this.wire);

  /// The canonical string this value occupies on the wire.
  @override
  final String wire;

  /// Parses a wire value, or returns `null` if it is not one of ours.
  static SenderType? fromWire(String value) => _lookup(values, value);
}

/// What kind of content a message carries (§12.1).
enum MessageType implements WireEnum {
  text('TEXT'),
  system('SYSTEM'),
  file('FILE'),
  image('IMAGE'),
  video('VIDEO'),
  audio('AUDIO'),
  typing('TYPING');

  const MessageType(this.wire);

  @override
  final String wire;

  static MessageType? fromWire(String value) => _lookup(values, value);
}

/// Session status. All SIX backend values (§12.1).
///
/// v1's type system modelled four and collapsed the other two into [open].
/// Removing a value here reintroduces that bug in Dart.
enum ChatStatus implements WireEnum {
  open('OPEN'),
  waitingForAgent('WAITING_FOR_AGENT'),
  assigned('ASSIGNED'),
  closed('CLOSED'),
  resolved('RESOLVED'),
  onHold('ON_HOLD');

  const ChatStatus(this.wire);

  @override
  final String wire;

  static ChatStatus? fromWire(String value) => _lookup(values, value);
}

/// Whether the session is being handled by the bot or a human (§12.5).
enum ChatMode implements WireEnum {
  bot('BOT'),
  human('HUMAN');

  const ChatMode(this.wire);

  @override
  final String wire;

  static ChatMode? fromWire(String value) => _lookup(values, value);
}

/// Participant presence (§12.1).
enum PresenceStatus implements WireEnum {
  online('ONLINE'),
  offline('OFFLINE'),
  away('AWAY'),
  dnd('DND');

  const PresenceStatus(this.wire);

  @override
  final String wire;

  static PresenceStatus? fromWire(String value) => _lookup(values, value);
}

/// What a participant is (§12.1).
enum ParticipantType implements WireEnum {
  customer('CUSTOMER'),
  agent('AGENT'),
  bot('BOT');

  const ParticipantType(this.wire);

  @override
  final String wire;

  static ParticipantType? fromWire(String value) => _lookup(values, value);
}

/// Why a session closed (§12.5).
///
/// [switched] is the distinction v1 could not express: `CLOSED` meant both
/// "genuinely ended" and "parked because the customer moved to another chat".
/// A host app should almost certainly render those differently.
enum CloseReason implements WireEnum {
  resolved('RESOLVED'),
  manual('MANUAL'),
  switched('SWITCHED');

  const CloseReason(this.wire);

  @override
  final String wire;

  static CloseReason? fromWire(String value) => _lookup(values, value);
}

/// Linear scan over a handful of constants. A prebuilt map would be faster and
/// would also need one static per enum; at six values the scan is not
/// measurable next to the JSON decode that precedes it.
T? _lookup<T extends WireEnum>(List<T> values, String wire) {
  for (final T value in values) {
    if (value.wire == wire) return value;
  }
  return null;
}
