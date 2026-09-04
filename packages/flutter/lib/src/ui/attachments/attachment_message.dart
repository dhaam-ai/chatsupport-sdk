/// Turning an uploaded file into the message that announces it — §12.10's
/// shape, in one place.
///
/// The Dart counterpart of `packages/core/src/messages/controller.ts`'s
/// `messageTypeFor` and the `#send` call in its `sendAttachment`.
///
/// ── An attachment is its OWN message, not a caption's passenger ──────────
///
/// This is the part of the flow that is easy to get wrong in a way nothing
/// catches locally. §12.10: "the client then emits `message.send` over WS
/// with that URL as content plus the attachment metadata." So a file and a
/// caption typed alongside it are **two** messages, exactly as
/// `composer.ts`'s submit produces them — `await onSendAttachment(file)`,
/// then `await onSend(text)`.
///
/// Folding them into one send would look tidier on screen and would be a
/// divergence with two concrete costs:
///
///  * The message would go out as [MessageType.text] with an attachment
///    hanging off it — a shape no other client in this system produces, and
///    one the agent console's own renderer has never been shown.
///  * `visibleContent` suppresses the placeholder by comparing `content`
///    against `attachment.url`. A caption in that field is a real caption
///    and is rendered as one, so the file would arrive with the words but
///    with nothing marking it as a file to anything reading `type`.
///
/// The URL-as-content placeholder is not a hack to work around: it is the
/// wire contract, and `visibleContent` is this port's already-shipped
/// counterpart to it.
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show AttachmentMetadata, MessageType;

/// What kind of message announces a file with this `mediaType`.
///
/// Ported verbatim from `messageTypeFor`, including its default. The three
/// named cases and the fallback are the whole function — deliberately not
/// widened to sniff [AttachmentMetadata.mimeType], because the server has
/// already classified the upload and a second, disagreeing classification
/// here would be a message whose `type` says one thing and whose metadata
/// says another.
///
/// `mediaType` is a `String` rather than an enum on both sides of the wire,
/// so an unrecognised value is expected rather than exceptional: a media
/// type this build has never heard of is a **file**, which is the one
/// answer that is never wrong about how to offer it to a reader.
MessageType attachmentMessageType(String mediaType) => switch (mediaType) {
      'IMAGE' => MessageType.image,
      'VIDEO' => MessageType.video,
      'AUDIO' => MessageType.audio,
      _ => MessageType.file,
    };

/// The `content` field of the message that announces [attachment].
///
/// The URL, per §12.10. A separate named function rather than an inline
/// `attachment.url` at the call site because `visibleContent` reads the same
/// contract from the other end, and a reader who finds one should be able to
/// find the other.
String attachmentMessageContent(AttachmentMetadata attachment) =>
    attachment.url;
