/// The Home screen — the first thing a customer sees. Mirrors
/// `ui/home-screen.ts`: the hero, a "Send us a message" CTA card, the most
/// recent conversation (when there is one) with a See-all link, and Common
/// Questions.
///
/// Reads [ChatWidgetCubit]'s state directly via [BlocBuilder] rather than
/// taking typed props — this is the SCREEN, the thing the root widget
/// mounts, not a presentational component a test builds in isolation (those
/// are [HeroHeader] and [CommonQuestionsList], which this screen composes).
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../config/remote_config.dart';
import '../nav/chat_screens.dart';
import '../session/chat_session_summary.dart';
import '../session/session_display.dart';
import '../state/chat_widget_cubit.dart';
import '../state/chat_widget_state.dart';
import '../theme/chat_theme.dart';
import 'common_questions_list.dart';
import 'hero_header.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChatWidgetCubit, ChatWidgetState>(
      builder: (BuildContext context, ChatWidgetState state) {
        final ChatWidgetCubit cubit = context.read<ChatWidgetCubit>();
        final RemoteConfig config = state.config;
        final ChatSessionSummary? recent = mostRecentSummary(state.sessionSummaries);
        final double radius = chatCornerRadius(config);

        return ListView(
          padding: EdgeInsets.zero,
          children: <Widget>[
            HeroHeader(config: config),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  _SendMessageCta(
                    // The merchant's own response-time line, reused rather
                    // than a second hardcoded "we usually reply instantly" —
                    // home-screen.ts's own comment on why this is the SAME
                    // ctaSubtitle the hero's own CTA would have shown, now
                    // that this card is the one place it renders (see
                    // hero_header.dart's header).
                    subtitle: config.header.ctaSubtitle,
                    radius: radius,
                    onTap: cubit.startNewConversation,
                  ),
                  if (recent != null) ...<Widget>[
                    const SizedBox(height: 24),
                    _RecentConversationSection(
                      summary: recent,
                      radius: radius,
                      onSeeAll: () => cubit.switchTab(ScreenName.messages),
                      onOpen: () => cubit.openConversation(recent.id),
                    ),
                  ],
                  if (config.commonQuestions.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 24),
                    _SectionHeading('Common Questions'),
                    const SizedBox(height: 8),
                    CommonQuestionsList(
                      questions: config.commonQuestions,
                      // One call, not "open the new-conversation form and
                      // then send into it": a tapped question is a customer
                      // asking one specific thing, and routing it through the
                      // form would put the merchant's pre-chat questions in
                      // front of an answer they already asked for. See
                      // ChatWidgetCubit.startCommonQuestion.
                      onSelect: cubit.startCommonQuestion,
                    ),
                  ],
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: Theme.of(context).textTheme.labelMedium?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
            letterSpacing: 0.4,
          ),
    );
  }
}

class _SendMessageCta extends StatelessWidget {
  const _SendMessageCta({required this.subtitle, required this.radius, required this.onTap});

  /// `config.header.ctaSubtitle` — hidden when the merchant left it unset,
  /// matching `home-screen.ts`'s own `ctaSubtitle.hidden = subtitle === ''`.
  final String? subtitle;
  final double radius;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
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
          padding: const EdgeInsets.all(16),
          child: Row(
            children: <Widget>[
              CircleAvatar(
                backgroundColor: scheme.primary,
                foregroundColor: scheme.onPrimary,
                child: const Icon(Icons.chat_bubble_outline, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Send us a message', style: Theme.of(context).textTheme.titleSmall),
                    if (subtitle != null && subtitle!.isNotEmpty)
                      Text(
                        subtitle!,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

class _RecentConversationSection extends StatelessWidget {
  const _RecentConversationSection({
    required this.summary,
    required this.radius,
    required this.onSeeAll,
    required this.onOpen,
  });

  final ChatSessionSummary summary;
  final double radius;
  final VoidCallback onSeeAll;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    // ALWAYS a pill, for every status — see `homeStatusPill`. This used to be
    // a nullable map lookup that rendered nothing for OPEN, ASSIGNED and
    // ON_HOLD.
    final String pill = homeStatusPill(summary.status);
    final String preview = summary.lastMessagePreview ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: <Widget>[
            _SectionHeading('Recent conversation'),
            TextButton(onPressed: onSeeAll, child: const Text('See all')),
          ],
        ),
        Material(
          color: scheme.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radius),
            side: BorderSide(color: scheme.outlineVariant),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(radius),
            onTap: onOpen,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Row(
                          children: <Widget>[
                            Flexible(
                              child: Text(
                                // NOT a subject line — see chat_session_summary.dart's
                                // header on why this is WHO handled it, never an
                                // invented title. handledByText is not reused here
                                // because it prefixes "with " for the row-body
                                // context Messages uses; this is the row's own
                                // heading, so the bare name is what home-screen.ts
                                // itself renders here.
                                summary.handledBy?.displayName ?? 'Conversation',
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.titleSmall,
                              ),
                            ),
                            const SizedBox(width: 8),
                            _StatusPill(pill),
                          ],
                        ),
                        if (preview.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
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
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            relativeTimeLabel(summary.lastMessageAt ?? summary.createdAt),
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(color: scheme.onSurfaceVariant),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(Icons.chevron_right, color: scheme.onSurfaceVariant),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: scheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(999)),
      child: Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant)),
    );
  }
}
