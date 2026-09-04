/// Voice notes: the failure taxonomy, the recording lifecycle, and the mic
/// affordance the composer grows.
///
/// The Flutter counterpart of `packages/widget/src/ui/voice.ts` and the
/// `micButton` half of `packages/widget/src/ui/composer.ts`.
///
/// ── What a voice note IS here ────────────────────────────────────────────
///
/// Audio, not text. The reference records a blob, names it
/// `voice-message.webm`/`.m4a`, and hands it to the SAME attachment path a
/// picked file takes — the agent listens to it. That is worth stating up
/// front because the obvious-sounding Flutter package for "voice" is
/// `speech_to_text`, which does the opposite: it returns a transcript and
/// throws the audio away.
///
/// ── The dependency question, answered with numbers ───────────────────────
///
/// Both candidates were resolved by running `flutter pub add --dry-run`
/// against this package on the Dart 3.5.4 / Flutter 3.24.4 this repo pins,
/// not by assuming:
///
///  * **`record` 6.2.1** resolves (7.1.1 is reported incompatible), pulling
///    seven packages — `record` plus one federated implementation per
///    platform.
///  * **`speech_to_text` 7.4.0** resolves, pulling three.
///
/// So resolution is not the blocker, and neither is availability. Two other
/// things are.
///
/// **`speech_to_text` is the wrong feature.** It transcribes; `voice.ts`
/// records. Shipping it would change what the customer sends from their voice
/// to a machine's guess at their words, and would additionally oblige every
/// host to declare `NSSpeechRecognitionUsageDescription` for a capability
/// this port does not have. That is the same argument D24 used to decline
/// `image_picker`, and it applies more strongly here because the substitution
/// is not merely wider — it is different.
///
/// **`record` is the right feature and is deferred, not rejected.** Three
/// costs, and the third is the one that decides it:
///
///  1. It links native capture code on six platforms for every host of this
///     library, including the hosts that never show the button.
///  2. `record_ios` links `AVAudioRecorder`, so every host must add
///     `NSMicrophoneUsageDescription` to `Info.plist` or fail App Store
///     review — a cost paid at submission time by hosts who do not use the
///     feature.
///  3. **The recording it produces cannot currently reach the wire.** A note
///     becomes a message by becoming an attachment, and
///     `AttachmentDraftController` has no way to accept a draft that did not
///     come from its own picker. Adding a microphone dependency whose output
///     has no consumer would recreate, in the same commit, exactly the
///     "built but unreachable" pattern this wave exists to close.
///
/// So this module ships the whole of the portable half — the taxonomy, the
/// lifecycle, the release discipline, the meter, the button — behind
/// [VoiceDevice], and ships no plugin. A host that wants recording today
/// implements five methods; the day `AttachmentDraftController` can take a
/// draft from outside, this package can take `record: ^6.2.1` and supply
/// those five itself, and nothing above the seam changes.
///
/// ── Host permission entries, for whoever fills the seam ──────────────────
///
/// A package cannot write these for its host, so they are named here and in
/// the README rather than added anywhere:
///
///  * **iOS** — `NSMicrophoneUsageDescription` in `ios/Runner/Info.plist`.
///  * **Android** — `<uses-permission android:name="android.permission.RECORD_AUDIO" />`
///    in `android/app/src/main/AndroidManifest.xml`.
///  * **macOS** — `NSMicrophoneUsageDescription`, plus the
///    `com.apple.security.device.audio-input` entitlement in both
///    `macos/Runner/*.entitlements`.
///
/// `NSSpeechRecognitionUsageDescription` is deliberately NOT in that list. It
/// belongs to `speech_to_text`, which this module does not use and whose
/// feature it does not implement; asking a host to justify speech recognition
/// to Apple for a widget that only records audio would be asking them to
/// declare something untrue.
///
/// The example app at `packages/flutter/example/` is left untouched for the
/// same reason: it ships no recording plugin, so a microphone usage string
/// there would document a permission nothing in the build actually needs.
library;

export 'voice_button.dart';
export 'voice_error.dart';
export 'record_voice_device.dart';
export 'voice_recorder.dart';
export 'wav.dart';
