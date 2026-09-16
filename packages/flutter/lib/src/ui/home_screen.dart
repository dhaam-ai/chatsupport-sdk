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

/// The accessible name of the close control, on both screens that carry one.
///
/// ── One name, because it is one control ─────────────────────────────────
///
/// Home and Messages are tabs, not two places: the customer sees the same
/// affordance in the same corner whichever one they are on, and a screen
/// reader that announced two different names would describe it as two
/// different controls. So `messages_screen.dart` imports exactly this one
/// name (`show kCloseChatLabel`) rather than restating the string — one
/// constant here, no widget shared, no layout borrowed.
///
/// It is the accessible NAME and not decoration: `IconButton` forwards
/// `tooltip` to the semantics node, which is how the ⋯ menu
/// ('Conversation options') and the session switcher already get theirs.
/// Left unset, an icon-only button has no name at all.
const String kCloseChatLabel = 'Close chat';

/// The close control `ChatWidget.onClose` backs.
///
/// Right-aligned above the screen's own content, so it lands where a panel's
/// dismiss control is looked for and never on top of something it would
/// obscure.
///
/// The callback is REQUIRED and non-null here: "there is nobody to tell" is
/// answered by not building this at all, at the one place that knows it —
/// the screen's own `build`. A widget that rendered a zero-sized box for a
/// null callback would still be a widget in a tree that is supposed to be
/// unchanged, and a DISABLED button would be worse: a control that looks
/// like a way out and is not.
class ChatCloseButton extends StatelessWidget {
  const ChatCloseButton({super.key, required this.onClose});

  /// Invoked once per press, with no navigation of this package's own — see
  /// `ChatWidget.onClose` on why the pop is the host's.
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(4, 4, 4, 0),
        child: IconButton(
          onPressed: onClose,
          tooltip: kCloseChatLabel,
          icon: const Icon(Icons.close),
        ),
      ),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, this.onClose});

  /// Forwarded from `ChatWidget.onClose`. Null draws no close control, and
  /// this screen is then the very tree it was before the parameter existed —
  /// see the `build` below, which does not even wrap the hero.
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChatWidgetCubit, ChatWidgetState>(
      builder: (BuildContext context, ChatWidgetState state) {
        final ChatWidgetCubit cubit = context.read<ChatWidgetCubit>();
        final RemoteConfig config = state.config;
        // The most recent conversation the customer STILL HAS — closed ones
        // are not among them (see
        // [ChatWidgetState.customerVisibleSessions]).
        //
        // That is a decision the user made directly, and it is why the
        // filter is applied BEFORE `mostRecentSummary` rather than after:
        // asked whether a customer whose newest conversation had just been
        // closed should see no Recent section at all or the newest one they
        // can still do something with, they chose the second. Filtering
        // afterwards — `mostRecentSummary` first, then dropping a closed
        // winner — would produce the first, with an older open conversation
        // sitting unmentioned behind a section that had vanished.
        //
        // Only CLOSED falls through this way. This screen has no
        // status-gating table (unlike `home-screen.ts`'s `SHOWN_IN_RECENT`):
        // every status it is handed renders its row and its pill, so a
        // RESOLVED or WAITING_FOR_AGENT newest still leads Home exactly as
        // it did.
        final ChatSessionSummary? recent =
            mostRecentSummary(state.customerVisibleSessions);
        final double radius = chatCornerRadius(config);

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
        final Widget hero = CollapsingHeroHeader(
          config: config,
          child: ListView(
            padding: EdgeInsets.zero,
            children: <Widget>[
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
          ),
        );

        // ── The close control, and the tree a host without one gets ──
        //
        // Returned UNWRAPPED when there is no callback: no Column, no
        // Expanded, nothing between the hero and this screen's caller. A
        // host that passes no `onClose` therefore gets the identical tree it
        // got before the parameter existed, which is the claim
        // `close_affordance_test.dart` makes and the reason this is a branch
        // rather than an `if` inside a Column that would always be built.
        //
        // Above the hero rather than over it. The hero is a merchant-coloured
        // band that renders nothing at all for a tenant who configured none
        // (see `HeroHeader`), so an icon floated on top of it would have no
        // guaranteed background to be legible against — and it COLLAPSES on
        // scroll, which would take the way out with it.
        final VoidCallback? close = onClose;
        if (close == null) return hero;
        return Column(
          children: <Widget>[
            ChatCloseButton(onClose: close),
            Expanded(child: hero),
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
  const _SendMessageCta(
      {required this.subtitle, required this.radius, required this.onTap});

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
                    Text('Send us a message',
                        style: Theme.of(context).textTheme.titleSmall),
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

class _StatusPill extends StatelessWidget {
  const _StatusPill(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(999)),
      child: Text(label,
          style: Theme.of(context)
              .textTheme
              .labelSmall
              ?.copyWith(color: scheme.onSurfaceVariant)),
    );
  }
}
