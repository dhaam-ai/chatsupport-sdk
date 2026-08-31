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

import '../session/chat_session_summary.dart';
import '../session/session_display.dart';
import '../state/chat_widget_cubit.dart';
import '../state/chat_widget_state.dart';
import '../theme/chat_theme.dart';

class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key});

  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  final TextEditingController _search = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() => _query = _search.text.trim().toLowerCase()));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool _matches(ChatSessionSummary summary) {
    if (_query.isEmpty) return true;
    final Iterable<String> haystack = <String?>[
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
        final List<ChatSessionSummary> visible = state.sessionSummaries.where(_matches).toList(growable: false);
        final double radius = chatCornerRadius(state.config);

        return Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: _SearchField(controller: _search, radius: radius),
            ),
            Expanded(
              child: visible.isEmpty
                  ? _EmptyState(hasQuery: _query.isNotEmpty)
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: visible.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (BuildContext context, int index) {
                        final ChatSessionSummary summary = visible[index];
                        return _ConversationRow(
                          summary: summary,
                          radius: radius,
                          onTap: () => cubit.openConversation(summary.id),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: FilledButton.icon(
                onPressed: cubit.startNewConversation,
                icon: const Icon(Icons.add),
                label: const Text('New conversation'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(44),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller, required this.radius});

  final TextEditingController controller;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: 'Search conversations',
        prefixIcon: const Icon(Icons.search),
        isDense: true,
        filled: true,
        fillColor: Theme.of(context).colorScheme.surfaceContainerHighest,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(radius), borderSide: BorderSide.none),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.hasQuery});

  final bool hasQuery;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          hasQuery ? 'No conversations match your search.' : 'No previous conversations yet.',
          textAlign: TextAlign.center,
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}

class _ConversationRow extends StatelessWidget {
  const _ConversationRow({required this.summary, required this.radius, required this.onTap});

  final ChatSessionSummary summary;
  final double radius;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final String heading = summary.subject ?? summary.topic ?? summary.handledBy?.displayName ?? 'Conversation';
    final String preview = summary.lastMessagePreview ?? '';
    final String handled = handledByText(summary.handledBy);
    final String time = relativeTimeLabel(summary.lastMessageAt ?? summary.createdAt);

    return Material(
      color: scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radius),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      child: InkWell(
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
                      heading,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    time,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                chatStatusLabel[summary.status] ?? '',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.primary),
              ),
              if (preview.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    preview,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ),
              if (handled.isNotEmpty || summary.unreadCount > 0)
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
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(color: scheme.onSurfaceVariant),
                          ),
                        ),
                      if (summary.unreadCount > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                          decoration: BoxDecoration(color: scheme.error, borderRadius: BorderRadius.circular(999)),
                          child: Text(
                            summary.unreadCount > 99 ? '99+' : '${summary.unreadCount}',
                            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onError),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
