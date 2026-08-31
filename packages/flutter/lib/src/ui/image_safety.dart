/// The one allowlist every merchant-supplied image URL in this package goes
/// through before it is ever handed to an `Image` widget.
///
/// Ports `ui/dom.ts`'s `safeImageUrl` verbatim (same two accepted forms, in
/// the same order) rather than re-deriving a rule: `appearance.logoUrl`,
/// `header.avatars`, `header.backgroundImageUrl` and `thread.imageUrl` are
/// all opaque strings the server stores and re-serves without validating
/// (remote_config.dart's header), so the widget layer is the one place that
/// ever checks what scheme they actually name.
library;

/// `https?://…` or a `data:image/…` URI in one of the formats Flutter's own
/// image codecs plus this package's usage can plausibly decode. Anything
/// else — `javascript:`, a bare relative path, `file://` — is refused
/// outright rather than attempted, because there is no legitimate published
/// image URL in any other form.
///
/// `svg+xml` is accepted for PARITY with the JS allowlist (a console that
/// validates the same way there should not silently reject here what it
/// accepted there), even though Flutter's stock `Image.network`/
/// `Image.memory` cannot decode SVG without an extra package this widget
/// layer does not otherwise need (`dhaam_chat`'s README: "each one has to
/// earn its place here"). A caller renders with an `errorBuilder` that hides
/// the image rather than showing Flutter's red error box — the same
/// graceful-miss the JS widget gives a URL its allowlist refused.
String? safeImageUrl(String? value) {
  if (value == null) return null;
  final String url = value.trim();
  if (url.isEmpty) return null;
  if (RegExp(r'^https?://', caseSensitive: false).hasMatch(url)) return url;
  if (RegExp(r'^data:image/(png|jpeg|jpg|gif|webp|svg\+xml);', caseSensitive: false).hasMatch(url)) {
    return url;
  }
  return null;
}
