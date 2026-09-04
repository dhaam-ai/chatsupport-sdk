/// Everything that shows once a conversation is over: the rating card, the
/// "End this conversation?" question that gets it there, and the footer that
/// stands in for the composer afterwards.
///
/// One module because the three are one precedence chain, and the chain is
/// the part that is easy to get wrong. A session that has genuinely ENDED is
/// owed a rating card; the footer is what is left once no card is due; and a
/// `SWITCHED` close is owed NEITHER, because that session was parked rather
/// than ended. `ChatWidgetCubit` asks those questions once, of `CsatMachine`
/// and of one `endedSessionId` getter, so the card and the footer can never
/// both decide they are on.
///
/// A barrel over the three files, the same shape `pre_chat.dart` has.
library;

export 'csat_card_view.dart';
export 'end_conversation_confirm.dart';
export 'ended_footer.dart';
