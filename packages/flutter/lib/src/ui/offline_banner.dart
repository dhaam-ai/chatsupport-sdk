/// The bar that says the network is gone and the messages are safe.
///
/// ── Why a bar, and not a word in the app bar ─────────────────────────────
///
/// A subtitle is a caption: small, grey, in the one spot a customer stops
/// reading after the first visit because it usually says "Replies instantly".
/// Losing your signal mid-sentence is not caption-sized news.
///
/// And a caption cannot carry the half that matters — what happens to what
/// you have already typed. "You're offline" on its own reads as "stop
/// typing", so the customer stops, and the offline queue that would have
/// delivered their message the moment the signal returned never gets used.
/// The promise IS the feature. The composer stays enabled underneath this
/// precisely because the promise is true: `ChatClient` holds a send it cannot
/// write and replays the whole outbox, in order, on reconnect (§8.4).
///
/// ── Amber, not red ───────────────────────────────────────────────────────
///
/// Nothing has failed. Every message is held, the connection is retrying, and
/// the expected outcome is that all of it goes through. Red belongs to the
/// send the SERVER refused, which has its own affordance (`ChatClient.retry`).
/// A red bar for a tunnel teaches customers that the red bar means nothing.
///
/// ── The copy is the same sentence the web widget shows ───────────────────
///
/// Kept character-for-character in step with `resolveOfflineBanner` in
/// `@dhaam-ccrm/browser`, which `@dhaam-ccrm/widget` and `@dhaam-ccrm/react`
/// both render from. A merchant whose customers meet this SDK on the web and
/// in an app should not be told two different things about the same outage,
/// and the two languages cannot share a function — so they share a review
/// note instead, right here.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ConnectionState;
// Flutter's async.dart (re-exported through material.dart) declares a SECOND,
// unrelated ConnectionState — AsyncSnapshot's none/waiting/active/done. Hidden
// for the same reason chat_widget.dart hides it: this file means dhaam_chat's
// §8.1 one and never Flutter's, so resolving the name to what it actually
// means costs nothing.
import 'package:flutter/material.dart' hide ConnectionState;

/// Which of the two things has gone wrong.
enum OfflineBannerTone {
  /// The device has no network. The customer can act on this.
  offline,

  /// There is a network but chat cannot be reached. They cannot act on it, so
  /// the copy promises what we are doing instead.
  unreachable,
}

/// Everything the bar needs, decided once.
@immutable
class OfflineBannerView {
  const OfflineBannerView({
    required this.tone,
    required this.message,
    required this.queuedCount,
  });

  final OfflineBannerTone tone;

  /// The full sentence, already accounting for [queuedCount].
  final String message;

  /// How many composed messages are waiting on the connection. May be 0.
  final int queuedCount;

  @override
  bool operator ==(Object other) =>
      other is OfflineBannerView &&
      other.tone == tone &&
      other.message == message &&
      other.queuedCount == queuedCount;

  @override
  int get hashCode => Object.hash(tone, message, queuedCount);
}

/// How many consecutive failed attempts before an outage stops being a blip.
///
/// One failure is the commonest event the transport has — a wifi handover, a
/// carrier handoff, an app returning from the background — and the client is
/// usually back inside a second. A bar on the FIRST failure would flash
/// constantly on a healthy connection, for a condition that resolves before
/// the customer finishes reading it. Two consecutive failures is the cheapest
/// honest evidence that something is actually wrong.
///
/// The same number as `OUTAGE_ATTEMPT_THRESHOLD` in `@dhaam-ccrm/browser`.
const int kOutageAttemptThreshold = 2;

/// The single decision behind the bar.
///
/// Returns `null` when there is nothing worth saying — which is most of the
/// time, including during a healthy first connect and a single blip. A banner
/// that appears for every reconnect teaches customers to ignore banners.
///
/// ── The precedence ───────────────────────────────────────────────────────
///
/// [ConnectionState.closed] and [ConnectionState.suspended] are silent before
/// anything else is considered. `closed` is the host's own `disconnect()`, not
/// a fault. `suspended` is a credential or protocol failure that no amount of
/// network will fix, and the client has stopped retrying — so "your messages
/// will send when you're back online" would be a straight lie there. That
/// state has its own whole-screen panel (`UnavailableView`).
///
/// Then [online] `== false` wins over EVERYTHING, `connected` included. That
/// looks wrong for about a second, and is the most important line here: the
/// platform reporting no route is a hard fact, while a socket reporting itself
/// open is not. A socket whose route has gone is half-open — it stays "open"
/// until a write fails or a keepalive expires, which on mobile is tens of
/// seconds — and during all of it a customer who has just watched their signal
/// bar empty is typing into something that cannot deliver.
///
/// Only after that does `connected` short-circuit, which is the case the
/// asymmetry protects: [online] `== true` is not evidence of anything (a hotel
/// wifi nobody paid for, a dropped VPN, a cell association with no data), so it
/// must never on its own suppress the bar — but an open socket may, because
/// that IS evidence.
OfflineBannerView? resolveOfflineBanner({
  required ConnectionState connectionState,
  required bool online,
  required int failedAttempts,
  required int queuedCount,
}) {
  if (connectionState == ConnectionState.closed ||
      connectionState == ConnectionState.suspended) {
    return null;
  }

  // Before the connection state and before the attempt count. "There is no
  // network" is more specific and more actionable than "we cannot reach the
  // server", it is the REASON any attempts are failing rather than a separate
  // fact, and it needs no failure count behind it — the device told us.
  if (!online) {
    return OfflineBannerView(
      tone: OfflineBannerTone.offline,
      message: _offlineMessage(queuedCount),
      queuedCount: queuedCount,
    );
  }

  if (connectionState == ConnectionState.connected) return null;

  if (failedAttempts >= kOutageAttemptThreshold) {
    return OfflineBannerView(
      tone: OfflineBannerTone.unreachable,
      message: _unreachableMessage(queuedCount),
      queuedCount: queuedCount,
    );
  }

  return null;
}

String _plural(int count) => count == 1 ? '1 message' : '$count messages';

String _offlineMessage(int queuedCount) => queuedCount == 0
    ? 'You’re offline. Messages will send when you’re back online.'
    : 'You’re offline. ${_plural(queuedCount)} will send when you’re back online.';

String _unreachableMessage(int queuedCount) => queuedCount == 0
    ? 'Can’t reach chat — still trying.'
    : 'Can’t reach chat — ${_plural(queuedCount)} will send when we reconnect.';

/// The two colour pairs, light and dark.
///
/// Fixed values rather than anything pulled from the merchant's published
/// accent, and that is deliberate for the same reason the web widget's band is
/// not tinted with the merchant's brand: a status colour that follows the
/// brand goes invisible on the merchant whose brand it matches, and this is the
/// one surface whose whole job is to be noticed.
class _ToneColors {
  const _ToneColors(this.background, this.foreground, this.border);
  final Color background;
  final Color foreground;
  final Color border;
}

const Map<OfflineBannerTone, _ToneColors> _lightTones =
    <OfflineBannerTone, _ToneColors>{
  OfflineBannerTone.offline:
      _ToneColors(Color(0xFFFEF4E6), Color(0xFF7A4A02), Color(0xFFF3DDB8)),
  OfflineBannerTone.unreachable:
      _ToneColors(Color(0xFFFDECE9), Color(0xFF8A2C1C), Color(0xFFF6CFC7)),
};

const Map<OfflineBannerTone, _ToneColors> _darkTones =
    <OfflineBannerTone, _ToneColors>{
  OfflineBannerTone.offline:
      _ToneColors(Color(0xFF3A2C12), Color(0xFFFBDCA6), Color(0xFF55411B)),
  OfflineBannerTone.unreachable:
      _ToneColors(Color(0xFF3D201A), Color(0xFFF9C8BD), Color(0xFF5A2F26)),
};

/// Renders [view], or nothing at all when it is `null`.
///
/// Mount it above the transcript and leave it there: it is hidden on a healthy
/// connection and on a single blip, and it survives navigation between Home,
/// Messages and a conversation, because losing your signal is a fact about the
/// whole panel rather than about any one screen.
///
/// Announced through [Semantics.liveRegion] rather than as an alert: the
/// platform speaks it at the next pause instead of interrupting whatever is
/// being read, and a dropped wifi does not earn an interruption.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key, required this.view});

  final OfflineBannerView? view;

  @override
  Widget build(BuildContext context) {
    final OfflineBannerView? current = view;
    // `SizedBox.shrink`, not `Offstage`/`Visibility`: there is no state inside
    // worth preserving across the gap, and an empty box keeps the Column above
    // it honest about its own height.
    if (current == null) return const SizedBox.shrink();

    final bool isDark = Theme.of(context).brightness == Brightness.dark;
    final _ToneColors colors =
        (isDark ? _darkTones : _lightTones)[current.tone]!;

    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: colors.background,
          border: Border(bottom: BorderSide(color: colors.border)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.wifi_off_rounded, size: 18, color: colors.foreground),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                current.message,
                style: TextStyle(
                  fontSize: 12.5,
                  height: 1.4,
                  color: colors.foreground,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
