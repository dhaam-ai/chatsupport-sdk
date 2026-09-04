/// Normalizing `/upload`'s `mediaType` to the names the rest of the SDK reads.
///
/// The route returns s3-client's `mediaFolder` verbatim
/// (`upload.routes.ts:173` ← `infrastructure/storage/s3-client.ts:13-32`),
/// which is an S3 sub-folder name: lowercase and plural — `images`, `videos`,
/// `audio`, `documents`.
///
/// The consuming side switches on `IMAGE | VIDEO | AUDIO` and defaults to
/// `FILE`, so an unnormalized `images` fell through that default and every
/// uploaded image was announced as a generic file attachment.
///
/// The fix belongs here rather than downstream: nothing else should have to
/// learn one backend's S3 folder naming. This package is the seam that absorbs
/// exactly this kind of wire drift — and note that `dart_rest`'s pubspec takes
/// `http_parser` as a dependency to prevent the SAME bug on the WRITE side of
/// this same upload (contract §5.4), where a part with no `Content-Type`
/// arrives as `application/octet-stream` and degrades identically.
library;

/// Lowercased wire value → the name the SDK uses.
///
/// Both the plural S3 folder and the singular form are listed so an
/// already-correct `IMAGE` survives the round trip unchanged: the lookup runs
/// on the lowercased input, which turns `IMAGE` into `image`.
const Map<String, String> _byWireValue = <String, String>{
  'images': 'IMAGE',
  'image': 'IMAGE',
  'videos': 'VIDEO',
  'video': 'VIDEO',
  'audio': 'AUDIO',
  'documents': 'DOCUMENT',
  'document': 'DOCUMENT',
};

/// Maps `/upload`'s `mediaType` onto a name this SDK recognizes.
///
/// ── Why a `String` and not an enum ────────────────────────────────────────
///
/// The result feeds `AttachmentMetadata.mediaType` directly, and that field —
/// `dhaam_chat`'s, reused rather than re-declared — is itself typed `String`
/// on the WebSocket side too. Matching it keeps this result assignable with no
/// conversion at the one call site that uses it, and avoids inventing a second
/// vocabulary for a value the socket already carries as text.
///
/// ── Why unrecognized input does not throw ─────────────────────────────────
///
/// It becomes `'DOCUMENT'`, mirroring both `normalizeMediaType`'s own fallback
/// and s3-client's fallback for an unclassified MIME type. `DOCUMENT` then
/// degrades to a generic file attachment as documented behaviour, not a bug —
/// so an unknown media kind still sends, as a file. An upload is not worth
/// failing over a label.
///
/// This is the one decoder in the package that guesses, and the asymmetry is
/// deliberate: the enum decoders refuse to guess because a wrong `senderType`
/// misattributes a message to a person, while a wrong `mediaType` costs a
/// thumbnail.
String normalizeMediaType(Object? value) {
  if (value is! String) return 'DOCUMENT';
  return _byWireValue[value.trim().toLowerCase()] ?? 'DOCUMENT';
}
