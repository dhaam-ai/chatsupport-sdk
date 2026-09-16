/// The seam that fills a transcript the customer has just opened.
///
/// ── The reported bug this file exists to answer ──────────────────────────
///
/// "Opening any past conversation shows the same previous transcript", from
/// an app developer testing against a live server. The first half of that was
/// fixed in `ChatWidgetCubit._onSession`: a snapshot whose id DIFFERS from
/// the one on screen is a REPLACEMENT and clears the message store, so the
/// conversation being left can no longer be painted under the new one's id.
///
/// That fix alone leaves the opposite hole, and it is the one this file
/// closes. `createChatClient`'s `seedReplacedSession` (packages/core) states
/// it exactly: the commit clears the transcript — that is the whole point of
/// it — so a replacement that nothing then seeds is "a permanently blank
/// pane". A customer who opens a conversation they had yesterday sees
/// nothing at all, which is not obviously better than seeing somebody else's
/// messages and is just as broken.
///
/// `dhaam_chat` cannot read history: it is the WebSocket slice, and history
/// is `GET /chat/sessions/{id}/messages`. So, exactly as with the session
/// list, the Cubit genuinely cannot do this alone — and, exactly as with the
/// session list, nothing used to say so.
///
/// ── Why a function, and not a REST client ────────────────────────────────
///
/// The same rule `SessionListFetch`, `AttachmentUploader`, `TranscriptEmailer`
/// and `IssueReporter` already follow on this class: the SEAM stays
/// function-typed so every test can drive it with a closure and no network,
/// and the REST-backed implementation of that seam is a named function beside
/// it — `restMessageHistory`, in `rest_message_history.dart`, which is the
/// only file in this module that imports the REST package.
///
/// It is also what a host proxying chat through its own backend needs: it
/// fills a transcript from something that is NOT `dhaam_chat_rest`, and a
/// client-typed parameter would have no shape for it to satisfy.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMessage;

/// Produces page one of [sessionId]'s history. One call, one request.
///
/// ── By EXPLICIT id, always ───────────────────────────────────────────────
///
/// [sessionId] is a parameter rather than something the implementation reads
/// off the widget's current state, and that is `joinAndSeed`'s rule in
/// packages/core: page one must be THIS session's even if another frame moved
/// the session on screen while the request was out. A fetch that resolved the
/// id for itself would race exactly the switch it is being asked to seed.
///
/// ── The page is OLDEST-FIRST ─────────────────────────────────────────────
///
/// Stated here because it is the one thing a host writing its own fetch
/// cannot guess, and because the REST route does the opposite: `listMessages`
/// documents "newest first, paging backwards", and `restMessageHistory`
/// reverses it to satisfy this contract. Normalising in the adapter rather
/// than in the Cubit keeps the knowledge of a route's page order in the one
/// file that talks to that route.
///
/// It matters for rows that carry no `seq` at all — legitimate for messages
/// predating sequencing (see `projectHistoryRow`). `ChatMessage.seq` is the
/// ordering key (D2) and the seeder orders by it, but rows that have none
/// keep the order they arrived in, so a page handed over newest-first would
/// paint that conversation upside down.
///
/// ── One page, no cursor, no `hasMore` ────────────────────────────────────
///
/// Narrower than `RestMessagePage` on purpose: nothing in this package can
/// page. There is no "load older" control anywhere in `lib/`, so a cursor
/// would be a value with no caller and `hasMore` a flag nothing could act on.
/// That makes the page size a hard ceiling on how far back a customer can
/// read — see `kMessageHistoryPageSize`, which says so and how to raise it.
///
/// An EMPTY page is ordinary success, not an error: a conversation with no
/// messages in it is a real thing, and so is a brand-new session whose first
/// message has not been sent yet.
typedef MessageHistoryFetch = Future<List<ChatMessage>> Function(
  String sessionId,
);
