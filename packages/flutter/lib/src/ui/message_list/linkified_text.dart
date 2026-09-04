/// A message's words, with its links made tappable. The Flutter half of
/// `ui/linkify.ts`.
///
/// ── What did NOT need porting, and why ───────────────────────────────────
///
/// `linkify.ts` exports two things: `findLinks`, which is pure, and
/// `renderLinkified`, which builds text nodes and `<a>` elements by hand
/// precisely so the string never goes near `innerHTML`. `dhaam_chat` ports
/// the first (T2) and deliberately does not port the second: a [TextSpan] is
/// never parsed as markup, so the hazard `renderLinkified` existed to avoid
/// does not exist here.
///
/// What remains is the slicing, and that is what this file does:
/// [findLinks] returns UTF-16 spans over the ORIGINAL string, so the
/// untouched text is sliced around them rather than reassembled from pieces
/// — a customer must see the matched substring verbatim.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show TextLink, findLinks;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

class LinkifiedText extends StatefulWidget {
  const LinkifiedText(
    this.text, {
    super.key,
    this.style,
    this.linkStyle,
    this.onOpenLink,
  });

  final String text;
  final TextStyle? style;
  final TextStyle? linkStyle;

  /// Opening a link is the HOST's decision, not this package's.
  ///
  /// `null` renders links styled but inert — the honest default for a build
  /// that has not been given a way to open one. `safeLinkUrl` has already
  /// run inside [findLinks], so an href reaching this callback is absolute
  /// http(s) or a `mailto:`, never a `data:`.
  final ValueChanged<String>? onOpenLink;

  @override
  State<LinkifiedText> createState() => _LinkifiedTextState();
}

class _LinkifiedTextState extends State<LinkifiedText> {
  final List<TapGestureRecognizer> _recognizers = <TapGestureRecognizer>[];

  @override
  void dispose() {
    _disposeRecognizers();
    super.dispose();
  }

  void _disposeRecognizers() {
    for (final TapGestureRecognizer recognizer in _recognizers) {
      recognizer.dispose();
    }
    _recognizers.clear();
  }

  @override
  Widget build(BuildContext context) {
    // Rebuilt per build rather than cached: a recognizer holds a callback
    // that closes over `widget`, and a stale one would open the link a
    // previous build's text pointed at.
    _disposeRecognizers();

    final List<TextLink> links = findLinks(widget.text);
    if (links.isEmpty) {
      return Text(widget.text, style: widget.style);
    }

    final TextStyle linkStyle = widget.linkStyle ??
        (widget.style ?? const TextStyle()).copyWith(
          decoration: TextDecoration.underline,
        );

    final List<InlineSpan> spans = <InlineSpan>[];
    int cursor = 0;
    for (final TextLink link in links) {
      if (link.start > cursor) {
        spans.add(TextSpan(text: widget.text.substring(cursor, link.start)));
      }
      final ValueChanged<String>? open = widget.onOpenLink;
      TapGestureRecognizer? recognizer;
      if (open != null) {
        recognizer = TapGestureRecognizer()..onTap = () => open(link.href);
        _recognizers.add(recognizer);
      }
      spans.add(
        TextSpan(
          // The matched substring, unmodified. This is what the customer
          // must see — never the resolved href, which for a bare `www.`
          // match carries a scheme the customer did not type.
          text: link.text,
          style: linkStyle,
          recognizer: recognizer,
          semanticsLabel: link.text,
        ),
      );
      cursor = link.end;
    }
    if (cursor < widget.text.length) {
      spans.add(TextSpan(text: widget.text.substring(cursor)));
    }

    return Text.rich(TextSpan(style: widget.style, children: spans));
  }
}
