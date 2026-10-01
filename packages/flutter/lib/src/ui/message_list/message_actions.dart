/// The per-message menu: Copy, and Reply. Ports `ui/message-actions.ts`.
///
/// ── Why only two ─────────────────────────────────────────────────────────
///
/// The React reference offers edit and delete alongside these. Neither
/// exists on this protocol — there is no `message.edit` or `message.delete`
/// frame in `dhaam_chat`'s catalog, and nothing server-side to receive one.
/// A menu item that cannot work is worse than an absent one: it is a promise
/// the product makes and then breaks in front of the customer.
///
/// Reply, by contrast, is real: `replyToMessageId` is on the send frame and
/// `ChatClient.sendMessage` already accepts it, so this is a capability the
/// wire has always had and no surface exposed.
///
/// ── Why a popover and not two inline buttons ─────────────────────────────
///
/// Two controls on every row is visual noise on a transcript whose job is to
/// be read, and on a phone they compete with the text for width. A single
/// toggle that opens on demand keeps the quiet state quiet.
///
/// ── The outside-press rule, and its JS counterpart ───────────────────────
///
/// `message-actions.ts` closes on a document-level `pointerdown` and had to
/// read `composedPath()[0]` rather than `event.target`, because a press
/// inside a shadow tree is retargeted to the shadow HOST and looked
/// "outside" — closing the popover mid-press and swallowing the click those
/// pointer events were producing.
///
/// [TapRegion]'s `groupId` is the same idea stated directly: the toggle and
/// the overlay live in different parts of the tree and count as ONE region,
/// so a press on a menu item is never "outside" and its tap still lands.
/// `outside-dismiss-retargeting.test.ts`'s assertions transfer; its DOM
/// mechanism does not.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';

/// How long the Copy item shows its outcome before the menu closes itself.
///
/// Long enough to be read, short enough that the menu does not feel stuck.
/// The old flow closed the menu FIRST and announced the outcome to a
/// visually-hidden live region only — which is why the reported bug reads
/// "tapping Copy gives no feedback": for a sighted user there was none.
const Duration kCopyOutcomeDuration = Duration(milliseconds: 1200);

/// The label a copy that worked swaps in.
const String kCopiedLabel = 'Copied';

/// The label a copy the platform refused swaps in.
const String kCopyFailedLabel = "Couldn't copy";

/// One row's menu state — open/closed, and the Copy item's outcome.
///
/// A plain [ChangeNotifier] rather than widget state so the 1200 ms
/// swap-then-close, and the "menu already closed while the clipboard was
/// pending" branch, can be asserted directly.
class MessageActionsController extends ChangeNotifier {
  bool _open = false;
  bool _busy = false;
  String _copyLabel = 'Copy';
  String? _announcement;
  Timer? _outcomeTimer;

  bool get isOpen => _open;

  /// Whether the Copy item is mid-flight or mid-outcome. Disabled either
  /// way: a second press during the outcome would announce it twice.
  bool get isCopyBusy => _busy;

  /// What the Copy item currently reads — 'Copy', [kCopiedLabel] or
  /// [kCopyFailedLabel].
  String get copyLabel => _copyLabel;

  /// The last thing worth speaking, or `null`. Spoken as well as shown,
  /// because the label swap is invisible to a screen reader whose focus is
  /// elsewhere.
  String? get announcement => _announcement;

  void open() {
    if (_open) return;
    _open = true;
    notifyListeners();
  }

  void close() {
    if (!_open) return;
    _open = false;
    _resetCopy();
    notifyListeners();
  }

  void toggle() => _open ? close() : open();

  /// Runs [onCopy], then shows and speaks the outcome.
  ///
  /// The menu is NOT closed first: the confirmation IS the label swapping in
  /// place, so the menu has to stay open long enough to show it, and the
  /// auto-close is the outcome timer's job.
  Future<void> copy(Future<void> Function() onCopy) async {
    if (_busy || _outcomeTimer != null) return;
    _busy = true;
    notifyListeners();

    String outcome;
    try {
      await onCopy();
      outcome = kCopiedLabel;
    } catch (_) {
      // Clipboard access is refused outright on some platforms without a
      // permission the host app has not asked for. Saying so is better than
      // a button that silently does nothing. The error object itself is not
      // surfaced — see `submitOnce`'s own rule.
      outcome = kCopyFailedLabel;
    }
    _showOutcome(outcome);
  }

  void _showOutcome(String text) {
    _announcement = text;

    // The menu can already be gone — an outside press or Escape landed while
    // the clipboard future was still pending, and `close()` ran `_resetCopy`
    // against a still-plain label. Swapping the label NOW would strand
    // "Copied" on a closed menu for the next open to show about a different
    // moment, so the VISUAL outcome is skipped and only the announcement
    // stands.
    if (!_open) {
      _resetCopy();
      notifyListeners();
      return;
    }

    _copyLabel = text;
    _outcomeTimer = Timer(kCopyOutcomeDuration, () {
      _outcomeTimer = null;
      close();
    });
    notifyListeners();
  }

  /// Back to a plain "Copy". Runs inside [close] — after the menu is hidden,
  /// so the restore is never visible — because every way the menu can go
  /// away funnels through [close], and a menu re-opened later must not still
  /// say "Copied" about a different moment.
  void _resetCopy() {
    _outcomeTimer?.cancel();
    _outcomeTimer = null;
    _busy = false;
    _copyLabel = 'Copy';
  }

  @override
  void dispose() {
    // The outcome timer holds this row's closure alive and would otherwise
    // fire `close()` against a controller already torn down.
    _outcomeTimer?.cancel();
    _outcomeTimer = null;
    super.dispose();
  }
}

/// The ⋯ toggle and its two-item menu.
class MessageActions extends StatefulWidget {
  const MessageActions({
    super.key,
    required this.onCopy,
    required this.onReply,
    this.controller,
  });

  /// Puts the message's text on the clipboard. Throws if the platform
  /// refuses.
  final Future<void> Function() onCopy;

  /// Starts a reply addressed to this message.
  ///
  /// `null` removes the item, for the same reason edit and delete are
  /// absent: a menu item that cannot work is worse than an absent one.
  final VoidCallback? onReply;

  /// An externally-owned controller, for a caller that needs to close the
  /// menu itself. When `null` this widget owns one and disposes it.
  final MessageActionsController? controller;

  @override
  State<MessageActions> createState() => _MessageActionsState();
}

class _MessageActionsState extends State<MessageActions> {
  final LayerLink _link = LayerLink();
  final OverlayPortalController _portal = OverlayPortalController();
  final FocusNode _toggleFocus = FocusNode(debugLabel: 'Message actions');
  late final Object _tapGroup = Object();

  MessageActionsController? _owned;
  MessageActionsController get _controller =>
      widget.controller ?? (_owned ??= MessageActionsController());

  String? _spoken;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onControllerChanged);
  }

  @override
  void didUpdateWidget(MessageActions oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller?.removeListener(_onControllerChanged);
      _controller.addListener(_onControllerChanged);
      _onControllerChanged();
    }
  }

  void _onControllerChanged() {
    if (_controller.isOpen) {
      _portal.show();
    } else {
      _portal.hide();
    }

    final String? announcement = _controller.announcement;
    if (announcement != null && announcement != _spoken) {
      _spoken = announcement;
      // Copy changes nothing on screen, so without this a screen-reader user
      // gets no confirmation it happened at all.
      SemanticsService.announce(announcement, Directionality.of(context));
    }
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _controller.removeListener(_onControllerChanged);
    _owned?.dispose();
    _toggleFocus.dispose();
    super.dispose();
  }

  void _closeAndRestoreFocus() {
    _controller.close();
    _toggleFocus.requestFocus();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    // Escape closes the MENU without closing the panel. Reporting it handled
    // is what stops the widget's own Escape handler taking the whole panel
    // down because the customer wanted to dismiss a two-item menu.
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (event.logicalKey != LogicalKeyboardKey.escape) {
      return KeyEventResult.ignored;
    }
    if (!_controller.isOpen) return KeyEventResult.ignored;
    _closeAndRestoreFocus();
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      onKeyEvent: _onKey,
      skipTraversal: true,
      canRequestFocus: false,
      child: CompositedTransformTarget(
        link: _link,
        child: OverlayPortal(
          controller: _portal,
          overlayChildBuilder: _buildMenu,
          child: TapRegion(
            groupId: _tapGroup,
            child: IconButton(
              focusNode: _toggleFocus,
              // Named, because the glyph is three dots and a screen reader
              // would otherwise announce an unlabelled button on every
              // single message.
              tooltip: 'Message actions',
              iconSize: 18,
              visualDensity: VisualDensity.compact,
              onPressed: _controller.toggle,
              icon: const Icon(Icons.more_horiz),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMenu(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Positioned(
      width: 180,
      child: CompositedTransformFollower(
        link: _link,
        targetAnchor: Alignment.bottomRight,
        followerAnchor: Alignment.topRight,
        child: TapRegion(
          // The same group as the toggle: the two live in different parts of
          // the tree and count as ONE region, so a press on an item is never
          // "outside" and the tap it produces still lands.
          groupId: _tapGroup,
          onTapOutside: (PointerDownEvent _) => _controller.close(),
          child: Semantics(
            container: true,
            explicitChildNodes: true,
            label: 'Message actions',
            // Focused on open, exactly as `message-actions.ts` calls
            // `copy.focus()`: a menu a keyboard user has just summoned but
            // cannot reach without tabbing to it is not open to them. It is
            // also what puts the Escape handler above in the key path — a
            // touch tap does not move focus on its own.
            child: Focus(
              autofocus: true,
              child: Material(
                elevation: 4,
                borderRadius: BorderRadius.circular(10),
                color: theme.colorScheme.surface,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    _MenuItem(
                      icon: Icons.copy_rounded,
                      label: _controller.copyLabel,
                      onPressed: _controller.isCopyBusy
                          ? null
                          : () => unawaited(_controller.copy(widget.onCopy)),
                    ),
                    if (widget.onReply != null)
                      _MenuItem(
                        icon: Icons.reply_rounded,
                        label: 'Reply',
                        onPressed: () {
                          _controller.close();
                          widget.onReply!();
                        },
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _MenuItem extends StatelessWidget {
  const _MenuItem({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: 16),
      label: Align(alignment: Alignment.centerLeft, child: Text(label)),
      style: TextButton.styleFrom(
        alignment: Alignment.centerLeft,
        minimumSize: const Size.fromHeight(40),
        shape: const RoundedRectangleBorder(),
      ),
    );
  }
}
