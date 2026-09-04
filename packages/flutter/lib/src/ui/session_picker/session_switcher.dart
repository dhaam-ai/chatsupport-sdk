/// Surface 2: the in-chat header switcher — a toggle and its popover, so a
/// customer already inside one conversation is never stuck in it with no way
/// back. Ports `session-picker.ts`'s `createSessionSwitcher`.
///
/// ── The three ways it closes, and the one way it must not ───────────────
///
///  * **Escape** closes it and returns focus to the toggle. A keyboard user
///    who dismissed a popover and is left focused on nothing has to tab from
///    the top of the panel to get back to where they were.
///  * **A press outside** closes it, like any ordinary disclosure menu — and
///    does NOT move focus, because a pointer user did not have it on the
///    toggle to begin with and yanking it there would scroll the panel.
///  * **Picking a row, or asking to start fresh**, closes it before
///    delegating. A customer who just switched conversations should see the
///    switch, not the menu they picked it from still hanging over the top of
///    it — and closing FIRST means the callback's own effects (which may
///    rebuild this widget with a new `currentSessionId`) never race the
///    close.
///  * **A press INSIDE its own panel must not close it.** In the DOM that
///    needed `composedPath()`, because a press inside a shadow tree is
///    retargeted to the shadow host and reads as "outside" — closing the
///    popover mid-press and swallowing the tap it was producing.
///    [TapRegion]'s `groupId` states the same idea directly: the toggle and
///    the panel live in different parts of the tree and count as ONE region.
///    "If any member of a group is hit by a particular tap, then the
///    onTapOutside / onTapUpOutside will not be called for any members of
///    the group."
///    https://api.flutter.dev/flutter/widgets/TapRegion-class.html
///
/// ── Why [OverlayPortal] rather than an [OverlayEntry] ───────────────────
///
/// The panel has to float over the transcript, and it has to stay part of
/// this widget for focus and inherited theme to work: "OverlayPortal uses
/// OverlayPortal.overlayChildBuilder to build a child widget of itself",
/// which is what lets the Escape handler below — declared around the toggle
/// — see a key event raised while focus is inside the panel.
/// https://api.flutter.dev/flutter/widgets/OverlayPortal-class.html
///
/// The same three pieces `ui/message_list/message_actions.dart` uses for its
/// own popover, deliberately: two popovers in one package should not have
/// two dismissal mechanisms.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../session/chat_session_summary.dart';
import 'session_row_list.dart';

/// What the toggle is called, for a reader that only ever hears it.
const String kSessionSwitcherToggleLabel = 'Switch conversation';

/// The panel's own name, and the name its list carries.
const String kSessionSwitcherPanelLabel = 'Your conversations';

/// What the switcher says when there is nothing else to switch to.
///
/// Deliberately not the picker screen's sentence: from inside a
/// conversation, "no previous conversations" would be false — the customer
/// is looking at one.
const String kSessionSwitcherEmptyText = 'No other conversations yet.';

/// How tall the popover's list is allowed to grow before it scrolls.
const double kSessionSwitcherMaxListHeight = 280;

/// How wide the popover is.
const double kSessionSwitcherPanelWidth = 300;

class SessionSwitcher extends StatefulWidget {
  const SessionSwitcher({
    super.key,
    required this.sessions,
    required this.currentSessionId,
    required this.onSelect,
    required this.onStartNew,
    this.isStartingNew = false,
    this.cornerRadius,
  });

  /// Rendered as given — see `SessionRowList.sessions`. An empty list still
  /// renders the popover, with its empty-state row: the toggle is not
  /// hidden, because "is there anything to switch to" is the caller's
  /// `sessions.length > 0` question and not a second one asked in here.
  final List<ChatSessionSummary> sessions;

  /// The conversation the customer is presently in — marked, never disabled.
  final String? currentSessionId;

  /// The customer picked a row, including the current one and terminal ones.
  final ValueChanged<String> onSelect;

  /// The customer asked for a fresh conversation instead of any listed one.
  final VoidCallback onStartNew;

  /// Whether a start is in flight. See `SessionPickerScreen.isStartingNew`.
  final bool isStartingNew;

  /// See `SessionRowList.cornerRadius`.
  final double? cornerRadius;

  @override
  State<SessionSwitcher> createState() => _SessionSwitcherState();
}

class _SessionSwitcherState extends State<SessionSwitcher> {
  final LayerLink _link = LayerLink();
  final OverlayPortalController _portal = OverlayPortalController();
  final FocusNode _toggleFocus = FocusNode(debugLabel: 'Switch conversation');
  late final Object _tapGroup = Object();

  bool _open = false;

  @override
  void dispose() {
    _toggleFocus.dispose();
    super.dispose();
  }

  void _openPanel() {
    if (_open) return;
    setState(() => _open = true);
    _portal.show();
  }

  void _close() {
    if (!_open) return;
    setState(() => _open = false);
    _portal.hide();
  }

  void _closeAndRefocus() {
    _close();
    _toggleFocus.requestFocus();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    // Reporting it handled is what stops the widget's own panel-level Escape
    // handler taking the whole chat down because the customer wanted to
    // dismiss a list of conversations.
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (event.logicalKey != LogicalKeyboardKey.escape) {
      return KeyEventResult.ignored;
    }
    if (!_open) return KeyEventResult.ignored;
    _closeAndRefocus();
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
          overlayChildBuilder: _buildPanel,
          child: TapRegion(
            groupId: _tapGroup,
            // Merged so the toggle is ONE node carrying both accounts of
            // itself: its name and button-ness, which `IconButton` states
            // from its tooltip, and its open/closed state, which only this
            // widget knows. Without the merge those are two nodes and a
            // reader announces "Switch conversation, button" with the state
            // stranded on a parent it never reads out.
            child: MergeSemantics(
              child: Semantics(
                // The direct port of `aria-expanded`. `aria-haspopup` and
                // `aria-controls` have no counterpart and need none: they
                // exist in the DOM to tell a reader a popup exists and where
                // it lives, and here the panel is a labelled semantics
                // container the reader reaches by ordinary traversal.
                expanded: _open,
                child: IconButton(
                  focusNode: _toggleFocus,
                  tooltip: kSessionSwitcherToggleLabel,
                  onPressed: _open ? _closeAndRefocus : _openPanel,
                  icon: const Icon(Icons.list_rounded),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPanel(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool hasRows = widget.sessions.isNotEmpty;

    return Positioned(
      width: kSessionSwitcherPanelWidth,
      child: CompositedTransformFollower(
        link: _link,
        targetAnchor: Alignment.bottomRight,
        followerAnchor: Alignment.topRight,
        child: TapRegion(
          // The same group as the toggle: a press on a row is never
          // "outside", so its tap still lands.
          groupId: _tapGroup,
          onTapOutside: (PointerDownEvent _) => _close(),
          child: Semantics(
            container: true,
            explicitChildNodes: true,
            label: kSessionSwitcherPanelLabel,
            child: Material(
              elevation: 4,
              borderRadius: BorderRadius.circular(12),
              color: theme.colorScheme.surface,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    ConstrainedBox(
                      constraints: const BoxConstraints(
                        maxHeight: kSessionSwitcherMaxListHeight,
                      ),
                      child: SessionRowList(
                        sessions: widget.sessions,
                        currentSessionId: widget.currentSessionId,
                        onSelect: _selectAndClose,
                        listLabel: kSessionSwitcherPanelLabel,
                        emptyText: kSessionSwitcherEmptyText,
                        // Sized to its content: a one-row popover should not
                        // be as tall as a full one.
                        shrinkWrap: true,
                        // Focus moves INTO the popover on open — a menu a
                        // keyboard user has just summoned but cannot reach
                        // without tabbing to it is not open to them, and a
                        // touch tap does not move focus on its own. It is
                        // also what puts the Escape handler in the key path.
                        autofocusFirstRow: hasRows,
                        cornerRadius: widget.cornerRadius,
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                      child: SessionStartNewButton(
                        onStartNew: _startNewAndClose,
                        busy: widget.isStartingNew,
                        autofocus: !hasRows,
                        cornerRadius: widget.cornerRadius,
                      ),
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

  void _selectAndClose(String sessionId) {
    _close();
    widget.onSelect(sessionId);
  }

  void _startNewAndClose() {
    _close();
    widget.onStartNew();
  }
}
