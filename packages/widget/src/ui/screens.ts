// Which screen the panel is showing, and the way back.
//
// ── Why this exists ──────────────────────────────────────────────────────
//
// Until now the panel WAS the conversation: one transcript, one composer, and
// a handful of panes (`heroHeader`, the greeting, the chip row) shown or
// hidden by `syncPreConversationPanes` according to whether the transcript was
// empty. That is a screen switcher with one screen and an implicit rule, and
// every surface added to it made the rule longer.
//
// The reference product is three screens with a nav between them — Home,
// Messages, and one conversation — so the implicit rule becomes an explicit
// one here rather than a fourth condition inside a fifth function.
//
// ── The back stack is a stack, not a guess ───────────────────────────────
//
// "Back" from a conversation means the screen you came FROM: Messages if you
// picked it out of the list, Home if you tapped Recent. Deriving that from the
// current screen alone gets it wrong half the time, and getting it wrong sends
// someone who was browsing their history to a home screen they did not ask
// for. So the previous screen is pushed, and `back()` pops it.
//
// The stack is deliberately shallow — it is cleared when the panel closes,
// because a back button that remembers where you were three sessions ago is
// remembering something nobody asked it to.

/** The screens the panel can show. */
export type ScreenName = 'home' | 'messages' | 'conversation';

export interface ScreensView {
  /** The screen showing right now. */
  current(): ScreenName;
  /** Goes to `name`, remembering the current one so {@link back} can return. */
  go(name: ScreenName): void;
  /** Goes to `name` WITHOUT pushing — for a tab switch, which is not a drill-down. */
  swap(name: ScreenName): void;
  /** Returns to the previous screen. Answers `false` when there is nowhere to go. */
  back(): boolean;
  /** Whether a back affordance should be offered at all. */
  canGoBack(): boolean;
  /** Forgets the stack. Called when the panel closes. */
  reset(name: ScreenName): void;
}

export interface ScreensOptions {
  /** Run after every change, with the screen now showing. */
  readonly onChange: (name: ScreenName) => void;
  /** The screen a fresh panel opens on. */
  readonly initial: ScreenName;
}

export function createScreens({ onChange, initial }: ScreensOptions): ScreensView {
  let current: ScreenName = initial;
  const stack: ScreenName[] = [];

  const settle = (next: ScreenName): void => {
    if (next === current) return;
    current = next;
    onChange(current);
  };

  return {
    current: () => current,

    go(name) {
      // Pushed BEFORE the change and only when it is a real move, so a
      // double-tap on the same row does not stack two identical entries and
      // make Back a no-op the customer has to press twice.
      if (name === current) return;
      stack.push(current);
      settle(name);
    },

    swap(name) {
      // No push. Home and Messages are siblings in a tab bar: going between
      // them is not a drill-down, and treating it as one would build a back
      // history out of tab presses.
      settle(name);
    },

    back() {
      const previous = stack.pop();
      if (previous === undefined) return false;
      settle(previous);
      return true;
    },

    canGoBack: () => stack.length > 0,

    reset(name) {
      stack.length = 0;
      settle(name);
    },
  };
}
