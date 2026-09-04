/// The quoted message a reply carries — `metadata: {kind: 'reply',
/// replyTo: {...}}`. Ports `ui/message-list.ts`'s `readReplyQuote`.
///
/// ── Why the excerpt is capped again here ─────────────────────────────────
///
/// The wire contract (agreed with the console team) caps the excerpt at 120
/// characters. This record nonetheless arrives over the socket from ANOTHER
/// PARTICIPANT'S CLIENT, so the cap is enforced again rather than assumed:
/// a quote is context for a message, and one that outgrows the message it
/// sits above has inverted the hierarchy. [kMaxQuoteExcerpt] is deliberately
/// wider than the contract — 160, not 120 — because this is a backstop
/// against a misbehaving peer, not a second opinion about the contract.
///
/// Never throws. Same defensive posture as `readQuickReplies`, for the same
/// reason: the bag is another client's data.
library;

/// Longest excerpt a quote block will render. See this file's header.
const int kMaxQuoteExcerpt = 160;

/// What a reply-carrying message quotes.
class ReplyQuote {
  const ReplyQuote({required this.senderName, required this.excerpt});

  /// Who wrote the quoted message, as the quoting client recorded it.
  final String senderName;

  /// The quoted words, capped at [kMaxQuoteExcerpt].
  final String excerpt;

  @override
  bool operator ==(Object other) =>
      other is ReplyQuote &&
      other.senderName == senderName &&
      other.excerpt == excerpt;

  @override
  int get hashCode => Object.hash(senderName, excerpt);

  @override
  String toString() => 'ReplyQuote($senderName: $excerpt)';
}

/// `message.metadata` → the quote to draw, or `null`.
///
/// Typed as `Object?` rather than `Map<String, Object?>?` so a caller can
/// hand over whatever the bag actually held without narrowing it first —
/// the point of this function is that it trusts nothing.
ReplyQuote? readReplyQuote(Object? metadata) {
  if (metadata is! Map<String, Object?>) return null;
  if (metadata['kind'] != 'reply') return null;

  final Object? ref = metadata['replyTo'];
  if (ref is! Map<String, Object?>) return null;

  final Object? rawName = ref['senderName'];
  final Object? rawExcerpt = ref['excerpt'];
  if (rawName is! String || rawExcerpt is! String) return null;

  final String name = rawName.trim();
  final String text = rawExcerpt.trim();
  // Both or nothing: a quote naming nobody, or naming someone who said
  // nothing, reads as a rendering bug rather than as context.
  if (name.isEmpty || text.isEmpty) return null;

  return ReplyQuote(
    senderName: name,
    excerpt: text.length > kMaxQuoteExcerpt
        // The ellipsis takes the last slot rather than being appended, so
        // the rendered string is never longer than the cap it is named for.
        ? '${text.substring(0, kMaxQuoteExcerpt - 1)}…'
        : text,
  );
}
