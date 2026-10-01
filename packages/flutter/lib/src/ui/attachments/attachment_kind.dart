/// What kind of thing a RECEIVED attachment is: `IMAGE`, `VIDEO`, `AUDIO` or
/// `DOCUMENT`. The one classifier the transcript bubble and the live-region
/// announcement share, so the glyph and the words cannot disagree.
///
/// ── Why received `mediaType` needs this at all ───────────────────────────
///
/// Only the customer's OWN uploads are normalized on the way in: `dart_rest`
/// runs `/upload`'s response through `normalizeMediaType`. A message the
/// agent console sent carries the S3 folder name verbatim (`images`,
/// `videos`, `audio`, `documents`), because neither the history read
/// (`dart_rest`'s `readAttachmentMetadata`) nor the socket frame decoder
/// (`dhaam_chat`'s `frames.dart`) touches the field. So a bubble that tested
/// `mediaType == 'IMAGE'` gave every agent photo a generic file row, and an
/// agent video the generic file glyph.
///
/// Not exported from the package. It answers a rendering question for this
/// module and `message_content.dart`, and a host that wants one can read
/// `mediaType` itself.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;
import 'package:dhaam_chat_rest/dhaam_chat_rest.dart' show normalizeMediaType;

/// The kind [attachment] should be drawn and announced as.
///
/// ── A recognized name decides; the MIME type only breaks a tie ──────────
///
/// The names come from `normalizeMediaType`, reused rather than copied, so
/// there is one table of spellings (folder, singular, any case). It answers
/// `DOCUMENT` both for a real `documents` and for a name it has never seen,
/// and only the second of those is a question the MIME type gets to answer.
/// A server that filed a file under `documents` decided what it is, and a
/// second classifier must not overrule it: the bubble's "classifies by
/// mediaType, not by mimeType" case pins exactly that.
///
/// The fallback then reads the MIME family, which is the same family rule
/// s3-client's `getMediaFolder` falls back to when it picks the folder.
String attachmentKind(AttachmentMetadata attachment) {
  final String name = attachment.mediaType.trim().toLowerCase();
  final String kind = normalizeMediaType(name);
  if (kind != 'DOCUMENT' || _documentNames.contains(name)) return kind;

  final String mime = attachment.mimeType.trim().toLowerCase();
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  return 'DOCUMENT';
}

/// The names `normalizeMediaType` maps to `DOCUMENT` on purpose, as opposed
/// to by fallback. Its map is private, so these two are the only spellings
/// repeated here; adding a new document alias there without adding it here
/// costs nothing worse than an unknown name getting its MIME family read.
const Set<String> _documentNames = <String>{'document', 'documents'};
