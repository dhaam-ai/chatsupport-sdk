/// The per-message Reply action. Copy is exposed from the message bubble
/// itself so transcript rows stay visually quiet.
///
/// The React reference also offers edit and delete. Neither exists on this
/// protocol: there is no `message.edit` or `message.delete` frame in
/// `dhaam_chat`'s catalog, and nothing server-side to receive one.
///
/// Reply is real: `replyToMessageId` is on the send frame and
/// `ChatClient.sendMessage` already accepts it.
library;

import 'package:flutter/material.dart';

import '../../app_assets.dart';
import '../svg_asset_icon.dart';

/// The label a copy that worked swaps in.
const String kCopiedLabel = 'Copied';

/// The label a copy the platform refused swaps in.
const String kCopyFailedLabel = "Couldn't copy";

/// The per-message Reply button.
class MessageActions extends StatelessWidget {
  const MessageActions({
    super.key,
    required this.onReply,
  });

  /// Starts a reply addressed to this message.
  final VoidCallback? onReply;

  @override
  Widget build(BuildContext context) {
    final VoidCallback? onReply = this.onReply;
    if (onReply == null) return const SizedBox.shrink();

    return IconButton(
      tooltip: 'Reply',
      iconSize: 18,
      visualDensity: VisualDensity.compact,
      onPressed: onReply,
      icon: const SvgAssetIcon(AppAssets.replyToIcon, size: 18),
    );
  }
}
