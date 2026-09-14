/// The one thing this app still decides about the session list: what its
/// developer strip says when there are no rows.
///
/// ── What this file used to test, and where that went ─────────────────────
///
/// A `toChatSessionSummary` field copy, an `exampleSessionListRefresher`
/// limit guard, and five tests driving `SessionListRefresher` directly. All
/// of that host code moved into the package, so its tests did too:
///
///  * the mapper and the limit guard are now
///    `test/state/rest_session_source_test.dart` in the package, where
///    `toChatSessionSummary` and `restSessionSource` live;
///  * the five refresher tests were already duplicates of the package's own
///    `test/ui/session_picker/session_list_refresher_test.dart`, which covers
///    each of them and four cases besides — they asserted the refresher's
///    behaviour, never this app's.
///
/// What is left below is the only session-list decision this app still makes
/// on its own, and it is the one that is easy to get wrong: refusing to call
/// an empty page a failure.
library;

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart'
    show kSessionListPageSize;
import 'package:dhaam_chat_flutter_example/session_list.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('exampleSessionListLine', () {
    test('says nothing once there are rows', () {
      // The list is on screen and speaking for itself; a strip repeating it
      // would be noise over the UI it is meant to help debug.
      expect(
        exampleSessionListLine(hasRows: true, isGuest: false),
        isNull,
      );
      expect(
        exampleSessionListLine(hasRows: true, isGuest: true),
        isNull,
      );
    });

    test('never calls an empty page an error', () {
      // The mistake `listSessions` documents at length: an empty page is a
      // 200, and reporting it as a failure makes "not identified"
      // indistinguishable from "the lookup failed".
      final String line =
          exampleSessionListLine(hasRows: false, isGuest: true)!;

      expect(line, contains('not an error'));
      expect(line.toLowerCase(), isNot(contains('failed to')));
    });

    test('names the empty page as the guest signal for a guest', () {
      final String line =
          exampleSessionListLine(hasRows: false, isGuest: true)!;

      expect(line, contains('guest signal'));
    });

    test('says something different for an identified visitor', () {
      // An empty page for someone holding a token is also fine, and worth
      // naming separately so nobody reads it as "the token was ignored" —
      // which is exactly what the two reporters concluded.
      final String line =
          exampleSessionListLine(hasRows: false, isGuest: false)!;

      expect(line, contains('identified visitor'));
      expect(line, isNot(contains('guest signal')));
    });

    test('quotes the page size the SDK actually asks for', () {
      // Not a number of this app's own any more. If the package changed its
      // default, a strip still quoting the old one would send an integrator
      // looking at the wrong request.
      expect(
        exampleSessionListLine(hasRows: false, isGuest: true),
        contains('limit $kSessionListPageSize'),
      );
    });

    test('does not claim a fetch has settled', () {
      // This app cannot know that any more — the Cubit owns the fetch and
      // reports a failure to FlutterError, not to a host callback. A line
      // asserting "0 results" would be a guess dressed as a fact.
      final String line =
          exampleSessionListLine(hasRows: false, isGuest: true)!;

      expect(line, contains('0 rows'));
      expect(line, contains('FlutterError'),
          reason: 'the strip has to say where a failure actually goes');
    });
  });
}
