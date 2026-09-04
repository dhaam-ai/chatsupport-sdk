import 'package:dhaam_chat_flutter/src/ui/voice/voice.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('the taxonomy', () {
    test('every code has its own non-empty sentence', () {
      final Set<String> messages = <String>{};
      for (final VoiceErrorCode code in VoiceErrorCode.values) {
        final String message = voiceErrorMessage(code);
        expect(message.trim(), isNotEmpty, reason: code.name);
        messages.add(message);
      }
      expect(
        messages,
        hasLength(VoiceErrorCode.values.length),
        reason: 'two codes sharing one sentence is two codes that did not '
            'need to be separate',
      );
    });

    test('insecure-context and unsupported say different things', () {
      // The reference keeps these apart because "needs HTTPS" and "your
      // device is too old" send someone to two different places.
      expect(
        voiceErrorMessage(VoiceErrorCode.insecureContext),
        isNot(voiceErrorMessage(VoiceErrorCode.unsupported)),
      );
      expect(
        voiceErrorMessage(VoiceErrorCode.insecureContext).toLowerCase(),
        contains('https'),
      );
    });

    test('VoiceError.of carries the module copy, not a caller\'s', () {
      final VoiceError error = VoiceError.of(VoiceErrorCode.noMicrophone);
      expect(error.code, VoiceErrorCode.noMicrophone);
      expect(error.message, voiceErrorMessage(VoiceErrorCode.noMicrophone));
    });

    test('no message leaks anything the platform said', () {
      // §14. Every sentence is a fixed literal; none is built from an
      // exception, a device name or a path. Asserted by construction: the
      // same code always produces the same string.
      for (final VoiceErrorCode code in VoiceErrorCode.values) {
        expect(
          VoiceError.of(code).message,
          VoiceError.of(code).message,
        );
        expect(voiceErrorMessage(code), isNot(contains('Exception')));
      }
    });
  });

  group('canRetry — the reason the two permission codes are separate', () {
    test('a dismissed prompt can be asked again', () {
      expect(
          VoiceError.of(VoiceErrorCode.permissionDismissed).canRetry, isTrue);
    });

    test('a denied permission cannot', () {
      expect(VoiceError.of(VoiceErrorCode.permissionDenied).canRetry, isFalse);
    });

    test('the momentary failures are retryable and the settled ones are not',
        () {
      const Set<VoiceErrorCode> retryable = <VoiceErrorCode>{
        VoiceErrorCode.permissionDismissed,
        VoiceErrorCode.microphoneBusy,
        VoiceErrorCode.aborted,
      };
      for (final VoiceErrorCode code in VoiceErrorCode.values) {
        expect(
          VoiceError.of(code).canRetry,
          retryable.contains(code),
          reason: code.name,
        );
      }
    });

    test('unknown is not retryable', () {
      // Offering "Try again" for a failure nobody understands is how someone
      // ends up tapping a button six times.
      expect(VoiceError.of(VoiceErrorCode.unknown).canRetry, isFalse);
    });
  });

  group('voicePermissionError', () {
    test('granted is not an error', () {
      expect(voicePermissionError(VoicePermission.granted), isNull);
    });

    test('dismissed and denied map to their own codes', () {
      expect(
        voicePermissionError(VoicePermission.dismissed)?.code,
        VoiceErrorCode.permissionDismissed,
      );
      expect(
        voicePermissionError(VoicePermission.denied)?.code,
        VoiceErrorCode.permissionDenied,
      );
    });

    test('every permission value is mapped', () {
      for (final VoicePermission permission in VoicePermission.values) {
        expect(() => voicePermissionError(permission), returnsNormally);
      }
    });
  });

  group('classifyVoiceException', () {
    test('a missing plugin is unsupported — the case an unfilled seam hits',
        () {
      expect(
        classifyVoiceException(MissingPluginException('none')).code,
        VoiceErrorCode.unsupported,
      );
    });

    test('UnsupportedError is unsupported', () {
      expect(
        classifyVoiceException(UnsupportedError('no encoder')).code,
        VoiceErrorCode.unsupported,
      );
    });

    test('an adapter that names its own code keeps it', () {
      expect(
        classifyVoiceException(
          const VoiceDeviceException(VoiceErrorCode.noMicrophone),
        ).code,
        VoiceErrorCode.noMicrophone,
      );
    });

    test('anything else is recorderFailed, never a guess', () {
      expect(
        classifyVoiceException(StateError('mystery')).code,
        VoiceErrorCode.recorderFailed,
      );
      expect(
        classifyVoiceException(PlatformException(code: 'whatever')).code,
        VoiceErrorCode.recorderFailed,
      );
    });

    test('VoiceDeviceException carries a code and nothing else', () {
      // §14: anything it carried would be something the platform said.
      const VoiceDeviceException exception =
          VoiceDeviceException(VoiceErrorCode.microphoneBusy);
      expect(exception.toString(), 'VoiceDeviceException(microphoneBusy)');
    });
  });
}
