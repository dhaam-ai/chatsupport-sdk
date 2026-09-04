// Reproduces the MACHINE half of
// `packages/widget/test/csat-submit.test.ts:436-597` — the part that decides
// whether to ask at all, and whether a submit may be written.
//
// The UI half of that file (the locked card's `aria-checked` row, the comment
// shown as text, the ended footer) is `packages/flutter`'s to reproduce; this
// package has no widgets. What crosses over is every rule about DATA: which
// verdict offers a survey, which withholds one, and which refuses a write.

import 'dart:async';

import 'package:dhaam_chat/src/logic/csat.dart';
import 'package:test/test.dart';

/// A [CsatLookupFn] a test can steer, and hold open.
class FakeLookup {
  /// Every session id asked, in order — so "once, not per repaint" is
  /// observable rather than inferred.
  final List<String> asked = <String>[];

  /// What the next call answers with. Exactly one of these is set.
  CsatStatus? answer = const CsatUnrated();
  Object? failure;

  /// When set, calls block until it completes — the `loading` window.
  Completer<void>? gate;

  int get callCount => asked.length;

  Future<CsatStatus> call(String sessionId) async {
    asked.add(sessionId);
    final Completer<void>? held = gate;
    if (held != null) await held.future;
    final Object? thrown = failure;
    if (thrown != null) throw thrown;
    return answer!;
  }
}

/// Lets every pending microtask and zero-duration timer run.
Future<void> settle() => Future<void>.delayed(Duration.zero);

void main() {
  late FakeLookup lookup;
  late List<Object> reported;
  late CsatMachine machine;

  setUp(() {
    lookup = FakeLookup();
    reported = <Object>[];
    machine = CsatMachine(
      lookup: lookup.call,
      onError: (Object error, StackTrace _) => reported.add(error),
    );
  });

  tearDown(() => machine.dispose());

  group('the five states', () {
    test('starts loading, and shows no card while the lookup is in flight', () {
      lookup.gate = Completer<void>();

      expect(machine.lookupFor('s1'), isA<CsatLoading>());
      // A survey that appears and then locks itself is one the customer may
      // already have started answering.
      expect(machine.cardFor('s1'), isNull);
    });

    test('unrated is an ANSWER, and offers the survey', () async {
      lookup.answer = const CsatUnrated();
      machine.lookupFor('s1');
      await settle();

      expect(machine.lookupFor('s1'), isA<CsatUnrated>());
      final CsatCard? card = machine.cardFor('s1');
      expect(card, isNotNull);
      expect(card!.isAsk, isTrue);
      expect(card.existing, isNull);
    });

    test('rated shows the rating, locked', () async {
      lookup.answer = const CsatRated(rating: 4, comment: 'Sorted in a minute');
      machine.lookupFor('s1');
      await settle();

      final CsatCard? card = machine.cardFor('s1');
      expect(card, isNotNull);
      expect(card!.isAsk, isFalse);
      expect(card.existing,
          equals(const CsatRated(rating: 4, comment: 'Sorted in a minute')));
    });

    // The type system carries the distinction the plan asks for: of the five
    // states, exactly two are things the server said.
    test('unrated is distinguishable from a failed lookup by TYPE', () async {
      lookup.answer = const CsatUnrated();
      machine.lookupFor('answered');
      lookup.failure = StateError('boom');
      machine.lookupFor('failed');
      await settle();

      expect(machine.lookupFor('answered'), isA<CsatStatus>());
      expect(machine.lookupFor('failed'), isA<CsatUnknown>());
      expect(machine.lookupFor('failed'), isNot(isA<CsatStatus>()));
    });
  });

  // ── `when the CSAT lookup cannot be answered` ─────────────────────────
  group('when the lookup cannot be answered', () {
    test('withholds the survey rather than risk overwriting a rating',
        () async {
      // The documented direction: the two ways to be wrong are not symmetric.
      // Showing the survey on an unknown answer risks destroying a rating the
      // customer already gave; hiding it risks not collecting one. Only the
      // first loses data.
      lookup.failure = StateError('5xx');
      machine.lookupFor('s1');
      await settle();

      expect(machine.lookupFor('s1'), isA<CsatUnknown>());
      expect(machine.cardFor('s1'), isNull);
    });

    // "an ownership 404 withholds it too — that IS an answer about this
    // session." The distinction lives in `describes`, which refuses a 404 that
    // carries a structured code.
    test('an ownership 404 is NOT a missing route, and still withholds', () {
      expect(
        CsatRouteMissing.describes(status: 404, code: 'SESSION_NOT_FOUND'),
        isFalse,
      );
      expect(CsatRouteMissing.describes(status: 404, code: 'HTTP_404'), isTrue);
      expect(CsatRouteMissing.describes(status: 405, code: 'HTTP_405'), isTrue);
      // A code that names the other status is not this rule either.
      expect(
        CsatRouteMissing.describes(status: 404, code: 'HTTP_405'),
        isFalse,
      );
      expect(
          CsatRouteMissing.describes(status: 500, code: 'HTTP_500'), isFalse);
      expect(CsatRouteMissing.describes(status: null, code: null), isFalse);
    });

    test('reports the failure to the host', () async {
      final StateError boom = StateError('5xx');
      lookup.failure = boom;
      machine.lookupFor('s1');
      await settle();

      expect(reported, equals(<Object>[boom]));
    });

    // Retrying on every repaint would hammer a service that just failed, at a
    // rate set by how often the customer scrolls.
    test('remembers the failure rather than retrying it', () async {
      lookup.failure = StateError('5xx');
      machine.lookupFor('s1');
      await settle();
      for (int i = 0; i < 5; i += 1) {
        machine.cardFor('s1');
      }
      await settle();

      expect(lookup.callCount, equals(1));
    });
  });

  // ── `a deployment with no GET /csat route` ────────────────────────────
  group('a deployment with no CSAT read route', () {
    setUp(() {
      lookup.failure = const CsatRouteMissing();
    });

    test('still offers the survey', () async {
      machine.lookupFor('s1');
      await settle();

      expect(machine.lookupFor('s1'), isA<CsatUnsupported>());
      final CsatCard? card = machine.cardFor('s1');
      expect(card, isNotNull);
      expect(card!.isAsk, isTrue);
    });

    test('reports nothing to the host — an older service is not a fault',
        () async {
      machine.lookupFor('s1');
      await settle();

      expect(reported, isEmpty);
    });

    test('asks the missing route ONCE, not on every repaint', () async {
      machine.cardFor('s1');
      await settle();
      expect(lookup.callCount, equals(1));

      // Any state change repaints the surfaces; the verdict is cached, so no
      // second lookup goes out.
      for (int i = 0; i < 10; i += 1) {
        machine.cardFor('s1');
      }
      await settle();
      expect(lookup.callCount, equals(1));
    });

    // `unsupported` has nothing to re-ask and would fail again on every press.
    test('lets a submit through without re-asking', () async {
      machine.lookupFor('s1');
      await settle();
      final int before = lookup.callCount;

      expect(await machine.confirmedUnrated('s1'), isTrue);
      expect(lookup.callCount, equals(before));
    });

    // The other half of "once": the route stays missing, so nothing the
    // server says can ever lock this card. What stops it being offered twice
    // is the machine's own record of the write it watched succeed.
    test('is offered ONCE — the client\'s own write locks it', () async {
      // The first repaint is still `loading` and shows nothing; the ask
      // appears once the 404 has landed.
      expect(machine.cardFor('s1'), isNull);
      await settle();
      expect(machine.cardFor('s1')!.isAsk, isTrue);

      machine.recordSubmitted('s1', rating: 5);

      final CsatCard? card = machine.cardFor('s1');
      expect(card!.isAsk, isFalse);
      expect(card.existing, equals(const CsatRated(rating: 5)));
      // Still exactly the one lookup that failed at the start.
      expect(lookup.callCount, equals(1));
    });
  });

  group('asking once', () {
    test('one lookup serves every repaint', () async {
      machine.lookupFor('s1');
      await settle();
      for (int i = 0; i < 20; i += 1) {
        machine.lookupFor('s1');
      }
      await settle();

      expect(lookup.asked, equals(<String>['s1']));
    });

    test('repaints during the in-flight window do not stack up lookups',
        () async {
      lookup.gate = Completer<void>();
      for (int i = 0; i < 5; i += 1) {
        machine.lookupFor('s1');
      }
      lookup.gate!.complete();
      await settle();

      expect(lookup.callCount, equals(1));
    });

    test('each session is asked for separately', () async {
      machine.lookupFor('s1');
      machine.lookupFor('s2');
      await settle();

      expect(lookup.asked, equals(<String>['s1', 's2']));
    });

    test('announces the session whose verdict changed', () async {
      final List<String> changed = <String>[];
      machine.changes.listen(changed.add);
      await settle();

      machine.lookupFor('s1');
      await settle();

      expect(changed, equals(<String>['s1']));
    });
  });

  // ── `a rating that arrived from somewhere else while the card was open` ─
  group('a rating that arrived from somewhere else', () {
    test('refuses the write and transitions to rated', () async {
      lookup.answer = const CsatUnrated();
      machine.lookupFor('s1');
      await settle();
      expect(machine.cardFor('s1')!.isAsk, isTrue);

      // The other tab rates it 5. Nothing tells this machine.
      lookup.answer = const CsatRated(rating: 5, comment: 'Perfect');

      expect(await machine.confirmedUnrated('s1'), isFalse);

      // …and the card becomes the locked read-out of the rating that stands,
      // rather than claiming a score the server never took.
      final CsatCard? card = machine.cardFor('s1');
      expect(card!.isAsk, isFalse);
      expect(card.existing,
          equals(const CsatRated(rating: 5, comment: 'Perfect')));
    });

    test('a re-check that FAILS lets the submit through', () async {
      // The opposite asymmetry: a definite `unrated` is already on file — it
      // is why this is an ask — and the customer has just chosen a score.
      // Refusing to send it loses a rating for certain on the strength of a
      // blip that says nothing about whether one exists.
      lookup.answer = const CsatUnrated();
      machine.lookupFor('s1');
      await settle();

      lookup.failure = StateError('5xx');
      expect(await machine.confirmedUnrated('s1'), isTrue);

      // The card is still an ask — a failed re-check is not evidence of
      // anything, so it must not be recorded as `unknown`.
      expect(machine.lookupFor('s1'), isA<CsatUnrated>());
      expect(machine.cardFor('s1')!.isAsk, isTrue);
    });

    test('a re-check landing on unrated lets it through and changes nothing',
        () async {
      machine.lookupFor('s1');
      await settle();

      expect(await machine.confirmedUnrated('s1'), isTrue);
      expect(machine.lookupFor('s1'), isA<CsatUnrated>());
    });

    // The caller is still inside its own submit when this resolves. Repainting
    // it out from under itself mid-flight is how a surface ends up half torn
    // down, so the announcement lands on a LATER turn.
    test('announces the refusal after the submit turn, not during it',
        () async {
      final List<String> changed = <String>[];
      machine.changes.listen(changed.add);
      machine.lookupFor('s1');
      await settle();
      changed.clear();

      lookup.answer = const CsatRated(rating: 5);
      await machine.confirmedUnrated('s1');
      expect(changed, isEmpty, reason: 'must not repaint inside the submit');

      await settle();
      expect(changed, equals(<String>['s1']));
    });
  });

  group('recording a rating this client wrote', () {
    test('locks the card without another round trip', () async {
      machine.lookupFor('s1');
      await settle();
      final int before = lookup.callCount;

      machine.recordSubmitted('s1', rating: 3, comment: 'Fine');

      expect(lookup.callCount, equals(before));
      final CsatCard? card = machine.cardFor('s1');
      expect(card!.isAsk, isFalse);
      expect(
          card.existing, equals(const CsatRated(rating: 3, comment: 'Fine')));
    });

    test('an omitted comment is recorded as null, not as an empty string', () {
      machine.recordSubmitted('s1', rating: 3);
      expect(machine.cardFor('s1')!.existing!.comment, isNull);
    });

    // A round trip that started before the write has nothing to teach a
    // machine that watched the write succeed, and letting it land would flash
    // the survey back over a session that was just rated.
    test('a stale in-flight lookup cannot put the survey back', () async {
      lookup.gate = Completer<void>();
      lookup.answer = const CsatUnrated();
      machine.lookupFor('s1');

      machine.recordSubmitted('s1', rating: 2);

      lookup.gate!.complete();
      await settle();

      expect(machine.lookupFor('s1'), isA<CsatRated>());
      expect(machine.cardFor('s1')!.isAsk, isFalse);
    });

    // A client session can rate more than one conversation: end one, start
    // another, end that.
    test('remembers every session it rated, not just the last', () async {
      machine.recordSubmitted('s1', rating: 5);
      machine.recordSubmitted('s2', rating: 1);
      await settle();

      expect(machine.cardFor('s1')!.existing!.rating, equals(5));
      expect(machine.cardFor('s2')!.existing!.rating, equals(1));
      // Neither needed a lookup.
      expect(lookup.callCount, equals(0));
    });
  });

  group('the lookup seam', () {
    // The machine never learns a URL, a header or a status code — that is what
    // keeps `dhaam_chat` free of HTTP.
    test('a lookup can only produce the two ANSWERS, never the other three',
        () {
      // A compile-time property, asserted by construction: `CsatLookupFn`
      // returns `CsatStatus`, whose only subtypes are the two below.
      Future<CsatStatus> answersUnrated(String _) async => const CsatUnrated();
      Future<CsatStatus> answersRated(String _) async =>
          const CsatRated(rating: 1);

      expect(CsatMachine(lookup: answersUnrated).lookupFor('s'),
          isA<CsatLoading>());
      expect(
          CsatMachine(lookup: answersRated).lookupFor('s'), isA<CsatLoading>());
    });

    test('dispose closes the change stream and ignores late answers', () async {
      lookup.gate = Completer<void>();
      machine.lookupFor('s1');

      await machine.dispose();
      lookup.gate!.complete();

      // The late answer must not throw into a closed controller.
      await expectLater(settle(), completes);
    });
  });
}
