/// The text a bubble shows and the words a screen reader hears — with
/// core's wire-shape quirk subtracted out. Ports `ui/message-list.ts`'s
/// `visibleContent` and `describeContent`.
///
/// ── §12.10, and why the comparison is against the URL ────────────────────
///
/// A plain-attachment message arrives with `content` SET TO
/// `attachment.url` — a placeholder for clients that predate attachment
/// rendering, not a caption. Showing or speaking that URL is the bug;
/// suppressing it is the fix.
///
/// The comparison is against [AttachmentMetadata.url] **specifically**, not
/// "an attachment is present", because an agent can send a real caption
/// alongside an attachment and that caption is a distinct string from the
/// url — it must still render and still be announced.
///
/// ── One function, two call sites ─────────────────────────────────────────
///
/// The bubble's text and the live-region announcement both go through
/// [visibleContent] so the two can never diverge. A caption visible in the
/// bubble but unannounced (or the reverse) is the same bug class this file
/// exists to close, and two independent "is this a placeholder?" tests is
/// exactly how that bug gets back in.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMessage;

/// The text to render in the bubble, with the §12.10 placeholder removed.
///
/// Returns the empty string for a plain attachment — the caller decides what
/// to draw in its place (an attachment view, or nothing at all).
String visibleContent(ChatMessage message) {
  final String? url = message.attachment?.url;
  // `url != null &&` rather than a bare equality: `content` is a non-null
  // `String` and a null `url` must not accidentally compare equal to
  // anything. The record arrives over the socket from another participant's
  // client, so `attachment` being typed non-null on OUR call sites is a
  // compile-time guarantee about us, not a runtime one about the server.
  if (url != null && message.content == url) return '';
  return message.content;
}

/// What the live region says about one message.
///
/// Once [visibleContent] has suppressed the attachment-url placeholder there
/// are no words left in `content` for a screen reader to read, so the mime
/// family supplies them.
String describeContent(ChatMessage message) {
  final String shown = visibleContent(message);
  if (shown.trim().isNotEmpty) return shown;

  final String? mime = message.attachment?.mimeType;
  if (mime == null) return 'sent a message';
  if (mime.startsWith('image/')) return 'sent an image';
  if (mime.startsWith('audio/')) return 'sent a voice message';
  return 'sent a file';
}
