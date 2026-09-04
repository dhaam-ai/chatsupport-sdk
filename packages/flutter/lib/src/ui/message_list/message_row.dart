/// One rendered row of the transcript — everything the view needs and
/// nothing it has to work out for itself.
///
/// Built only by [MessageListPresenter]. The view reads these fields and
/// draws them; it never re-asks a question this record already answered,
/// which is what stops a second, disagreeing copy of the tick rule or the
/// retry rule appearing in the render path.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMessage;

import 'delivery_failure.dart';
import 'reply_quote.dart';
import 'tick_state.dart';

class MessageRow {
  const MessageRow({
    required this.message,
    required this.outgoing,
    required this.text,
    required this.senderName,
    required this.showAuthorName,
    required this.avatarLetter,
    required this.tick,
    required this.failure,
    required this.quote,
  });

  /// The message core gave this row, untouched.
  ///
  /// Handed straight to `onRetry` so a retry keyed on `message.id` can never
  /// see the placeholder-stripped string in [text]. The related bug: retry
  /// used to be able to send `''` for an attachment message because
  /// something read the SUPPRESSED bubble text.
  final ChatMessage message;

  /// Whether this is the customer's own message.
  final bool outgoing;

  /// The bubble's words, with §12.10's placeholder subtracted — the empty
  /// string for a plain attachment.
  final String text;

  /// Who wrote this, resolved. `null` for the customer's own: "You" over
  /// their own bubble tells them nothing they do not already know, and the
  /// bubble is already aligned and coloured as theirs.
  final String? senderName;

  /// Whether [senderName] should also be printed as text above the bubble.
  ///
  /// Only the FIRST bubble of a run from the same sender. Repeating the name
  /// on each of five consecutive bot replies is noise that pushes the words
  /// themselves off the screen.
  final bool showAuthorName;

  /// The avatar's single letter, or `null` for the customer's own row.
  ///
  /// Present on EVERY incoming row, unlike [showAuthorName] — the heading is
  /// a heading for the run, the avatar is a per-line identity cue. Always
  /// derived from [senderName], never from the merchant's configured header
  /// initials: those name the BRAND, not whoever sent this message.
  final String? avatarLetter;

  /// The tick to draw, straight from [deriveTickState]. `null` means no tick
  /// at all — see that function's doc for the four cases.
  final MessageTickState? tick;

  /// The failure to state, or `null`. Carries `retryable` as core reported
  /// it; nothing here re-derives it from [SendFailure.reason] or
  /// [SendFailure.code].
  final SendFailure? failure;

  /// The message this one replies to, or `null`.
  final ReplyQuote? quote;

  /// The sentence shown under a failed bubble, or `null`.
  ///
  /// Shown on EVERY failure, whether or not [showRetry] is true: a
  /// permanently-refused send still owes the customer a reason.
  String? get failureText {
    final SendFailure? f = failure;
    return f == null ? null : failureReasonCopy(f.reason);
  }

  /// Whether to offer Retry.
  ///
  /// `!failure.retryable` and nothing else. The bug this replaces was
  /// `retry.hidden = !failed`, which offered Retry for EVERY failure —
  /// including one the server already refused as non-retryable. Retrying
  /// that exact send is refused identically every time, so the button is a
  /// lie the customer has no way to detect until they press it.
  bool get showRetry => failure?.retryable ?? false;

  /// The name a reply quote drawn from this row would carry. The customer's
  /// own rows resolve to "You", which is also what WhatsApp prints when
  /// someone quotes themselves.
  String get replyAttribution => senderName ?? 'You';
}
