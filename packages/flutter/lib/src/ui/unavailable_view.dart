/// The full-panel state for when the chat service cannot be reached at all.
/// Mirrors `ui/unavailable.ts`'s content and rationale; see [UnavailableView]
/// for what is deliberately NOT ported, and `chat_widget.dart` for when this
/// is shown rather than the normal Home/Messages/Conversation screens.
///
/// ── Why a whole panel rather than a status line ──────────────────────────
///
/// A status line and a "try again" control are the right weight for a blip
/// the client is still working through. They are the wrong weight for "we
/// have stopped trying": a customer looking at an empty transcript and a
/// composer that still accepts text has no reason to believe their message
/// is going nowhere. They type it, they wait, and nobody ever answers. Once
/// the client has given up, the panel says so plainly and offers the two
/// things that can still help: try again, or reach the merchant another way.
/// `chat_widget.dart` is what gates this on the client having actually given
/// up — see its own note on why that has to be a TERMINAL connection state,
/// never one still retrying.
///
/// ── The email is the merchant's, or there is none ────────────────────────
///
/// `RemoteConfig.supportEmail` is a console setting, and an ABSENT one shows
/// no link rather than a guess — see that field's own doc. An address nobody
/// monitors is worse than admitting there is no second route: the customer
/// waits on a reply that is never coming.
library;

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/remote_config.dart';
import '../theme/chat_theme.dart';

/// Longest local-part + domain this will offer as a link — RFC 5321's own
/// mailbox length cap, ported from `ui/unavailable.ts`'s identical `MAX_EMAIL`
/// rather than re-derived.
const int _kMaxSupportEmailLength = 254;

/// One address, no header-injection surface. Ported from `ui/unavailable.ts`'s
/// `safeMailto` REGEX verbatim (same character class, same order) rather than
/// re-derived: deliberately strict rather than clever, because the shape of
/// an email is exactly the kind of thing a permissive pattern gets wrong in
/// the direction that matters.
final RegExp _supportEmailPattern = RegExp(
  r'''^[^\s@,;:<>"'()[\]\\?&]+@[^\s@,;:<>"'()[\]\\?&]+\.[a-z]{2,}$''',
  caseSensitive: false,
);

/// [RemoteConfig.supportEmail] reduced to a `mailto:` [Uri] safe to hand to
/// `url_launcher`, or `null` for anything this cannot trust.
///
/// Kept separate from `remote_config.dart`'s own parsing (which only checks
/// that the leaf is a non-blank string — see that file's header on why every
/// leaf there is read, not validated) for the same reason `image_safety.dart`
/// keeps `safeImageUrl` out of the parser: a merchant-supplied string is
/// opaque until the one place that is about to actually USE it checks the
/// shape it needs. `Uri`'s own constructor percent-encodes `path`, so this
/// does not hand-build the string the way the JS original's DOM `href` does.
Uri? safeMailtoUri(String? value) {
  if (value == null) return null;
  final String address = value.trim();
  if (address.isEmpty || address.length > _kMaxSupportEmailLength) return null;
  if (!_supportEmailPattern.hasMatch(address)) return null;
  return Uri(scheme: 'mailto', path: address);
}

/// Renders `config.supportEmail` (via [safeMailtoUri]) and calls
/// [onTryAgain] — nothing else. A presentational widget, not a screen: it
/// does not read [ConnectionState] and does not know why it is on screen,
/// matching [HeroHeader]'s own split between "what to render" (this file)
/// and "when to render it" (its caller). `chat_widget.dart` is the one place
/// that decides THAT this belongs on screen right now.
///
/// ── What this does NOT do ────────────────────────────────────────────────
///
/// No "retrying…" sub-state, unlike `ui/unavailable.ts`'s `retrying` flag.
/// That flag exists there to cover the moment between a click and core's own
/// state actually changing. Here, [ChatWidgetCubit.connect] delegates to
/// `ConnectionController.connect`, which is already idempotent while a
/// connect is in flight (a second call reuses the same pending `Future`
/// rather than starting a second attempt — verified by reading
/// `packages/dart`'s `ConnectionController.connect`, not assumed) — and the
/// instant the state leaves a terminal one, `chat_widget.dart` swaps this
/// panel out on its own. There is no window here for a second tap to do
/// anything a disabled button would have prevented.
class UnavailableView extends StatelessWidget {
  const UnavailableView(
      {super.key, required this.config, required this.onTryAgain});

  final RemoteConfig config;

  /// Retries the connection — [ChatWidgetCubit.connect], passed down by
  /// `chat_widget.dart` rather than reached for here, so this widget stays
  /// ignorant of the Cubit the same way [HeroHeader] stays ignorant of it.
  final VoidCallback onTryAgain;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final double radius = chatCornerRadius(config);
    final Uri? emailUri = safeMailtoUri(config.supportEmail);

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            // Muted, not `scheme.error`: this is a status the panel is
            // reporting, not a mistake the customer made.
            Icon(Icons.error_outline, size: 48, color: scheme.onSurfaceVariant),
            const SizedBox(height: 16),
            Text(
              'Chat is temporarily unavailable',
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              "We couldn't reach the support service. Try again, or email us and "
              "we'll pick it up from there.",
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: onTryAgain,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(radius)),
              ),
              child: const Text('Try again'),
            ),
            if (emailUri != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: TextButton(
                  onPressed: () => launchUrl(emailUri),
                  child: Text(
                    // The address itself is the link text, not "email us": a
                    // customer who cannot reach the chat may want to copy it
                    // into their own mail client rather than trust a
                    // `mailto:` to open one — same reasoning
                    // `ui/unavailable.ts`'s own comment gives.
                    'Email ${config.supportEmail!.trim()}',
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
