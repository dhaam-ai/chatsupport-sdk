/// Resolving [HeaderAppearance] into paintable Flutter values — the hero
/// header's background colour, a readable foreground, and its gradient or
/// image overlay.
///
/// Ports `ui/styles.ts`'s `headerBaseColor` / `headerForeground` /
/// `headerLayers` with every coefficient kept VERBATIM — that file's own
/// header on why: "lifted verbatim from chatsupport_react's `WidgetHeader`
/// [...] the only definition of what [a slider value] LOOKS like is the one
/// that preview used." A plausible-looking second curve here would render a
/// merchant's slider differently from the console they set it against.
///
/// ── Why this is a separate file from `chat_theme.dart` ─────────────────
///
/// `chat_theme.dart` builds the ONE [ThemeData] every screen shares. This is
/// screen-specific — only the hero header on Home reads it — so it stays out
/// of that shared function rather than growing it speculatively ahead of a
/// second consumer (this package's own "touch only what the task requires"
/// discipline).
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../config/remote_config.dart';
import '../ui/image_safety.dart';
import 'chat_theme.dart' show parseHexColor;

/// A 0–100 console slider as a 0.0–1.0 alpha, clamped and NaN-proofed —
/// mirrors `styles.ts`'s `percent`.
double _percent(double? value, double fallback) {
  final double raw = (value != null && value.isFinite) ? value : fallback;
  return raw.clamp(0, 100) / 100;
}

/// WCAG 2.x relative luminance, 0.0–1.0.
///
/// Unlike `styles.ts`'s `luminance`, this takes an already-resolved [Color]
/// rather than a raw CSS string, so there is no "cannot measure this" case
/// to fall back from: every colour reaching this function has already gone
/// through [parseHexColor] (or its default) once, upstream.
double _relativeLuminance(Color color) {
  double channel(double srgb) =>
      srgb <= 0.03928 ? srgb / 12.92 : math.pow((srgb + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * channel(color.red / 255) +
      0.7152 * channel(color.green / 255) +
      0.0722 * channel(color.blue / 255);
}

/// A foreground that stays readable on [color] — mirrors `styles.ts`'s
/// `readableOn`: white unless the background is light enough to wash it out.
Color readableOn(Color color) =>
    _relativeLuminance(color) > 0.55 ? const Color(0xFF1A1A1A) : const Color(0xFFFFFFFF);

/// The hero header's background colour, before any gradient/image overlay.
///
/// `header.colorSource` (`accent` vs `platform`) is a runtime-detected fact
/// in the JS widget (`ui/platform-color.ts` reads the HOST PAGE's own CSS
/// custom properties) — there is no equivalent "the surrounding page's
/// colour" for a Flutter host to defer to, so both values resolve the same
/// way here: to [accent]. An explicit `backgroundColor` always wins over
/// either, matching `headerBaseColor`'s own precedence.
Color headerBackgroundColor(HeaderAppearance header, Color accent) {
  final String? explicit = header.backgroundColor;
  if (explicit == null) return accent;
  return parseHexColor(explicit) ?? accent;
}

/// What to paint OVER [headerBackgroundColor] — `null` for `solid`, or for
/// an `image` background whose URL the allowlist refused. Same graceful miss
/// `styles.ts`'s `headerLayers` gives that case: the base colour alone,
/// never a broken-image flash.
sealed class HeaderOverlay {
  const HeaderOverlay();
}

/// `background: 'gradient'` — a top-down black wash, strongest at the top.
final class HeaderGradientOverlay extends HeaderOverlay {
  const HeaderGradientOverlay(this.gradient);
  final LinearGradient gradient;
}

/// `background: 'image'` — a merchant's photo under a uniform dark scrim so
/// the header's own text stays legible over it.
final class HeaderImageOverlay extends HeaderOverlay {
  const HeaderImageOverlay({required this.imageUrl, required this.scrimAlpha});
  final String imageUrl;
  final double scrimAlpha;
}

HeaderOverlay? headerOverlay(HeaderAppearance header) {
  if (header.background == HeaderBackground.gradient) {
    final double a = _percent(header.gradientStrength, 100);
    return HeaderGradientOverlay(
      LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        // 0%, 50%, 100% stops at a, 0.3a, 0 — headerLayers's own curve,
        // ported coefficient for coefficient.
        colors: <Color>[
          Colors.black.withOpacity(a),
          Colors.black.withOpacity(a * 0.3),
          Colors.black.withOpacity(0),
        ],
        stops: const <double>[0, 0.5, 1],
      ),
    );
  }

  if (header.background == HeaderBackground.image) {
    final String? url = safeImageUrl(header.backgroundImageUrl);
    if (url == null) return null;
    return HeaderImageOverlay(imageUrl: url, scrimAlpha: _percent(header.imageOverlay, 45));
  }

  return null;
}
