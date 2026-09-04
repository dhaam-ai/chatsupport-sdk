/// The shared row family both picker surfaces build their list out of, so a
/// row can never render two ways — the port of `session-picker.ts`'s
/// `createSessionRow` / `createSessionRowList` / `createStartNewButton`.
///
/// ── One row family, two surfaces ────────────────────────────────────────
///
/// The screen and the header switcher differ in their chrome, their list
/// label and their empty sentence, and in nothing else. Everything a ROW is
/// — what it shows, what it speaks, that it is tappable whatever its status
/// — is stated once here and consumed by both. `session_display.dart`'s own
/// header records what happens when a row's vocabulary gets a second copy:
/// one conversation reads two ways on two screens.
///
/// ── Terminal rows are not disabled ──────────────────────────────────────
///
/// [SessionRow]'s tap handler is required and non-nullable. There is no
/// status it is withheld for, no `enabled` parameter to pass `false` to, and
/// no dimmed-archive variant: picking a CLOSED or RESOLVED conversation and
/// typing reactivates it server-side, so rendering one inert would take away
/// a path that works. Making that unrepresentable in the constructor is
/// stronger than a comment asking for it.
library;

import 'package:flutter/material.dart';

import '../../config/remote_config.dart';
import '../../session/chat_session_summary.dart';
import '../../session/session_display.dart';
import '../../theme/chat_theme.dart';
import 'session_row_description.dart';

/// What the "start a new conversation" control reads when idle.
const String kStartNewConversationLabel = 'Start a new conversation';

/// What it reads while a start is in flight.
const String kStartingNewConversationLabel = 'Starting…';

/// A list of conversations, or one empty-state row.
///
/// ── An empty list is a ROW, not a hidden component ──────────────────────
///
/// [sessions] being empty renders [emptyText] and nothing else. This widget
/// never decides to disappear, because "should the picker be on screen at
/// all" is `sessions.length > 0` asked by whoever owns the screen flow — see
/// this module's barrel on why re-deciding it here would be a second source
/// of truth for "is this a guest".
class SessionRowList extends StatelessWidget {
  const SessionRowList({
    super.key,
    required this.sessions,
    required this.currentSessionId,
    required this.onSelect,
    required this.listLabel,
    required this.emptyText,
    this.shrinkWrap = false,
    this.autofocusFirstRow = false,
    this.cornerRadius,
  });

  /// Rendered in the order given. This widget does not sort, filter or
  /// de-duplicate — it renders exactly what it is handed, which is what
  /// makes "what does the customer see" a question about the caller's list
  /// rather than about two layers at once.
  final List<ChatSessionSummary> sessions;

  /// The conversation the customer is presently in, or `null` when the
  /// surface has no notion of one (the standalone screen passes `null` and
  /// therefore marks no row).
  final String? currentSessionId;

  /// Called with the picked session's id — for a terminal row too.
  final ValueChanged<String> onSelect;

  /// Names the list itself for a screen reader.
  final String listLabel;

  /// The one row an empty list renders.
  final String emptyText;

  /// For a list inside a popover, which is sized to its content rather than
  /// given the height to fill.
  final bool shrinkWrap;

  /// Puts keyboard focus on the first row when the surface appears. Focus
  /// lands on a row when there is one, and on the start-new control when
  /// there is not — the surfaces own that choice and pass the answer down.
  final bool autofocusFirstRow;

  /// The merchant's published corner radius, or `null` for this package's
  /// own default.
  ///
  /// A parameter rather than a `RemoteConfig` read, because these widgets
  /// are deliberately Cubit-free: they render what they are given. The
  /// mounting surface, which does hold the state, passes
  /// `chatCornerRadius(state.config)` through. `null` resolves to
  /// `chatCornerRadius(defaultRemoteConfig)` rather than a literal, so the
  /// default has exactly one definition.
  final double? cornerRadius;

  @override
  Widget build(BuildContext context) {
    if (sessions.isEmpty) {
      return Semantics(
        container: true,
        label: listLabel,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
          child: Text(
            emptyText,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ),
      );
    }

    return Semantics(
      container: true,
      explicitChildNodes: true,
      label: listLabel,
      child: ListView.separated(
        shrinkWrap: shrinkWrap,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: sessions.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (BuildContext context, int index) {
          final ChatSessionSummary summary = sessions[index];
          return SessionRow(
            // Keyed by id, not by index: a list rebuilt with one session
            // removed must drop THAT row's element rather than reusing it
            // for whatever slid up into its position.
            key: ValueKey<String>(summary.id),
            summary: summary,
            isCurrent: summary.id == currentSessionId,
            autofocus: autofocusFirstRow && index == 0,
            cornerRadius: cornerRadius,
            onTap: () => onSelect(summary.id),
          );
        },
      ),
    );
  }
}

/// One conversation: its status, when it last moved, its preview, who has it
/// and how much of it is unread — always as an enabled control.
class SessionRow extends StatelessWidget {
  const SessionRow({
    super.key,
    required this.summary,
    required this.isCurrent,
    required this.onTap,
    this.autofocus = false,
    this.cornerRadius,
  });

  final ChatSessionSummary summary;

  /// Marked, not disabled. The current conversation is still pickable — the
  /// switcher is where a customer confirms they are already where they meant
  /// to be, and a dead row there reads as a broken one.
  final bool isCurrent;

  /// Required and non-nullable — see this file's header.
  final VoidCallback onTap;

  final bool autofocus;

  /// See `SessionRowList.cornerRadius`.
  final double? cornerRadius;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final TextTheme text = Theme.of(context).textTheme;
    final double radius = cornerRadius ?? chatCornerRadius(defaultRemoteConfig);

    final String preview = summary.lastMessagePreview ?? '';
    final String handled = handledByText(summary.handledBy);
    final bool hasUnread = summary.unreadCount > 0;

    return Semantics(
      container: true,
      button: true,
      // The port of `aria-current="true"`. Carried on the row itself rather
      // than announced inside the label a second time — `describeSessionRow`
      // states it in words for readers that do not surface selection.
      selected: isCurrent,
      label: describeSessionRow(summary, isCurrent: isCurrent),
      onTap: onTap,
      // The ONE spoken account. Without this the visible spans below are
      // read out as well, so a screen reader hears the status twice and the
      // preview twice — and the composed label stops being the single
      // source it exists to be.
      excludeSemantics: true,
      child: Material(
        color: isCurrent ? scheme.primaryContainer : scheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radius),
          side: BorderSide(
            color: isCurrent ? scheme.primary : scheme.outlineVariant,
          ),
        ),
        child: InkWell(
          autofocus: autofocus,
          borderRadius: BorderRadius.circular(radius),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        chatStatusLabel(summary.status),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.labelLarge?.copyWith(color: scheme.primary),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      relativeTimeLabel(
                        summary.lastMessageAt ?? summary.createdAt,
                      ),
                      style: text.labelSmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
                // Absent rather than present-and-blank. The TypeScript
                // original keeps the span and toggles `hidden` because it
                // reuses one node across renders; Flutter rebuilds, so an
                // empty `Text` would only be an invisible box taking layout.
                if (preview.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      preview,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: text.bodySmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ),
                if (handled.isNotEmpty || hasUnread)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Row(
                      children: <Widget>[
                        if (handled.isNotEmpty)
                          Expanded(
                            child: Text(
                              handled,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: text.labelSmall
                                  ?.copyWith(color: scheme.onSurfaceVariant),
                            ),
                          ),
                        if (hasUnread)
                          Text(
                            '${summary.unreadCount} unread',
                            style: text.labelSmall?.copyWith(
                              color: scheme.error,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// "Start a new conversation" — the one control both surfaces offer beside
/// the list, whatever the list contains.
///
/// Always available, deliberately. A customer with five open conversations
/// still gets it, and a customer with none gets it as the only thing on the
/// surface: it is the answer to "none of these", which is a question an
/// empty list asks loudest.
class SessionStartNewButton extends StatelessWidget {
  const SessionStartNewButton({
    super.key,
    required this.onStartNew,
    this.busy = false,
    this.autofocus = false,
    this.cornerRadius,
  });

  final VoidCallback onStartNew;

  /// Disables AND relabels. Disabling alone leaves a control that looks
  /// broken; relabelling alone leaves one round trip able to mint two
  /// sessions.
  final bool busy;

  final bool autofocus;

  /// See `SessionRowList.cornerRadius`.
  final double? cornerRadius;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      autofocus: autofocus,
      onPressed: busy ? null : onStartNew,
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(44),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(
            cornerRadius ?? chatCornerRadius(defaultRemoteConfig),
          ),
        ),
      ),
      child: Text(
        busy ? kStartingNewConversationLabel : kStartNewConversationLabel,
      ),
    );
  }
}
