import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/remote_config_fixtures.dart';

/// Reproduces `packages/widget/test/header-avatar.test.ts`.
///
/// The half that matters most there is AGREEMENT with the title beside it:
/// the title gates on `isHandledByCurrent` and the avatar rides the same gate,
/// so a face of Ada next to "Acme Support" (or the reverse) is the bug this
/// file exists to keep out. Every case below therefore checks the avatar and
/// the label together, exactly as the reference does.
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
  /// The merchant's configured brand face, so the fallback branch has
  /// something visible to fall back TO.
  RemoteConfig brand({
    String? avatarInitials = 'AC',
    AvatarMode? avatarMode,
    String? logoUrl,
    OfflineMode offlineMode = OfflineMode.showMessage,
    bool? isOpenNow,
  }) =>
      testRemoteConfig(
        avatarInitials: avatarInitials,
        avatarMode: avatarMode,
        logoUrl: logoUrl,
        offlineMode: offlineMode,
        isOpenNow: isOpenNow,
      );

  group('no agent — the brand face', () {
    test('shows the configured initials while nobody has picked the chat up',
        () {
      final SessionSnapshot s = session(status: ChatStatus.waitingForAgent);
      expect(
        resolveHeaderAvatar(session: s, config: brand()),
        const HeaderAvatarLetters('AC', isAgent: false),
      );
      expect(identityLabel(s, kFallback), kFallback);
    });

    test('shows the uploaded logo when the merchant chose one', () {
      expect(
        resolveHeaderAvatar(
          session: session(status: ChatStatus.waitingForAgent),
          config: brand(
            avatarMode: AvatarMode.logo,
            logoUrl: 'https://cdn.example.com/logo.png',
          ),
        ),
        const HeaderAvatarLogo('https://cdn.example.com/logo.png'),
      );
    });

    test('draws nothing when the merchant configured no brand face at all', () {
      // The pre-existing contract: no grey placeholder disc where a brand was
      // supposed to be.
      expect(
        resolveHeaderAvatar(
          session: session(status: ChatStatus.waitingForAgent),
          config: brand(avatarInitials: null),
        ),
        isNull,
      );
      expect(
        resolveHeaderAvatar(
          session: session(status: ChatStatus.waitingForAgent),
          config: brand(avatarInitials: '   '),
        ),
        isNull,
      );
    });

    test('draws nothing rather than a broken logo the allowlist refuses', () {
      expect(
        resolveHeaderAvatar(
          session: null,
          config: brand(
            avatarMode: AvatarMode.logo,
            logoUrl: 'javascript:alert(1)',
          ),
        ),
        isNull,
      );
    });

    test('caps the brand initials at two — a merchant may type a whole word',
        () {
      expect(
        resolveHeaderAvatar(
            session: null, config: brand(avatarInitials: 'Acme Co')),
        const HeaderAvatarLetters('Ac', isAgent: false),
      );
    });
  });

  group('an agent on the chat — their letter', () {
    test("shows the agent's first initial, agreeing with the title beside it",
        () {
      final SessionSnapshot s =
          session(status: ChatStatus.assigned, handledBy: agent);
      expect(
        resolveHeaderAvatar(session: s, config: brand()),
        const HeaderAvatarLetters('A', isAgent: true),
      );
      expect(identityLabel(s, kFallback), 'Ada');
    });

    test('flips from brand to agent when one takes the chat', () {
      expect(
        resolveHeaderAvatar(
          session: session(status: ChatStatus.open),
          config: brand(),
        ),
        const HeaderAvatarLetters('AC', isAgent: false),
      );
      expect(
        resolveHeaderAvatar(
          session: session(status: ChatStatus.open, handledBy: agent),
          config: brand(),
        ),
        const HeaderAvatarLetters('A', isAgent: true),
      );
    });

    test('refuses a stale handler exactly as the title does', () {
      // The reactivation shape: the server keeps the previous handler on the
      // record while status goes back to WAITING_FOR_AGENT. The title drops
      // Ada's name; a face of her lingering beside "Acme Support" would be
      // the avatar and the title disagreeing about whether she is present.
      final SessionSnapshot s =
          session(status: ChatStatus.waitingForAgent, handledBy: agent);
      expect(
        resolveHeaderAvatar(session: s, config: brand()),
        const HeaderAvatarLetters('AC', isAgent: false),
      );
      expect(identityLabel(s, kFallback), kFallback);
    });

    test(
        'letters a bot the same way, because the title names one the same '
        'way', () {
      final SessionSnapshot s =
          session(status: ChatStatus.open, handledBy: bot);
      expect(
        resolveHeaderAvatar(session: s, config: brand()),
        const HeaderAvatarLetters('A', isAgent: true),
      );
      expect(identityLabel(s, kFallback), 'Assistant');
    });

    test('falls back to the brand face for a blank display name', () {
      // A degenerate record, not a state the protocol promises. An empty disc
      // would be worse than the brand.
      final SessionSnapshot s = session(
        status: ChatStatus.assigned,
        handledBy: const HandledBy(
          kind: HandledByKind.agent,
          id: 'agt_1',
          displayName: '   ',
        ),
      );
      expect(
        resolveHeaderAvatar(session: s, config: brand()),
        const HeaderAvatarLetters('AC', isAgent: false),
      );
    });

    test('takes a whole code point, never half a surrogate pair', () {
      final SessionSnapshot s = session(
        status: ChatStatus.assigned,
        handledBy: const HandledBy(
          kind: HandledByKind.agent,
          id: 'agt_1',
          displayName: '𝒜da',
        ),
      );
      expect(
        resolveHeaderAvatar(session: s, config: brand()),
        const HeaderAvatarLetters('𝒜', isAgent: true),
      );
    });
  });

  group('out of hours — no avatar at all', () {
    test('hides the avatar while the leave-a-message surface is due', () {
      // A brand face floating above a "we're closed" form implies someone is
      // there to answer. The SAME predicate the surface is raised from.
      final RemoteConfig closed = brand(
        offlineMode: OfflineMode.collectMessage,
        isOpenNow: false,
      );
      expect(shouldCollectOffline(closed), isTrue);
      expect(resolveHeaderAvatar(session: null, config: closed), isNull);
      // Even with an agent on the chat: the surface is what is on screen.
      expect(
        resolveHeaderAvatar(
          session: session(status: ChatStatus.assigned, handledBy: agent),
          config: closed,
        ),
        isNull,
      );
    });

    test('keeps the brand face when the team is open', () {
      final RemoteConfig open = brand(
        offlineMode: OfflineMode.collectMessage,
        isOpenNow: true,
      );
      expect(shouldCollectOffline(open), isFalse);
      expect(
        resolveHeaderAvatar(session: null, config: open),
        const HeaderAvatarLetters('AC', isAgent: false),
      );
    });

    test('keeps the brand face under SHOW_MESSAGE even while closed', () {
      final RemoteConfig closedButShowing =
          brand(offlineMode: OfflineMode.showMessage, isOpenNow: false);
      expect(
        resolveHeaderAvatar(session: null, config: closedButShowing),
        const HeaderAvatarLetters('AC', isAgent: false),
      );
    });
  });

  group('the rendered disc', () {
    Future<void> pump(
      WidgetTester tester, {
      SessionSnapshot? session,
      required RemoteConfig config,
    }) =>
        tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: HeaderAvatar(session: session, config: config),
            ),
          ),
        );

    testWidgets('draws the letters', (WidgetTester tester) async {
      await pump(tester, config: brand());
      expect(find.text('AC'), findsOneWidget);
    });

    testWidgets('draws nothing at all — zero size, no placeholder disc',
        (WidgetTester tester) async {
      await pump(tester, config: brand(avatarInitials: null));
      expect(find.byType(DecoratedBox), findsNothing);
      expect(tester.getSize(find.byType(HeaderAvatar)), Size.zero);
    });

    testWidgets(
        'is hidden from assistive tech — the title beside it already '
        'names this person', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pump(
        tester,
        session: session(status: ChatStatus.assigned, handledBy: agent),
        config: brand(),
      );
      expect(find.text('A'), findsOneWidget);
      // No semantics node carries the letter: a screen reader would otherwise
      // read the initial and then the full name from the title.
      expect(find.bySemanticsLabel('A'), findsNothing);
      handle.dispose();
    });

    testWidgets('is drawn under the hero design too',
        (WidgetTester tester) async {
      // The hero design's face row only renders on Home, so suppressing the
      // header avatar under it left every hero-design conversation with no
      // avatar at all.
      await pump(
        tester,
        config: testRemoteConfig(
          avatarInitials: 'AC',
          design: WidgetDesign.hero,
        ),
      );
      expect(find.text('AC'), findsOneWidget);
    });
  });
}
