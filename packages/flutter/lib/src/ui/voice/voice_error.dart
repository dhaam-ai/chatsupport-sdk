/// Why a voice recording could not start, in the words the customer sees.
///
/// Ports the failure taxonomy of `packages/widget/src/ui/voice.ts`, which is
/// the half of that module worth carrying across platforms. The recorder
/// itself is a `MediaRecorder` on one side and a platform channel on the
/// other; the taxonomy is neither, and it was earned rather than designed.
///
/// ── Two distinctions that look like hair-splitting and are not ───────────
///
///  * **[VoiceErrorCode.insecureContext] vs [VoiceErrorCode.unsupported].**
///    "This needs HTTPS" and "this device cannot record" send the customer to
///    two completely different places. Collapsing them tells someone on an
///    http:// page to go and buy a newer phone.
///  * **[VoiceErrorCode.permissionDismissed] vs
///    [VoiceErrorCode.permissionDenied].** Only one of them can be asked
///    again. That is not a shade of meaning — it decides whether the UI may
///    offer "Try again" (which will re-prompt) or must send the customer to
///    the system settings app. [VoiceError.canRetry] is where that decision
///    is actually read, so the distinction does something rather than merely
///    existing.
///
/// ── §14: nothing here is logged ──────────────────────────────────────────
///
/// Not the error, not the mime type, not the byte count, and above all not
/// the audio. Every message below is a fixed string written in advance: none
/// of them interpolates anything the platform said, so there is no path by
/// which a device name, a file path or a channel name reaches a screen — or a
/// host's error tracker — through this module.
library;

import 'package:flutter/services.dart' show MissingPluginException;

import 'voice_recorder.dart' show VoiceDevice;

/// The nine outcomes, verbatim from `voice.ts`.
///
/// Deliberately not widened. A tenth code would have to earn its place the
/// way these did: by naming a state that needs different words or a different
/// affordance from all nine.
enum VoiceErrorCode {
  /// The page is not a secure context. Web only, and distinct from
  /// [unsupported] because the fix is the URL, not the device.
  insecureContext,

  /// Nothing on this platform can record — no implementation is registered,
  /// or the device has no capture capability at all.
  unsupported,

  /// Refused, and the platform will NOT ask again. The customer has to change
  /// it in the system settings.
  permissionDenied,

  /// Refused by dismissing the prompt rather than answering it. The platform
  /// WILL ask again, so this is retryable in place.
  permissionDismissed,

  /// The platform has no capture device attached.
  noMicrophone,

  /// Something else on the device holds the microphone.
  microphoneBusy,

  /// Access was interrupted — a call arrived, the app was backgrounded.
  aborted,

  /// The recorder itself refused to start. The permission was fine.
  recorderFailed,

  /// Unclassified. Present so a [VoiceDevice] never has to invent a code, and
  /// deliberately last: reaching for this one is a signal that the adapter
  /// knows something it is not saying.
  unknown,
}

/// A failure, and the sentence that describes it.
///
/// Constructed through [VoiceError.of] rather than freely, so the copy for a
/// given code is written exactly once and no adapter can put its own words on
/// a shared code.
class VoiceError {
  const VoiceError._(this.code, this.message);

  /// The error for [code], with this module's own copy.
  factory VoiceError.of(VoiceErrorCode code) =>
      VoiceError._(code, voiceErrorMessage(code));

  final VoiceErrorCode code;

  /// Human-readable and safe to render.
  ///
  /// Never contains anything captured from the microphone, and never anything
  /// the platform said — see this library's header.
  final String message;

  /// Whether asking again could succeed **without leaving the app**.
  ///
  /// The whole reason [VoiceErrorCode.permissionDismissed] is a separate code
  /// from [VoiceErrorCode.permissionDenied]: a dismissed prompt re-prompts, a
  /// denied one does not. [VoiceErrorCode.microphoneBusy] and
  /// [VoiceErrorCode.aborted] join it because both describe a moment rather
  /// than a setting — the call ends, the other app lets go, and the same tap
  /// works.
  ///
  /// Everything else is false, including [VoiceErrorCode.unknown]: offering
  /// "Try again" for a failure nobody understands is how a customer ends up
  /// tapping a button six times.
  bool get canRetry => switch (code) {
        VoiceErrorCode.permissionDismissed => true,
        VoiceErrorCode.microphoneBusy => true,
        VoiceErrorCode.aborted => true,
        VoiceErrorCode.insecureContext => false,
        VoiceErrorCode.unsupported => false,
        VoiceErrorCode.permissionDenied => false,
        VoiceErrorCode.noMicrophone => false,
        VoiceErrorCode.recorderFailed => false,
        VoiceErrorCode.unknown => false,
      };

  @override
  String toString() => 'VoiceError(${code.name})';
}

/// The copy for [code].
///
/// Lifted from `voice.ts`, with one deliberate change: the reference says
/// "secure (HTTPS) page" because it only ever runs in one. This package also
/// runs on five platforms that have no page, so the sentence names the
/// connection instead. Every other string is the reference's own.
String voiceErrorMessage(VoiceErrorCode code) => switch (code) {
      VoiceErrorCode.insecureContext =>
        'Voice messages need a secure (HTTPS) connection.',
      VoiceErrorCode.unsupported => 'This device cannot record audio.',
      VoiceErrorCode.permissionDenied =>
        'Microphone permission was denied. You can turn it back on in '
            'settings.',
      VoiceErrorCode.permissionDismissed =>
        'Microphone permission prompt was dismissed.',
      VoiceErrorCode.noMicrophone => 'No microphone was found.',
      VoiceErrorCode.microphoneBusy =>
        'The microphone is in use by another application.',
      VoiceErrorCode.aborted => 'Microphone access was interrupted.',
      VoiceErrorCode.recorderFailed => 'Recording could not be started.',
      VoiceErrorCode.unknown => 'The microphone could not be started.',
    };

/// What the platform said when asked for the microphone.
///
/// The port's own vocabulary rather than any one plugin's, for the reason the
/// header gives: this is the distinction worth carrying, and a `Future<bool>`
/// — which is what the obvious plugins actually return — cannot carry it. An
/// adapter that genuinely cannot tell [dismissed] from [denied] must say
/// [denied], because that is the answer whose UI (send them to settings) is
/// merely unhelpful rather than wrong.
enum VoicePermission {
  /// The microphone may be used.
  granted,

  /// Refused, and the platform will ask again. Android's plain "Deny", and an
  /// iOS prompt that was never answered.
  dismissed,

  /// Refused, and the platform will not ask again. Android's "Don't ask
  /// again", iOS after any refusal, and a device under a policy that blocks
  /// the microphone outright.
  denied,
}

/// Maps a permission result to a code, or `null` when there is nothing wrong.
///
/// The Dart counterpart of `voice.ts`'s `classifyMediaError` — with the guess
/// taken out. The reference has to read `name` and then sniff `message` for
/// the substring "dismiss", because the browser expresses both refusals as an
/// identical `NotAllowedError`. Here the adapter is asked the question
/// directly instead, so nothing depends on a vendor's error prose.
VoiceError? voicePermissionError(VoicePermission permission) =>
    switch (permission) {
      VoicePermission.granted => null,
      VoicePermission.dismissed =>
        VoiceError.of(VoiceErrorCode.permissionDismissed),
      VoicePermission.denied => VoiceError.of(VoiceErrorCode.permissionDenied),
    };

/// Maps an exception thrown by a [VoiceDevice] to a code.
///
/// ── Only mappings that can be verified appear here ───────────────────────
///
/// [MissingPluginException] and [UnsupportedError] are Flutter's and Dart's
/// own, and both mean exactly one thing: nothing on this platform implements
/// the call. That is [VoiceErrorCode.unsupported], and it is the case a host
/// who has not filled the [VoiceDevice] seam will actually hit.
///
/// Everything else becomes [VoiceErrorCode.recorderFailed]. Deliberately NOT
/// a table of platform error codes: this package ships no recording plugin
/// (see `voice.dart`), so any such table would be transcribed from memory
/// rather than verified against a dependency — and a wrong code produces
/// confidently wrong copy, which is worse than the honest general one. An
/// adapter that knows its platform's codes should return the specific
/// [VoiceError] itself; that is why [VoiceDevice.start] is allowed to.
VoiceError classifyVoiceException(Object error) => switch (error) {
      MissingPluginException() => VoiceError.of(VoiceErrorCode.unsupported),
      UnsupportedError() => VoiceError.of(VoiceErrorCode.unsupported),
      VoiceDeviceException(:final VoiceErrorCode code) => VoiceError.of(code),
      _ => VoiceError.of(VoiceErrorCode.recorderFailed),
    };

/// The exception a [VoiceDevice] throws when it already knows which code
/// applies.
///
/// Exists so an adapter with real platform knowledge — one built on a
/// recording plugin, which this package deliberately does not ship — can
/// report [VoiceErrorCode.microphoneBusy] or [VoiceErrorCode.noMicrophone]
/// without this module having to guess at its error strings.
///
/// Carries a code and nothing else. No message, no cause, no stack: anything
/// it carried would be something the platform said, and §14 forbids that
/// reaching a screen.
class VoiceDeviceException implements Exception {
  const VoiceDeviceException(this.code);

  final VoiceErrorCode code;

  @override
  String toString() => 'VoiceDeviceException(${code.name})';
}
