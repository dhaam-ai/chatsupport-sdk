/// The Messages screen — the conversations the customer still has,
/// searchable, plus a way to start a fresh one. Mirrors the row data
/// `ui/session-picker.ts` already renders (full status vocabulary, relative
/// time, preview, handledBy, unread) — see this file's header on the one
/// thing it adds that no JS row does yet.
///
/// "Still has", not "every conversation the host supplied", and the
/// difference is exactly one status: a conversation the merchant has CLOSED
/// is not listed here (see [ChatWidgetState.customerVisibleSessions] for the
/// rule, its one exception, and why RESOLVED is unaffected). This screen is
/// no longer the surface that shows everything.
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
// The close control, declared beside Home's own use of it. ONE widget and
// ONE accessible name across both tabs, because from the customer's side
// this is a single affordance that happens to be on whichever tab they are
// on — see `kCloseChatLabel`. `show` rather than a bare import: what this
// screen borrows from Home is exactly that control and nothing else about
// it.
import 'home_screen.dart' show ChatCloseButton;

class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key, this.onClose});

  /// Forwarded from `ChatWidget.onClose`. Null draws no close control, and
  /// leaves this screen the tree it was before the parameter existed.
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
        // `customerVisibleSessions`, not `sessionSummaries`: a conversation
        // the merchant has CLOSED is not one of the customer's any more, and
        // the rule for that lives on the state object all three surfaces
        // read — see [ChatWidgetState.customerVisibleSessions]. The search
        // box narrows what is already the customer's list; it is not where
        // the status question is answered.
        final List<ChatSessionSummary> customerVisible =
            state.customerVisibleSessions;
        final List<ChatSessionSummary> visible =
            customerVisible.where(_matches).toList(growable: false);
        // ── Why the empty state needs to know this ────────────────────
        //
        // An empty list has two different causes here and the customer is
        // owed the right one. "No previous conversations yet." is simply
        // FALSE for someone whose only conversation the merchant closed:
        // they have one. The screen cannot tell those apart from `visible`
        // alone, because the rule above already removed the evidence — so
        // the comparison is made where both facts are still in hand.
        //
        // An empty `customerVisible` over a NON-empty page means every
        // summary the host supplied was withheld, and there is exactly one
        // thing that withholds one (closed, and not the conversation being
        // read), which is why the copy can name closure rather than say
        // something vague about rows that are missing.
        final bool withheld =
            customerVisible.isEmpty && state.sessionSummaries.isNotEmpty;
        final double radius = chatCornerRadius(state.config);

        final VoidCallback? close = widget.onClose;

        return Column(
          children: <Widget>[
            // Above the search box, in the same corner Home puts it — this
            // screen's own first row, so the control does not move as the
            // customer changes tab. Absent entirely when the host wired no
            // callback, which leaves this Column exactly the three children
            // it had before.
            if (close != null) ChatCloseButton(onClose: close),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: _SearchField(controller: _search, radius: radius),
            ),
            Expanded(
              child: visible.isEmpty
                  ? _EmptyState(hasQuery: _query.isNotEmpty, withheld: withheld)
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: visible.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (BuildContext context, int index) {
                        final ChatSessionSummary summary = visible[index];
                        return _ConversationRow(
                          // Keyed by id, not by index — the same rule
                          // `session_row_list.dart` has always applied, and
                          // for the same reason: a list rebuilt with one
                          // conversation removed must drop THAT row's element
                          // rather than reuse it for whatever slid up into
                          // its position.
                          //
                          // This row missed it, and the cost was specific.
                          // Unkeyed, removing a row did not destroy its
                          // element, so a focused row's focus node SURVIVED
                          // and was silently re-pointed at a different
                          // conversation — no focus change, so nothing for
                          // assistive technology to announce, and Enter
                          // opened a conversation the customer had not
                          // chosen. Keyed, focus genuinely moves and is
                          // announced.
                          //
                          // Pinned by `test/ui/messages_row_focus_test.dart`,
                          // which asserts the node actually differs rather
                          // than only where it lands.
                          key: ValueKey<String>(summary.id),
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
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(radius)),
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
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(radius),
            borderSide: BorderSide.none),
      ),
    );
  }
}

/// The sentence an empty list gets, and the three different reasons it can
/// be empty.
///
/// ── None, withheld, and unmatched are not the same thing ───────────────
///
/// A customer with no conversations at all and a customer whose only
/// conversation the merchant has CLOSED both arrive at an empty list, and
/// telling the second of them "No previous conversations yet." is the
/// screen stating something that is not true. They have one; this package
/// is not listing it (see [ChatWidgetState.customerVisibleSessions] for why
/// that withholding is right). So the fact that rows were withheld is
/// carried down here and said plainly.
///
/// ── What this copy deliberately does NOT do ────────────────────────────
///
/// It offers no way to see the withheld conversation — no archive, no
/// filter, no "show closed". There is no such surface in this package and
/// inventing one is a product decision nobody has made; copy that hinted at
/// it would promise an action the customer cannot take, which is the same
/// failure as the sentence it replaces. It reports a state and stops there.
/// The one thing the customer CAN do about it is already on this screen:
/// the New conversation button directly below.
class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.hasQuery, required this.withheld});

  final bool hasQuery;

  /// Whether the customer HAS conversations that this screen is not
  /// listing, as opposed to having none at all.
  final bool withheld;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          // A typed query is answered first, and neither ordering makes a
          // false statement: when both are true, nothing matches AND
          // everything they have is closed. The customer just asked one of
          // those two questions by typing, so that is the one replied to;
          // clearing the box tells them the rest.
          hasQuery
              ? 'No conversations match your search.'
              : withheld
                  ? 'Your previous conversations have been closed.'
                  : 'No previous conversations yet.',
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
  const _ConversationRow({
    super.key,
    required this.summary,
    required this.radius,
    required this.onTap,
  });

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
    final String time =
        relativeTimeLabel(summary.lastMessageAt ?? summary.createdAt);

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
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                chatStatusLabel(summary.status),
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: scheme.primary),
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
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 1),
                          decoration: BoxDecoration(
                              color: scheme.error,
                              borderRadius: BorderRadius.circular(999)),
                          child: Text(
                            summary.unreadCount > 99
                                ? '99+'
                                : '${summary.unreadCount}',
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(color: scheme.onError),
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
