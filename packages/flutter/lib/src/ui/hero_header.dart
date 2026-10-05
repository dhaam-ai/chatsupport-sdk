// ignore_for_file: deprecated_member_use

/// The Home screen's tall branded header — background, avatar stack,
/// greeting and sub-greeting — and the rule by which it gets out of the way
/// once the visitor scrolls into the content below it.
///
/// Mirrors `ui/hero-header.ts`; see this file's "What this does not render"
/// section for what is deliberately left to the Home screen instead.
///
/// Two things live here, split the way the reference splits them: [HeroHeader]
/// is what the merchant configured, drawn, and is a plain [StatelessWidget]
/// that any test can pump on its own. [CollapsingHeroHeader] is the scroll
/// behaviour wrapped around it.
library;

import 'package:flutter/material.dart';

import '../config/remote_config.dart';
import '../theme/header_style.dart';
import 'image_safety.dart';

/// How many faces the row shows — `hero-header.ts`'s own `MAX_AVATARS`,
/// enforced again here rather than trusted: `header.avatars` is a plain
/// array on an opaque blob (remote_config.dart's header), and a fourth
/// avatar would overflow the row rather than being dropped the way an
/// older console version's own validation would have.
const int kMaxHeroAvatars = 3;

const double kCollapsedHeroBarHeight = 84;
const double kExpandedHeroHeaderHeight = 260;
const double kHeroHeaderForegroundOverlap = 32;
const double kHeroHeaderForegroundClearance = 25;

/// The Home screen's hero. Renders nothing at all — not an empty coloured
/// slab — when the merchant turned off every piece of it, matching
/// `hero-header.ts`'s own `data-empty` rule: "an empty hero is not a short
/// hero... a bare coloured slab above the transcript would read as a
/// rendering failure rather than as their choice."
///
/// ── What this does NOT render ───────────────────────────────────────────
///
/// `header.ctaEnabled` / `.ctaTitle`. In the JS widget, the hero carries its
/// own call-to-action because that widget has no separate Home screen to put
/// one on — "there is no conversation to start, so it focuses the composer"
/// (`hero-header.ts`'s own header). This package has a real Home screen with
/// its own "Send us a message" card (`home_screen.dart`, mirroring
/// `home-screen.ts`'s own separately-built `cta`), so the workaround this
/// hero would otherwise need does not apply — `ctaSubtitle` is read there
/// instead, unconditionally, matching `home-screen.ts`'s own unconditional
/// CTA card rather than this hero's gated one.
///
/// `aria-hidden` on the whole block. The JS hero is marked fully hidden from
/// assistive tech because every string in it is redundant with what the
/// composer right below it already conveys (its placeholder repeats the
/// greeting; its CTA's only action focuses that same composer, the next tab
/// stop regardless). Home has no composer sitting under this hero — the
/// greeting is the ONLY place that copy appears — so the redundancy the JS
/// choice relies on does not hold here, and hiding it would remove real
/// content from a screen-reader user instead of skipping a repeat.
class HeroHeader extends StatelessWidget {
  const HeroHeader({
    super.key,
    required this.config,
    this.onClose,
    this.bottomClearance = 0,
  });

  final RemoteConfig config;
  final VoidCallback? onClose;
  final double bottomClearance;

  @override
  Widget build(BuildContext context) {
    final HeaderAppearance header = config.header;
    final String? logoUrl = safeImageUrl(header.logoUrl ?? config.logoUrl);
    final bool showLogo = (header.showLogo ?? false) && logoUrl != null;

    final List<String> avatars = _safeHeroAvatars(header);

    final String greeting = header.greeting ?? '';
    final String subGreeting = header.subGreeting ?? '';

    final bool isEmpty = onClose == null &&
        !showLogo &&
        avatars.isEmpty &&
        greeting.isEmpty &&
        subGreeting.isEmpty;
    if (isEmpty) return const SizedBox.shrink();

    final Color accent = Theme.of(context).colorScheme.primary;
    final Color backgroundColor = headerBackgroundColor(header, accent);
    final Color foregroundColor = readableOn(backgroundColor);
    final HeaderOverlay? overlay = headerOverlay(header);

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(color: backgroundColor),
      child: Stack(
        children: <Widget>[
          if (overlay is HeaderImageOverlay)
            _HeroBackgroundImage(overlay: overlay),
          if (overlay is HeaderGradientOverlay)
            Positioned.fill(
              child: DecoratedBox(
                  decoration: BoxDecoration(gradient: overlay.gradient)),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 28, 20, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.max,
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.only(bottom: 12, top: 20),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      if (showLogo)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.network(
                            logoUrl,
                            height: 32,
                            errorBuilder: (_, __, ___) =>
                                const SizedBox.shrink(),
                          ),
                        )
                      else
                        SizedBox.shrink(),
                      if (onClose != null)
                        Align(
                          alignment: Alignment.centerRight,
                          child: IconButton(
                            tooltip: 'Close chat',
                            onPressed: onClose,
                            color: foregroundColor,
                            icon: const Icon(Icons.close),
                          ),
                        ),
                    ],
                  ),
                ),
                if (avatars.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _AvatarStack(
                        avatars: avatars,
                        showPresence: header.showPresence ?? false),
                  ),
                if (greeting.isNotEmpty || subGreeting.isNotEmpty)
                  Flexible(
                    child: _HeroHeaderCopy(
                      greeting: greeting,
                      subGreeting: subGreeting,
                      foregroundColor: foregroundColor,
                    ),
                  ),
                if (bottomClearance > 0) SizedBox(height: bottomClearance),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroHeaderCopy extends StatelessWidget {
  const _HeroHeaderCopy({
    required this.greeting,
    required this.subGreeting,
    required this.foregroundColor,
  });

  final String greeting;
  final String subGreeting;
  final Color foregroundColor;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (greeting.isNotEmpty)
          Flexible(
            child: SizedBox(
              width: double.infinity,
              child: Text(
                greeting,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                softWrap: true,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    color: foregroundColor, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        if (subGreeting.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              subGreeting,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: foregroundColor.withOpacity(0.85)),
            ),
          ),
      ],
    );
  }
}

/// A [HeroHeader] as a pinned sliver above the Home screen content.
///
/// ── Collapsed means compact, not gone ────────────────────────────────────
///
/// Scrolled away from the top the large greeting band collapses out of the
/// layout, leaving only the compact app-bar layer: logo, configured avatar
/// stack and the close affordance. Scrolled back, the full hero returns.
///
/// Implemented as [SliverPersistentHeader], so the current scroll offset
/// continuously drives the header extent the same way a native sliver app bar
/// does. There is no threshold state to snap between.
class CollapsingHeroHeader extends StatelessWidget {
  const CollapsingHeroHeader({
    super.key,
    required this.config,
    required this.slivers,
    this.onClose,
    this.controller,
    this.foreground,
  });

  final RemoteConfig config;
  final VoidCallback? onClose;
  final ScrollController? controller;
  final Widget? foreground;

  final List<Widget> slivers;

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
      controller: controller,
      slivers: <Widget>[
        if (hasHeroContent(config, onClose))
          SliverPersistentHeader(
            pinned: true,
            delegate: _HeroSliverHeaderDelegate(
              config: config,
              onClose: onClose,
              foreground: foreground,
            ),
          ),
        ...slivers,
      ],
    );
  }
}

class _HeroSliverHeaderDelegate extends SliverPersistentHeaderDelegate {
  const _HeroSliverHeaderDelegate({
    required this.config,
    this.onClose,
    this.foreground,
  });

  final RemoteConfig config;
  final VoidCallback? onClose;
  final Widget? foreground;

  @override
  double get minExtent => _collapsedHeroHeight(config, onClose);

  @override
  double get maxExtent =>
      _expandedHeroHeight(config, onClose) +
      (foreground == null ? 0 : kHeroHeaderForegroundClearance);

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    final double range = (maxExtent - minExtent).clamp(1, double.infinity);
    final double progress = (shrinkOffset / range).clamp(0.0, 1.0);

    return SizedBox.expand(
      key: const ValueKey<String>('hero.sliverHeader'),
      child: Stack(
        clipBehavior: Clip.none,
        fit: StackFit.expand,
        children: <Widget>[
          if (progress < 1)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: maxExtent,
              child: IgnorePointer(
                ignoring: progress >= 0.5,
                child: Opacity(
                  opacity: 1 - progress,
                  child: HeroHeader(
                    config: config,
                    onClose: onClose,
                    bottomClearance:
                        foreground == null ? 0 : kHeroHeaderForegroundClearance,
                  ),
                ),
              ),
            ),
          if (minExtent > 0 && progress > 0)
            IgnorePointer(
              ignoring: progress < 0.5,
              child: Opacity(
                opacity: progress,
                child: _CollapsedHeroBar(
                  key: const ValueKey<String>('hero.collapsedBar'),
                  config: config,
                  onClose: onClose,
                ),
              ),
            ),
          if (foreground != null)
            Positioned(
              left: 20,
              right: 20,
              bottom: -kHeroHeaderForegroundOverlap,
              child: Opacity(
                opacity: 1 - progress,
                child: foreground!,
              ),
            ),
        ],
      ),
    );
  }

  @override
  bool shouldRebuild(_HeroSliverHeaderDelegate oldDelegate) =>
      oldDelegate.config != config ||
      oldDelegate.onClose != onClose ||
      oldDelegate.foreground != foreground;
}

class _CollapsedHeroBar extends StatelessWidget {
  const _CollapsedHeroBar({super.key, required this.config, this.onClose});

  final RemoteConfig config;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final HeaderAppearance header = config.header;
    final String? logoUrl = safeImageUrl(header.logoUrl ?? config.logoUrl);
    final bool showLogo = (header.showLogo ?? false) && logoUrl != null;
    final List<String> avatars = _safeHeroAvatars(header);

    if (!showLogo && avatars.isEmpty && onClose == null) {
      return const SizedBox.shrink();
    }

    final Color accent = Theme.of(context).colorScheme.primary;
    final Color backgroundColor = headerBackgroundColor(header, accent);
    final Color foregroundColor = readableOn(backgroundColor);

    return Container(
      height: kCollapsedHeroBarHeight,
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 28, 20, 8),
      decoration: BoxDecoration(color: backgroundColor),
      child: Row(
        children: <Widget>[
          if (showLogo) ...<Widget>[
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.network(
                logoUrl,
                height: 32,
                errorBuilder: (_, __, ___) => const SizedBox.shrink(),
              ),
            ),
            const SizedBox(width: 12),
          ],
          if (avatars.isNotEmpty)
            _AvatarStack(
              avatars: avatars,
              showPresence: header.showPresence ?? false,
            ),
          const Spacer(),
          if (onClose != null)
            IconButton(
              tooltip: 'Close chat',
              onPressed: onClose,
              color: foregroundColor,
              icon: const Icon(Icons.close),
            ),
        ],
      ),
    );
  }
}

double _collapsedHeroHeight(RemoteConfig config, VoidCallback? onClose) {
  final HeaderAppearance header = config.header;
  final String? logoUrl = safeImageUrl(header.logoUrl ?? config.logoUrl);
  final bool showLogo = (header.showLogo ?? false) && logoUrl != null;
  final bool showAvatars = _safeHeroAvatars(header).isNotEmpty;
  return showLogo || showAvatars || onClose != null
      ? kCollapsedHeroBarHeight
      : 0;
}

double _expandedHeroHeight(RemoteConfig config, VoidCallback? onClose) =>
    hasHeroContent(config, onClose) ? kExpandedHeroHeaderHeight : 0;

bool hasHeroContent(RemoteConfig config, VoidCallback? onClose) {
  final HeaderAppearance header = config.header;
  final String? logoUrl = safeImageUrl(header.logoUrl ?? config.logoUrl);
  final bool showLogo = (header.showLogo ?? false) && logoUrl != null;
  return onClose != null ||
      showLogo ||
      _safeHeroAvatars(header).isNotEmpty ||
      (header.greeting ?? '').isNotEmpty ||
      (header.subGreeting ?? '').isNotEmpty;
}

List<String> _safeHeroAvatars(HeaderAppearance header) {
  if (!(header.showAvatars ?? false)) return const <String>[];
  return (header.avatars ?? const <String>[])
      .map(safeImageUrl)
      .whereType<String>()
      .take(kMaxHeroAvatars)
      .toList(growable: false);
}

class _HeroBackgroundImage extends StatelessWidget {
  const _HeroBackgroundImage({required this.overlay});

  final HeaderImageOverlay overlay;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          Image.network(
            overlay.imageUrl,
            fit: BoxFit.cover,
            // Same graceful miss headerLayers gives a URL that fails to
            // decode — the base colour alone, never Flutter's red error box.
            errorBuilder: (_, __, ___) => const SizedBox.shrink(),
          ),
          DecoratedBox(
              decoration: BoxDecoration(
                  color: Colors.black.withOpacity(overlay.scrimAlpha))),
        ],
      ),
    );
  }
}

class _AvatarStack extends StatelessWidget {
  const _AvatarStack({required this.avatars, required this.showPresence});

  final List<String> avatars;
  final bool showPresence;

  static const double _diameter = 36;
  static const double _overlap = 12;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: _diameter,
      width: _diameter + (avatars.length - 1) * (_diameter - _overlap),
      child: Stack(
        children: <Widget>[
          for (int i = 0; i < avatars.length; i++)
            Positioned(
              left: i * (_diameter - _overlap),
              child: Stack(
                children: <Widget>[
                  Container(
                    width: _diameter,
                    height: _diameter,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                      image: DecorationImage(
                        image: NetworkImage(avatars[i]),
                        fit: BoxFit.cover,
                        // A face that fails to load degrades to an empty
                        // circle rather than an unhandled image-stream
                        // exception — the same graceful miss every other
                        // merchant-supplied image in this widget gets.
                        onError: (_, __) {},
                      ),
                    ),
                  ),
                  // The presence dot rides the LAST face only — it says
                  // "someone is here", not "this particular person is", so
                  // one is the honest count regardless of how many faces are
                  // shown. Mirrors hero-header.ts's own placement exactly.
                  if (showPresence && i == avatars.length - 1)
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.green,
                          border: Border.all(color: Colors.white, width: 2),
                        ),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
