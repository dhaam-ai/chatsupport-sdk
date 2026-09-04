/// Who the host page says this visitor is — and the ONE place the widget
/// decides whether that amounts to a guest.
///
/// ── Why this type exists at all ────────────────────────────────────────
///
/// `packages/widget/src/attributes.ts` is on the deliberately-not-ported
/// list precisely because `data-*` attributes cannot express this shape: a
/// nested object with an optional collection inside it. The Flutter analogue
/// the parity matrix names is "a typed Dart config object — strictly more
/// expressive", and this is that object. A host that has authenticated
/// somebody hands one of these in; a host that has not, does not.
///
/// ── The discriminator, stated once ────────────────────────────────────
///
/// A guest is a visitor whose [ChatIdentity.profile] is ABSENT. It is NOT "a
/// visitor with no user id": chat-service mints an id for every visitor the
/// moment the socket acks, so `userId == null` is false for everybody and a
/// gate built on it never fires for anybody.
///
/// That distinction is the whole reason [ChatIdentity.isGuest] is a getter
/// on a type rather than an expression at a call site. The reported bug —
/// the pre-chat form appearing on one path and not the other — was two call
/// sites answering this question two different ways, and neither of them was
/// obviously wrong when read on its own. There is now one answer, and the
/// only way to get it wrong is to change this line.
///
/// Everything downstream — `ProductSurfaceSlot.sync` through
/// `SurfaceSyncInputs.isGuest`, and all three field-bearing surfaces through
/// `preChatFieldsToAsk` — takes the ANSWER as a parameter. None of them
/// re-asks the question, which is what keeps the count at one.
library;

import 'package:equatable/equatable.dart';

/// What the host knows about a visitor it has authenticated.
///
/// Every field is optional because a host that has a signed-in customer may
/// still not have all of these to hand. Presence of the PROFILE is what
/// matters; presence of any particular field inside it is not — a host that
/// knows only that somebody is logged in passes `ChatParticipantProfile()`
/// and that visitor is correctly not a guest.
class ChatParticipantProfile extends Equatable {
  const ChatParticipantProfile({
    this.name,
    this.email,
    this.phone,
    this.attributes = const <String, String>{},
  });

  final String? name;
  final String? email;
  final String? phone;

  /// Merchant-defined extras. The nested-collection half of the shape
  /// `attributes.ts` could not carry.
  final Map<String, String> attributes;

  @override
  List<Object?> get props => <Object?>[name, email, phone, attributes];
}

/// The visitor, as the host describes them.
class ChatIdentity extends Equatable {
  const ChatIdentity({this.userId, this.profile});

  /// A visitor nobody has vouched for — the default, and what a host with no
  /// signed-in customer leaves in place.
  ///
  /// Deliberately carries no [userId] either, but note that supplying one
  /// would change NOTHING about [isGuest]: see this library's header.
  static const ChatIdentity guest = ChatIdentity();

  /// chat-service's id for this visitor.
  ///
  /// Carried because callers legitimately need it, and NOT consulted by
  /// [isGuest]. Every visitor has one of these — including the anonymous
  /// ones the pre-chat form exists to collect details from — so it cannot
  /// tell the two apart. Kept next to the getter that ignores it so the
  /// temptation to reach for it is answered on sight.
  final String? userId;

  /// What the host vouched for, or null when it vouched for nothing.
  final ChatParticipantProfile? profile;

  /// Whether nobody has vouched for this visitor.
  ///
  /// **This is the only derivation of this fact in the package.** Callers
  /// take the answer as a parameter; none of them recompute it. See the
  /// library header for what happened the last time there were two.
  bool get isGuest => profile == null;

  @override
  List<Object?> get props => <Object?>[userId, profile];
}
