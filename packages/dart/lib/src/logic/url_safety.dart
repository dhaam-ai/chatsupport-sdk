/// The allowlist every URL this package is asked to NAVIGATE to goes through.
///
/// Ports `packages/widget/src/ui/dom.ts`'s `safeLinkUrl` — the same rule the
/// branding link, the header menu's Privacy item and `logic/linkify.dart` all
/// use, so there is one answer to "may this string become an href" rather
/// than one per call site.
library;

/// `https://…` or `http://…`, trimmed — or `null` for anything else.
///
/// ── Why this is NARROWER than `safeImageUrl` ─────────────────────────────
///
/// `packages/flutter`'s `image_safety.dart` accepts a second form,
/// `data:image/…`, and this deliberately does not. The two are not
/// inconsistent, because they answer different questions about the same
/// string:
///
///   - `data:image/svg+xml,…` handed to an `Image` widget is a PICTURE. It is
///     decoded by an image codec, which has no script engine to run anything
///     the SVG declares.
///   - the SAME string NAVIGATED to is a DOCUMENT. An SVG is XML, `<script>`
///     inside one executes, and on the web it executes in a `data:` origin
///     the host page did not choose.
///
/// So the scheme is not the risk — the destination is. A URL that will be
/// opened gets the stricter list, and `data:` is refused outright rather than
/// filtered by media type, because there is no media type that is safe to
/// navigate to and unnecessary to render as an image.
///
/// Everything else — `javascript:`, `vbscript:`, `file:`, a bare relative
/// path — is refused for the ordinary reason: no legitimate link a merchant
/// or another participant writes takes any of those forms, and refusing is
/// the harmless direction. A refused URL stays plain text; an accepted bad
/// one is a click the customer cannot take back.
///
/// Accepts `null` so a caller holding an optional config field
/// (`RemoteConfig.privacyUrl`) can gate on the result directly instead of
/// null-checking twice.
String? safeLinkUrl(String? value) {
  if (value == null) return null;
  final String url = value.trim();
  return _absoluteHttp.hasMatch(url) ? url : null;
}

/// Anchored at the start, so a `javascript:` payload cannot smuggle itself in
/// behind a substring that happens to read as a scheme later in the string.
final RegExp _absoluteHttp = RegExp(r'^https?://', caseSensitive: false);
