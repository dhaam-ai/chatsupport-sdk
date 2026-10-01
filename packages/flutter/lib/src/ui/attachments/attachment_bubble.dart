/// Drawing one attachment inside a transcript bubble — the fill for T9's
/// declared `MessageListView.attachmentBuilder` seam.
///
/// T9 left the seam empty on purpose: "attachment rendering is its own node's
/// work, and a half-built one here would be the 'menu item that cannot work'
/// mistake in another shape." This is that node.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;
import 'package:flutter/material.dart';

import '../image_safety.dart';
import 'attachment_draft.dart' show formatAttachmentBytes;

/// Draws [attachment] for a message bubble.
///
/// Shaped as a plain function, not a widget constructor tear-off, because the
/// seam's type is `Widget Function(BuildContext, AttachmentMetadata)` and a
/// function that already matches it is what a caller can pass with no lambda:
///
/// ```dart
/// MessageListView(
///   inputs: ...,
///   callbacks: ...,
///   attachmentBuilder: buildAttachmentBubble,
/// )
/// ```
Widget buildAttachmentBubble(
  BuildContext context,
  AttachmentMetadata attachment,
) {
  return AttachmentBubble(attachment: attachment);
}

/// One attachment as it appears inside a message bubble: a thumbnail when it
/// is an image this package can safely load, and a named file row otherwise.
///
/// ── Every image URL goes through `safeImageUrl` ──────────────────────────
///
/// The URL arrives from `POST /upload`'s response or off a `message.new`
/// frame — in both cases a string the server stored and re-served, and in the
/// second case one that originated on ANOTHER participant's client. It gets
/// the same allowlist every other merchant-supplied image URL in this package
/// gets, rather than a second rule written here.
///
/// A URL the allowlist refuses is not a broken image: it falls through to the
/// file row, which still names the file and its size. The customer learns
/// that something was attached and what it was called, which is strictly more
/// than a red error box tells them.
///
/// ── mediaType is the classifier, not the mimeType ────────────────────────
///
/// `normalizeMediaType` in `dhaam_chat_rest` already turned the route's S3
/// folder name (`images`) into `IMAGE` on the way in, and the socket carries
/// the same vocabulary. Re-deriving "is this a picture" from
/// `mimeType.startsWith('image/')` here would be a second classifier that can
/// disagree with the first — and it is the first one the server used when it
/// decided where to put the bytes.
class AttachmentBubble extends StatelessWidget {
  const AttachmentBubble({super.key, required this.attachment});

  final AttachmentMetadata attachment;

  /// The tallest a thumbnail is allowed to be inside a bubble.
  ///
  /// A cap rather than a natural size: an attachment is one line of a
  /// conversation, and a full-height photo pushes every message around it off
  /// screen — including the agent's reply about the photo.
  static const double maxThumbnailHeight = 180;

  /// The box a thumbnail occupies before its first frame arrives.
  ///
  /// ── This is an accessibility fix, not a layout preference ─────────────
  ///
  /// An `Image` that has not decoded a frame yet reports a size of zero, and
  /// Flutter drops a semantics node whose rect is empty. Without a reserved
  /// box the entire bubble — label and all — is therefore ABSENT from the
  /// semantics tree for as long as the image is loading, which on a slow
  /// connection is exactly when a customer most needs to be told that
  /// something was attached. Verified by dumping the tree, not assumed.
  ///
  /// Reserving the space also stops the transcript jumping as each image
  /// lands, which is the same fix wearing its other face.
  static const Size thumbnailPlaceholder = Size(160, 120);

  @override
  Widget build(BuildContext context) {
    final String? imageUrl =
        attachment.mediaType == 'IMAGE' ? safeImageUrl(attachment.url) : null;

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Semantics(
        // Composed from the fields, never from the rendered strings — the
        // same rule the draft chip and T11's session rows follow. A
        // thumbnail has no text at all, so without this the row is silent.
        label: 'Attachment ${attachment.fileName}, '
            '${formatAttachmentBytes(attachment.size)}',
        container: true,
        // Replaces the rendered strings rather than merging with them —
        // without this the file row is announced twice, once as this label
        // and again as its own two Texts. Nothing inside carries an action,
        // so there is nothing to lose by excluding it.
        excludeSemantics: true,
        child: imageUrl == null
            ? _FileRow(attachment: attachment)
            : _Thumbnail(url: imageUrl, attachment: attachment),
      ),
    );
  }
}

class _Thumbnail extends StatelessWidget {
  const _Thumbnail({required this.url, required this.attachment});

  final String url;
  final AttachmentMetadata attachment;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          maxHeight: AttachmentBubble.maxThumbnailHeight,
        ),
        child: Image.network(
          url,
          fit: BoxFit.cover,
          // Holds the node open until there is a frame to draw — see
          // `AttachmentBubble.thumbnailPlaceholder`.
          frameBuilder: (
            BuildContext context,
            Widget child,
            int? frame,
            bool wasSynchronouslyLoaded,
          ) {
            if (wasSynchronouslyLoaded || frame != null) return child;
            return SizedBox(
              width: AttachmentBubble.thumbnailPlaceholder.width,
              height: AttachmentBubble.thumbnailPlaceholder.height,
              child: ColoredBox(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
              ),
            );
          },
          // The graceful miss `image_safety.dart` asks callers for: a URL
          // that passed the allowlist can still 404, expire its signature, or
          // be an SVG this package has no codec for. Falling back to the file
          // row keeps the customer informed; Flutter's red error box would
          // tell them only that the widget broke.
          errorBuilder: (
            BuildContext context,
            Object error,
            StackTrace? stackTrace,
          ) =>
              _FileRow(attachment: attachment),
        ),
      ),
    );
  }
}

/// A named file with its size — what a non-image, or an image that would not
/// load, comes down to.
class _FileRow extends StatelessWidget {
  const _FileRow({required this.attachment});

  final AttachmentMetadata attachment;

  @override
  Widget build(BuildContext context) {
    final TextStyle? style = Theme.of(context).textTheme.bodySmall;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(_iconFor(attachment.mediaType), size: 18),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            attachment.fileName,
            overflow: TextOverflow.ellipsis,
            style: style,
          ),
        ),
        const SizedBox(width: 6),
        Text(formatAttachmentBytes(attachment.size), style: style),
      ],
    );
  }
}

/// The four names `normalizeMediaType` can produce, and nothing else.
///
/// A `switch` with a `default` rather than an exhaustive one because
/// `mediaType` is a `String` on both the REST and the socket side — see
/// `media_type.dart` for why it was not made an enum. `DOCUMENT` is also the
/// documented fallback for anything unrecognized, so an unknown kind and a
/// document draw the same glyph, which is the right answer for both.
IconData _iconFor(String mediaType) {
  switch (mediaType) {
    case 'IMAGE':
      return Icons.image_outlined;
    case 'VIDEO':
      return Icons.videocam_outlined;
    case 'AUDIO':
      return Icons.audiotrack_outlined;
    default:
      return Icons.insert_drive_file_outlined;
  }
}
