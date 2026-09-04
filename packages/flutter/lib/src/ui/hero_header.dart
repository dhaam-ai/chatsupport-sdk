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
/// behaviour wrapped around it, and [heroCollapseDecision] is the rule that
/// behaviour obeys — a pure function over three numbers, so the oscillation
/// guard it exists for is assertable without a scroll gesture, a viewport or
/// a frame.
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

/// How far past the top the visitor must scroll before the hero goes — and
/// the slack the collapse must SURVIVE in order to happen at all.
///
/// One number, used twice, because the two are the same fact: the distance
/// that has to exist on either side of the collapse for it not to undo
/// itself. The reference's `COLLAPSE_SLACK_PX` says the same thing.
const double kHeroCollapseSlackPx = 32;

/// What the hero should do about the scroll position it has just been told
/// about.
///
/// Three outcomes rather than a boolean, and the third one is the point:
/// refusing to collapse is NOT the same as expanding. See
/// [heroCollapseDecision].
enum HeroCollapseDecision {
  /// The visitor is at (or near) the top. The hero is shown in full.
  expand,

  /// The visitor has scrolled away and there is room to give the height back.
  collapse,

  /// The visitor has scrolled away, but collapsing would un-scroll the very
  /// scroll that caused it. Whatever the hero is doing now, it keeps doing.
  hold,
}

/// Whether the hero may collapse, given where the scroll is and how much
/// height collapsing would hand back.
///
/// ── The oscillation this closes ──────────────────────────────────────────
///
/// Collapsing returns the hero's full height to the scroll container. If the
/// content's current overflow is not comfortably larger than that height, the
/// framework clamps the scroll offset back toward the top the instant the
/// space arrives — which puts the hero back in its expand zone, which expands
/// it, which re-consumes the space, which scrolls it away again. The two
/// states re-trigger each other every frame, and what a customer sees is a
/// header strobing on a Home screen that barely overflows.
///
/// Two guards close it, and BOTH are needed:
///
///  1. **The slack margin.** [expand] until the visitor has scrolled more than
///     [kHeroCollapseSlackPx] — not the instant the offset leaves zero. This
///     alone makes the collapse unreachable when the whole overflow is smaller
///     than the slack, so the loop is never even woken for the sub-slack
///     scrolls that are the commonest way into it.
///  2. **The layout check, read AT COLLAPSE TIME.** Collapse only when, after
///     the height is handed back, the container will STILL be scrolled at
///     least that same slack. This covers the wider band of heights that full
///     removal exposes, which the margin alone cannot.
///
/// [maxScrollExtent] is Flutter's name for exactly what the reference computes
/// as `scrollHeight - clientHeight`: the content extent minus the viewport,
/// i.e. how far the container can scroll. So `maxScrollExtent - heroHeight` is
/// the reference's `overflow - freed`, and the guard is the same inequality.
///
/// [heroHeight] must be measured when this is called, never cached at build:
/// a config publish or an image finishing its load changes the hero's height,
/// and a stale number re-opens the loop this closes.
///
/// Refusing to collapse on a too-short Home is the CORRECT behaviour, not a
/// degraded one — there is nowhere for the freed space to go.
HeroCollapseDecision heroCollapseDecision({
  required double scrollOffset,
  required double maxScrollExtent,
  required double heroHeight,
}) {
  if (scrollOffset <= kHeroCollapseSlackPx) return HeroCollapseDecision.expand;
  if (maxScrollExtent - heroHeight <= kHeroCollapseSlackPx) {
    // NOT `expand`. Expanding here would be a second writer of the same state
    // fighting whatever put the hero where it is; "there is no room to do
    // this" is a refusal to act, not an instruction to act the other way.
    return HeroCollapseDecision.hold;
  }
  return HeroCollapseDecision.collapse;
}

/// A [HeroHeader] pinned above a scroll view, which gets out of the way once
/// the visitor scrolls into the content below it.
///
/// ── Why this owns the arrangement rather than just the header ────────────
///
/// It takes the scroll view as its [child] and builds the whole band-plus-
/// content column itself. That is not convenience: the hero has to sit ABOVE
/// the scroll view for a collapse to mean anything (a hero that were merely
/// the scroll view's first child would already be gone by the time the
/// visitor had scrolled past it), and a widget above a scroll view can reach
/// neither `Scrollable.of` — which searches ancestors, and the scroll view is
/// a sibling — nor that view's notifications, which bubble up past it. Owning
/// both halves puts this widget where the notifications actually pass and
/// spares every caller a [ScrollController] to thread through.
///
/// ── Collapsed means GONE, not a short bar ────────────────────────────────
///
/// There is no compact layer and no shrunken variant. Scrolled away from the
/// top the hero occupies NO space at all; scrolled back, it returns whole.
/// The reference is explicit that this is the behaviour, and the reason is
/// that a panel this size has room for one branded band — the app bar — and a
/// second, shorter one underneath it is two headers.
///
/// Spelled as [Align] with a zero `heightFactor` inside a [ClipRect], which is
/// the framework's own way of saying the reference's `height: 0;
/// overflow: hidden`. [Align] still lays its child out at full height and
/// merely reports zero for ITSELF, so the hero can be measured while
/// collapsed — which is what lets [heroCollapseDecision] read a real
/// [heroHeight] at the moment it decides, rather than the zero a removed
/// subtree would report.
///
/// ── A notification, not an observer, and why that is not a downgrade ─────
///
/// The reference picks an `IntersectionObserver` over a `scroll` listener
/// specifically because the DOM's scroll event misses anything that moves the
/// offset without a gesture — a programmatic `scrollTo`, a `scrollIntoView`
/// from elsewhere in the tree. Flutter has no such gap: `jumpTo`,
/// `animateTo` and `ensureVisible` all drive [ScrollPosition], and every one
/// of them emits a [ScrollUpdateNotification]. So the concern that chose the
/// observer there does not exist here, and the framework's own mechanism is
/// the right one.
///
/// A hero given a [child] that does not scroll simply never collapses, which
/// is correct rather than degraded — the same answer the reference gives an
/// environment with no `IntersectionObserver` at all.
class CollapsingHeroHeader extends StatefulWidget {
  const CollapsingHeroHeader({
    super.key,
    required this.config,
    required this.child,
  });

  final RemoteConfig config;

  /// The scrolling content the hero sits above. Given the remaining height.
  final Widget child;

  @override
  State<CollapsingHeroHeader> createState() => _CollapsingHeroHeaderState();
}

class _CollapsingHeroHeaderState extends State<CollapsingHeroHeader> {
  /// Measures the hero at its natural height, collapsed or not — see the
  /// class doc on why [Align] is what makes that possible.
  final GlobalKey _heroKey = GlobalKey();

  bool _collapsed = false;

  bool _onScroll(ScrollNotification notification) {
    // Only the view this widget is wrapped around, never one nested inside
    // its content: a horizontally scrolling row of chips down in the page
    // says nothing about how far Home itself has been scrolled.
    if (notification.depth != 0) return false;

    final RenderBox? hero =
        _heroKey.currentContext?.findRenderObject() as RenderBox?;
    if (hero == null || !hero.hasSize) return false;

    switch (heroCollapseDecision(
      scrollOffset: notification.metrics.pixels,
      maxScrollExtent: notification.metrics.maxScrollExtent,
      // Read HERE, at the moment of the decision, never cached at build.
      heroHeight: hero.size.height,
    )) {
      case HeroCollapseDecision.expand:
        _apply(false);
      case HeroCollapseDecision.collapse:
        _apply(true);
      case HeroCollapseDecision.hold:
        // Deliberately nothing. See `hold`'s own doc.
        break;
    }
    // Never swallowed: this only observes, and a pull-to-refresh or a scroll
    // metric watcher further up has as much right to hear about the scroll as
    // this does.
    return false;
  }

  void _apply(bool collapsed) {
    if (_collapsed == collapsed || !mounted) return;
    setState(() => _collapsed = collapsed);
  }

  @override
  Widget build(BuildContext context) {
    return NotificationListener<ScrollNotification>(
      onNotification: _onScroll,
      child: Column(
        children: <Widget>[
          ClipRect(
            child: Align(
              alignment: Alignment.topCenter,
              heightFactor: _collapsed ? 0.0 : 1.0,
              child: HeroHeader(key: _heroKey, config: widget.config),
            ),
          ),
          Expanded(child: widget.child),
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
