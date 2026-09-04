/// The face beside the title — `widget.ts`'s `syncHeaderAvatar` and the two
/// builders it calls (`buildHeaderAvatar`, `buildAgentAvatar`).
///
/// ── The whole state machine, in precedence order ─────────────────────────
///
///   1. OUT OF HOURS (`shouldCollectOffline`) — no avatar at all. The panel
///      is showing the "leave a message" surface, and a face implies someone
///      is there to answer. The SAME predicate the offline surface is raised
///      from, so the two cannot disagree.
///   2. An agent (or bot) is on the chat — that handler's letter. Gated on
///      [isHandledByCurrent], the exact gate `identity_header.dart` names the
///      handler with, so the face and the name beside it always agree about
///      whether somebody is present. An absent `handledBy` and a stale one on
///      a reactivated session both fail it.
///   3. Otherwise — the merchant's configured brand face (logo or initials),
///      or NOTHING when they configured neither.
///
/// ── Nothing, not a placeholder ───────────────────────────────────────────
///
/// A merchant who configured no brand face gets no disc, not a grey circle
/// where a brand was supposed to be. [resolveHeaderAvatar] returns null and
/// [HeaderAvatar] renders zero size, which is the direct port of the
/// reference hiding its host and emptying it.
///
/// ── Drawn under every design ─────────────────────────────────────────────
///
/// This used to skip the hero design on the theory that its face row answers
/// "who am I talking to" — but that row only renders on Home, so a
/// hero-design conversation had no avatar at all. There is no design branch
/// here, deliberately.
library;

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter/material.dart';

import '../../config/remote_config.dart';
import '../../config/remote_config_client.dart';
import '../image_safety.dart';
import 'identity_header.dart';

/// Longest brand initials this will draw.
///
/// Two characters, because that is what fits: the console lets a merchant
/// type a whole word into a field rendered as a small disc, and three letters
/// overflow it. Sliced rather than refused — a merchant who typed their full
/// name meant the first letters of it.
const int kMaxBrandInitials = 2;

/// What the header avatar should draw right now, or null for nothing at all.
///
/// A sealed union rather than a nullable-field record, matching
/// `ProductSurface`'s own shape: the two cases carry different data and a
/// `switch` over them is exhaustive, so a third case added later is a compile
/// error at every render site rather than a silently unhandled branch.
sealed class HeaderAvatarContent extends Equatable {
  const HeaderAvatarContent();
}

/// The merchant's uploaded logo, already through [safeImageUrl].
final class HeaderAvatarLogo extends HeaderAvatarContent {
  const HeaderAvatarLogo(this.url);

  final String url;

  @override
  List<Object?> get props => <Object?>[url];
}

/// Letters on a disc.
final class HeaderAvatarLetters extends HeaderAvatarContent {
  const HeaderAvatarLetters(this.letters, {required this.isAgent});

  final String letters;

  /// Whether these letters name the PERSON handling the chat rather than the
  /// brand. One letter for a person, up to two for a company — the same
  /// reading the console's own agent chips use, and the difference the
  /// reference marks with a `dh-avatar-agent` class.
  final bool isAgent;

  @override
  List<Object?> get props => <Object?>[letters, isAgent];
}

/// The state machine, as a pure function.
///
/// No widget, no `BuildContext`: the precedence above is the part worth
/// asserting, and it is asserted directly rather than through a rendered
/// tree.
HeaderAvatarContent? resolveHeaderAvatar({
  required SessionSnapshot? session,
  required RemoteConfig config,
}) {
  // 1. A face above a "we're closed" form would imply someone is there.
  if (shouldCollectOffline(config)) return null;

  // 2. The one gate, shared with the title.
  if (session != null && isHandledByCurrent(session)) {
    final String? letter = _agentLetter(session.handledBy?.displayName);
    // A blank display name is a degenerate record, not a state the protocol
    // promises. Falling through to the brand face is better than an empty
    // disc — the same fallback the reference takes.
    if (letter != null) {
      return HeaderAvatarLetters(letter, isAgent: true);
    }
  }

  // 3. The brand, or nothing.
  return _brandAvatar(config);
}

HeaderAvatarContent? _brandAvatar(RemoteConfig config) {
  if (config.avatarMode == AvatarMode.logo) {
    final String? src = safeImageUrl(config.logoUrl);
    return src == null ? null : HeaderAvatarLogo(src);
  }
  final String initials = (config.avatarInitials ?? '').trim();
  if (initials.isEmpty) return null;
  return HeaderAvatarLetters(
    _firstRunes(initials, kMaxBrandInitials),
    isAgent: false,
  );
}

/// One character for a handler's disc, upper-cased.
///
/// `runes.first` rather than `substring(0, 1)`: a name beginning with an
/// astral character is two UTF-16 code units, and taking one of them yields
/// half a surrogate pair — a replacement glyph where the customer expected a
/// letter. Same rule the message list's own avatar letter uses.
String? _agentLetter(String? displayName) {
  final String trimmed = (displayName ?? '').trim();
  if (trimmed.isEmpty) return null;
  return String.fromCharCode(trimmed.runes.first).toUpperCase();
}

/// The first [count] code points of [value], for the same surrogate-pair
/// reason as [_agentLetter] — `substring(0, 2)` on "🎉A" yields half a pair.
String _firstRunes(String value, int count) =>
    String.fromCharCodes(value.runes.take(count));

/// The header's face.
///
/// ── Hidden from assistive tech ───────────────────────────────────────────
///
/// [IdentityHeader] beside it already names this person or this brand, out
/// loud, and does it from the same gate. A disc that also announced would
/// say the name twice — and the reference marks both of its builders
/// `aria-hidden` for exactly this reason.
class HeaderAvatar extends StatelessWidget {
  const HeaderAvatar({
    super.key,
    required this.session,
    required this.config,
    this.diameter = 32,
  });

  final SessionSnapshot? session;
  final RemoteConfig config;
  final double diameter;

  @override
  Widget build(BuildContext context) {
    final HeaderAvatarContent? content =
        resolveHeaderAvatar(session: session, config: config);
    if (content == null) return const SizedBox.shrink();

    final ColorScheme scheme = Theme.of(context).colorScheme;
    return ExcludeSemantics(
      child: SizedBox(
        width: diameter,
        height: diameter,
        child: switch (content) {
          HeaderAvatarLogo(url: final String url) => ClipOval(
              child: Image.network(url, fit: BoxFit.cover),
            ),
          HeaderAvatarLetters(letters: final String letters) => DecoratedBox(
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Text(
                  letters,
                  style: Theme.of(context)
                      .textTheme
                      .labelMedium
                      ?.copyWith(color: scheme.onPrimaryContainer),
                ),
              ),
            ),
        },
      ),
    );
  }
}
