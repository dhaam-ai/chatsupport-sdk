/// Error codes and error payloads — PRD §7.4.
///
/// §7.4 exists to replace v1's `error.message === 'TOKEN_EXPIRED'` string
/// matching (§12.6) with something every platform can branch on. So this file
/// carries one rule: BRANCH ON [ErrorCode], NEVER ON [ErrorPayload.message].
/// The message is prose meant for a human reading a log.
library;

/// Canonical error codes (§7.4).
enum ErrorCode {
  /// Credentials are wrong and a fresh token will not help. Escalates to
  /// suspended (§8.2).
  authInvalid('AUTH_INVALID'),

  /// The token has expired. Worth one reactive `getToken()` (§10.4).
  authExpired('AUTH_EXPIRED'),

  /// The server cannot speak any version this client offers. Terminal — §7.5
  /// requires surfacing this as suspended rather than retry-looping against a
  /// version the client cannot speak.
  protocolVersionUnsupported('PROTOCOL_VERSION_UNSUPPORTED'),

  /// Too many frames or too many handshakes.
  rateLimited('RATE_LIMITED'),

  /// A frame was malformed. Retrying the identical frame cannot help.
  validationFailed('VALIDATION_FAILED'),

  sessionNotFound('SESSION_NOT_FOUND'),

  sessionClosed('SESSION_CLOSED'),

  internal('INTERNAL');

  const ErrorCode(this.wire);

  /// The canonical string this value occupies on the wire.
  final String wire;

  /// Parses a wire value, or returns `null` if it is not one of ours.
  static ErrorCode? fromWire(String value) {
    for (final ErrorCode code in values) {
      if (code.wire == value) return code;
    }
    return null;
  }
}

/// The `d` payload of an `error` frame, and of a failed `ack` (§7.2, §7.4).
class ErrorPayload {
  const ErrorPayload({
    required this.code,
    required this.message,
    required this.retryable,
    this.details,
  });

  /// Branch on this.
  final ErrorCode code;

  /// Human-readable. Log it, show it to a developer, never branch on it.
  final String message;

  /// Whether the server considers the failing operation worth retrying.
  final bool retryable;

  /// Optional structured extras. Contents are per-code and not part of the
  /// §7.4 contract, so treat anything read out of here as best-effort.
  final Map<String, Object?>? details;

  @override
  String toString() =>
      'ErrorPayload(${code.wire}, retryable: $retryable, $message)';
}

/// Raised when a frame cannot be decoded (§14: "every inbound frame is
/// untrusted and is validated BEFORE any business logic runs").
///
/// Carries a dot [path] to the offending field so a developer can find it
/// without a packet capture. Note the deliberate asymmetry with the server's
/// validator, which puts the offending VALUE in its logs: this one never does.
/// A malformed `connection.hello` contains a token, and this exception may be
/// caught by a host app and posted to a crash reporter.
class FrameDecodeException implements Exception {
  const FrameDecodeException(this.path, this.reason, {this.frameType});

  /// Dot path to the field, e.g. `d.protocolVersion`, or `''` for the
  /// envelope itself.
  final String path;

  /// Single-line reason, naming the CATEGORY of failure and never the value.
  final String reason;

  /// The frame's `t`, when the envelope parsed far enough to know it.
  final String? frameType;

  @override
  String toString() {
    final String where = path.isEmpty ? 'frame' : path;
    final String type = frameType == null ? '' : ' [$frameType]';
    return 'FrameDecodeException$type: $where $reason';
  }
}
