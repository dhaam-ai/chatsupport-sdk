import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const Color _accent = Color(0xFF1F2937);

void main() {
  group('headerBackgroundColor', () {
    test('an explicit backgroundColor wins over accent', () {
      final color = headerBackgroundColor(
          const HeaderAppearance(backgroundColor: '#ff0000'), _accent);
      expect(color, const Color(0xFFFF0000));
    });

    test('falls back to accent when unset', () {
      expect(headerBackgroundColor(const HeaderAppearance(), _accent), _accent);
    });

    test('falls back to accent when the published colour cannot be parsed', () {
      final color = headerBackgroundColor(
          const HeaderAppearance(backgroundColor: 'not-a-color'), _accent);
      expect(color, _accent);
    });

    test(
        'colorSource has no host-page equivalent to defer to — both values resolve to accent',
        () {
      final platform = headerBackgroundColor(
        const HeaderAppearance(colorSource: HeaderColorSource.platform),
        _accent,
      );
      final accentSource = headerBackgroundColor(
        const HeaderAppearance(colorSource: HeaderColorSource.accent),
        _accent,
      );
      expect(platform, _accent);
      expect(accentSource, _accent);
    });
  });

  group('readableOn', () {
    test('white text on a dark background', () {
      expect(readableOn(const Color(0xFF1F2937)), const Color(0xFFFFFFFF));
    });

    test('dark text on a light background', () {
      expect(readableOn(const Color(0xFFFFFFFF)), const Color(0xFF1A1A1A));
    });
  });

  group('headerOverlay', () {
    test('solid paints nothing over the background', () {
      expect(
          headerOverlay(
              const HeaderAppearance(background: HeaderBackground.solid)),
          isNull);
    });

    test('an unset background also paints nothing', () {
      expect(headerOverlay(const HeaderAppearance()), isNull);
    });

    test('gradient returns a top-down black wash', () {
      final overlay = headerOverlay(
          const HeaderAppearance(background: HeaderBackground.gradient));
      expect(overlay, isA<HeaderGradientOverlay>());
      final gradient = (overlay! as HeaderGradientOverlay).gradient;
      expect(gradient.begin, Alignment.topCenter);
      expect(gradient.end, Alignment.bottomCenter);
      // gradientStrength unset defaults to 100 -> alpha 1.0 at the top stop.
      expect(gradient.colors.first.opacity, 1.0);
      expect(gradient.colors.last.opacity, 0.0);
    });

    test('gradientStrength scales the wash, clamped and NaN-proofed', () {
      final overlay = headerOverlay(
        const HeaderAppearance(
            background: HeaderBackground.gradient, gradientStrength: 50),
      ) as HeaderGradientOverlay;
      // Tolerance wider than the naive 0.5, because Color stores alpha as an
      // 8-bit channel: withOpacity(0.5) round-trips to 128/255 (~0.50196),
      // not exactly 0.5. 1/255 is the real precision floor here.
      expect(overlay.gradient.colors.first.opacity, closeTo(0.5, 1 / 255));
    });

    test('image with a safe URL returns the overlay with a default 45% scrim',
        () {
      final overlay = headerOverlay(
        const HeaderAppearance(
            background: HeaderBackground.image,
            backgroundImageUrl: 'https://x.test/bg.png'),
      );
      expect(overlay, isA<HeaderImageOverlay>());
      final image = overlay! as HeaderImageOverlay;
      expect(image.imageUrl, 'https://x.test/bg.png');
      expect(image.scrimAlpha, closeTo(0.45, 0.001));
    });

    test(
        'image with an unsafe or absent URL paints nothing — graceful miss, not a broken image',
        () {
      expect(
        headerOverlay(const HeaderAppearance(
            background: HeaderBackground.image,
            backgroundImageUrl: 'javascript:x')),
        isNull,
      );
      expect(
          headerOverlay(
              const HeaderAppearance(background: HeaderBackground.image)),
          isNull);
    });
  });
}
