/// The §7.2 frame envelope and the §7.3 frame-type catalog.
///
/// Every frame on this wire has the same five envelope fields — `v`, `t`,
/// `id`, `ts`, `d` — with `ack` adding `ref` and `error` adding an optional
/// `ref`. This file owns encoding outbound frames, decoding inbound ones, and
/// the envelope-level validation §14 requires before any business logic runs.
///
/// Payload (`d`) shapes live in `frames.dart`. The split is deliberate: an
/// envelope that fails to parse and a payload that fails to parse are
/// different failures — the first means the peer is not speaking this
/// protocol, the second means it is speaking a version of it we do not know.
library;

import 'dart:convert';

import 'errors.dart';
import 'json.dart';
import 'ulid.dart';

/// The protocol version this package speaks (§7.5).
///
/// `v` is an integer bumped on any breaking change to frame shapes or
/// semantics. §7.5 forbids silently downgrading behaviour for an older
/// negotiated version in v2.0, so this package speaks exactly one version and
/// treats a negotiated version it did not offer as a protocol violation.
const int kProtocolVersion = 1;

/// Frame types a client may SEND (§7.3, client→server half).
const Set<String> kClientFrameTypes = <String>{
  'connection.hello',
  'connection.reauth',
  'session.join',
  'session.leave',
  'session.requestAgent',
  'message.send',
  'message.markRead',
  // DRIFT: implemented by the server, absent from the §7.3 catalog table.
  // See kServerPushFrameTypes for the note.
  'message.markDelivered',
  'typing.start',
  'typing.stop',
  'presence.set',
  'presence.query',
  'system.heartbeat',
};

/// Frame types the server PUSHES (§7.3, server→client half).
///
/// ── DRIFT (spec vs. server) ───────────────────────────────────────────────
///
/// `message.delivered` and its client-side partner `message.markDelivered` are
/// implemented by the running server and appear in NEITHER §7.3 table. §0.4
/// open question 8 is marked "Closing now — delivery adopts the watermark
/// model, `message.markDelivered`/`message.delivered` keyed on `seq`", so the
/// decision was made and the catalog was never updated to match.
///
/// They are listed here anyway, and deliberately. Delivery ticks are out of
/// scope for this pass (see README "Out of scope"), but a client that treats
/// an unlisted `t` as a protocol violation would tear down a healthy
/// connection the first time the server sent one. Decoding it and letting the
/// host ignore it is the forward-compatible behaviour; refusing it is not.
const Set<String> kServerPushFrameTypes = <String>{
  'connection.ack',
  'session.updated',
  'session.closed',
  'agent.joined',
  'agent.left',
  'message.new',
  'typing.start',
  'typing.stop',
  'message.read',
  'message.delivered',
  'presence.update',
  'ticket.linked',
  'system.pong',
};

/// Everything a server may send: the pushes plus `ack` and `error` (§7.2).
final Set<String> kServerFrameTypes = <String>{
  ...kServerPushFrameTypes,
  'ack',
  'error',
};

/// A frame this client is about to send (§7.2).
///
/// [ts] is a [DateTime] and is encoded as EPOCH MILLIS — never ISO-8601. See
/// [requireEpochMillis] for why this type is what stops that mistake.
class ClientFrame {
  ClientFrame({
    required this.type,
    required this.id,
    required this.ts,
    required this.d,
    this.v = kProtocolVersion,
  });

  /// Protocol version (`v`).
  final int v;

  /// Frame type (`t`), dot-namespaced.
  final String type;

  /// Envelope ULID (`id`). For `message.send` this IS the permanent message
  /// id (D1), and for every frame it is the server's idempotency key.
  final String id;

  /// Sender's clock (`ts`). Informational only — NEVER an ordering key (D2).
  final DateTime ts;

  /// Payload (`d`). camelCase keys, string enums, ISO-8601 timestamps (D4).
  final Map<String, Object?> d;

  /// The JSON object form of this frame.
  Map<String, Object?> toJson() => <String, Object?>{
        'v': v,
        't': type,
        'id': id,
        // The single most load-bearing line in this file. `ts` is epoch millis
        // (§7.2); sending `ts.toIso8601String()` here returns
        // `VALIDATION_FAILED: ts must be a finite epoch-millis number`. No
        // caller chooses this, which is the point.
        'ts': ts.millisecondsSinceEpoch,
        'd': d,
      };

  /// The wire bytes of this frame.
  String encode() => jsonEncode(toJson());
}

/// A frame received from the server (§7.2).
///
/// Sealed, so a `switch` over it is checked for exhaustiveness at compile
/// time: adding a variant here makes every handler that ignores it a build
/// error rather than a silently dropped frame.
sealed class ServerFrame {
  const ServerFrame({required this.v, required this.id, required this.ts});

  /// Negotiated protocol version (`v`).
  final int v;

  /// This frame's server-generated ULID (`id`).
  final String id;

  /// Server's clock (`ts`). Informational only — NEVER an ordering key (D2).
  final DateTime ts;
}

/// An unsolicited server push: `message.new`, `session.updated`, and the rest
/// of the §7.3 server half.
final class PushFrame extends ServerFrame {
  const PushFrame({
    required super.v,
    required super.id,
    required super.ts,
    required this.type,
    required this.d,
  });

  /// Frame type (`t`).
  final String type;

  /// Raw payload. Decoded into a typed shape by `frames.dart`.
  final Map<String, Object?> d;
}

/// A successful acknowledgment of a frame this client sent (`d.ok == true`).
final class AckSuccessFrame extends ServerFrame {
  const AckSuccessFrame({
    required super.v,
    required super.id,
    required super.ts,
    required this.ref,
    required this.data,
  });

  /// The `id` of the frame being acknowledged.
  final String ref;

  /// Everything in `d` other than `ok` — e.g. `{seq}` for `message.send`.
  final Map<String, Object?> data;
}

/// A failed acknowledgment (`d.ok == false`).
///
/// A separate type from [AckSuccessFrame] so an error cannot exist without a
/// failure and a failure cannot exist without an error — the same reasoning
/// the PRD applied to `MessageDelivery` in §6.4.
final class AckFailureFrame extends ServerFrame {
  const AckFailureFrame({
    required super.v,
    required super.id,
    required super.ts,
    required this.ref,
    required this.error,
  });

  /// The `id` of the frame being acknowledged.
  final String ref;

  /// Why it failed. Branch on `error.code`, never on `error.message`.
  final ErrorPayload error;
}

/// A standalone `error` frame (§7.4).
final class ErrorFrame extends ServerFrame {
  const ErrorFrame({
    required super.v,
    required super.id,
    required super.ts,
    required this.error,
    this.ref,
  });

  /// The `id` of the frame that caused this, when there is one to blame.
  final String? ref;

  /// Branch on `error.code`, never on `error.message`.
  final ErrorPayload error;
}

/// Decodes one inbound WebSocket text frame.
///
/// Throws [FrameDecodeException] and never returns a partially built frame
/// (§14: "malformed frames are never partially applied").
ServerFrame decodeServerFrame(String raw) =>
    decodeServerFrameJson(_parseJson(raw));

Object? _parseJson(String raw) {
  try {
    return jsonDecode(raw);
  } on FormatException {
    // FormatException's message quotes the offending source, so it is neither
    // rethrown nor wrapped — it would carry payload text into whatever logs
    // this.
    throw const FrameDecodeException('', 'is not valid JSON');
  }
}

/// Decodes an already-parsed JSON value as a server frame.
///
/// Split from [decodeServerFrame] so tests can hand it a map directly, and so
/// replayed frames — which arrive already parsed, nested inside
/// `connection.ack.d.replay` — go through the identical validation as frames
/// that arrived on their own.
ServerFrame decodeServerFrameJson(Object? parsed) {
  final Map<String, Object?> root = requireObject(parsed, '');

  final int v = requireInt(root, 'v', '');

  final String type = requireNonEmptyString(root, 't', '');
  if (!kServerFrameTypes.contains(type)) {
    // Unknown `t` is refused exactly like any other malformed frame. Tolerating
    // it would mean guessing at the shape of `d`, and §14 has no room for a
    // guess.
    //
    // Note this is DIRECTIONAL: a client→server type such as `message.send`
    // arriving FROM the server is refused here too. A server has no legitimate
    // reason to send one, and accepting it would make this client credulous
    // about frames the real server never emits.
    throw FrameDecodeException('t', 'is not a server→client frame type');
  }

  final String id = requireNonEmptyString(root, 'id', '', frameType: type);
  if (!isValidUlid(id)) {
    throw FrameDecodeException('id', 'must be a valid ULID', frameType: type);
  }

  final DateTime ts = requireEpochMillis(root, 'ts', '', frameType: type);

  final Map<String, Object?> d = requireObject(root['d'], 'd', frameType: type);

  switch (type) {
    case 'error':
      return ErrorFrame(
        v: v,
        id: id,
        ts: ts,
        ref: optionalString(root, 'ref', '', frameType: type),
        error: decodeErrorPayload(d, 'd', frameType: type),
      );

    case 'ack':
      final String ref = requireNonEmptyString(
        root,
        'ref',
        '',
        frameType: type,
      );
      final bool ok = requireBool(d, 'ok', 'd', frameType: type);
      if (!ok) {
        return AckFailureFrame(
          v: v,
          id: id,
          ts: ts,
          ref: ref,
          error: decodeErrorPayload(
            requireObject(d['error'], 'd.error', frameType: type),
            'd.error',
            frameType: type,
          ),
        );
      }
      final Map<String, Object?> data = Map<String, Object?>.of(d)
        ..remove('ok');
      return AckSuccessFrame(v: v, id: id, ts: ts, ref: ref, data: data);

    default:
      return PushFrame(v: v, id: id, ts: ts, type: type, d: d);
  }
}

/// Decodes an [ErrorPayload] (§7.2, §7.4).
ErrorPayload decodeErrorPayload(
  Map<String, Object?> d,
  String path, {
  String? frameType,
}) {
  final Object? rawDetails = d['details'];
  return ErrorPayload(
    code: requireEnum(
      d,
      'code',
      path,
      ErrorCode.fromWire,
      'ErrorCode',
      frameType: frameType,
    ),
    message: requireString(d, 'message', path, frameType: frameType),
    retryable: requireBool(d, 'retryable', path, frameType: frameType),
    details: rawDetails == null
        ? null
        : requireObject(rawDetails, '$path.details', frameType: frameType),
  );
}
