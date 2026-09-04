/// Surface 1: the standalone picker screen — recent conversations, and a way
/// to start a fresh one. Ports `session-picker.ts`'s `createPreChatScreen`.
///
/// ── Named for what it picks, not for when it shows ──────────────────────
///
/// The TypeScript factory is called `createPreChatScreen` because of WHEN it
/// appeared: before the customer was in a chat. That name is already taken
/// here, by `ui/pre_chat/` — the guest-only gate that asks the merchant's
/// configured questions — and the two are unrelated surfaces answering
/// unrelated questions ("which conversation?" vs "who are you?"). Reusing
/// the word for both is how a reader ends up expecting one and finding the
/// other, so this is named for its job instead.
///
/// ── It never decides whether to be here ─────────────────────────────────
///
/// Handed an empty list it renders its heading, its empty-state row and its
/// start-new control — a complete, usable screen that says there is nothing
/// to pick and offers the only thing there is to do. Whether it is mounted
/// at all is `sessions.length > 0` asked by whoever owns the screen flow.
library;

import 'package:flutter/material.dart';

import '../../session/chat_session_summary.dart';
import 'session_row_list.dart';

/// The screen's own heading, and the name its list carries for a reader.
const String kSessionPickerHeading = 'Recent conversations';

/// What the screen says when the customer has no conversations yet.
///
/// The same sentence `MessagesScreen` uses for the same fact — one empty
/// list should not read two ways depending on which surface is asking.
const String kSessionPickerEmptyText = 'No previous conversations yet.';

class SessionPickerScreen extends StatelessWidget {
  const SessionPickerScreen({
    super.key,
    required this.sessions,
    required this.onSelect,
    required this.onStartNew,
    this.isStartingNew = false,
    this.autofocus = false,
    this.cornerRadius,
  });

  /// Rendered as given — see `SessionRowList.sessions`.
  final List<ChatSessionSummary> sessions;

  /// The customer picked a row, including a terminal one.
  final ValueChanged<String> onSelect;

  /// The customer asked for a fresh conversation instead of any listed one.
  final VoidCallback onStartNew;

  /// Whether a start is in flight, so one round trip cannot mint two
  /// sessions.
  ///
  /// A parameter rather than state of its own, for the same reason
  /// [sessions] is: the flight belongs to whoever is making the request, and
  /// a second copy of "are we starting?" here could disagree with it.
  final bool isStartingNew;

  /// Moves focus to the first meaningful control when the screen appears —
  /// the first row when there is one, and "start a new conversation" when
  /// there is not.
  ///
  /// The port of the TypeScript surface's imperative `focus()`, stated
  /// declaratively because Flutter has somewhere to put it: a caller
  /// revealing this screen passes `true` instead of having to remember a
  /// call after the reveal.
  final bool autofocus;

  /// See `SessionRowList.cornerRadius`.
  final double? cornerRadius;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      explicitChildNodes: true,
      label: kSessionPickerHeading,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
            child: Semantics(
              header: true,
              child: Text(
                kSessionPickerHeading,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
          ),
          Expanded(
            child: SessionRowList(
              sessions: sessions,
              // No notion of a current conversation on this surface: it is
              // shown when the customer is not in one, so nothing here is
              // marked. The switcher is the surface that has an answer.
              currentSessionId: null,
              onSelect: onSelect,
              listLabel: kSessionPickerHeading,
              emptyText: kSessionPickerEmptyText,
              autofocusFirstRow: autofocus && sessions.isNotEmpty,
              cornerRadius: cornerRadius,
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: SessionStartNewButton(
              onStartNew: onStartNew,
              busy: isStartingNew,
              autofocus: autofocus && sessions.isEmpty,
              cornerRadius: cornerRadius,
            ),
          ),
        ],
      ),
    );
  }
}
