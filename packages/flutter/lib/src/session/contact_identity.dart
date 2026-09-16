/// The seam that forwards what the HOST already knows about this visitor —
/// and this device — to `POST /identify`.
///
/// ── The reported gap this file exists to answer ──────────────────────────
///
/// "The integrated developer will append these details to the SDK — we will
/// not. We use that detail, send to API backend via SDK." Every word of that
/// is a boundary, and this file is on the forwarding side of it.
///
/// So: this package ACCEPTS a device id, a push token and a platform from the
/// host and hands them on. It DISCOVERS nothing. There is no
/// `device_info_plus` here, no Firebase, no plugin added for this, and no
/// platform channel anywhere in this module asking what handset it is running
/// on — a library sitting between a host app and `dhaam_chat` taking a
/// discovery plugin would add a second answer to a question the app has
/// already answered, which is the same reasoning
/// `ChatWidgetCubit.setOnline` states for connectivity.
///
/// ── Nothing new is modelled, and no HTTP is written here ─────────────────
///
/// The whole contract already existed in `dhaam_chat_rest` and none of it
/// changes: `RestClient.identify` is the call, [RestIdentityProfile] is the
/// body and `RestIdentityDevice` is the `device` block on it. What was
/// missing was a caller — `packages/flutter` called none of it, so a host
/// holding a device token had nowhere to put it.
///
/// `RestDevicePlatform` is what keeps the casing right. `platform` is
/// `'ios' | 'android' | 'web'` LOWERCASE on the wire — the route's own
/// spelling, unlike every other enum in that package — and sending `'IOS'` is
/// a validation failure. Taking the enum rather than a `String` makes that
/// unspellable at the call site instead of discoverable in a 400.
///
/// ── Why a function, and not a REST client ────────────────────────────────
///
/// The same rule `SessionListFetch`/`restSessionSource` and
/// `MessageHistoryFetch`/`restMessageHistory` already follow on this class:
/// the SEAM stays function-typed so every test can drive it with a closure
/// and no network, and the REST-backed implementation of that seam is a named
/// function beside it. It is also what a host proxying chat through its own
/// backend needs — that host upserts its CRM contact somewhere that is not
/// `dhaam_chat_rest`, and a client-typed parameter would have no shape for it
/// to satisfy.
///
/// The seam and its REST half share ONE file here, where the session list and
/// the transcript each use two. That is not inconsistency: those two seams
/// are declared in REST-free vocabulary (`ChatSessionSummary`, `ChatMessage`)
/// and only their implementations touch the REST package, so the split buys a
/// REST-free declaration. This seam's own PARAMETER is a REST type, so a
/// separate declaration file would import `dhaam_chat_rest` anyway and buy
/// nothing but a second file to keep in step.
library;

import 'package:dhaam_chat_rest/dhaam_chat_rest.dart'
    show
        // `identify` is an extension ON `RestClient`, not a member of it:
        // without this in scope the call below does not resolve. Named
        // explicitly rather than importing the barrel wholesale so that stays
        // visible — the same rule `rest_session_source.dart` and
        // `rest_message_history.dart` follow for their own routes.
        MediaApi,
        RestClient,
        RestIdentityProfile;

// The seam's own parameter types, so a host filling it does not need a second
// import to name what it is handing over — and, more to the point, so
// `RestDevicePlatform` is in reach at the one call site where its casing
// matters. Same rule `rest_session_source.dart` applies to
// `RestChatSessionSummary` and `transcript_email.dart` to `RestIssueReport`.
export 'package:dhaam_chat_rest/dhaam_chat_rest.dart'
    show RestDevicePlatform, RestIdentityDevice, RestIdentityProfile;

/// Upserts [profile] as a CRM Contact. One call, one upsert.
///
/// ── The receipt is dropped, deliberately ─────────────────────────────────
///
/// `RestClient.identify` answers with a `RestIdentityResult` — `contactId`,
/// `externalId`, `lastLoginAt` — and this returns `Future<void>`. Nothing in
/// this package can use that receipt: it renders no contact id, stores none,
/// and none of the three is a value any screen here reads. Carrying it would
/// also oblige a host writing its own forwarder over its own backend to
/// FABRICATE one, which is a worse answer than not asking.
///
/// ── What a failure means ─────────────────────────────────────────────────
///
/// Throw, and the caller reports it to the host's own error channel. A failed
/// identify must never block or break chat — it is a CRM write about the
/// visitor, not a precondition for talking to anybody — so the only thing it
/// costs is a contact record that is less complete than it could be.
typedef ContactIdentifier = Future<void> Function(RestIdentityProfile profile);

/// A [ContactIdentifier] over `POST /identify`.
///
/// This is what `ChatWidgetCubit(rest: ...)` builds for itself once a
/// `contactProfile` is supplied. Call it directly only to route the same
/// upsert through a different client; there is nothing else to vary — the
/// route takes no options and this adds no policy of its own.
///
/// Nothing is retried in here, matching `RestClient.identify`'s own note that
/// a retry is a CALLER's decision: the Cubit re-arms on failure and the next
/// `connect()` asks again, which is a rule about when a panel opens rather
/// than about HTTP.
ContactIdentifier restContactIdentifier({required RestClient rest}) =>
    // A lambda and not a tear-off: `identify` returns a
    // `Future<RestIdentityResult>` and this seam promises `Future<void>`, so
    // the receipt is dropped HERE, where the doc above explains why, rather
    // than in an implicit widening at some call site.
    (RestIdentityProfile profile) async => rest.identify(profile);
