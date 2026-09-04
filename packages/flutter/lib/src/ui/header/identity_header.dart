/// Who the customer is talking to, in the panel header.
///
/// Ports `packages/widget/src/ui/identity-header.ts`.
///
/// ── The two semantics this file exists to get right ──────────────────────
///
/// [SessionSnapshot.handledBy] carries exactly one bit of presentation
/// information, and getting either half of it wrong tells the customer
/// something false:
///
///   1. ABSENT means "render your own configured title" — never "nobody is
///      handling this chat". `status`/`mode` carry that signal, not this
///      field. An absent `handledBy` must never blank the header, spin it, or
///      say "no agent". `dhaam_chat`'s own doc on that field says the same
///      thing, unprompted, because hosts kept reading it the other way.
///
///   2. PRESENT does not always mean CURRENT. A session reactivated from
///      CLOSED/RESOLVED keeps its previous agent server-side, so `handledBy`
///      can still name someone while `status` is back to `WAITING_FOR_AGENT`
///      — that person is not actually on the chat right now.
///
/// Both rules collapse into one call. [isHandledByCurrent] already returns
/// false for an absent `handledBy` (its first conjunct), so gating the whole
/// label on it handles rule 1 and rule 2 with a single branch: there is no
/// second, separate "is it absent" check to keep in sync with it.
library;

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:flutter/material.dart';

/// Whether [session]'s `handledBy` names somebody who is on the chat NOW.
///
/// The Dart counterpart of core's `isHandledByCurrent`
/// (`packages/core/src/client/session.ts:259`), ported verbatim:
///
/// ```ts
/// return session.handledBy !== undefined && session.status !== 'WAITING_FOR_AGENT';
/// ```
///
/// ── Why it lives here and not in `dhaam_chat` ────────────────────────────
///
/// `dhaam_chat` is where it belongs — it is a question about a protocol type,
/// and core is where TypeScript keeps it. It is here instead because this
/// package is its only consumer today and `dhaam_chat`'s barrel is not this
/// node's to reopen. If a second package ever needs it, move it down rather
/// than writing a second copy: two derivations of this fact is precisely the
/// stale-agent bug it exists to close.
///
/// ── Never re-derive this at a call site ──────────────────────────────────
///
/// Not `session.handledBy != null`, not a local `WAITING_FOR_AGENT` special
/// case. The title and the avatar beside it both come through here, which is
/// what keeps a face of Ada from sitting next to "Acme Support".
bool isHandledByCurrent(SessionSnapshot session) =>
    session.handledBy != null && session.status != ChatStatus.waitingForAgent;

/// The name to show, given a session and the widget's own configured title.
///
/// `session == null` is a legitimate input (no session yet, or one not
/// loaded) and always resolves to [fallbackTitle] — it is not a distinct
/// "error" state needing different handling.
String identityLabel(SessionSnapshot? session, String fallbackTitle) {
  if (session == null) return fallbackTitle;
  if (!isHandledByCurrent(session)) return fallbackTitle;
  // Read back through the object rather than force-unwrapped.
  // `isHandledByCurrent` guarantees this is non-null when it returns true,
  // but that is a compile-time guarantee about our own call sites, not a
  // runtime one about wire-sourced data.
  final HandledBy? handledBy = session.handledBy;
  return handledBy == null ? fallbackTitle : handledBy.displayName;
}

/// The kind of handler actually driving the title, or null.
///
/// A testing and styling hook for the identity DRIVING the title, not merely
/// for whether one is present: null covers both the fallback case and a stale
/// (not-current) `handledBy` alike, on purpose, since both render identical
/// copy.
HandledByKind? identityKind(SessionSnapshot? session) {
  if (session == null || !isHandledByCurrent(session)) return null;
  return session.handledBy?.kind;
}

/// The sentence the live region speaks on a real hand-off.
String identityAnnouncement(String label) => "You're now chatting with $label.";

/// The panel's title, and the announcement channel for identity CHANGES.
///
/// ── Why props rather than the reference's `update()`/`setFallbackTitle()` ─
///
/// `createIdentityHeader` is imperative: `update(session)` recomputes and may
/// speak, `setFallbackTitle(title)` recomputes and never speaks. Both rules
/// survive here, but they fall out of the props rather than out of two
/// methods a caller has to pick between:
///
///  * `setFallbackTitle` "only repaints when the fallback is what is
///    CURRENTLY on screen" — because an agent's name outranks a configured
///    title and stamping over it would rename the person the customer is
///    talking to. Here [identityLabel] simply recomputes: with an agent
///    current it returns the agent's name whatever [fallbackTitle] now says,
///    so the no-op is structural rather than a branch someone can drop.
///
///  * `setFallbackTitle` is SILENT. A screen-reader user told "You're now
///    chatting with Acme Support" because a config fetch landed would be a
///    lie about an event that did not happen. Here a [fallbackTitle] change
///    is recognised in [didUpdateWidget] and re-syncs the watermark without
///    announcing.
///
/// ── Never on the first build ─────────────────────────────────────────────
///
/// The first thing this widget renders describes whatever was ALREADY true
/// when the panel appeared — a resumed session an agent was already handling
/// — not a live hand-off. Announcing "you're now chatting with Ada" the
/// instant the widget mounts, for a fact that predates the mount, is the same
/// class of hostility as announcing forty backfilled messages on open. Same
/// discipline, and the same reason, as the message list's own first-state
/// suppression.
class IdentityHeader extends StatefulWidget {
  const IdentityHeader({
    super.key,
    required this.session,
    required this.fallbackTitle,
    this.style,
  });

  /// The session driving the identity, or null for none loaded.
  final SessionSnapshot? session;

  /// The widget's own configured title — `RemoteConfig.title`, or the host's.
  ///
  /// Shown whenever there is no CURRENT handler to name. Replacing it is the
  /// published-config path: it lands after mount and must be able to take
  /// over without announcing anything.
  final String fallbackTitle;

  final TextStyle? style;

  @override
  State<IdentityHeader> createState() => _IdentityHeaderState();
}

class _IdentityHeaderState extends State<IdentityHeader> {
  /// What is on screen right now. The watermark every announcement decision
  /// compares against — kept in step even when nothing is announced, so the
  /// NEXT change still compares against what is really displayed.
  ///
  /// Seeded in [initState], NOT as a `late` field initializer. A `late`
  /// initializer is evaluated on first READ, and the first read is inside
  /// [didUpdateWidget] — by which point `widget` is already the NEW one, so
  /// the watermark would seed itself to the value it is about to be compared
  /// against and the first real hand-off would announce nothing. Seeding here
  /// is what makes "never on the first build" mean the first build rather
  /// than the first change.
  String _currentLabel = '';

  /// The sentence to speak, or null when there is nothing to say.
  ///
  /// Cleared to null and re-set rather than held: a live region that is
  /// present the whole time is a node the platform may re-announce on an
  /// unrelated rebuild — the same rule `FormStatusLine` states for its own.
  String? _announcement;

  @override
  void initState() {
    super.initState();
    _currentLabel = identityLabel(widget.session, widget.fallbackTitle);
  }

  @override
  void didUpdateWidget(IdentityHeader oldWidget) {
    super.didUpdateWidget(oldWidget);
    final String label = identityLabel(widget.session, widget.fallbackTitle);

    // The `setFallbackTitle` path: published config landing. Silent, always —
    // see the class doc. The watermark still moves, so a genuine hand-off
    // after this still compares against what is displayed.
    if (widget.fallbackTitle != oldWidget.fallbackTitle) {
      _currentLabel = label;
      if (_announcement != null) setState(() => _announcement = null);
      return;
    }

    if (label == _currentLabel) return;
    _currentLabel = label;
    setState(() => _announcement = identityAnnouncement(label));
  }

  @override
  Widget build(BuildContext context) {
    final String label = identityLabel(widget.session, widget.fallbackTitle);
    final String? announcement = _announcement;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: widget.style ?? Theme.of(context).textTheme.titleMedium,
          ),
        ),
        // The announcement channel, separate from the title itself and
        // carrying no visible layout — the direct port of the reference's
        // dedicated `liveRegion` node, and for its stated reason: marking the
        // title live would re-announce it on every unrelated header
        // re-render, and folding it into the message log's region would race
        // whatever that is announcing at the same moment.
        if (announcement != null)
          Semantics(
            liveRegion: true,
            label: announcement,
            child: const SizedBox.shrink(),
          ),
      ],
    );
  }
}
