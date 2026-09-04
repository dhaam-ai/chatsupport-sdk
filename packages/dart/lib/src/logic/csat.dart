/// What is known about a session's CSAT rating, and the rules for acting on
/// it.
///
/// Ports the state machine `packages/widget/src/widget.ts` carries as
/// `csatBySession`, `csatFor`, `confirmedUnrated` and `csatCard`. The card
/// itself (`ui/csat.ts`) is not here — this library decides WHETHER to ask and
/// what to show, and a Flutter widget decides how.
///
/// ── Why this lives in `dhaam_chat` and takes no HTTP client ──────────────
///
/// `dhaam_chat` has exactly one dependency and no HTTP at all, and this does
/// not change that. The machine is handed a [CsatLookupFn] — an async function
/// from a session id to what the server says — and never learns a URL, a
/// header or a status code. That keeps the rules testable without a socket or
/// a server, which matters because the rules are the whole of the risk: every
/// one of them exists to stop a rating being destroyed.
library;

import 'dart:async';

/// The server's ANSWER about one session — a sealed pair, and a subtype of
/// [CsatLookup].
///
/// The nesting is the point. Of the five things the machine can know, exactly
/// two are answers, and `unrated` is one of them: "nobody has rated this" is a
/// fact the server stated, not a lookup that came back empty. Making the pair
/// a subtype means `lookup is CsatStatus` is precisely the question "did the
/// server answer?", so no caller has to remember which of five names count.
///
/// A [CsatLookupFn] returns this rather than [CsatLookup], so the states that
/// are the machine's own bookkeeping — loading, unsupported, unknown — are
/// unreachable from a lookup implementation by construction.
sealed class CsatStatus extends CsatLookup {
  const CsatStatus();
}

/// Somebody has rated this session. Show it filled and locked.
final class CsatRated extends CsatStatus {
  const CsatRated({required this.rating, this.comment});

  /// 1-5.
  final int rating;

  /// `null` when the customer left none.
  final String? comment;

  @override
  bool operator ==(Object other) =>
      other is CsatRated && other.rating == rating && other.comment == comment;

  @override
  int get hashCode => Object.hash(rating, comment);

  @override
  String toString() => 'CsatRated($rating, comment: $comment)';
}

/// Nobody has rated this session yet. Offer the survey.
///
/// An ANSWER, not an absence — see [CsatStatus].
final class CsatUnrated extends CsatStatus {
  const CsatUnrated();

  @override
  String toString() => 'CsatUnrated()';
}

/// What this machine knows about one session's rating.
///
/// Five states, and the three that are NOT answers matter as much as the two
/// that are.
sealed class CsatLookup {
  const CsatLookup();
}

/// The lookup is in flight.
///
/// Show nothing. A survey that appears and then locks itself is a survey the
/// customer may already have started answering.
final class CsatLoading extends CsatLookup {
  const CsatLoading();

  @override
  String toString() => 'CsatLoading()';
}

/// The lookup FAILED, and nothing is known about this session.
///
/// ── Why an unknown answer WITHHOLDS the survey ───────────────────────────
///
/// `POST /chat/sessions/{id}/csat` is an UPSERT: a second rating does not
/// fail, it replaces the first. So the two ways to be wrong here are not
/// symmetric. Showing the survey when the answer is unknown risks a customer
/// silently overwriting a score they already gave, while hiding it risks not
/// collecting one they might have offered. Only the first loses data, so an
/// unknown answer withholds.
///
/// Nobody is stranded by that: a terminal session with no card falls through
/// to the ended footer's Reopen / New conversation pair, which is what that
/// footer is for.
///
/// A failure is REMEMBERED, not retried. Retrying on every repaint would
/// hammer a service that just failed, at a rate set by how often the customer
/// scrolls; the retry that matters is the next page view, which starts with a
/// fresh machine. The cost of getting this wrong is one uncollected rating,
/// which is the cheap side of the asymmetry above.
final class CsatUnknown extends CsatLookup {
  const CsatUnknown();

  @override
  String toString() => 'CsatUnknown()';
}

/// This deployment has no CSAT read route at all.
///
/// ── The one failure that does NOT withhold the survey ────────────────────
///
/// A service that does not serve the route is a different fact from a lookup
/// that failed, and [CsatUnknown]'s asymmetry does not apply to it: there is
/// no rating to protect, because that deployment could never have shown this
/// widget one.
///
/// A client is embedded in apps that outlive any one backend release, so a
/// staged rollout, a lagging tenant or a rollback would otherwise silently
/// stop collecting ratings for every visitor on that deployment — and,
/// because the verdict is cached, for the whole session rather than one
/// conversation. So this falls back to exactly the behaviour that shipped
/// before the route existed: OFFER the survey, once, remembered by the
/// machine's own record of what it has already submitted.
///
/// It is also not reported to the host. An older service is not a fault.
final class CsatUnsupported extends CsatLookup {
  const CsatUnsupported();

  @override
  String toString() => 'CsatUnsupported()';
}

/// Thrown by a [CsatLookupFn] to say the DEPLOYMENT has no CSAT read route,
/// as opposed to saying no about this particular session.
///
/// The two are distinguishable and must be distinguished — see
/// [CsatUnsupported] for why the machine treats them oppositely. Every other
/// error a lookup throws lands on [CsatUnknown].
///
/// The classification rule itself is [describes], so the REST adapter that
/// raises this does not carry a second copy of it.
final class CsatRouteMissing implements Exception {
  const CsatRouteMissing();

  /// Whether a REST failure says the route is missing rather than the session.
  ///
  /// chat-service answers an ownership failure with its own envelope, so the
  /// error carries a STRUCTURED code (`SESSION_NOT_FOUND`) — that is an answer
  /// about this session and must still withhold the survey. A framework
  /// route-not-found carries no envelope at all, so the code falls back to the
  /// literal `HTTP_<status>`, and that is the only shape this accepts.
  ///
  /// Takes plain `int?`/`String?` rather than an error object, so this package
  /// keeps its distance from any HTTP type.
  static bool describes({required int? status, required String? code}) =>
      (status == 404 || status == 405) && code == 'HTTP_$status';

  @override
  String toString() => 'CsatRouteMissing()';
}

/// Asks the server what it knows about `sessionId`'s rating.
///
/// Completes with one of the two [CsatStatus] answers, or fails. Throw
/// [CsatRouteMissing] for "this deployment has no such route"; anything else
/// is an ordinary failure.
typedef CsatLookupFn = Future<CsatStatus> Function(String sessionId);

/// The rating card a session is owed, or `null` for none.
///
/// One definition for every reader — the card itself and whatever decides the
/// ended footer is outranked — so the two can never answer the question
/// differently. That divergence is exactly what the TypeScript extracted its
/// own `csatCard` to prevent.
class CsatCard {
  const CsatCard({required this.sessionId, this.existing});

  final String sessionId;

  /// `null` means ASK. A rating means show it filled and LOCKED, with no
  /// submit control at all — not a disabled one, which still invites the
  /// press.
  final CsatRated? existing;

  /// Whether this card asks for a rating rather than reading one back.
  bool get isAsk => existing == null;

  @override
  String toString() => 'CsatCard($sessionId, existing: $existing)';
}

/// Remembers what the server said about each session's rating, and enforces
/// the rules for acting on it.
///
/// One instance per client session. Not persisted: the server holds the
/// authoritative answer, and a stored copy would be a third memory to keep in
/// step.
class CsatMachine {
  CsatMachine({
    required CsatLookupFn lookup,
    void Function(Object error, StackTrace stackTrace)? onError,
  })  : _lookup = lookup,
        _onError = onError;

  final CsatLookupFn _lookup;
  final void Function(Object error, StackTrace stackTrace)? _onError;

  final Map<String, CsatLookup> _bySession = <String, CsatLookup>{};

  /// Sessions THIS machine has recorded a rating for.
  ///
  /// Protects a locally-known answer from a lookup that was already in flight
  /// when it was recorded: that round trip has nothing to teach a machine that
  /// watched the write succeed, and letting it land would flash the survey
  /// back over a session that was just rated.
  ///
  /// A set rather than the TypeScript's single id, because one client session
  /// can rate more than one conversation — end one, start another, end that.
  final Set<String> _submittedHere = <String>{};

  final StreamController<String> _changes =
      StreamController<String>.broadcast();

  bool _disposed = false;

  /// The id of each session whose verdict has just changed.
  ///
  /// A repaint trigger: the answer landing is a state change like any other,
  /// so whatever a caller decided while the lookup was [CsatLoading] has to be
  /// decided again.
  Stream<String> get changes => _changes.stream;

  /// What is known about `sessionId`, asking the server AT MOST ONCE.
  ///
  /// Synchronous by design — a repaint cannot await. The first call starts the
  /// request and returns [CsatLoading]; every later call is answered from the
  /// cache, so repainting fifty times costs one lookup. [changes] announces
  /// the answer when it lands.
  CsatLookup lookupFor(String sessionId) {
    final CsatLookup? known = _bySession[sessionId];
    if (known != null) return known;
    _bySession[sessionId] = const CsatLoading();
    unawaited(_ask(sessionId));
    return const CsatLoading();
  }

  /// The card `sessionId` is owed, or `null` for none.
  ///
  /// [CsatUnsupported] asks alongside [CsatUnrated]: a deployment with no read
  /// route has no stored rating this card could overwrite, and
  /// [recordSubmitted] is what stops it being offered twice.
  ///
  /// Callers still decide whether a card is due at all — a session has to be
  /// over, and an empty transcript has nothing to rate. That is state this
  /// package cannot see; this answers only the half that depends on the
  /// server's verdict.
  CsatCard? cardFor(String sessionId) => switch (lookupFor(sessionId)) {
        CsatUnrated() || CsatUnsupported() => CsatCard(sessionId: sessionId),
        final CsatRated rated =>
          CsatCard(sessionId: sessionId, existing: rated),
        // Show nothing either way, for opposite reasons — see the two classes.
        CsatLoading() || CsatUnknown() => null,
      };

  /// Re-asks the server, at the moment of submit, whether `sessionId` is still
  /// unrated. `false` means "somebody rated it already, do not write".
  ///
  /// ── Why the cached answer is not enough ────────────────────────────────
  ///
  /// The cache holds `unrated` for this machine's lifetime and nothing
  /// invalidates it: there is no CSAT frame on the wire and no event. So a
  /// second tab, or the same customer's phone, can rate the conversation while
  /// the card sits on screen holding an answer that was true when it was
  /// fetched. The write is an UPSERT, so submitting then does not fail — it
  /// replaces the score they already gave. One request on the button press
  /// cannot close that window entirely, but it narrows it from "however long
  /// this card has been open" to the width of one round trip.
  ///
  /// ── A re-check that FAILS lets the submit through ──────────────────────
  ///
  /// The opposite of [CsatUnknown]'s rule, and deliberately. There, no
  /// evidence had been gathered and the safe direction was to withhold. Here a
  /// definite `unrated` is already on file — that is WHY this card is an ask
  /// and not a locked read-out — and the customer has just chosen a score.
  /// Refusing to send it loses a rating for certain, on the strength of a
  /// transport blip that says nothing about whether a rating exists.
  ///
  /// Only meaningful for a session believed [CsatUnrated]. [CsatUnsupported]
  /// has nothing to re-ask and would fail again on every press, so it passes
  /// straight through.
  Future<bool> confirmedUnrated(String sessionId) async {
    if (_bySession[sessionId] is! CsatUnrated) return true;

    final CsatStatus status;
    try {
      status = await _lookup(sessionId);
    } catch (_) {
      // Deliberately not recorded as `unknown`: the card stays an ask, and the
      // rating the customer just chose goes out.
      return true;
    }
    if (status is! CsatRated) return true;

    _bySession[sessionId] = status;
    // Delivered on a later microtask, because [changes] is a broadcast stream.
    // That matters: the caller is still inside its own submit, and repainting
    // it out from under itself mid-flight is how a surface ends up half torn
    // down. Repainting AFTER this turn is what swaps the ask for the locked
    // read-out of the rating that actually stands — the honest end state for a
    // press that deliberately wrote nothing.
    _emit(sessionId);
    return false;
  }

  /// Records a rating this client just wrote successfully.
  ///
  /// Call it after the write lands, never before: this is the memory every
  /// later repaint reads, and writing it optimistically would lock a card over
  /// a rating the server refused.
  void recordSubmitted(
    String sessionId, {
    required int rating,
    String? comment,
  }) {
    _submittedHere.add(sessionId);
    _bySession[sessionId] = CsatRated(rating: rating, comment: comment);
    _emit(sessionId);
  }

  /// Releases the [changes] stream. In-flight lookups are allowed to finish
  /// and are then ignored.
  Future<void> dispose() async {
    _disposed = true;
    await _changes.close();
  }

  Future<void> _ask(String sessionId) async {
    CsatLookup verdict;
    Object? failure;
    StackTrace? failureStack;
    try {
      verdict = await _lookup(sessionId);
    } on CsatRouteMissing {
      // Not reported: an older service is not a fault. See [CsatUnsupported].
      verdict = const CsatUnsupported();
    } catch (error, stack) {
      verdict = const CsatUnknown();
      failure = error;
      failureStack = stack;
    }

    // A rating recorded here while this was in flight is the better answer,
    // and a stale `unrated` landing on top of it would put the survey back
    // over a session this client has already rated.
    if (!_submittedHere.contains(sessionId)) {
      _bySession[sessionId] = verdict;
    }
    if (failure != null) _onError?.call(failure, failureStack!);
    _emit(sessionId);
  }

  void _emit(String sessionId) {
    if (_disposed || _changes.isClosed) return;
    _changes.add(sessionId);
  }
}
