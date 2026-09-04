/// The two controls the composer grows when attachments are enabled: the
/// paperclip, and the chip showing what is currently attached.
///
/// The Flutter counterpart of `composer.ts`'s `attachButton` and its
/// `.dh-preview` row.
///
/// ── Two widgets, not one composer ────────────────────────────────────────
///
/// `composer.ts` builds the attach button, the preview and the send button in
/// one function because the DOM gives it nowhere else to put them. Here they
/// are separate widgets a composer composes, for a concrete reason: T13 owns
/// `composer.dart` in this same wave, and a module that had to reach into
/// that file to exist would be two nodes editing one file. These drop into
/// whatever row T13 settles on.
library;

import 'package:flutter/material.dart';

import 'attachment_draft.dart';
import 'attachment_draft_controller.dart';

/// The paperclip. Opens the platform picker.
///
/// ── This is the ONE place `RemoteConfig.fileUploads` is read ─────────────
///
/// [enabled] is that flag, and nothing downstream re-reads it:
/// `AttachmentDraftController` deliberately knows nothing about
/// `RemoteConfig`. Two derivations of one gating fact is the exact shape this
/// port has been bitten by twice — `isGuest` computed on two paths put the
/// pre-chat form on one of them and not the other, and `composingNew` had to
/// be collapsed into the surface slot for the same reason. T11 makes the same
/// call keeping guest-gating outside the session picker.
///
/// A merchant who turned uploads off gets **no button at all**, not a
/// disabled one. A disabled paperclip advertises a feature the merchant
/// chose not to offer and invites the customer to work out why it is greyed
/// out; an absent one says nothing, which is the truth.
class AttachmentAttachButton extends StatelessWidget {
  const AttachmentAttachButton({
    super.key,
    required this.controller,
    required this.enabled,
    this.composerEnabled = true,
  });

  final AttachmentDraftController controller;

  /// `RemoteConfig.fileUploads`. When false this widget renders nothing.
  final bool enabled;

  /// Whether the composer as a whole accepts input — the consent gate, a
  /// closed session. Mirrors `composer.ts`'s `enabled` term in
  /// `attachButton.disabled = !enabled || uploading`.
  final bool composerEnabled;

  @override
  Widget build(BuildContext context) {
    if (!enabled) return const SizedBox.shrink();

    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        // The `uploading` half of composer.ts's disabled rule. Picking
        // mid-upload would replace the file whose bytes are already going up.
        final bool usable = composerEnabled && !controller.isUploading;
        return IconButton(
          tooltip: 'Attach a file',
          icon: const Icon(Icons.attach_file),
          // Matches the web original's `aria-label`, which is the same
          // string. A paperclip glyph names nothing on its own.
          onPressed: usable ? controller.pick : null,
        );
      },
    );
  }
}

/// What is attached right now, and anything the module needs to say about it.
///
/// Sits directly above the composer's text field — a sibling of it, never
/// inside it, so a long file name cannot push the input around.
///
/// Renders nothing at all when there is no draft and nothing to say. An
/// always-present empty strip would reserve vertical space the conversation
/// could use, and — because the status line is a live region — would give
/// screen readers a node to re-announce on unrelated rebuilds. Same call
/// `FormStatusLine` makes for the same reason.
class AttachmentDraftBar extends StatelessWidget {
  const AttachmentDraftBar({super.key, required this.controller});

  final AttachmentDraftController controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        final PickedAttachment? draft = controller.draft;
        final String? status = controller.statusMessage;
        if (draft == null && status == null) return const SizedBox.shrink();

        return Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (draft != null)
                _DraftChip(
                  draft: draft,
                  uploading: controller.isUploading,
                  onRemove: controller.clearDraft,
                ),
              if (status != null) _StatusLine(message: status),
            ],
          ),
        );
      },
    );
  }
}

class _DraftChip extends StatelessWidget {
  const _DraftChip({
    required this.draft,
    required this.uploading,
    required this.onRemove,
  });

  final PickedAttachment draft;
  final bool uploading;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final TextStyle? style = Theme.of(context).textTheme.bodySmall;

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 6, 4, 6),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Flexible(
            // One accessible name for the file, composed from the FIELDS
            // rather than from the two rendered Texts. Same rule T11 applies
            // to session rows: the spoken and the visual account may differ
            // in wording but never in facts, and reading the rendered strings
            // back would make a layout change silently a content change.
            //
            // `excludeSemantics` is what makes that true rather than merely
            // intended. Without it the children's own text is MERGED into
            // this label and the file is announced three times over —
            // "Attached receipt.pdf, 2 KB / receipt.pdf / 2 KB".
            //
            // The remove button is deliberately a SIBLING of this node rather
            // than a child: it carries an action, and excluding it here would
            // drop the only way to remove the file out of the semantics tree
            // altogether.
            child: Semantics(
              label: uploading
                  ? 'Sending attachment ${draft.fileName}, ${draft.displaySize}'
                  : 'Attached ${draft.fileName}, ${draft.displaySize}',
              container: true,
              excludeSemantics: true,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: uploading
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.insert_drive_file_outlined,
                            size: 16),
                  ),
                  Flexible(
                    child: Text(
                      draft.fileName,
                      overflow: TextOverflow.ellipsis,
                      style: style,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    draft.displaySize,
                    style: style?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ),
          IconButton(
            tooltip: 'Remove attachment',
            iconSize: 16,
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.close),
            // Inert rather than gone while the bytes are going up: the
            // controller refuses the clear anyway, and a control that
            // accepts a press and does nothing is worse than one that
            // reports itself unavailable.
            onPressed: uploading ? null : onRemove,
          ),
        ],
      ),
    );
  }
}

/// The module's one sentence, announced without stealing focus.
///
/// A live region for the same reason `FormStatusLine` is one: the message
/// appears in response to something the customer just did — choosing a file —
/// while their attention is on the picker they just dismissed rather than on
/// this line. Refusing a 30 MB video silently is the failure this exists to
/// prevent, and a refusal a screen reader never speaks is silent.
class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Semantics(
        liveRegion: true,
        child: Text(
          message,
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: Theme.of(context).colorScheme.error),
        ),
      ),
    );
  }
}
