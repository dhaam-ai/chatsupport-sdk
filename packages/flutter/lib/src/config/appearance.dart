/// The console's Appearance vocabulary — mirrors `remote-config.ts`'s own
/// "Appearance vocabulary" section field for field.
///
/// Every enum here implements `dhaam_chat`'s [WireEnum] (re-exported through
/// its barrel) rather than reinventing the pattern: a wire-string enum with a
/// null-returning [WireEnum]-style parse is exactly what `oneOf<T>()` gives
/// the TypeScript side, just realised as Dart's own idiom for it instead of
/// a generic helper function — `dhaam_chat` already needed this shape for
/// [ChatStatus] and friends, and an unrecognised value degrading to
/// "the merchant said nothing" (not a default, not a thrown error) is the
/// same defensive contract this file needs for every appearance leaf.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show WireEnum;
import 'package:equatable/equatable.dart';

/// Follows the OS (`auto`) or pins one scheme.
enum WidgetTheme implements WireEnum {
  light('light'),
  dark('dark'),
  auto('auto');

  const WidgetTheme(this.wire);

  @override
  final String wire;

  static WidgetTheme? fromWire(String value) => lookupWire(values, value);
}

/// Which bottom corner the launcher — and the panel above it — sits in.
enum WidgetPosition implements WireEnum {
  bottomRight('bottom-right'),
  bottomLeft('bottom-left');

  const WidgetPosition(this.wire);

  @override
  final String wire;

  static WidgetPosition? fromWire(String value) => lookupWire(values, value);
}

/// The launcher's shape.
enum LauncherStyle implements WireEnum {
  bubble('bubble'),
  bubbleLabel('bubble-label'),
  tab('tab');

  const LauncherStyle(this.wire);

  @override
  final String wire;

  static LauncherStyle? fromWire(String value) => lookupWire(values, value);
}

/// Which home layout the merchant chose. `classic` is the compact header;
/// `hero` is the tall branded one this package's Home screen renders.
enum WidgetDesign implements WireEnum {
  classic('classic'),
  hero('hero');

  const WidgetDesign(this.wire);

  @override
  final String wire;

  static WidgetDesign? fromWire(String value) => lookupWire(values, value);
}

/// What the classic header's avatar draws.
enum AvatarMode implements WireEnum {
  initials('initials'),
  logo('logo');

  const AvatarMode(this.wire);

  @override
  final String wire;

  static AvatarMode? fromWire(String value) => lookupWire(values, value);
}

/// Where the launcher's glyph comes from.
enum LauncherIconSource implements WireEnum {
  library('library'),
  emoji('emoji'),
  image('image');

  const LauncherIconSource(this.wire);

  @override
  final String wire;

  static LauncherIconSource? fromWire(String value) =>
      lookupWire(values, value);
}

/// How the hero header's background is painted.
enum HeaderBackground implements WireEnum {
  solid('solid'),
  gradient('gradient'),
  image('image');

  const HeaderBackground(this.wire);

  @override
  final String wire;

  static HeaderBackground? fromWire(String value) => lookupWire(values, value);
}

/// Where the header's colour comes from when no explicit one is set.
enum HeaderColorSource implements WireEnum {
  accent('accent'),
  platform('platform');

  const HeaderColorSource(this.wire);

  @override
  final String wire;

  static HeaderColorSource? fromWire(String value) => lookupWire(values, value);
}

/// How the conversation's backdrop is painted.
enum ThreadBackground implements WireEnum {
  mesh('mesh'),
  solid('solid'),
  image('image'),
  pattern('pattern');

  const ThreadBackground(this.wire);

  @override
  final String wire;

  static ThreadBackground? fromWire(String value) => lookupWire(values, value);
}

/// The built-in thread textures.
enum ThreadPattern implements WireEnum {
  dots('dots'),
  grid('grid'),
  diagonal('diagonal'),
  crosshatch('crosshatch');

  const ThreadPattern(this.wire);

  @override
  final String wire;

  static ThreadPattern? fromWire(String value) => lookupWire(values, value);
}

/// Which way a scrim washes background artwork.
enum ImageFade implements WireEnum {
  light('light'),
  dark('dark');

  const ImageFade(this.wire);

  @override
  final String wire;

  static ImageFade? fromWire(String value) => lookupWire(values, value);
}

/// Linear scan over a handful of constants — see `dhaam_chat`'s
/// `protocol/enums.dart` for why this does not become a prebuilt map at this
/// size.
///
/// Public (not `_lookup`) because Dart privacy is per-FILE, not per-package
/// like the wire enums in `remote_config.dart` (e.g. [AutoOpen]) still need
/// it and live in a different library — same reason `dhaam_chat` exports
/// [WireEnum] itself rather than keeping the whole pattern private to one
/// file.
T? lookupWire<T extends WireEnum>(List<T> values, String wire) {
  for (final T value in values) {
    if (value.wire == wire) return value;
  }
  return null;
}

// ── Partial appearance objects ─────────────────────────────────────────────
//
// `remote-config.ts` gives these `Partial<LauncherIcon>` etc. because its
// base types (in `config.ts`) are the FULLY RESOLVED shape used elsewhere —
// every field always present. This package never builds that resolved shape
// (see this package's README on why the host-precedence merge does not carry
// over to a Flutter host); the published, possibly-partial reading is the
// only one that exists here, so nullable fields on one class are the whole
// representation rather than a second `Partial<T>` wrapper around a
// non-nullable one.

/// `appearance.launcherIcon` — the glyph on the launcher.
///
/// Extends [Equatable] (from `package:equatable`, already a dependency for
/// Cubit state comparison — see `state/chat_widget_state.dart`) rather than
/// hand-written `==`/`hashCode`: shorter, and `Equatable`'s own comparison
/// already recurses correctly into the `List<String>?` further down this
/// file ([HeaderAppearance.avatars]) — verified against its source
/// (`equatable_utils.dart`'s `objectsEquals`), not assumed.
class LauncherIcon extends Equatable {
  const LauncherIcon({this.source, this.library, this.emoji, this.imageUrl});

  final LauncherIconSource? source;
  final String? library;
  final String? emoji;
  final String? imageUrl;

  /// True when the publish named none of these — see this file's header on
  /// why "named nothing" has to stay distinguishable from "named a value
  /// equal to the default".
  bool get isEmpty =>
      source == null && library == null && emoji == null && imageUrl == null;

  @override
  List<Object?> get props => <Object?>[source, library, emoji, imageUrl];
}

/// `appearance.launcherShadow` — one enable flag and one 0–100 intensity.
class LauncherShadow extends Equatable {
  const LauncherShadow({this.enabled, this.intensity});

  final bool? enabled;
  final double? intensity;

  bool get isEmpty => enabled == null && intensity == null;

  @override
  List<Object?> get props => <Object?>[enabled, intensity];
}

/// `appearance.header` — how the hero header is painted.
class HeaderAppearance extends Equatable {
  const HeaderAppearance({
    this.background,
    this.backgroundColor,
    this.colorSource,
    this.gradientStrength,
    this.backgroundImageUrl,
    this.imageOverlay,
    this.showLogo,
    this.logoUrl,
    this.showAvatars,
    this.avatars,
    this.showPresence,
    this.greeting,
    this.subGreeting,
    this.ctaEnabled,
    this.ctaTitle,
    this.ctaSubtitle,
  });

  final HeaderBackground? background;
  final String? backgroundColor;
  final HeaderColorSource? colorSource;
  final double? gradientStrength;
  final String? backgroundImageUrl;
  final double? imageOverlay;
  final bool? showLogo;
  final String? logoUrl;
  final bool? showAvatars;

  /// Up to three, rendered overlapping in order — the Home screen's avatar
  /// stack. Beyond that they are dropped, same as the console's own hero.
  final List<String>? avatars;
  final bool? showPresence;
  final String? greeting;
  final String? subGreeting;
  final bool? ctaEnabled;
  final String? ctaTitle;
  final String? ctaSubtitle;

  bool get isEmpty =>
      background == null &&
      backgroundColor == null &&
      colorSource == null &&
      gradientStrength == null &&
      backgroundImageUrl == null &&
      imageOverlay == null &&
      showLogo == null &&
      logoUrl == null &&
      showAvatars == null &&
      avatars == null &&
      showPresence == null &&
      greeting == null &&
      subGreeting == null &&
      ctaEnabled == null &&
      ctaTitle == null &&
      ctaSubtitle == null;

  @override
  List<Object?> get props => <Object?>[
        background,
        backgroundColor,
        colorSource,
        gradientStrength,
        backgroundImageUrl,
        imageOverlay,
        showLogo,
        logoUrl,
        showAvatars,
        avatars,
        showPresence,
        greeting,
        subGreeting,
        ctaEnabled,
        ctaTitle,
        ctaSubtitle,
      ];
}

/// The conversation's backdrop. Bubbles keep their own opaque surfaces in
/// every mode, so nothing here can make a message unreadable.
class ThreadAppearance extends Equatable {
  const ThreadAppearance({
    this.background,
    this.color,
    this.pattern,
    this.patternOpacity,
    this.imageUrl,
    this.imageFade,
    this.imageOverlay,
  });

  final ThreadBackground? background;
  final String? color;
  final ThreadPattern? pattern;
  final double? patternOpacity;
  final String? imageUrl;
  final ImageFade? imageFade;
  final double? imageOverlay;

  bool get isEmpty =>
      background == null &&
      color == null &&
      pattern == null &&
      patternOpacity == null &&
      imageUrl == null &&
      imageFade == null &&
      imageOverlay == null;

  @override
  List<Object?> get props => <Object?>[
        background,
        color,
        pattern,
        patternOpacity,
        imageUrl,
        imageFade,
        imageOverlay,
      ];
}

// ── Parsing ──────────────────────────────────────────────────────────────
//
// Every leaf read defensively, same rule as `remote_config.dart`: `appearance`
// is an opaque blob the server stores and re-serves without validating, so a
// key can be absent because an older console never wrote it, or present with
// the wrong type.

bool isJsonObject(Object? value) => value is Map<String, Object?>;

String? readString(Map<String, Object?> source, String key) {
  final Object? value = source[key];
  // Empty strings become null, not '': the console writes '' for "not set"
  // on several fields, and an empty accent colour must fall through to the
  // default rather than render as blank.
  return value is String && value.trim().isNotEmpty ? value : null;
}

bool? readFlag(Map<String, Object?> source, String key) {
  final Object? value = source[key];
  return value is bool ? value : null;
}

/// A numeric leaf. JSON itself cannot decode `NaN`/`Infinity` (unlike JS's
/// `Number()` coercion, which is what the TypeScript guard was written
/// against) — `jsonDecode` throws before a non-finite double ever reaches
/// here. The `isFinite` check is kept anyway: it is free, and it holds even
/// for a `Map` built by hand (a test fixture, say) rather than decoded from
/// wire JSON.
double? readNum(Map<String, Object?> source, String key) {
  final Object? value = source[key];
  if (value is num && value.isFinite) return value.toDouble();
  return null;
}

/// A string leaf constrained to a known [WireEnum] value set — the Dart-idiom
/// sibling of `remote-config.ts`'s generic `oneOf<T>()`: [fromWire] already
/// encodes the allowed set (unrecognised → null), so this only has to guard
/// the leaf's own type before handing it over.
T? readEnum<T extends WireEnum>(
  Map<String, Object?> source,
  String key,
  T? Function(String) fromWire,
) {
  final Object? value = source[key];
  return value is String ? fromWire(value) : null;
}

/// `appearance.launcherIcon` — every branch read, not just the one the
/// current `source` names, because the console keeps the unused ones
/// populated so switching back and forth does not lose them.
LauncherIcon parseLauncherIcon(Object? value) {
  if (!isJsonObject(value)) return const LauncherIcon();
  final Map<String, Object?> source = value as Map<String, Object?>;
  return LauncherIcon(
    source: readEnum(source, 'source', LauncherIconSource.fromWire),
    library: readString(source, 'library'),
    emoji: readString(source, 'emoji'),
    imageUrl: readString(source, 'imageUrl'),
  );
}

/// `appearance.launcherShadow` — one enable flag and one 0–100 intensity.
LauncherShadow parseLauncherShadow(Object? value) {
  if (!isJsonObject(value)) return const LauncherShadow();
  final Map<String, Object?> source = value as Map<String, Object?>;
  return LauncherShadow(
    enabled: readFlag(source, 'enabled'),
    intensity: readNum(source, 'intensity'),
  );
}

/// `appearance.header` — how the hero header is painted.
HeaderAppearance parseHeader(Object? value) {
  if (!isJsonObject(value)) return const HeaderAppearance();
  final Map<String, Object?> source = value as Map<String, Object?>;
  final Object? rawAvatars = source['avatars'];
  return HeaderAppearance(
    background: readEnum(source, 'background', HeaderBackground.fromWire),
    backgroundColor: readString(source, 'backgroundColor'),
    colorSource: readEnum(source, 'colorSource', HeaderColorSource.fromWire),
    gradientStrength: readNum(source, 'gradientStrength'),
    backgroundImageUrl: readString(source, 'backgroundImageUrl'),
    imageOverlay: readNum(source, 'imageOverlay'),
    showLogo: readFlag(source, 'showLogo'),
    logoUrl: readString(source, 'logoUrl'),
    showAvatars: readFlag(source, 'showAvatars'),
    // An absent array stays absent (null); a present one that contains
    // non-strings is filtered rather than rejected, because a merchant with
    // one broken avatar among three should still get the other two.
    avatars: rawAvatars is List<Object?>
        ? rawAvatars.whereType<String>().toList(growable: false)
        : null,
    showPresence: readFlag(source, 'showPresence'),
    greeting: readString(source, 'greeting'),
    subGreeting: readString(source, 'subGreeting'),
    ctaEnabled: readFlag(source, 'ctaEnabled'),
    ctaTitle: readString(source, 'ctaTitle'),
    ctaSubtitle: readString(source, 'ctaSubtitle'),
  );
}

/// `appearance.thread` — how the conversation's backdrop is painted.
ThreadAppearance parseThread(Object? value) {
  if (!isJsonObject(value)) return const ThreadAppearance();
  final Map<String, Object?> source = value as Map<String, Object?>;
  return ThreadAppearance(
    background: readEnum(source, 'background', ThreadBackground.fromWire),
    color: readString(source, 'color'),
    pattern: readEnum(source, 'pattern', ThreadPattern.fromWire),
    patternOpacity: readNum(source, 'patternOpacity'),
    imageUrl: readString(source, 'imageUrl'),
    imageFade: readEnum(source, 'imageFade', ImageFade.fromWire),
    imageOverlay: readNum(source, 'imageOverlay'),
  );
}
