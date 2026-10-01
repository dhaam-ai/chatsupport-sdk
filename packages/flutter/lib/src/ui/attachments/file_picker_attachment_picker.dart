/// The one real [AttachmentPicker] — and the only file in this module that
/// imports a plugin.
///
/// ── The split, and why it is where it is ─────────────────────────────────
///
/// [filePickerAttachmentPicker] is a handful of lines: it calls
/// `FilePicker.pickFiles` and hands the result to
/// [attachmentFromPlatformFile]. Everything that could be wrong — the size
/// guard, the byte read, the media-type lookup, what a cancel looks like —
/// lives in that second function, which takes a plain [PlatformFile] anyone
/// can construct and is covered by ordinary tests.
///
/// That leaves exactly one untestable line in the module, and it is a line
/// with no branches in it. `FilePicker.pickFiles` is a static, so a module
/// that called it from the middle of its own logic would drag the whole of
/// that logic out of reach of CI — there is no instance to substitute.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:mime/mime.dart';

import 'attachment_draft.dart';

/// Opens the platform file chooser.
///
/// Pass this straight to `AttachmentDraftController(picker: ...)` in a host
/// app. Tests pass a closure instead and never load the plugin at all.
///
/// ── `withReadStream`, not `withData` ─────────────────────────────────────
///
/// `withData: true` is the obvious call and it is the wrong one here: it
/// loads the ENTIRE chosen file into memory before `pickFiles` even returns,
/// so a customer who picks a 2 GB video is out of memory before the 25 MiB
/// cap gets to say anything. A cap that crashes instead of refusing is not a
/// cap. The stream is requested instead, and [attachmentFromPlatformFile]
/// reads from it only after the declared size has been looked at.
Future<PickedAttachment?> filePickerAttachmentPicker() async {
  // `FilePicker.pickFiles`, not `FilePicker.platform.pickFiles`: v11.0.0
  // made these statics and removed the instance-based accessor
  // (its CHANGELOG's first BREAKING CHANGE under 11.0.0). Written against
  // the resolved package's own source, not from memory.
  final FilePickerResult? result = await FilePicker.pickFiles(
    // One file per message — `composer.ts` holds a single `pendingFile` and
    // the composer shows a single preview.
    allowMultiple: false,
    // No `allowedExtensions` filter. `composer.ts`'s `<input type="file">`
    // carries no `accept` attribute either, and a filter here would decide on
    // the merchant's behalf which of their customers' documents count — a
    // policy nobody in this stack has stated.
    type: FileType.any,
    withReadStream: true,
  );

  final List<PlatformFile> files = result?.files ?? const <PlatformFile>[];
  // `allowMultiple: false` above, so at most one — but read defensively
  // rather than indexing: an empty `files` on a non-null result is how a
  // dismissed picker reaches this line on some platforms.
  final PlatformFile? file = files.isEmpty ? null : files.first;
  // A cancel. Resolving null rather than throwing is the seam's contract:
  // backing out of the picker is not a failure and gets no sentence.
  if (file == null) return null;

  return attachmentFromPlatformFile(file);
}

/// Turns one [PlatformFile] into something this module can refuse or send.
///
/// Separated from the plugin call so it can be tested — see this library's
/// header. Everything below this line is ordinary Dart.
///
/// Throws when there is neither a byte array nor a readable stream. That is
/// not a case any documented `file_picker` path produces, so it is a genuine
/// "this should not happen", and the controller turns it into
/// [kAttachmentPickFailedMessage] like any other picker failure.
Future<PickedAttachment> attachmentFromPlatformFile(PlatformFile file) async {
  // ── Refused without ever being read ──────────────────────────────────
  //
  // The REFUSAL is still the controller's, along with its wording; this only
  // declines to pull into memory a file the controller is certain to refuse.
  // The outcome is identical either way, which is what keeps this from being
  // a second copy of the policy: `size` is carried through, `isTooLarge` is
  // still what decides, and the customer still gets the same sentence.
  if (file.size > kMaxAttachmentBytes) {
    return PickedAttachment(
      fileName: file.name,
      // No bytes to sniff, so the extension is all there is. It costs nothing
      // and keeps the value honest rather than blank.
      mimeType: lookupMimeType(file.name) ?? '',
      bytes: Uint8List(0),
      size: file.size,
    );
  }

  final Uint8List bytes = file.bytes ?? await _readBounded(file);

  return PickedAttachment(
    fileName: file.name,
    mimeType: _mimeTypeFor(file.name, bytes),
    bytes: bytes,
  );
}

/// Drains [file]'s stream, stopping once it is past the cap.
///
/// `PlatformFile.size` is documented to default to `0` when the platform
/// could not determine it, so the declared size cannot be the only guard —
/// a file that under-reports itself would otherwise be drained without limit.
/// Reading stops one chunk past [kMaxAttachmentBytes], which is enough for
/// [PickedAttachment.isTooLarge] to come out true and for the controller to
/// refuse it in words.
Future<Uint8List> _readBounded(PlatformFile file) async {
  final Stream<List<int>>? stream = file.readStream;
  if (stream == null) {
    throw StateError('file_picker returned neither bytes nor a read stream');
  }

  final BytesBuilder builder = BytesBuilder(copy: false);
  await for (final List<int> chunk in stream) {
    builder.add(chunk);
    if (builder.length > kMaxAttachmentBytes) break;
  }
  return builder.takeBytes();
}

/// The media type to declare for a file the platform did not describe.
///
/// ── Why sniffing comes first ─────────────────────────────────────────────
///
/// `lookupMimeType` matches magic numbers before the extension when header
/// bytes are supplied. That is the right order HERE, but only because the
/// package's magic table was checked: it holds JPEG, PNG, GIF, TIFF, PDF,
/// FLAC, AAC, MP3, Ogg and WebM, and no container formats at all. A table
/// that recognised ZIP would type every `.docx` as `application/zip`, since
/// that is what a `.docx` physically is — sniffing-first would then be
/// actively worse than the extension. It does not, so it is not.
///
/// What sniffing buys: a photo saved as `IMG_1234` with no extension at all,
/// which Android pickers hand back routinely. Extension-only lookup returns
/// nothing for it, and the customer's photo arrives as a generic file with no
/// thumbnail.
///
/// ── An unrecognised file gets the EMPTY STRING, not a fallback ───────────
///
/// Not `application/octet-stream`. T7 draws the line at absent-vs-wrong and
/// owns the substitution: an empty type means "the platform said nothing" and
/// becomes `application/octet-stream` inside `uploadAttachment`, while a
/// non-empty malformed one still raises. Writing the fallback here instead
/// would collapse the two cases at the one seam that can still tell them
/// apart.
String _mimeTypeFor(String fileName, Uint8List bytes) {
  final int headerLength = bytes.length < defaultMagicNumbersMaxLength
      ? bytes.length
      : defaultMagicNumbersMaxLength;
  return lookupMimeType(
        fileName,
        headerBytes: bytes.sublist(0, headerLength),
      ) ??
      '';
}
