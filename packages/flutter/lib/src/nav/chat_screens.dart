/// Which screen the panel is showing, and the way back — a direct port of
/// `packages/widget/src/ui/screens.ts`'s state machine.
///
/// ── Why this exists ──────────────────────────────────────────────────────
///
/// The reference product is three screens with a nav between them — Home,
/// Messages, and one conversation. [ChatScreens] is the explicit model of
/// that: which screen is current, and the back stack that makes "back" mean
/// "the screen you came from" rather than a guess.
///
/// ── The back stack is a stack, not a guess ─────────────────────────────
///
/// "Back" from a conversation means the screen you came FROM: Messages if
/// you picked it out of the list, Home if you tapped Recent. Deriving that
/// from the current screen alone gets it wrong half the time, and getting it
/// wrong sends someone who was browsing their history to a home screen they
/// did not ask for. So [go] pushes the outgoing screen, and [back] pops it.
///
/// The stack is deliberately shallow — [reset] clears it, called when the
/// panel closes, because a back button that remembers where you were three
/// sessions ago is remembering something nobody asked it to.
///
/// ── No `onChange` callback ─────────────────────────────────────────────
///
/// `screens.ts` takes one because vanilla DOM/TS has no state-container
/// convention of its own to lean on. This package does: the Cubit that owns
/// a [ChatScreens] (see `state/chat_widget_cubit.dart`) emits after every
/// call here, and `Equatable`-based state comparison downstream is what
/// suppresses a rebuild when a call turned out to be a no-op — the same
/// outcome `onChange`'s internal no-op guard produced, reached through the
/// mechanism this stack already has for it rather than a second one.
library;

enum ScreenName { home, messages, conversation }

class ChatScreens {
  ChatScreens({required ScreenName initial}) : _current = initial;

  ScreenName _current;
  final List<ScreenName> _stack = <ScreenName>[];

  /// The screen showing right now.
  ScreenName get current => _current;

  /// Whether a back affordance should be offered at all.
  bool get canGoBack => _stack.isNotEmpty;

  /// Goes to [name], remembering the current screen so [back] can return.
  void go(ScreenName name) {
    // Pushed BEFORE the change and only when it is a real move, so a
    // double-tap on the same row does not stack two identical entries and
    // make Back a no-op the customer has to press twice.
    if (name == _current) return;
    _stack.add(_current);
    _current = name;
  }

  /// Goes to [name] WITHOUT pushing — for a tab switch, which is not a
  /// drill-down. Home and Messages are siblings in a tab bar: going between
  /// them is not a drill-down, and treating it as one would build a back
  /// history out of tab presses.
  void swap(ScreenName name) {
    _current = name;
  }

  /// Returns to the previous screen. Answers `false` when there is nowhere
  /// to go — a caller (the root widget's system-back handling, typically)
  /// uses that to fall through to closing the panel instead.
  bool back() {
    final ScreenName? previous = _stack.isEmpty ? null : _stack.removeLast();
    if (previous == null) return false;
    _current = previous;
    return true;
  }

  /// Forgets the stack and jumps straight to [name]. Called when the panel
  /// closes.
  void reset(ScreenName name) {
    _stack.clear();
    _current = name;
  }
}
