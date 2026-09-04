/// The four REST calls the end-of-conversation module needs, behind one seam.
///
/// ── Why an interface here rather than a `dhaam_chat_rest` dependency ────
///
/// `packages/flutter` depends on `dhaam_chat` and `http`, and deliberately
/// not on `dhaam_chat_rest`. The same boundary `ChatSessionSummary` already
/// states for the Messages screen applies here: this package renders what it
/// is handed, and the host owns which client fetched it. Keeping the REST
/// package out of this one's dependency graph is what lets a host that has
/// its own transport (an app that already proxies chat through its own
/// backend, say) use these screens at all.
///
/// So this is the seam, and `dhaam_chat_rest`'s `RestChatClient` is the
/// adapter a host writes over it — four methods, each a direct delegation.
/// `csatLookupOver` in that package supplies the one method with a rule in
/// it, so the 404/405 classification is not re-derived per host.
///
/// ── Absent means the feature is OFF, not broken ─────────────────────────
///
/// `ChatWidgetCubit` takes this as an optional constructor argument and
/// defaults it to null. A host that has not wired it up gets no rating card,
/// no ended footer and no end-conversation item — never a card whose submit
/// silently discards the customer's answer, which is worse than no card.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show CsatStatus;

/// Everything the rating card, the ended footer and the end-conversation
/// confirm need from chat-service.
///
/// One interface rather than four callbacks: they are one concept — what a
/// customer can do to a conversation that is over — and a host implements,
/// and a test fakes, one thing.
abstract interface class ChatSessionActions {
  /// `GET /chat/sessions/{id}/csat`.
  ///
  /// Exactly `dhaam_chat`'s [CsatLookupFn], so it can be handed to
  /// `CsatMachine` unchanged. The return type is [CsatStatus], not
  /// `CsatLookup`, and the compiler is what keeps it honest: `loading`,
  /// `unknown` and `unsupported` are the machine's own bookkeeping and are
  /// unreachable from an implementation of this.
  ///
  /// Throw `CsatRouteMissing` — and ONLY that — for "this deployment has no
  /// such route", which the machine treats oppositely to every other failure
  /// (it still offers the survey, because a service with no read route has no
  /// stored rating to overwrite). The classification rule is
  /// `CsatRouteMissing.describes`; call it rather than writing a second
  /// 404/405 check, or an ownership `SESSION_NOT_FOUND` — an answer ABOUT
  /// this session — will be read as a missing route and re-offer the survey
  /// over a rated conversation.
  ///
  /// A malformed body must THROW, never come back as [CsatStatus] unrated.
  /// `POST …/csat` is an upsert, so reading "we do not understand this" as
  /// "nobody has rated it" replaces the score the customer already gave.
  Future<CsatStatus> readCsat(String sessionId);

  /// `POST /chat/sessions/{id}/csat` — one round trip, and an upsert.
  ///
  /// [comment] is omitted from the body when null, never sent as null or
  /// `''`: the body stays an honest record of what the customer typed, and an
  /// explicit null asserts they were asked and declined in a way an absent
  /// key does not.
  Future<void> submitCsat(
    String sessionId, {
    required int rating,
    String? comment,
  });

  /// `POST /chat/sessions/{id}/close`, then the `GET …/full` read-back.
  ///
  /// **Never replay this on a read-back failure.** Closing is not idempotent:
  /// a second POST re-runs the status update, re-marks participants as having
  /// left, and emits a fresh "chat closed" SYSTEM message plus another event,
  /// all of it visible in the customer's own transcript. A
  /// `RestSessionReadBackException` means the mutation ALREADY APPLIED and
  /// only the read failed — re-issue the read, using the id the exception
  /// carries, and never the action.
  ///
  /// Returns nothing, because there is nothing here to apply: the terminal
  /// status arrives on the socket as `session.closed`/`session.updated` and
  /// `ChatWidgetState.session` follows it. A REST session and a protocol
  /// [SessionSnapshot] are different types carrying different fields, and
  /// having two writers of the on-screen session would be the second memory
  /// this package is built to avoid.
  Future<void> closeSession(String sessionId);

  /// `POST /chat/sessions/{id}/reopen`, then the same read-back.
  ///
  /// **Answers with the SETTLED id, which may not be the one asked for.**
  /// Reopen converges onto an already-active session and returns that one —
  /// the ordinary outcome when another tab has already reopened this
  /// conversation, not an error. The caller follows the returned id; an
  /// implementation that answered with the requested one instead would send
  /// the customer back into a session the server did not reopen.
  ///
  /// Same read-back rule as [closeSession].
  Future<String> reopenSession(String sessionId);
}
