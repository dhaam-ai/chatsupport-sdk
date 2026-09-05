import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ChatScreens', () {
    test('starts on the given initial screen with nothing to go back to', () {
      final screens = ChatScreens(initial: ScreenName.home);
      expect(screens.current, ScreenName.home);
      expect(screens.canGoBack, isFalse);
    });

    test('go() navigates and enables back', () {
      final screens = ChatScreens(initial: ScreenName.home);
      screens.go(ScreenName.conversation);
      expect(screens.current, ScreenName.conversation);
      expect(screens.canGoBack, isTrue);
    });

    test('go() to the current screen is a no-op that does not grow the stack',
        () {
      final screens = ChatScreens(initial: ScreenName.home);
      screens.go(ScreenName.home);
      expect(screens.current, ScreenName.home);
      expect(screens.canGoBack, isFalse);
    });

    test('back() returns to wherever go() was called FROM, not a fixed screen',
        () {
      // Picked a conversation out of the Messages list: Home -> Messages -> Conversation.
      final screens = ChatScreens(initial: ScreenName.home);
      screens.go(ScreenName.messages);
      screens.go(ScreenName.conversation);

      expect(screens.back(), isTrue);
      expect(screens.current, ScreenName.messages);

      expect(screens.back(), isTrue);
      expect(screens.current, ScreenName.home);
    });

    test(
        'back() from a conversation opened off Home returns to Home, not Messages',
        () {
      // The same conversation screen, reached a different way, must remember
      // ITS OWN path back — this is the whole reason back() is a stack and
      // not "always go to Messages".
      final screens = ChatScreens(initial: ScreenName.home);
      screens.go(ScreenName.conversation);

      expect(screens.back(), isTrue);
      expect(screens.current, ScreenName.home);
    });

    test('back() answers false and does nothing when the stack is empty', () {
      final screens = ChatScreens(initial: ScreenName.home);
      expect(screens.back(), isFalse);
      expect(screens.current, ScreenName.home);
    });

    test('swap() changes the current screen without pushing', () {
      final screens = ChatScreens(initial: ScreenName.home);
      screens.go(ScreenName.conversation); // stack: [home]
      screens.swap(ScreenName.messages); // no push
      expect(screens.current, ScreenName.messages);
      expect(screens.canGoBack, isTrue); // the earlier go() is still there

      expect(screens.back(), isTrue);
      expect(screens.current, ScreenName.home);
    });

    test('reset() clears the stack and jumps straight to the given screen', () {
      final screens = ChatScreens(initial: ScreenName.home);
      screens.go(ScreenName.messages);
      screens.go(ScreenName.conversation);

      screens.reset(ScreenName.home);

      expect(screens.current, ScreenName.home);
      expect(screens.canGoBack, isFalse);
      expect(screens.back(), isFalse);
    });

    test('reset() to the screen already current still clears the stack', () {
      final screens = ChatScreens(initial: ScreenName.home);
      screens.go(ScreenName.messages);

      screens.reset(ScreenName.messages);

      expect(screens.current, ScreenName.messages);
      expect(screens.canGoBack, isFalse);
    });
  });
}
