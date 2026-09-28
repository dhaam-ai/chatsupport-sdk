library;

import 'package:flutter/material.dart';

import '../config/appearance.dart';
import '../theme/chat_theme.dart' show parseHexColor;
import 'image_safety.dart';

const Key kThreadBackdropKey = ValueKey<String>('thread.backdrop');
const double _kDefaultPatternOpacity = 0.12;
const double _kDefaultImageOverlay = 0.35;
const double _kDarkGradientOverlay = 0.45;

/// Paints `appearance.thread` behind the conversation transcript.
class ThreadBackdrop extends StatelessWidget {
  const ThreadBackdrop({
    required this.thread,
    required this.child,
    super.key,
  });

  final ThreadAppearance thread;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final ThreadBackground? background = _backgroundFor(thread);
    if (background == null) return child;

    return Stack(
      key: kThreadBackdropKey,
      fit: StackFit.expand,
      children: <Widget>[
        _ThreadBackdropPaint(thread: thread, background: background),
        child,
      ],
    );
  }
}

ThreadBackground? _backgroundFor(ThreadAppearance thread) {
  if (thread.background != null) return thread.background;
  if (thread.imageUrl != null) return ThreadBackground.image;
  if (thread.pattern != null || thread.patternOpacity != null) {
    return ThreadBackground.pattern;
  }
  if (thread.color != null) return ThreadBackground.solid;
  return null;
}

class _ThreadBackdropPaint extends StatelessWidget {
  const _ThreadBackdropPaint({
    required this.thread,
    required this.background,
  });

  final ThreadAppearance thread;
  final ThreadBackground background;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final Brightness brightness = Theme.of(context).brightness;
    final Color base = parseHexColor(thread.color) ?? scheme.surface;

    return switch (background) {
      ThreadBackground.solid => ColoredBox(color: base),
      ThreadBackground.pattern => _PatternBackdrop(
          base: base,
          pattern: thread.pattern ?? ThreadPattern.dots,
          opacity: _percent(thread.patternOpacity, _kDefaultPatternOpacity),
        ),
      ThreadBackground.image => _ImageBackdrop(
          base: base,
          url: safeImageUrl(thread.imageUrl),
          fade: thread.imageFade,
          overlay: _percent(thread.imageOverlay, _kDefaultImageOverlay),
        ),
      ThreadBackground.mesh || ThreadBackground.gradient => _MeshBackdrop(
          base: base,
          accent: scheme.primary,
          darkOverlay: /*background == ThreadBackground.gradient &&*/
              brightness == Brightness.dark,
        ),
    };
  }
}

class _ImageBackdrop extends StatelessWidget {
  const _ImageBackdrop({
    required this.base,
    required this.url,
    required this.fade,
    required this.overlay,
  });

  final Color base;
  final String? url;
  final ImageFade? fade;
  final double overlay;

  @override
  Widget build(BuildContext context) {
    final Color overlayColor =
        (fade == ImageFade.light ? Colors.white : Colors.black)
            .withValues(alpha: overlay);

    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        ColoredBox(color: base),
        if (url != null)
          Image.network(
            url!,
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => const SizedBox.shrink(),
          ),
        ColoredBox(color: overlayColor),
      ],
    );
  }
}

class _MeshBackdrop extends StatelessWidget {
  const _MeshBackdrop({
    required this.base,
    required this.accent,
    required this.darkOverlay,
  });

  final Color base;
  final Color accent;
  final bool darkOverlay;

  @override
  Widget build(BuildContext context) {
    final Color blended = Color.lerp(base, accent, 0.18) ?? base;

    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        ColoredBox(color: base),
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: <Color>[
                accent.withValues(alpha: 0.18),
                blended.withValues(alpha: 0.12),
                base.withValues(alpha: 0),
              ],
              stops: const <double>[0, 0.42, 1],
            ),
          ),
        ),
        Align(
          alignment: Alignment.bottomRight,
          child: FractionallySizedBox(
            widthFactor: 0.9,
            heightFactor: 0.58,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment.bottomRight,
                  radius: 1,
                  colors: <Color>[
                    accent.withValues(alpha: 0.16),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          ),
        ),
        if (darkOverlay)
          ColoredBox(
            color: Colors.black.withValues(alpha: _kDarkGradientOverlay),
          ),
      ],
    );
  }
}

class _PatternBackdrop extends StatelessWidget {
  const _PatternBackdrop({
    required this.base,
    required this.pattern,
    required this.opacity,
  });

  final Color base;
  final ThreadPattern pattern;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    final Color stroke = Theme.of(context)
        .colorScheme
        .onSurface
        .withValues(alpha: opacity.clamp(0, 1));

    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        ColoredBox(color: base),
        CustomPaint(
          painter: _ThreadPatternPainter(pattern: pattern, color: stroke),
        ),
      ],
    );
  }
}

class _ThreadPatternPainter extends CustomPainter {
  const _ThreadPatternPainter({required this.pattern, required this.color});

  final ThreadPattern pattern;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = color
      ..strokeWidth = 1;
    const double step = 24;

    switch (pattern) {
      case ThreadPattern.dots:
        for (double x = step / 2; x < size.width; x += step) {
          for (double y = step / 2; y < size.height; y += step) {
            canvas.drawCircle(Offset(x, y), 1.4, paint);
          }
        }
      case ThreadPattern.grid:
        for (double x = 0; x < size.width; x += step) {
          canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
        }
        for (double y = 0; y < size.height; y += step) {
          canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
        }
      case ThreadPattern.diagonal:
        for (double x = -size.height; x < size.width; x += step) {
          canvas.drawLine(
            Offset(x, size.height),
            Offset(x + size.height, 0),
            paint,
          );
        }
      case ThreadPattern.crosshatch:
        for (double x = -size.height; x < size.width; x += step) {
          canvas
            ..drawLine(
              Offset(x, size.height),
              Offset(x + size.height, 0),
              paint,
            )
            ..drawLine(
              Offset(x, 0),
              Offset(x + size.height, size.height),
              paint,
            );
        }
    }
  }

  @override
  bool shouldRepaint(_ThreadPatternPainter oldDelegate) =>
      oldDelegate.pattern != pattern || oldDelegate.color != color;
}

double _percent(double? value, double fallback) {
  if (value == null) return fallback;
  final double normalized = value > 1 ? value / 100 : value;
  return normalized.clamp(0, 1);
}
