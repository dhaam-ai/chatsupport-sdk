/// Drawing one attachment inside a transcript bubble — the fill for T9's
/// declared `MessageListView.attachmentBuilder` seam.
///
/// T9 left the seam empty on purpose: "attachment rendering is its own node's
/// work, and a half-built one here would be the 'menu item that cannot work'
/// mistake in another shape." This is that node.
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show AttachmentMetadata, safeLinkUrl;
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../image_safety.dart';
import 'attachment_draft.dart' show formatAttachmentBytes;
import 'attachment_kind.dart';

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
/// [attachmentKind] reads `mediaType` in every spelling the transcript can
/// receive: `IMAGE` from the customer's own upload (normalized by
/// `dhaam_chat_rest` on the way in), and the raw S3 folder name `images` from
/// anything the agent console sent, which neither the history read nor the
/// socket normalizes. Re-deriving "is this a picture" from
/// `mimeType.startsWith('image/')` would be a second classifier that can
/// disagree with the first, and the first is the one the server used when
/// it decided where to put the bytes. The MIME family is consulted only when
/// `mediaType` names nothing [attachmentKind] recognizes.
///
/// ── A file row opens the file; only an http(s) one ───────────────────────
///
/// There is no inline player, so before this a received video, or a PDF,
/// could be seen in the transcript and not opened at all. A file row now
/// hands its URL to the platform, which gives a video to its player or
/// browser and a document to whatever reads it.
///
/// The gate is `safeLinkUrl`, not `safeImageUrl`, because this is a
/// navigation, not a picture: `data:image/svg+xml` is safe to DRAW and not
/// safe to OPEN (`url_safety.dart` explains the difference). A URL it refuses
/// leaves the row exactly as it was: named, sized, and not a button. A
/// control that does nothing when pressed would be worse than no control.
///
/// The thumbnail is unchanged and is not a button. Opening an image
/// full-size is a separate design question, so its fallback row (an image
/// that would not load) stays inert too, keeping the visible row and the
/// accessible one in agreement.
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
    final String kind = attachmentKind(attachment);
    final String? imageUrl =
        kind == 'IMAGE' ? safeImageUrl(attachment.url) : null;
    final Uri? openUri = imageUrl == null ? _openableUri(attachment.url) : null;
    final VoidCallback? open =
        openUri == null ? null : () => _openExternally(openUri);
    final String size = formatAttachmentBytes(attachment.size);

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Semantics(
        // Composed from the fields, never from the rendered strings — the
        // same rule the draft chip and T11's session rows follow. A
        // thumbnail has no text at all, so without this the row is silent.
        // An openable row leads with the verb, as a button's name should,
        // and keeps the size: it is how a customer on mobile data decides
        // whether to open a 40 MB video now.
        label: open == null
            ? 'Attachment ${attachment.fileName}, $size'
            : '${kind == 'VIDEO' ? 'Open video' : 'Open'} '
                '${attachment.fileName}, $size',
        button: open != null,
        // The screen reader's activation. `excludeSemantics` below drops the
        // InkWell's own tap action along with the Texts, so the action has
        // to be declared on the node that survives.
        onTap: open,
        container: true,
        // Replaces the rendered strings rather than merging with them —
        // without this the file row is announced twice, once as this label
        // and again as its own two Texts.
        excludeSemantics: true,
        child: imageUrl == null
            ? _FileRow(attachment: attachment, onOpen: open)
            : _Thumbnail(url: imageUrl, attachment: attachment),
      ),
    );
  }
}

/// The URL a file row may open, or `null` when it may not be opened.
///
/// `null` both for anything `safeLinkUrl` refuses and for an http(s) string
/// `Uri` cannot parse, so a row is only ever a button when pressing it will
/// actually reach `launchUrl`.
Uri? _openableUri(String url) {
  final String? safe = safeLinkUrl(url);
  return safe == null ? null : Uri.tryParse(safe);
}

/// Hands [uri] to the platform.
///
/// `externalApplication`, the mode `openPrivacyUrl` uses and for the same
/// reason: the file lives on the merchant's storage, not in the widget, and
/// an in-app web view has no address bar to show whose server it came from.
/// It also lets the OS give a video to a real player.
/// https://pub.dev/documentation/url_launcher/latest/url_launcher/launchUrl.html
/// https://pub.dev/documentation/url_launcher/latest/url_launcher/LaunchMode.html
Future<void> _openExternally(Uri uri) async {
  await launchUrl(uri, mode: LaunchMode.externalApplication);
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
///
/// With [onOpen] it is also a control, and looks like one: the name is
/// underlined, which is how `LinkifiedText` marks a link in this package, an
/// `open_in_new` glyph says that pressing it leaves the chat, and the row is
/// at least 44 high, the height of this package's own buttons, so it is a
/// target a thumb can hit.
class _FileRow extends StatelessWidget {
  const _FileRow({required this.attachment, this.onOpen});

  final AttachmentMetadata attachment;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final TextStyle? style = Theme.of(context).textTheme.bodySmall;
    final bool openable = onOpen != null;

    final Widget row = Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(_iconFor(attachmentKind(attachment)), size: 18),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            attachment.fileName,
            overflow: TextOverflow.ellipsis,
            style: openable
                ? (style ?? const TextStyle())
                    .copyWith(decoration: TextDecoration.underline)
                : style,
          ),
        ),
        const SizedBox(width: 6),
        Text(formatAttachmentBytes(attachment.size), style: style),
        if (openable) ...<Widget>[
          const SizedBox(width: 6),
          const Icon(Icons.open_in_new, size: 16),
        ],
      ],
    );
    if (!openable) return row;

    // Transparent Material so the ink lands on top of the bubble's own
    // colour; without one the splash paints on the Scaffold underneath the
    // bubble, where nobody can see it.
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(8),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          // Both factors 1: size to the row, then let minHeight lift it.
          // Without heightFactor an Align fills any bounded height it is
          // given, and the row would stretch to its parent.
          child: Align(widthFactor: 1, heightFactor: 1, child: row),
        ),
      ),
    );
  }
}

/// The four names [attachmentKind] can produce, and nothing else.
///
/// A `switch` with a `default` rather than an exhaustive one because the
/// kind is a `String`, like `mediaType` on both the REST and the socket side
/// — see `media_type.dart` for why it was not made an enum. `DOCUMENT` is
/// also [attachmentKind]'s answer for anything it cannot place, so an unknown
/// kind and a document draw the same glyph, which is right for both.
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
