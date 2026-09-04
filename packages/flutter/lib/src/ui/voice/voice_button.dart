/// The two controls the composer grows for voice: the microphone, and the
/// strip that shows a recording in progress.
///
/// The Flutter counterpart of `composer.ts`'s `micButton`, its `.dh-recording`
/// row and `setRecordingUi`.
///
/// ── Two widgets and a controller, matching the attachment module ─────────
///
/// The same shape `AttachmentAttachButton`/`AttachmentDraftBar`/
/// `AttachmentDraftController` use, and for the same reason: the button sits
/// inside the input's border while the strip sits above it, so they cannot be
/// one widget, and both have to read one answer to "is it recording". A
/// second copy of that flag is a second thing to leave stale.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import 'voice_error.dart';
import 'voice_recorder.dart';

/// Builds the platform half. Called at most once, on the first press.
///
/// Lazily, exactly as `Chime` builds its player: a widget nobody records with
/// should never have opened an audio device, and a host-supplied device may
/// hold a real handle that should not exist until there is something to
/// capture.
typedef VoiceDeviceFactory = VoiceDevice Function();

/// One composer's voice capture: whether it is recording, how long for, how
/// loud, and the one sentence it is currently telling the customer.
///
/// A [ChangeNotifier] for the reason `AttachmentDraftController` is one —
/// recording-ness is not private to the button that started it.
///
/// Owns a lifetime: every caller that constructs one must [dispose] it, and
/// that disposal is what hands the microphone back if the widget is torn down
/// mid-recording.
class VoiceCaptureController extends ChangeNotifier {
  VoiceCaptureController({required VoiceDeviceFactory createDevice})
      : _createDevice = createDevice;

  final VoiceDeviceFactory _createDevice;

  VoiceRecorder? _recorder;
  bool _recording = false;
  Duration _elapsed = Duration.zero;
  double _level = 0;
  VoiceError? _error;

  /// Guards `notifyListeners()` after the composer is gone — a tick can still
  /// be in flight when the conversation is torn down. Same guard, same
  /// reason, as `AttachmentDraftController`.
  bool _disposed = false;

  bool get isRecording => _recording;
  Duration get elapsed => _elapsed;

  /// The current input level, 0..1. Always in range and never NaN;
  /// [VoiceRecorder] guarantees it.
  double get level => _level;

  /// What went wrong, or `null`. Cleared by the next press.
  VoiceError? get error => _error;

  /// Whether a device has been built. Exposed so a test can assert the
  /// laziness rather than infer it.
  bool get isInitialised => _recorder != null;

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }

  /// Starts recording, or stops and hands back what was recorded.
  ///
  /// Returns the finished note, or `null` — which covers starting, a refused
  /// start, and a stop that produced nothing. `composer.ts`'s
  /// `toggleRecording`, with the attachment hop left to the caller because
  /// this module does not own the draft.
  Future<VoiceRecording?> toggle() async {
    final VoiceRecorder recorder = _recorder ??= VoiceRecorder(
      device: _createDevice(),
      onTick: _onTick,
    );

    if (recorder.isRecording) {
      final VoiceRecording? result = await recorder.stop();
      _setRecording(false);
      return result;
    }

    // Cleared before the attempt, not after it: a stale "permission denied"
    // sitting under a recording that has just started is worse than no
    // sentence at all. Same call `AttachmentDraftController.pick` makes.
    _error = null;
    final VoiceError? failure = await recorder.start();
    if (failure != null) {
      _error = failure;
      _setRecording(false);
      return null;
    }
    _setRecording(true);
    return null;
  }

  /// Abandons a recording without producing anything, and releases the
  /// device.
  Future<void> cancel() async {
    await _recorder?.cancel();
    _setRecording(false);
  }

  void _onTick(Duration elapsed, double level) {
    _elapsed = elapsed;
    _level = level;
    _notify();
  }

  void _setRecording(bool recording) {
    _recording = recording;
    if (!recording) {
      // `setRecordingUi(false)`'s own reset. Left over, the strip would
      // reappear on the next press already showing the last recording's
      // length.
      _elapsed = Duration.zero;
      _level = 0;
    }
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    // The microphone goes back even when the widget is torn down mid-
    // recording — see `VoiceRecorder`'s first guarantee for why a track left
    // open outlives the widget in the only place the customer can see.
    final VoiceRecorder? recorder = _recorder;
    _recorder = null;
    // Fire-and-forget: `VoiceRecorder.dispose` swallows its own failures
    // (§14), so there is nothing to await and nothing to catch. Spelled
    // with `unawaited` rather than left bare because `unawaited_futures` is
    // an error in this package — same call `Chime` makes.
    if (recorder != null) unawaited(recorder.dispose());
    super.dispose();
  }
}

/// The microphone. Starts and stops recording.
///
/// ── No device factory means NO BUTTON ────────────────────────────────────
///
/// Not a disabled one. `composer.ts` always renders its mic because a browser
/// that cannot record is rare; here a host that has not supplied a
/// [VoiceDevice] cannot record *ever*, and a button that greets every
/// customer with "This device cannot record audio" is an advertisement for a
/// feature nobody can use.
///
/// The same call `AttachmentAttachButton` makes for `RemoteConfig.fileUploads`
/// — an absent control says nothing, which is the truth.
class VoiceRecordButton extends StatelessWidget {
  const VoiceRecordButton({
    super.key,
    required this.controller,
    this.enabled = true,
    this.onRecorded,
  });

  /// `null` renders nothing at all. See this class's own doc.
  final VoiceCaptureController? controller;

  /// Whether the composer as a whole accepts input. Mirrors `composer.ts`'s
  /// `micButton.disabled = !enabled || uploading`.
  final bool enabled;

  /// A finished note. Never called for a start, a refusal or an empty stop.
  final ValueChanged<VoiceRecording>? onRecorded;

  @override
  Widget build(BuildContext context) {
    final VoiceCaptureController? capture = controller;
    if (capture == null) return const SizedBox.shrink();

    return ListenableBuilder(
      listenable: capture,
      builder: (BuildContext context, Widget? child) {
        final bool recording = capture.isRecording;
        return IconButton(
          key: const Key('composer.voice'),
          // The reference's own two `aria-label`s. A glyph names nothing on
          // its own, and the label has to change with the state or a screen
          // reader announces "record" on the control that stops it.
          tooltip: recording ? 'Stop recording' : 'Record a voice message',
          isSelected: recording,
          icon: Icon(recording ? Icons.stop : Icons.mic_none),
          onPressed: enabled ? () => _toggle(capture) : null,
        );
      },
    );
  }

  Future<void> _toggle(VoiceCaptureController capture) async {
    final VoiceRecording? recording = await capture.toggle();
    if (recording != null) onRecorded?.call(recording);
  }
}

/// The strip shown while recording, and the one sentence a refusal leaves
/// behind.
///
/// Renders nothing when there is neither. An always-present empty strip would
/// reserve vertical space the conversation could use and would give screen
/// readers a live region to re-announce on unrelated rebuilds — the same call
/// `AttachmentDraftBar` and `FormStatusLine` make.
class VoiceRecordingBar extends StatelessWidget {
  const VoiceRecordingBar({super.key, required this.controller});

  final VoiceCaptureController? controller;

  @override
  Widget build(BuildContext context) {
    final VoiceCaptureController? capture = controller;
    if (capture == null) return const SizedBox.shrink();

    return ListenableBuilder(
      listenable: capture,
      builder: (BuildContext context, Widget? child) {
        final VoiceError? error = capture.error;
        if (!capture.isRecording) {
          if (error == null) return const SizedBox.shrink();
          return _VoiceErrorLine(error: error);
        }
        return _RecordingStrip(
          elapsed: capture.elapsed,
          level: capture.level,
        );
      },
    );
  }
}

/// `composer.ts`'s `.dh-recording` row.
class _RecordingStrip extends StatelessWidget {
  const _RecordingStrip({required this.elapsed, required this.level});

  final Duration elapsed;
  final double level;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;

    return Padding(
      key: const Key('composer.voice.recording'),
      padding: const EdgeInsets.only(bottom: 6),
      // A live region, unlike the typing indicator: this one reports the
      // customer's OWN action, and "recording started" is the only
      // confirmation a non-sighted customer gets that the microphone actually
      // opened. The reference says exactly this about the same node.
      child: Semantics(
        liveRegion: true,
        container: true,
        excludeSemantics: true,
        label: 'Recording voice message',
        child: Row(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Icon(Icons.fiber_manual_record,
                  size: 12, color: scheme.error),
            ),
            Text(
              formatRecordingDuration(elapsed),
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(width: 8),
            // Decorative: the elapsed time above already carries the fact in
            // words, and a meter announced on every tick would talk over the
            // customer twenty times a second.
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: LinearProgressIndicator(
                  value: level,
                  minHeight: 4,
                  backgroundColor: scheme.surfaceContainerHighest,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The module's one sentence, announced without stealing focus.
class _VoiceErrorLine extends StatelessWidget {
  const _VoiceErrorLine({required this.error});

  final VoiceError error;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Padding(
      key: const Key('composer.voice.error'),
      padding: const EdgeInsets.only(bottom: 6),
      child: Semantics(
        liveRegion: true,
        child: Text(
          error.message,
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.error),
        ),
      ),
    );
  }
}

/// `m:ss`, from `composer.ts`'s own `formatDuration`.
///
/// Deliberately not `Duration.toString()`, which produces `0:00:03.000000`.
String formatRecordingDuration(Duration elapsed) {
  final int total = elapsed.inSeconds;
  final String seconds = (total % 60).toString().padLeft(2, '0');
  return '${total ~/ 60}:$seconds';
}
