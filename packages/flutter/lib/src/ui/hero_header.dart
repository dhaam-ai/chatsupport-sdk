/// The Home screen's tall branded header — background, avatar stack,
/// greeting and sub-greeting. Mirrors `ui/hero-header.ts`'s CONTENT only;
/// see this file's "What this does not render" section for what is
/// deliberately left to the Home screen instead.
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
  const HeroHeader({super.key, required this.config});

  final RemoteConfig config;

  @override
  Widget build(BuildContext context) {
    final HeaderAppearance header = config.header;
    final String? logoUrl = safeImageUrl(header.logoUrl ?? config.logoUrl);
    final bool showLogo = (header.showLogo ?? false) && logoUrl != null;

    final List<String> avatars = (header.showAvatars ?? false)
        ? (header.avatars ?? const <String>[])
            .map(safeImageUrl)
            .whereType<String>()
            .take(kMaxHeroAvatars)
            .toList(growable: false)
        : const <String>[];

    final String greeting = header.greeting ?? '';
    final String subGreeting = header.subGreeting ?? '';

    final bool isEmpty = !showLogo && avatars.isEmpty && greeting.isEmpty && subGreeting.isEmpty;
    if (isEmpty) return const SizedBox.shrink();

    final Color accent = Theme.of(context).colorScheme.primary;
    final Color backgroundColor = headerBackgroundColor(header, accent);
    final Color foregroundColor = readableOn(backgroundColor);
    final HeaderOverlay? overlay = headerOverlay(header);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 28, 20, 24),
      decoration: BoxDecoration(color: backgroundColor),
      child: Stack(
        children: <Widget>[
          if (overlay is HeaderImageOverlay) _HeroBackgroundImage(overlay: overlay),
          if (overlay is HeaderGradientOverlay) DecoratedBox(decoration: BoxDecoration(gradient: overlay.gradient)),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (showLogo)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.network(
                      logoUrl,
                      height: 32,
                      errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                    ),
                  ),
                ),
              if (avatars.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _AvatarStack(avatars: avatars, showPresence: header.showPresence ?? false),
                ),
              if (greeting.isNotEmpty)
                Text(
                  greeting,
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(color: foregroundColor, fontWeight: FontWeight.w600),
                ),
              if (subGreeting.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    subGreeting,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: foregroundColor.withOpacity(0.85)),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
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
          DecoratedBox(decoration: BoxDecoration(color: Colors.black.withOpacity(overlay.scrimAlpha))),
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
