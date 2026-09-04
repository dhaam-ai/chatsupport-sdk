// Reproduces `session-list-refresh.test.ts`'s "two fetches never overlap"
// block, at the layer that actually owns the rule:
//
//   * "the first-open fetch and a close-driven one are serialised, newest
//      answer last"
//   * "a burst of closes collapses to ONE re-fetch, not one per event"
//   * "a refresh asked for during a flight is re-issued, never dropped"
//
// The JS file drives those through a mounted widget and counts GETs at
// `fetch`, because that is where the serialisation lives there. Here the
// adapter is pinned NOT to collapse (four calls, four requests — see
// `dhaam_chat_rest`'s `listSessions`), so the same three assertions belong
// to this object, and it can be asserted with neither a widget nor a socket
// in the room.
//
// The WHEN of a refresh — a panel open, a screen arrival, a `session.closed`
// frame — is not asserted here. That is the mounting layer's wiring, and
// this object deliberately knows nothing about it.

import 'dart:async';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

ChatSessionSummary _summary({
  String id = 'sess_current',
  ChatStatus status = ChatStatus.assigned,
}) =>
    ChatSessionSummary(
      id: id,
      status: status,
      mode: ChatMode.human,
      createdAt: DateTime.utc(2026, 8, 19, 9),
      lastMessageAt: DateTime.utc(2026, 8, 19, 10),
    );

/// A fetch that can be held open, so a second caller genuinely arrives while
/// the first is in flight — the same trick the JS file's `holdSessions` uses.
class _HeldFetch {
  int calls = 0;
  final List<Completer<List<ChatSessionSummary>>> pending =
      <Completer<List<ChatSessionSummary>>>[];

  /// What the NEXT release answers with. Read at release time, not at call
  /// time, so a test can change the answer while a request is held open —
  /// which is how "the older page lands last" is made observable at all.
  List<ChatSessionSummary> answer = <ChatSessionSummary>[_summary()];

  Future<List<ChatSessionSummary>> call() {
    calls += 1;
    final Completer<List<ChatSessionSummary>> completer =
        Completer<List<ChatSessionSummary>>();
    pending.add(completer);
    return completer.future;
  }

  void releaseOne() {
    expect(pending, isNotEmpty, reason: 'nothing was in flight to release');
    pending.removeAt(0).complete(answer);
  }

  void failOne(Object error) {
    expect(pending, isNotEmpty, reason: 'nothing was in flight to fail');
    pending.removeAt(0).completeError(error, StackTrace.empty);
  }
}

void main() {
  late _HeldFetch fetch;
  late List<List<ChatSessionSummary>> written;
  late List<Object> errors;
  late SessionListRefresher refresher;

  setUp(() {
    fetch = _HeldFetch();
    written = <List<ChatSessionSummary>>[];
    errors = <Object>[];
    refresher = SessionListRefresher(
      fetch: fetch.call,
      onSessions: written.add,
      onError: (Object error, StackTrace _) => errors.add(error),
    );
    addTearDown(refresher.dispose);
  });

  test('one ask is one fetch', () async {
    final Future<void> done = refresher.refresh();
    expect(fetch.calls, 1);
    expect(refresher.isRefreshing, isTrue);

    fetch.releaseOne();
    await done;

    expect(written, hasLength(1));
    expect(refresher.isRefreshing, isFalse);
  });

  test('two asks never overlap — the second waits for the first to land',
      () async {
    final Future<void> first = refresher.refresh();
    expect(fetch.calls, 1);

    // A close lands while that first page is still in flight.
    final Future<void> second = refresher.refresh();
    // Still exactly one request out: the second was queued, not raced.
    expect(fetch.calls, 1);
    expect(refresher.isRefreshQueued, isTrue);

    // The held page is the STALE one, fetched before the close.
    fetch.answer = <ChatSessionSummary>[_summary(status: ChatStatus.assigned)];
    fetch.releaseOne();
    await pumpEventQueue();

    // Only now does the queued refresh go out — after the first LANDED,
    // never beside it.
    expect(fetch.calls, 2);
    expect(written, hasLength(1));

    fetch.answer = <ChatSessionSummary>[_summary(status: ChatStatus.closed)];
    fetch.releaseOne();
    await Future.wait(<Future<void>>[first, second]);

    // The newer answer is the one left, which is the whole point of
    // serialising: with both in flight the stale page could have landed last
    // and written this back to "With an agent".
    expect(written, hasLength(2));
    expect(written.last.single.status, ChatStatus.closed);
    expect(fetch.calls, 2);
  });

  test('a burst collapses to ONE re-fetch, not one per ask', () async {
    final Future<void> first = refresher.refresh();
    expect(fetch.calls, 1);

    // Three more while #1 is still open — they share the single queued slot.
    refresher.refresh();
    refresher.refresh();
    refresher.refresh();
    expect(fetch.calls, 1);

    fetch.releaseOne();
    await pumpEventQueue();

    // One re-issue for all three…
    expect(fetch.calls, 2);

    fetch.releaseOne();
    await first;

    // …and then it stops, rather than chaining a fourth.
    expect(fetch.calls, 2);
    expect(written, hasLength(2));
    expect(refresher.isRefreshing, isFalse);
    expect(refresher.isRefreshQueued, isFalse);
  });

  test('an ask during a flight is re-issued, never dropped', () async {
    // The end-then-immediately-start-another sequence: the second ask used
    // to return silently, leaving the list on a page fetched before the new
    // conversation existed.
    final Future<void> first = refresher.refresh();
    final Future<void> second = refresher.refresh();
    expect(fetch.calls, 1);

    fetch.releaseOne();
    await pumpEventQueue();
    expect(fetch.calls, 2);

    fetch.releaseOne();
    await Future.wait(<Future<void>>[first, second]);

    // The queued caller is released only once the page ITS ask produced has
    // landed — not once the page that happened to be in flight when it
    // asked did.
    expect(written, hasLength(2));
  });

  test('the queued ask is re-issued even when the flight it waited on failed',
      () async {
    final Future<void> first = refresher.refresh();
    refresher.refresh();

    fetch.failOne(StateError('503'));
    await pumpEventQueue();

    expect(errors, hasLength(1));
    expect(fetch.calls, 2);

    fetch.releaseOne();
    await first;
    expect(written, hasLength(1));
  });

  test('a failure leaves the previous page standing, and does not wedge it',
      () async {
    final Future<void> first = refresher.refresh();
    fetch.releaseOne();
    await first;
    expect(written, hasLength(1));

    final Future<void> second = refresher.refresh();
    fetch.failOne(StateError('503'));
    await second;

    // Nothing written: a stale list still describes conversations that
    // exist, where an emptied one claims they do not.
    expect(written, hasLength(1));
    expect(errors, hasLength(1));
    expect(refresher.isRefreshing, isFalse);

    // And the next ask works — a failure is not a terminal state.
    final Future<void> third = refresher.refresh();
    expect(fetch.calls, 3);
    fetch.releaseOne();
    await third;
    expect(written, hasLength(2));
  });

  test('an empty page is written like any other — emptiness is not an error',
      () async {
    // A guest gets `200 {sessions: []}`. Turning that into a failure would
    // make "not identified" indistinguishable from "the lookup failed" at
    // exactly the seam that knows they are different.
    fetch.answer = <ChatSessionSummary>[];
    final Future<void> done = refresher.refresh();
    fetch.releaseOne();
    await done;

    expect(errors, isEmpty);
    expect(written, <List<ChatSessionSummary>>[<ChatSessionSummary>[]]);
  });

  test('a page landing after dispose is dropped, not written', () async {
    refresher.refresh();
    refresher.dispose();

    fetch.releaseOne();
    await pumpEventQueue();

    expect(written, isEmpty);
    // And no re-issue was chased after teardown.
    expect(fetch.calls, 1);
  });

  test('refresh after dispose is a no-op rather than a throw', () async {
    refresher.dispose();
    await refresher.refresh();

    expect(fetch.calls, 0);
    expect(written, isEmpty);
  });
}
