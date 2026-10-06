/// The Messages screen — every conversation the host supplied, searchable,
/// plus a way to start a fresh one. Mirrors the row data `ui/session-picker.ts`
/// already renders (full status vocabulary, relative time, preview,
/// handledBy, unread) — see this file's header on the one thing it adds
/// that no JS row does yet.
///
/// ── Search is local, ephemeral UI state — not Cubit state ───────────────
///
/// A typed query has no meaning outside this screen and nothing else in the
/// widget needs to react to it, so it lives in this [StatefulWidget]'s own
/// [TextEditingController] rather than growing [ChatWidgetState] for a
/// filter only one screen reads.
///
/// ── The row's heading: subject, then topic, then who handled it ─────────
///
/// [ChatSessionSummary.subject] / `.topic` are newly-optional fields landing
/// in parallel (the SDK plan's §A) that no existing JS row renders yet
/// either. Per this package's own brief — "render a sensible row when they
/// are absent and do NOT invent a title" — a subject (the customer's own
/// words) is the most specific thing to show; falling back to `topic` (the
/// chip category they picked) and then to who handled it keeps every row
/// meaningful without ever fabricating text nobody wrote.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../app_assets.dart';
import '../session/chat_session_summary.dart';
import '../session/session_display.dart';
import '../state/chat_widget_cubit.dart';
import '../state/chat_widget_state.dart';
import '../theme/chat_theme.dart';
import 'session_status_pill.dart';
import 'svg_asset_icon.dart';

class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key, this.onBack, this.onClose});

  final VoidCallback? onBack;
  final VoidCallback? onClose;

  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  final TextEditingController _search = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _search.addListener(
        () => setState(() => _query = _search.text.trim().toLowerCase()));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  /// Whether [summary] survives the current query — `''` matches everything.
  ///
  /// ── Nothing is searchable that is not on screen ─────────────────────
  ///
  /// Every field below is one this screen's own row renders, which is the
  /// rule `messages-screen.ts` states for its own filter: a match is always
  /// explainable by looking at the row that produced it. The status is in
  /// here for exactly that reason — it is the most prominent thing on a row
  /// after the heading, and a customer who can read "Resolved" and types it
  /// getting an empty screen is the filter contradicting the list.
  ///
  /// Matched through [chatStatusLabel], never the enum's own name: the
  /// customer types what they can SEE, and "waitingForAgent" is not on any
  /// screen. The generic heading fallback is deliberately NOT searchable —
  /// it is a placeholder nobody wrote, so matching it would answer
  /// "conversation" with every untitled row.
  bool _matches(ChatSessionSummary summary) {
    if (_query.isEmpty) return true;
    final Iterable<String> haystack = <String?>[
      chatStatusLabel(summary.status),
      summary.subject,
      summary.topic,
      summary.lastMessagePreview,
      summary.handledBy?.displayName,
    ].whereType<String>();
    return haystack.any((String field) => field.toLowerCase().contains(_query));
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChatWidgetCubit, ChatWidgetState>(
      builder: (BuildContext context, ChatWidgetState state) {
        final ChatWidgetCubit cubit = context.read<ChatWidgetCubit>();
        final List<ChatSessionSummary> openSummaries =
            state.customerVisibleSessions;
        final bool hasOnlyClosedSummaries =
            state.sessionSummaries.isNotEmpty && openSummaries.isEmpty;
        final List<ChatSessionSummary> visible =
            openSummaries.where(_matches).toList(growable: false);
        final double radius = chatCornerRadius(state.config);

        return SafeArea(
          child: Column(
            children: <Widget>[
              _MessagesHeader(
                onBack: widget.onBack,
                onClose: widget.onClose,
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: _SearchField(controller: _search, radius: radius),
              ),
              const Divider(
                height: 8,
                thickness: 0.5,
              ),
              Expanded(
                child: visible.isEmpty
                    ? _EmptyState(
                        hasQuery: _query.isNotEmpty,
                        hasOnlyClosedSummaries: hasOnlyClosedSummaries,
                        radius: radius,
                        onNewConversation: cubit.startNewConversation,
                      )
                    : ListView.separated(
                        padding: EdgeInsets.zero,
                        itemCount: visible.length,
                        separatorBuilder: (_, __) => const Divider(
                          height: 8,
                          thickness: 0.5,
                        ),
                        itemBuilder: (BuildContext context, int index) {
                          final ChatSessionSummary summary = visible[index];
                          return Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: _ConversationRow(
                              summary: summary,
                              radius: radius,
                              onTap: () => cubit.openConversation(summary.id),
                            ),
                          );
                        },
                      ),
              ),
              if (visible.isNotEmpty) ...<Widget>[
                const Divider(
                  height: 8,
                  thickness: 0.5,
                ),
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton.icon(
                    onPressed: cubit.startNewConversation,
                    icon: const SvgAssetIcon(
                      AppAssets.editIcon,
                      size: 18,
                    ),
                    label: const Text('New conversation'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(44),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(radius)),
                    ),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _MessagesHeader extends StatelessWidget {
  const _MessagesHeader({this.onBack, this.onClose});

  final VoidCallback? onBack;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(bottom: BorderSide(color: scheme.outlineVariant)),
      ),
      child: SizedBox(
        height: 64,
        child: NavigationToolbar(
          centerMiddle: false,
          leading: onBack == null
              ? null
              : IconButton(
                  tooltip: 'Back',
                  icon: const Icon(Icons.arrow_back_ios),
                  onPressed: onBack,
                ),
          middle: Text(
            'Messages',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w600),
          ),
          trailing: onClose == null
              ? null
              : IconButton(
                  tooltip: 'Close chat',
                  icon: const Icon(Icons.close),
                  onPressed: onClose,
                ),
        ),
      ),
    );
  }
}

class _SearchField extends StatefulWidget {
  const _SearchField({required this.controller, required this.radius});

  final TextEditingController controller;
  final double radius;

  @override
  State<_SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<_SearchField> {
  final FocusNode _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_onFocusChanged);
    widget.controller.addListener(_onSearchChanged);
  }

  @override
  void didUpdateWidget(_SearchField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.controller, widget.controller)) {
      oldWidget.controller.removeListener(_onSearchChanged);
      widget.controller.addListener(_onSearchChanged);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onSearchChanged);
    _focusNode.removeListener(_onFocusChanged);
    _focusNode.dispose();
    super.dispose();
  }

  void _onFocusChanged() => setState(() {});

  void _onSearchChanged() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final Color borderColor =
        _focusNode.hasFocus ? scheme.primary : scheme.outlineVariant;
    final double searchRadius = widget.radius.clamp(0, 8).toDouble();

    return TextField(
      controller: widget.controller,
      focusNode: _focusNode,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: 'Search conversations',
        prefixIcon: const Padding(
          padding: EdgeInsets.only(left: 12, right: 2),
          child: Icon(Icons.search, size: 20),
        ),
        prefixIconConstraints:
            const BoxConstraints.tightFor(width: 34, height: 36),
        suffixIcon: widget.controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: 'Clear search',
                icon: const Icon(Icons.close, size: 18),
                onPressed: widget.controller.clear,
              ),
        suffixIconConstraints:
            const BoxConstraints.tightFor(width: 40, height: 36),
        isDense: true,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(searchRadius),
          borderSide: BorderSide(color: borderColor),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(searchRadius),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(searchRadius),
          borderSide: BorderSide(color: scheme.primary),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.hasQuery,
    required this.hasOnlyClosedSummaries,
    required this.radius,
    required this.onNewConversation,
  });

  final bool hasQuery;
  final bool hasOnlyClosedSummaries;
  final double radius;
  final VoidCallback onNewConversation;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final String title = hasQuery
        ? 'No conversations match your search.'
        : hasOnlyClosedSummaries
            ? 'Your previous conversations have been closed.'
            : 'No previous conversations yet.';
    final String subtitle = hasQuery
        ? 'Try a different word, or start a new conversation about it.'
        : hasOnlyClosedSummaries
            ? 'Start a new conversation when you need more help.'
            : 'Start a new conversation when you need help.';

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            DecoratedBox(
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                shape: BoxShape.circle,
              ),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Icon(
                  Icons.search,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ),
            const SizedBox(height: 18),
            Text(
              title,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 22),
            FilledButton(
              onPressed: onNewConversation,
              style: FilledButton.styleFrom(
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(radius)),
              ),
              child: const Text('New conversation'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConversationRow extends StatelessWidget {
  const _ConversationRow(
      {required this.summary, required this.radius, required this.onTap});

  final ChatSessionSummary summary;
  final double radius;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final String heading = summary.subject ??
        summary.topic ??
        summary.handledBy?.displayName ??
        'Conversation';
    final String preview = summary.lastMessagePreview ?? '';
    final String handled = handledByText(summary.handledBy);
    final String pill = homeStatusPill(summary.status);
    final String time =
        relativeTimeLabel(summary.lastMessageAt ?? summary.createdAt);

    return Material(
      color: scheme.surface,
      // shape: RoundedRectangleBorder(
      //   borderRadius: BorderRadius.circular(radius),
      //   side: BorderSide(color: scheme.outlineVariant),
      // ),
      child: InkWell(
        borderRadius: BorderRadius.circular(radius),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Flexible(
                    child: Row(
                      children: [
                        Flexible(
                          child: Text(
                            heading,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                        ),
                        const SizedBox(width: 8),
                        SessionStatusPill(
                          status: summary.status,
                          label: pill,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Row(
                    children: [
                      if (summary.unreadCount > 0)
                        Container(
                          margin: EdgeInsets.only(right: 5),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 1),
                          decoration: BoxDecoration(
                              color: scheme.primary,
                              borderRadius: BorderRadius.circular(999)),
                          child: Text(
                            summary.unreadCount > 99
                                ? '99+'
                                : '${summary.unreadCount}',
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(color: scheme.onPrimary),
                          ),
                        ),
                      Icon(
                        Icons.arrow_forward_ios_rounded,
                        size: 15,
                      ),
                    ],
                  ),
                ],
              ),
              if (preview.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    preview,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ),
              if (handled.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    handled,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ),
              Text(
                time,
                textAlign: TextAlign.right,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
