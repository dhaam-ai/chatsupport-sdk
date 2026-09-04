/// The seams `dhaam_chat_flutter` deliberately leaves injectable, filled in
/// with the real implementations a host is expected to supply.
///
/// ── Why this file is the point of the example ────────────────────────────
///
/// Every one of these is a function type or a one-method interface that the
/// package takes as a parameter rather than constructing for itself, so that
/// its own tests can pass a closure and never touch a platform channel or a
/// network. That property is worth having and it has a cost: nothing in the
/// package's 930 tests ever exercises the REAL implementations together. This
/// file is the first place they meet.
///
/// Each declaration below is CONSTRUCTED, not described. If
/// `filePickerAttachmentPicker` ever stops satisfying `AttachmentPicker`, or
/// `RestClient.uploadAttachment` changes shape, this file stops compiling —
/// which is the whole reason to write the recipe as code rather than as a
/// paragraph in the README.
///
/// ── Two of these have nowhere to be passed ───────────────────────────────
///
/// [exampleAttachmentDraft] and [exampleChime] are correct, compile against
/// the real APIs, and cannot currently be handed to the widget tree: neither
/// `ChatWidget` nor `ChatWidgetCubit` accepts them, and the only widgets that
/// would consume them are not mounted. See [seamReports], which says so on
/// screen rather than leaving a reader to discover it.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show TokenProvider;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart'
    show
        AttachmentDraftController,
        AttachmentPicker,
        AttachmentUploader,
        Chime,
        PickedAttachment,
        filePickerAttachmentPicker;
// `MediaApi` is an extension on `RestClient`, not a member of it: without it
// in scope `rest.uploadAttachment(...)` does not resolve. Named explicitly
// rather than importing the barrel wholesale so that stays visible.
import 'package:dhaam_chat_rest/dhaam_chat_rest.dart'
    show GeolocationProbe, MediaApi, RestClient, RestGeoPosition;
import 'package:flutter/foundation.dart';

/// The `getToken` callback both clients take.
///
/// ── This is the shape, and the example is not the example of it ──────────
///
/// A real host's body is `myBackend.mintChatToken()` — an HTTP call to its own
/// server, which holds the secret key. `ChatClient` re-reads this on every
/// connect and every reauth, so returning a fresh token from it is how a
/// refresh is picked up without restarting anything.
///
/// This one closes over a string from `--dart-define` and hands back the same
/// value every time, which means a run outlives its token by exactly as long
/// as the token had left. That is a limitation of the example, not of the SDK,
/// and it is the one place here where copying this file verbatim would be
/// wrong.
TokenProvider exampleTokenProvider(String token) => () async => token;

/// What this build calls itself, for `captureContactInfo`.
///
/// There is no `navigator.userAgent` in a Flutter app, so the host names
/// itself. [defaultTargetPlatform] rather than `dart:io`'s `Platform`: this
/// example builds for web, where `dart:io` is not available at all.
String exampleUserAgent() =>
    'dhaam_chat_flutter_example/1.0.0 (${defaultTargetPlatform.name})';

/// A [GeolocationProbe] that honours the contract by declining.
///
/// ── Why this declines rather than asking for a fix ───────────────────────
///
/// The seam's contract is three rules: resolve `null` and never reject, pass
/// the timeout to the platform API rather than racing a second timer, and
/// never re-prompt a visitor who has already declined. A real host satisfies
/// all three with a location plugin — `geolocator` is the usual choice, and
/// its `getCurrentPosition` takes the timeout directly.
///
/// This example does not add one, for a reason that is specific rather than
/// general: a location plugin obliges the host to declare permission strings
/// on iOS, macOS and Android, and this app's platform files carry exactly the
/// entries the SDK's own plugins documented and no invented ones. Adding four
/// permission declarations to demonstrate a value that has nowhere to go (see
/// [seamReports] on `captureContactInfo`) would be inventing host requirements
/// to exercise a dead path.
///
/// So: `null`, immediately, with the timeout unused and named as unused. The
/// visitor is never prompted, which is the correct behaviour for an app that
/// cannot ask.
Future<RestGeoPosition?> exampleGeolocationProbe(Duration timeout) async =>
    null;

/// Compile-time proof that [exampleGeolocationProbe] satisfies the seam.
///
/// A bare top-level function is not checked against a typedef until something
/// assigns it to one. This is that something.
const GeolocationProbe kExampleGeolocationProbe = exampleGeolocationProbe;

/// The real platform file chooser, as an [AttachmentPicker].
///
/// `filePickerAttachmentPicker` is the package's own one-line wrapper over
/// `FilePicker.pickFiles`; everything that can go wrong (the 25 MiB cap, the
/// bounded byte read, the media-type sniff, what a cancel looks like) lives
/// behind it in ordinary testable Dart. A host passes this tear-off; a test
/// passes a closure.
const AttachmentPicker kExampleAttachmentPicker = filePickerAttachmentPicker;

/// The real uploader: `POST /upload`, through the REST client.
///
/// [sessionId] is a callback rather than a value because the seam's signature
/// is `Future<AttachmentMetadata> Function(PickedAttachment)` — the session is
/// not one of its parameters, and the conversation a file belongs to can
/// change under a long-lived controller. Reading it at upload time is what
/// keeps a file from being posted against the session that was open when the
/// composer was built.
///
/// Note the absence of any `?? 'application/octet-stream'` on `mimeType`. That
/// is deliberate and is `uploadAttachment`'s own rule: an empty type means
/// "the platform said nothing" and gets the fallback inside that method, while
/// a non-empty malformed one still raises. Substituting here would collapse
/// the two cases at the one seam that can still tell them apart.
AttachmentUploader exampleAttachmentUploader(
  RestClient rest,
  String Function() sessionId,
) {
  return (PickedAttachment file) => rest.uploadAttachment(
        sessionId: sessionId(),
        bytes: file.bytes,
        fileName: file.fileName,
        mimeType: file.mimeType,
      );
}

/// The picker and the uploader, assembled into the controller that owns the
/// draft, the 25 MiB refusal and the in-flight flag.
///
/// **Nothing mounts this today** — see this library's header and
/// [seamReports]. It is built anyway because building it is what proves the
/// three pieces fit: the controller's constructor is what type-checks the
/// picker and the uploader against each other.
AttachmentDraftController exampleAttachmentDraft({
  required RestClient rest,
  required String Function() sessionId,
  required void Function(Object error, StackTrace stackTrace) onError,
}) {
  return AttachmentDraftController(
    picker: kExampleAttachmentPicker,
    uploader: exampleAttachmentUploader(rest, sessionId),
    onError: onError,
  );
}

/// The message-arrival chime, with the package's own default player.
///
/// `Chime()` with no factory uses `playSystemChime`, which is
/// `SystemSound.play(SystemSoundType.alert)` — Flutter's own, no audio plugin,
/// no asset, nothing for a host to bundle. That is why this seam needs no
/// dependency where the geolocation one would have needed a plugin and four
/// permission strings.
///
/// **Nothing constructs one of these inside the package**, so like
/// [exampleAttachmentDraft] this is built and not passed. Its `play` still
/// needs `sound` (the merchant's `RemoteConfig.sound`) and `muted` (the header
/// menu's per-visitor state) supplied on every call, and both live inside the
/// widget tree.
Chime exampleChime() => Chime();

/// Whether a seam is actually connected to the widget tree, or only built.
enum SeamWiring {
  /// Passed to the SDK. Exercised by running the app.
  wired,

  /// Constructed and type-checked here, but no public constructor parameter
  /// accepts it and no mounted widget consumes it.
  unreachable,
}

/// One seam, and the truth about it.
class SeamReport {
  const SeamReport({
    required this.name,
    required this.wiring,
    required this.detail,
  });

  final String name;
  final SeamWiring wiring;
  final String detail;
}

/// What this example was able to wire, and what it was not.
///
/// Rendered on the host page rather than buried in the README, because the
/// person this matters to is holding the running app and wondering why the
/// paperclip is missing. A parity gap that only exists in a document is a gap
/// somebody rediscovers.
const List<SeamReport> seamReports = <SeamReport>[
  SeamReport(
    name: 'ChatSessionActions',
    wiring: SeamWiring.wired,
    detail:
        'RestClient close/reopen/CSAT, passed to ChatWidgetCubit(sessionActions:). '
        'Without it there is no rating card, no ended footer and no way to end '
        'a conversation.',
  ),
  SeamReport(
    name: 'GeolocationProbe',
    wiring: SeamWiring.wired,
    detail:
        'Passed to captureContactInfo. Declines rather than prompting — this '
        'app adds no location plugin, so it cannot ask.',
  ),
  SeamReport(
    name: 'AttachmentPicker / AttachmentUploader',
    wiring: SeamWiring.unreachable,
    detail: 'Built in seams.dart and type-checked, but ChatWidget takes only a '
        'Cubit, ChatWidgetCubit takes no AttachmentDraftController, and '
        'conversation_screen.dart builds its Composer with no attach controls. '
        'There is no parameter to pass it to.',
  ),
  SeamReport(
    name: 'ChimePlayer',
    wiring: SeamWiring.unreachable,
    detail:
        'Chime() is built here, but nothing inside the package constructs one, '
        'so no message arrival reaches a player. Its play() also needs the '
        'header menu mute state, which is not mounted either.',
  ),
];
