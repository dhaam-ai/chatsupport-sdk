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

import 'package:dhaam_chat/dhaam_chat.dart' show safeLinkUrl;
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_svg/svg.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_assets.dart';
import '../config/remote_config.dart';
import '../nav/chat_screens.dart';
import '../session/chat_session_summary.dart';
import '../session/session_display.dart';
import '../state/chat_widget_cubit.dart';
import '../state/chat_widget_state.dart';
import '../theme/chat_theme.dart';
import 'common_questions_list.dart';
import 'header/header_avatar.dart';
import 'header/identity_header.dart';
import 'hero_header.dart';
import 'session_status_pill.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, this.onClose});

  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChatWidgetCubit, ChatWidgetState>(
      builder: (BuildContext context, ChatWidgetState state) {
        final ChatWidgetCubit cubit = context.read<ChatWidgetCubit>();
        final RemoteConfig config = state.config;
        final ChatSessionSummary? recent =
            mostRecentSummary(state.sessionSummaries);
        final double radius = chatCornerRadius(config);
        final bool classic = config.design == WidgetDesign.classic;
        final bool overlapHero = !classic && _hasHeroHeader(config, onClose);
        final Widget cta = _SendMessageCta(
          title: config.header.ctaTitle ??
              (classic ? 'Chat now' : 'Send us a message'),
          // The merchant's own response-time line, reused rather
          // than a second hardcoded "we usually reply instantly" —
          // home-screen.ts's own comment on why this is the SAME
          // ctaSubtitle the hero's own CTA would have shown, now
          // that this card is the one place it renders (see
          // hero_header.dart's header).
          subtitle: config.header.ctaSubtitle,
          radius: radius,
          onTap: cubit.startNewConversation,
        );
        final Widget content = _HomeContent(
          config: config,
          recent: recent,
          radius: radius,
          classic: classic,
          overlapHero: overlapHero,
          cta: cta,
          onSeeAll: () => cubit.switchTab(ScreenName.messages),
          onOpenRecent:
              recent == null ? null : () => cubit.openConversation(recent.id),
          onQuestion: cubit.startCommonQuestion,
        );
        final Widget body = ListView(
          padding: EdgeInsets.zero,
          children: <Widget>[content],
        );

        if (classic) {
          return Column(
            children: <Widget>[
              _ClassicHomeHeader(
                state: state,
                onClose: onClose,
              ),
              Expanded(child: body),
            ],
          );
        }

        // ── The hero is pinned ABOVE the scroll view, not inside it ──
        //
        // Collapsing has to hand the hero's height back to something. A hero
        // that were merely the scroll view's first child would already be
        // gone by the time the visitor had scrolled past it, so there would
        // be nothing for a collapse to mean; pinned above, it stays put while
        // the content moves under it and then gets out of the way entirely.
        // `CollapsingHeroHeader` owns that arrangement rather than this
        // screen assembling it — see its own header for why the band and the
        // scroll view have to be one widget's business.
        return CollapsingHeroHeader(
          config: config,
          onClose: onClose,
          foreground: overlapHero ? cta : null,
          slivers: <Widget>[
            SliverToBoxAdapter(child: content),
          ],
        );
      },
    );
  }
}

class _ClassicHomeHeader extends StatelessWidget {
  const _ClassicHomeHeader({required this.state, this.onClose});

  final ChatWidgetState state;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final RemoteConfig config = state.config;
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final String? subtitle = _firstNonBlank(<String?>[
      config.subtitle,
      config.header.ctaSubtitle,
    ]);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(bottom: BorderSide(color: scheme.outlineVariant)),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
          child: Row(
            children: <Widget>[
              HeaderAvatar(
                session: state.session,
                config: config,
                diameter: 40,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    IdentityHeader(
                      session: state.session,
                      fallbackTitle: config.title ?? 'Conversation',
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    if (subtitle != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Row(
                          children: <Widget>[
                            const _PresenceDot(),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                subtitle,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(color: scheme.onSurfaceVariant),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              if (onClose != null)
                IconButton(
                  tooltip: 'Close chat',
                  icon: const Icon(Icons.close),
                  onPressed: onClose,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeContent extends StatelessWidget {
  const _HomeContent({
    required this.config,
    required this.recent,
    required this.radius,
    required this.classic,
    required this.overlapHero,
    required this.cta,
    required this.onSeeAll,
    required this.onOpenRecent,
    required this.onQuestion,
  });

  final RemoteConfig config;
  final ChatSessionSummary? recent;
  final double radius;
  final bool classic;
  final bool overlapHero;
  final Widget cta;
  final VoidCallback onSeeAll;
  final VoidCallback? onOpenRecent;
  final ValueChanged<CommonQuestion> onQuestion;

  @override
  Widget build(BuildContext context) {
    final bool showClassicGreeting = classic && _hasClassicGreeting(config);

    return Padding(
      padding: EdgeInsets.fromLTRB(20, classic ? 20 : 0, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (showClassicGreeting) ...<Widget>[
            _ClassicGreeting(config: config),
            const SizedBox(height: 24),
          ],
          if (overlapHero)
            const SizedBox(height: kHeroHeaderForegroundOverlap + 8)
          else
            cta,
          if (recent != null && onOpenRecent != null) ...<Widget>[
            const SizedBox(height: 24),
            _RecentConversationSection(
              summary: recent!,
              radius: radius,
              onSeeAll: onSeeAll,
              onOpen: onOpenRecent!,
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
              onSelect: onQuestion,
            ),
          ],
          _BrandingFooter(config: config),
        ],
      ),
    );
  }
}

class _BrandingFooter extends StatelessWidget {
  const _BrandingFooter({required this.config});

  final RemoteConfig config;

  @override
  Widget build(BuildContext context) {
    final String label = (config.brandingText ?? '').trim();
    if (config.showBranding != true || label.isEmpty) {
      return const SizedBox.shrink();
    }

    final String? href = safeLinkUrl(config.brandingUrl);
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final TextStyle? style = Theme.of(context)
        .textTheme
        .labelSmall
        ?.copyWith(color: scheme.onSurfaceVariant);

    final Widget child = href == null
        ? Text(label, style: style)
        : TextButton(
            style: TextButton.styleFrom(
              foregroundColor: scheme.onSurfaceVariant,
              minimumSize: Size.zero,
              padding: EdgeInsets.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              textStyle: style,
            ),
            onPressed: () async {
              final Uri? uri = Uri.tryParse(href);
              if (uri == null) return;
              await launchUrl(uri, mode: LaunchMode.externalApplication);
            },
            child: Text(label),
          );

    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: Center(child: child),
    );
  }
}

class _ClassicGreeting extends StatelessWidget {
  const _ClassicGreeting({required this.config});

  final RemoteConfig config;

  @override
  Widget build(BuildContext context) {
    final String? greeting = _firstNonBlank(<String?>[
      config.header.greeting,
      config.greeting,
    ]);
    final String? subGreeting = _firstNonBlank(<String?>[
      config.header.subGreeting,
      config.subtitle,
    ]);

    if (greeting == null && subGreeting == null) return const SizedBox.shrink();

    final ColorScheme scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (greeting != null)
          Text(
            greeting,
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
        if (subGreeting != null)
          Padding(
            padding: EdgeInsets.only(top: greeting == null ? 0 : 6),
            child: Text(
              subGreeting,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ),
      ],
    );
  }
}

class _PresenceDot extends StatelessWidget {
  const _PresenceDot();

  @override
  Widget build(BuildContext context) {
    return const DecoratedBox(
      decoration:
          BoxDecoration(color: Color(0xFF22C55E), shape: BoxShape.circle),
      child: SizedBox(width: 8, height: 8),
    );
  }
}

String? _firstNonBlank(Iterable<String?> values) {
  for (final String? value in values) {
    final String trimmed = (value ?? '').trim();
    if (trimmed.isNotEmpty) return trimmed;
  }
  return null;
}

bool _hasClassicGreeting(RemoteConfig config) =>
    _firstNonBlank(<String?>[
      config.header.greeting,
      config.greeting,
      config.header.subGreeting,
      config.subtitle,
    ]) !=
    null;

bool _hasHeroHeader(RemoteConfig config, VoidCallback? onClose) {
  final HeaderAppearance header = config.header;
  final bool showLogo = (header.showLogo ?? false) &&
      ((header.logoUrl ?? config.logoUrl) ?? '').trim().isNotEmpty;
  final bool showAvatars = (header.showAvatars ?? false) &&
      (header.avatars ?? const <String>[]).isNotEmpty;
  return onClose != null ||
      showLogo ||
      showAvatars ||
      (header.greeting ?? '').isNotEmpty ||
      (header.subGreeting ?? '').isNotEmpty;
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
  const _SendMessageCta({
    required this.title,
    required this.subtitle,
    required this.radius,
    required this.onTap,
  });

  final String title;

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
                child: SvgPicture.asset(
                  AppAssets.messageBubblesIcon,
                  package: AppAssets.packageName,
                  width: 20,
                  height: 20,
                  colorFilter: ColorFilter.mode(Colors.white, BlendMode.srcIn),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(title, style: Theme.of(context).textTheme.titleSmall),
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
                                summary.handledBy?.displayName ??
                                    'Conversation',
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
                            relativeTimeLabel(
                                summary.lastMessageAt ?? summary.createdAt),
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
