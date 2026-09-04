/// The message a reply is addressed to — what the composer's chip shows, and
/// what rides along on the send. Ports `ui/composer.ts`'s `ReplyTarget` and
/// the record `widget.ts` holds beside it.
///
/// ── Captured at Reply, never re-read at send ─────────────────────────────
///
/// [senderName] and [excerpt] are resolved the moment the customer presses
/// Reply, not when they eventually press Send. Two reasons, and both are the
/// reference's own:
///
///   1. The chip showed the customer these exact words, and the quote that
///      reaches the other participant has to be the same ones. Re-deriving at
///      send time is how a chip and the message it produced come to disagree.
///   2. By send time the quoted message may have been evicted from the loaded
///      page entirely, so there may be nothing left to re-derive FROM.
///
/// That is also why the excerpt travels on the wire at all rather than being
/// looked up by id at the far end — see [metadata].
///
/// ── The id is here, and the composer still never hands it back ───────────
///
/// `composer.ts`'s own `ReplyTarget` carries name and excerpt only, on the
/// grounds that "giving the composer an id it would only hand back would be
/// two owners for one fact". The same protection holds here by a different
/// route: [Composer]'s `onSend` is a `ValueChanged<String>` and carries TEXT
/// and nothing else, so the id physically cannot travel back out of the
/// composer. Which message a send is addressed to is read by the Cubit from
/// its own state, exactly once, in `sendMessage`.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMessage;
import 'package:equatable/equatable.dart';

import '../message_list/message_content.dart';
import '../message_list/reply_quote.dart';

/// Collapses every run of whitespace to one space.
///
/// A transcript bubble wraps a newline; a one-line chip above the input
/// cannot, so a multi-line quote would either stretch the composer down the
/// screen or be clipped mid-word. Ports the reference's `.replace(/\s+/g,
/// ' ')` on the same string.
final RegExp _whitespaceRun = RegExp(r'\s+');

/// What is being replied to.
class ReplyTarget extends Equatable {
  const ReplyTarget({
    required this.messageId,
    required this.senderName,
    required this.excerpt,
  });

  /// Reads a target off the message the customer pressed Reply on.
  ///
  /// [senderName] is supplied by the TRANSCRIPT rather than read off
  /// [message], because a [ChatMessage] carries no display name and only the
  /// message list can resolve one — see
  /// `MessageListCallbacks.onReplyToMessage`, which hands both over together
  /// for exactly this reason. Resolving it a second way here is the
  /// duplication that seam exists to avoid.
  factory ReplyTarget.from(ChatMessage message, {required String senderName}) {
    // `visibleContent` and not `message.content`: a plain attachment arrives
    // with its `content` SET TO the attachment url (§12.10), so quoting the
    // raw field would put a signed storage URL in front of the customer as
    // though it were something somebody said. That rule is stated once, in
    // `message_content.dart`, and consumed here.
    final String text =
        visibleContent(message).trim().replaceAll(_whitespaceRun, ' ');

    return ReplyTarget(
      messageId: message.id,
      senderName: senderName,
      excerpt: text.isEmpty ? _wordlessExcerpt(message) : _cap(text),
    );
  }

  /// What to quote when the message has no words of its own.
  ///
  /// The reference says `'Attachment'` unconditionally. That is right for the
  /// case it was written for and a small lie for the other one: a message
  /// that arrived from another participant's client with an empty `content`
  /// and NO attachment would be quoted as a file that does not exist. The
  /// customer would be looking at a chip describing something they cannot
  /// see, which is the same class of bug as the url placeholder above.
  static String _wordlessExcerpt(ChatMessage message) =>
      message.attachment != null ? 'Attachment' : 'Message';

  /// Trims to [kMaxQuoteExcerpt].
  ///
  /// ── Deliberately NOT a second cap ───────────────────────────────────
  ///
  /// [kMaxQuoteExcerpt] is `reply_quote.dart`'s, the one the RENDER side
  /// already enforces on a quote arriving from another participant's client.
  /// Producing against the same constant is what makes the chip the customer
  /// saw and the quote their reader draws the same string, rather than two
  /// numbers that have to be kept in step by hand.
  ///
  /// **Consequence, stated rather than hidden:** the wire contract agreed
  /// with the console team caps this at 120 and [kMaxQuoteExcerpt] is 160, so
  /// an excerpt between the two lengths goes out longer than that contract
  /// asks for. It is well within what every reader here caps at, so nothing
  /// renders wrong — but it IS a divergence from the reference's own
  /// producing cap, and the fix if the contract is to be honoured exactly is
  /// to change the constant this line reads, in one place.
  static String _cap(String text) => text.length > kMaxQuoteExcerpt
      // The ellipsis takes the last slot rather than being appended, so the
      // result is never longer than the cap it is named for — the same rule
      // `readReplyQuote` applies on the way back in.
      ? '${text.substring(0, kMaxQuoteExcerpt - 1)}…'
      : text;

  /// The id the send frame's `replyToMessageId` carries.
  final String messageId;

  /// Who wrote the quoted message, as the transcript itself names them. The
  /// customer's own messages resolve to "You".
  final String senderName;

  /// The quoted words, already collapsed and capped.
  final String excerpt;

  /// The RENDERABLE half of a reply, as `sendMessage`'s metadata bag.
  ///
  /// `replyToMessageId` is the protocol-native field and says WHICH message;
  /// this says what it SAID. Both travel, because the quoted message may not
  /// be in the reader's loaded page at all — an id alone would leave them a
  /// reply to something they cannot see.
  ///
  /// Built here, next to the fields it names, rather than at the call site:
  /// the `kind` string is not checked by any compiler, and a typo in it is
  /// not an error but a quote that silently never renders. This is also the
  /// exact shape [readReplyQuote] parses, so the writer and the reader are
  /// one round trip apart and can be asserted against each other.
  Map<String, Object?> get metadata => <String, Object?>{
        'kind': 'reply',
        'replyTo': <String, Object?>{
          'messageId': messageId,
          'excerpt': excerpt,
          'senderName': senderName,
        },
      };

  @override
  List<Object?> get props => <Object?>[messageId, senderName, excerpt];
}
