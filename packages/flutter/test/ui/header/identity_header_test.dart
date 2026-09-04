import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reproduces `packages/widget/test/identity-header.test.ts` (12 cases) and
/// the identity half of `identity-header-mount.test.ts`.
///
/// The mount file's other half — "does the widget mount T11's component rather
/// than a second hand-built `<h2>`" — is a DOM single-sourcing question
/// (`querySelectorAll('#dh-title')` returning exactly one node, the panel's
/// `aria-labelledby` still pointing at it). Flutter has no id space and no
/// `aria-labelledby`; the equivalent property is that there is one
/// [IdentityHeader] widget and one [isHandledByCurrent], which is a structural
/// fact rather than something a test can drift away from. What DOES transfer
/// is every case about identity following the session, and those are here.
const String kFallback = 'Acme Support';

const HandledBy agent =
    HandledBy(kind: HandledByKind.agent, id: 'agt_1', displayName: 'Ada');
const HandledBy bot =
    HandledBy(kind: HandledByKind.bot, id: 'bot_1', displayName: 'Assistant');

SessionSnapshot session({
  ChatStatus status = ChatStatus.assigned,
  HandledBy? handledBy,
}) =>
    SessionSnapshot(
      sessionId: 'sess_1',
      status: status,
      mode: ChatMode.human,
      participants: const <ParticipantSnapshot>[],
      createdAt: DateTime.utc(2026, 1, 1),
      handledBy: handledBy,
    );

void main() {
  group('isHandledByCurrent — the one gate', () {
    test('false for an absent handledBy, whatever the status says', () {
      for (final ChatStatus status in ChatStatus.values) {
        expect(isHandledByCurrent(session(status: status)), isFalse);
      }
    });

    test('false for a present handledBy while the session says it is waiting',
        () {
      expect(
        isHandledByCurrent(
          session(status: ChatStatus.waitingForAgent, handledBy: agent),
        ),
        isFalse,
      );
    });

    test('true for a present handledBy on every other status', () {
      for (final ChatStatus status in ChatStatus.values
          .where((ChatStatus s) => s != ChatStatus.waitingForAgent)) {
        expect(
          isHandledByCurrent(session(status: status, handledBy: agent)),
          isTrue,
          reason: '$status',
        );
      }
    });
  });

  group('absence — handledBy absent means "render my own title"', () {
    test('falls back when there is no session at all', () {
      expect(identityLabel(null, kFallback), kFallback);
      expect(identityKind(null), isNull);
    });

    test('falls back when handledBy is simply absent', () {
      expect(
        identityLabel(session(status: ChatStatus.waitingForAgent), kFallback),
        kFallback,
      );
      expect(
        identityLabel(session(status: ChatStatus.open), kFallback),
        kFallback,
      );
    });
  });

  group('presence — a current handledBy names the agent or the bot', () {
    test('shows the human agent once assigned', () {
      final SessionSnapshot s =
          session(status: ChatStatus.assigned, handledBy: agent);
      expect(identityLabel(s, kFallback), 'Ada');
      expect(identityKind(s), HandledByKind.agent);
    });

    test("shows the bot's own name while the bot handles it", () {
      final SessionSnapshot s =
          session(status: ChatStatus.open, handledBy: bot);
      expect(identityLabel(s, kFallback), 'Assistant');
      expect(identityKind(s), HandledByKind.bot);
    });
  });

  group('staleness — a reactivated session keeps a name the gate must reject',
      () {
    test(
        'renders the configured title, NOT the closing agent\'s name, when a '
        'reactivated session reports WAITING_FOR_AGENT with a stale handledBy',
        () {
      // A session reactivated from CLOSED/RESOLVED keeps its previous
      // assigned agent server-side, so handledBy can still name the agent who
      // closed it even though status has gone back to WAITING_FOR_AGENT.
      // Rendering "Ada" here would tell the customer someone is with them
      // when nobody is.
      final SessionSnapshot s =
          session(status: ChatStatus.waitingForAgent, handledBy: agent);
      expect(identityLabel(s, kFallback), kFallback);
      expect(identityLabel(s, kFallback), isNot(contains('Ada')));
      expect(identityKind(s), isNull);
    });
  });

  group('the rendered title', () {
    Future<void> pump(
      WidgetTester tester, {
      SessionSnapshot? session,
      String fallbackTitle = kFallback,
    }) =>
        tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: IdentityHeader(
                session: session,
                fallbackTitle: fallbackTitle,
              ),
            ),
          ),
        );

    testWidgets('starts on the configured title before any session exists',
        (WidgetTester tester) async {
      await pump(tester);
      expect(find.text(kFallback), findsOneWidget);
    });

    testWidgets('names the agent once one is handling the chat',
        (WidgetTester tester) async {
      await pump(tester);
      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
      );
      expect(find.text('Ada'), findsOneWidget);
      expect(find.text(kFallback), findsNothing);
    });

    testWidgets('falls back again when the agent leaves',
        (WidgetTester tester) async {
      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
      );
      await pump(tester, session: session(status: ChatStatus.waitingForAgent));
      expect(find.text(kFallback), findsOneWidget);
    });

    testWidgets(
        'does not narrate a stale agent on a session that went back '
        'to waiting', (WidgetTester tester) async {
      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
      );
      await pump(
        tester,
        session: session(status: ChatStatus.waitingForAgent, handledBy: agent),
      );
      expect(find.text(kFallback), findsOneWidget);
      expect(find.text('Ada'), findsNothing);
    });
  });

  group('the live-region announcement', () {
    /// The announcement currently on the semantics tree, or null.
    ///
    /// The Dart counterpart of the reference test reading
    /// `header.liveRegion.textContent`: a node that carries no visible layout
    /// and exists only while there is something to say.
    String? announcement(WidgetTester tester) {
      final Iterable<Semantics> live = tester
          .widgetList<Semantics>(find.byType(Semantics))
          .where((Semantics s) => s.properties.liveRegion ?? false);
      return live.isEmpty ? null : live.first.properties.label;
    }

    Future<void> pump(
      WidgetTester tester, {
      SessionSnapshot? session,
      String fallbackTitle = kFallback,
    }) =>
        tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: IdentityHeader(
                session: session,
                fallbackTitle: fallbackTitle,
              ),
            ),
          ),
        );

    testWidgets(
        'never announces on the very first build — that describes '
        'what was already true, not a live change',
        (WidgetTester tester) async {
      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
      );
      expect(find.text('Ada'), findsOneWidget);
      expect(announcement(tester), isNull);
    });

    testWidgets('announces once an agent joins mid-session',
        (WidgetTester tester) async {
      await pump(tester, session: session(status: ChatStatus.waitingForAgent));
      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
      );
      expect(announcement(tester), "You're now chatting with Ada.");
    });

    testWidgets('announces the reversion once an agent leaves',
        (WidgetTester tester) async {
      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
      );
      await pump(tester, session: session(status: ChatStatus.waitingForAgent));
      expect(announcement(tester), "You're now chatting with $kFallback.");
    });

    testWidgets(
        'does not re-announce when a rebuild carries no actual label '
        'change', (WidgetTester tester) async {
      // A cubit can emit for reasons unrelated to identity — a new session
      // object with the same handledBy. Repeating the announcement every time
      // would talk over whatever the user is reading.
      await pump(tester, session: session(status: ChatStatus.waitingForAgent));
      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
      );
      expect(announcement(tester), "You're now chatting with Ada.");

      await pump(
        tester,
        session: session(
          status: ChatStatus.assigned,
          handledBy: const HandledBy(
            kind: HandledByKind.agent,
            id: 'agt_1',
            displayName: 'Ada',
          ),
        ),
      );
      // Still the same sentence, not a second one — the watermark compares
      // the LABEL, so a fresh object naming the same person changes nothing.
      expect(announcement(tester), "You're now chatting with Ada.");
    });

    testWidgets(
        'does not announce a stale handledBy as though it were a real '
        'hand-off', (WidgetTester tester) async {
      await pump(tester, session: session(status: ChatStatus.waitingForAgent));
      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
      );

      // Reactivation: handledBy still says Ada, but the gate rejects it — so
      // the rendered (and thus announced) label is the fallback title, which
      // DOES differ from 'Ada'. This announces, but with the honest fallback
      // text, never Ada's name.
      await pump(
        tester,
        session: session(status: ChatStatus.waitingForAgent, handledBy: agent),
      );
      expect(announcement(tester), "You're now chatting with $kFallback.");
      expect(announcement(tester), isNot(contains('Ada')));
    });
  });

  group('a new fallback title — the setFallbackTitle contract', () {
    String? announcement(WidgetTester tester) {
      final Iterable<Semantics> live = tester
          .widgetList<Semantics>(find.byType(Semantics))
          .where((Semantics s) => s.properties.liveRegion ?? false);
      return live.isEmpty ? null : live.first.properties.label;
    }

    Future<void> pump(
      WidgetTester tester, {
      SessionSnapshot? session,
      required String fallbackTitle,
    }) =>
        tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: IdentityHeader(
                session: session,
                fallbackTitle: fallbackTitle,
              ),
            ),
          ),
        );

    testWidgets('repaints when the fallback is what is on screen',
        (WidgetTester tester) async {
      await pump(tester, fallbackTitle: 'Chat');
      expect(find.text('Chat'), findsOneWidget);
      await pump(tester, fallbackTitle: kFallback);
      expect(find.text(kFallback), findsOneWidget);
    });

    testWidgets("no-ops visually while an agent's name is showing",
        (WidgetTester tester) async {
      // An agent's name outranks a configured title; stamping over it would
      // rename the person the customer is talking to.
      final SessionSnapshot live =
          session(status: ChatStatus.assigned, handledBy: agent);
      await pump(tester, session: live, fallbackTitle: 'Chat');
      await pump(tester, session: live, fallbackTitle: kFallback);
      expect(find.text('Ada'), findsOneWidget);
      expect(find.text(kFallback), findsNothing);
    });

    testWidgets('is SILENT — a landed config fetch is not a hand-off',
        (WidgetTester tester) async {
      // Telling a screen-reader user "You're now chatting with Acme Support"
      // because a config fetch landed is a lie about an event that did not
      // happen.
      await pump(tester, fallbackTitle: 'Chat');
      await pump(tester, fallbackTitle: kFallback);
      expect(find.text(kFallback), findsOneWidget);
      expect(announcement(tester), isNull);
    });

    testWidgets(
        'and it clears a previous announcement rather than leaving it '
        'to be re-read', (WidgetTester tester) async {
      await pump(tester, fallbackTitle: kFallback);
      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
        fallbackTitle: kFallback,
      );
      expect(announcement(tester), "You're now chatting with Ada.");

      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
        fallbackTitle: 'Acme Help',
      );
      expect(announcement(tester), isNull);
      expect(find.text('Ada'), findsOneWidget);
    });

    testWidgets(
        'the watermark still moves, so a later hand-off is measured '
        'against what is displayed', (WidgetTester tester) async {
      await pump(tester, fallbackTitle: 'Chat');
      await pump(tester, fallbackTitle: kFallback);
      expect(announcement(tester), isNull);

      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
        fallbackTitle: kFallback,
      );
      expect(announcement(tester), "You're now chatting with Ada.");

      // And back to the NEW fallback, not the old one.
      await pump(
        tester,
        session: session(status: ChatStatus.waitingForAgent),
        fallbackTitle: kFallback,
      );
      expect(announcement(tester), "You're now chatting with $kFallback.");
    });
  });
}
