/// Validating an attachment that arrived inside a message row's `metadata`.
///
/// ── Why REST validates what the socket does not have to ───────────────────
///
/// On the WebSocket path `dhaam_chat` validates the identical object through
/// `AttachmentMetadata.fromJson`, because everything arriving there is a frame
/// and §14 requires every frame to be validated before any business logic
/// runs. An HTTP response is not a frame and never passes through that check,
/// so without this file the REST path would be the one way into a binding's
/// state with no validation at all.
///
/// ── That gap is reachable, not theoretical ────────────────────────────────
///
/// chat-service validates an inbound `message.send` attachment only when the
/// field is TOP-LEVEL (`api/websocket/v2/protocol/validate.ts:223` tests
/// `'attachment' in d`). A client that sends NO top-level attachment and a
/// forged `d.metadata.attachment` therefore skips validation on both sides and
/// is persisted verbatim (`handlers.ts:902-903`). On the next history load it
/// comes back here. Trusting it would put an attacker-chosen URL into a
/// rendered image — a zero-click beacon reporting every viewer's IP and
/// User-Agent on every history load.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;

import 'json_reading.dart';

/// Only `http:` and `https:` are an inert network fetch.
///
/// ── This defense IS ported; the prototype-pollution one is NOT ────────────
///
/// `projection.ts` carries two hardening measures and only one of them
/// transfers to Dart (contract §5.8):
///
///  * **Ported, unchanged: this scheme allowlist.** Its original threat — a
///    forged URL reaching an HTML `<img src>` — is DOM-specific, but the rule
///    underneath it is not: "do not fetch an attacker-chosen URL for the sole
///    reason a `mediaType` field claims it is an image" holds on every
///    runtime. `dhaam_chat`'s target list includes Flutter Web, where an
///    `Image.network` is not guaranteed to be DOM-free depending on the
///    renderer, and the check costs a few lines regardless.
///  * **Not ported: `__proto__`/`constructor`/`prototype` stripping.** See
///    `message_decode.dart`, where the metadata bag is actually built.
///
/// `javascript:`, `data:` and `blob:` are refused, and so is a
/// protocol-relative `//host/path`, which inherits whatever scheme the caller
/// happened to be on.
final RegExp _httpUrl = RegExp(r'^https?://', caseSensitive: false);

/// Validates a candidate attachment and rebuilds it, or returns `null`.
///
/// ── Why this returns the value rather than a `bool` ───────────────────────
///
/// TS exports `isAttachmentMetadata` as a type-guard predicate, because that
/// is how TypeScript narrows a type: the caller tests, then reads the fields
/// off the same object it just tested. Dart has no such narrowing to perform,
/// and a `bool` here would leave every caller re-reading five untyped fields
/// out of a `Map` immediately after being told they were fine — the second
/// read being the one that could drift from the first.
///
/// Returning `AttachmentMetadata?` collapses validate-then-rebuild into one
/// step, and gets the property `projection.test.ts` asserts separately — "it
/// rebuilds the attachment, dropping unvalidated extra keys" — for free rather
/// than by discipline: a constructor taking five named parameters has nowhere
/// to put a sixth key.
///
/// A `null` return costs the ATTACHMENT, never the message that carried it.
/// One forged attachment must not cost a customer the text they were sent —
/// the same tradeoff `message_decode.dart` makes for a row that predates
/// sequencing.
AttachmentMetadata? readAttachmentMetadata(Object? value) {
  if (value is! Map<String, Object?>) return null;

  final String? url = optionalStringValue(value['url']);
  if (url == null || !_httpUrl.hasMatch(url)) return null;

  final String? fileName = optionalStringValue(value['fileName']);
  final String? mimeType = optionalStringValue(value['mimeType']);
  final String? mediaType = optionalStringValue(value['mediaType']);
  if (fileName == null || mimeType == null || mediaType == null) return null;

  // TS accepts any finite number here; `AttachmentMetadata.size` is an `int`
  // on this side, so a fractional byte count has nowhere to go. Refusing it is
  // the right direction anyway — a size of 1024.5 describes no file — and
  // `optionalIntValue` still accepts `1024.0`, which is what every size looks
  // like once Flutter Web has decoded it.
  final int? size = optionalIntValue(value['size']);
  if (size == null) return null;

  return AttachmentMetadata(
    url: url,
    fileName: fileName,
    mimeType: mimeType,
    size: size,
    mediaType: mediaType,
  );
}
