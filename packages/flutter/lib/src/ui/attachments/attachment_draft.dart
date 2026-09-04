/// What a picked file is, what refuses one, and the two seams that keep this
/// module testable without a platform channel or an HTTP client.
///
/// The Flutter counterpart of the attachment half of
/// `packages/widget/src/ui/composer.ts` — `MAX_ATTACHMENT_BYTES`,
/// `acceptFile`, `formatBytes` and the `onSendAttachment` callback.
///
/// ── Nothing here imports a plugin, and that is the point ─────────────────
///
/// A file arrives through [AttachmentPicker] and leaves through
/// [AttachmentUploader]. Both are function types, so a test supplies a
/// closure and never reaches a `MethodChannel` or a socket. A suite that
/// needs a real picker is a suite that does not run in CI, and a picker is
/// exactly the kind of dependency that cannot be faked after the fact —
/// `file_picker`'s entry point is a static on a platform singleton.
///
/// The same shape `dhaam_chat_rest`'s `GeolocationProbe` already uses for the
/// same reason: the layer that can make a platform call is not the layer that
/// should own the policy about what to do with the answer.
library;

import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;

/// The largest file this widget will hand to `POST /upload`.
///
/// 25 MiB, matching `composer.ts`'s `MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024`
/// exactly. The cap is the CLIENT's, not the adapter's: T7's
/// `uploadAttachment` has no size limit of its own and will happily stream
/// whatever it is given, so refusing here is the only refusal there is. A
/// cap enforced only by the server is a cap the customer discovers after
/// waiting out the upload of a file that was never going to be accepted.
const int kMaxAttachmentBytes = 25 * 1024 * 1024;

/// What the customer is told when their file is over [kMaxAttachmentBytes].
///
/// ── Refused with words, not silence ──────────────────────────────────────
///
/// The failure mode this exists to prevent is a picker that opens, a file
/// that is chosen, and then nothing at all happening — which reads as the
/// widget being broken rather than as the file being too big. The sentence
/// names both facts a customer needs: that the file was the problem, and
/// what would not have been.
///
/// Interpolated from the constant rather than written out, so the number in
/// the sentence cannot drift away from the number in the check — the two
/// being allowed to disagree is how a "limit is 10 MB" message ends up in
/// front of someone whose 12 MB file was accepted.
final String kAttachmentTooLargeMessage =
    'That file is too large. The limit is '
    '${formatAttachmentBytes(kMaxAttachmentBytes)}.';

/// What the customer is told when the platform hands back a file with no
/// name.
///
/// ── This check is T7's, delegated here, and it is not decoration ─────────
///
/// `uploadAttachment` deliberately has NO fallback for an empty `fileName`:
/// TS's three-deep chain ending in the literal `'upload'` was a browser
/// workaround for `Blob.name` being optional, not a policy anyone chose. A
/// [Uint8List] never self-describes, so inventing a placeholder here would be
/// this package guessing on the customer's behalf about the one value only
/// they can know.
///
/// The concrete harm of letting one through: `POST /upload` echoes the empty
/// name back, `AttachmentMetadata.fromJson` refuses an empty `fileName`, and
/// the message is dropped from the transcript on the NEXT history load —
/// long after the customer watched it send successfully. A refusal at the
/// picker costs one re-pick; a silent acceptance costs the message.
const String kAttachmentUnnamedMessage =
    'That file has no name, so it could not be attached. '
    'Rename it and try again.';

/// What the customer is told when the picker itself failed.
///
/// Deliberately vague, and deliberately not the exception's own text: a
/// `PlatformException` from a file picker carries a channel name and
/// sometimes a filesystem path, and neither belongs in front of a customer.
/// The exception goes to the host's reporter instead — the same split
/// `FormSubmitController.submitOnce` makes for the same reason.
const String kAttachmentPickFailedMessage =
    'That file could not be attached. Please try again.';

/// What the customer is told when the upload itself failed.
///
/// One sentence for every failure the REST layer can raise —
/// `RestTransportException`, `RestApiException`,
/// `RestMalformedResponseException` — because the customer's next move is the
/// same in all three: try again, or pick something else. Distinguishing them
/// on screen would be reporting our own taxonomy to someone who cannot act on
/// it. The typed exception still reaches the host reporter intact.
const String kAttachmentUploadFailedMessage =
    'That file could not be sent. Please try again.';

/// Renders a byte count the way `composer.ts`'s `formatBytes` does.
///
/// Ported rather than replaced by `intl` or a Flutter helper so the preview
/// under the composer reads identically on both clients — a customer who sees
/// "1.4 MB" on the web and "1.44 MB" in the app has been shown two different
/// facts about one file.
///
/// The thresholds are binary (1024), matching the source, and the megabyte
/// case keeps one decimal place.
String formatAttachmentBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

/// One file the customer chose, in memory, not yet uploaded.
///
/// ── Why bytes and not a path ─────────────────────────────────────────────
///
/// [AttachmentUploader] ends at T7's `uploadAttachment`, whose `bytes`
/// parameter is a [Uint8List]. Carrying a path instead would push the read —
/// and its failure modes, and the `dart:io` import that makes this module
/// stop compiling for web — into whichever widget happened to call the
/// upload. The picker reads once, at the seam, where a read failure is still
/// a pick failure.
///
/// ── Deliberately NOT validated in the constructor ────────────────────────
///
/// A blank [fileName] and an oversized [bytes] are both refusable, and both
/// refusals are the CONTROLLER's, in `AttachmentDraftController.pick`, where
/// there is a status line to put words on. Throwing here instead would move
/// the refusal into a stack trace, and a stack trace is not a sentence a
/// customer can read. See [kAttachmentUnnamedMessage].
class PickedAttachment {
  const PickedAttachment({
    required this.fileName,
    required this.mimeType,
    required this.bytes,
    int? size,
  }) : _declaredSize = size;

  /// The platform's own byte count, when it is known WITHOUT having read the
  /// file.
  ///
  /// ── Why this exists, and why it is not just `bytes.length` ────────────
  ///
  /// A picker that loaded every chosen file into memory before anyone could
  /// look at its size would run out of memory on a 2 GB video — and it would
  /// do so BEFORE the 25 MiB refusal could say a word, which is a cap that
  /// crashes instead of refusing.
  ///
  /// So the real picker reads the platform's declared size first and, for a
  /// file already over the cap, hands back one of these with the size filled
  /// in and [bytes] left empty. [size] then still reports the truth, [
  /// isTooLarge] is still true, and the controller still refuses it in words.
  /// Without this field such a file would report a length of zero, sail past
  /// the cap, and upload nothing at all.
  final int? _declaredSize;

  /// What the platform called this file. May be blank — see
  /// [kAttachmentUnnamedMessage] for what happens then.
  final String fileName;

  /// The platform's declared media type, VERBATIM — including the empty
  /// string.
  ///
  /// ── Do not substitute a fallback here ────────────────────────────────
  ///
  /// T7 already decided this, once, at the endpoint: an empty type is
  /// ABSENCE (the platform said nothing) and becomes
  /// `application/octet-stream` inside `uploadAttachment`, while a non-empty
  /// but unparseable one is WRONGNESS and still raises. Writing
  /// `mimeType.isEmpty ? 'application/octet-stream' : mimeType` anywhere on
  /// this side collapses those two cases back together, and a genuinely
  /// malformed type — the one worth catching — arrives at the server as a
  /// silent generic file instead.
  ///
  /// Some Android document pickers really do return an empty type for a file
  /// they cannot classify. Passing that straight through is correct.
  final String mimeType;

  final Uint8List bytes;

  /// How many bytes this file is.
  ///
  /// The platform's declared size when one was given, and otherwise the
  /// length of what was actually read. See [_declaredSize].
  int get size => _declaredSize ?? bytes.length;

  /// Whether this file is over [kMaxAttachmentBytes].
  bool get isTooLarge => size > kMaxAttachmentBytes;

  /// Whether the platform gave this file no usable name.
  bool get isUnnamed => fileName.trim().isEmpty;

  /// The preview's second line: `1.4 MB`.
  String get displaySize => formatAttachmentBytes(size);
}

/// Asks the platform for a file, and resolves `null` when the customer backed
/// out.
///
/// ── The contract an implementation must honour ───────────────────────────
///
///  * **Resolve `null` for a cancel.** Backing out of the system picker is
///    not a failure and must not put a sentence on screen.
///  * **Return a fresh result every call, even for the same file.** See
///    `AttachmentDraftController.pick` for why re-picking one file twice is
///    load-bearing rather than obvious.
///  * **May throw.** A denied permission, a file that cannot be read, a
///    channel that is not registered — the controller catches all of it.
///    Throwing is how those reach the host's reporter; resolving `null`
///    would report a cancel that never happened.
typedef AttachmentPicker = Future<PickedAttachment?> Function();

/// Uploads [file] and resolves the metadata the socket needs to announce it.
///
/// ── Why this is a seam and not a direct call ─────────────────────────────
///
/// `packages/flutter` does not depend on `dhaam_chat_rest`, and this node is
/// not the one that should add it — D3 puts the `remote_config_client`
/// migration into that package on T16, and adding it here first would decide
/// that question early and from the wrong node. The metadata type is
/// `dhaam_chat`'s own [AttachmentMetadata], which this package DOES depend
/// on, so the seam costs no translation layer in either direction.
///
/// The integration wires this to T7's extension method directly:
///
/// ```dart
/// AttachmentUploader uploader = (PickedAttachment file) =>
///     restClient.uploadAttachment(
///       sessionId: sessionId,
///       bytes: file.bytes,
///       fileName: file.fileName,
///       mimeType: file.mimeType,
///     );
/// ```
///
/// Note the absence of any `?? 'application/octet-stream'` on that last line.
/// That is deliberate — see [PickedAttachment.mimeType].
///
/// ── What an implementation may throw ─────────────────────────────────────
///
/// Anything. `RestTransportException`, `RestApiException` and
/// `RestMalformedResponseException` are the documented three, but
/// `uploadAttachment` also raises a bare [ArgumentError] — NOT a
/// `RestException` — for a non-empty but malformed `mimeType`, so a `switch`
/// over the sealed hierarchy would miss it entirely and no request would ever
/// have been made. The controller catches [Object] rather than any named
/// type for exactly that reason.
typedef AttachmentUploader = Future<AttachmentMetadata> Function(
  PickedAttachment file,
);
