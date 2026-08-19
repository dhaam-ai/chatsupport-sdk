import 'package:dhaam_chat/src/protocol/envelope.dart';
import 'package:dhaam_chat/src/protocol/errors.dart';
import 'package:dhaam_chat/src/resume/resume_tracker.dart';
import 'package:test/test.dart';

PushFrame push(String type, Map<String, Object?> d) => PushFrame(
      v: 1,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      ts: DateTime.utc(2026),
      type: type,
      d: d,
    );

void main() {
  group('anchor', () {
    test('is null before the first connect, so resumeFrom is omitted', () {
      // Absent means "fresh". Sending 0 would mean "replay the entire
      // session".
      expect(ResumeTracker().anchor, isNull);
    });

    test('adopts the ack seq on a fresh connect with no gap', () {
      final ResumeTracker tracker = ResumeTracker();
      expect(tracker.settleAck(40), isNull);
      expect(tracker.anchor, equals(40));
    });
  });

  group('observe', () {
    test('advances one at a time with no gap', () {
      final ResumeTracker tracker = ResumeTracker()..settleAck(10);
      expect(tracker.observe(11), isNull);
      expect(tracker.observe(12), isNull);
      expect(tracker.anchor, equals(12));
    });

    test('reports the span between a jump', () {
      final ResumeTracker tracker = ResumeTracker()..settleAck(10);
      final ResumeGap? gap = tracker.observe(15);
      expect(gap, equals(const ResumeGap(fromSeq: 11, toSeq: 14)));
      expect(gap!.length, equals(4));
      expect(tracker.anchor, equals(15));
    });

    test('ignores a duplicate without reporting a gap', () {
      // Replaying a frame already applied is D1's dedup working, not an error.
      final ResumeTracker tracker = ResumeTracker()..settleAck(10);
      expect(tracker.observe(10), isNull);
      expect(tracker.observe(3), isNull);
      expect(tracker.anchor, equals(10));
    });
  });

  group('the full resume exchange', () {
    test('a complete replay leaves no gap', () {
      // resumeFrom 10, server lastSeq 12, replay [11, 12].
      final ResumeTracker tracker = ResumeTracker()..settleAck(10);
      expect(tracker.observe(11), isNull);
      expect(tracker.observe(12), isNull);
      expect(tracker.settleAck(12), isNull);
      expect(tracker.anchor, equals(12));
    });

    test('the over-cap path surfaces as exactly one gap', () {
      // D2: more than 200 behind, the server sends NO replay and a truthful
      // seq. There are no frames to walk, so only the ack's own number reveals
      // the span. This is the check that catches it.
      final ResumeTracker tracker = ResumeTracker()..settleAck(10);
      final ResumeGap? gap = tracker.settleAck(300);
      expect(gap, equals(const ResumeGap(fromSeq: 11, toSeq: 300)));
      expect(tracker.anchor, equals(300));
    });

    test('a truncated replay is caught by the ack cross-check', () {
      // The server refuses to truncate, but a client whose correctness
      // depends on the server never doing so is relying on luck.
      final ResumeTracker tracker = ResumeTracker()..settleAck(10);
      expect(tracker.observe(11), isNull);
      final ResumeGap? gap = tracker.settleAck(40);
      expect(gap, equals(const ResumeGap(fromSeq: 12, toSeq: 40)));
    });

    test('a hole in the middle of a replay is caught by observe', () {
      final ResumeTracker tracker = ResumeTracker()..settleAck(10);
      expect(tracker.observe(11), isNull);
      expect(tracker.observe(14), equals(const ResumeGap(fromSeq: 12, toSeq: 13)));
      expect(tracker.settleAck(14), isNull);
    });

    test('never rewinds the anchor', () {
      final ResumeTracker tracker = ResumeTracker()..settleAck(50);
      expect(tracker.settleAck(40), isNull);
      expect(tracker.anchor, equals(50));
    });

    test('reset is the only recovery from an anchor ahead of the server', () {
      // The never-rewind rule means a client ahead of the server would keep an
      // impossible anchor forever. The server closes that hole out of band
      // with a VALIDATION_FAILED naming its own seq — an exchange the PRD
      // never describes.
      final ResumeTracker tracker = ResumeTracker()..settleAck(50);
      expect(tracker.settleAck(40), isNull);
      tracker.reset();
      expect(tracker.anchor, isNull);
      expect(tracker.settleAck(40), isNull);
      expect(tracker.anchor, equals(40));
    });
  });

  group('ordering is by seq, never by ts', () {
    test('frames arriving out of ts order still anchor by seq', () {
      // D2 is explicit that `ts` is informational. Two frames whose sender
      // clocks disagree — an agent's laptop and a bot server — must not
      // reorder anything.
      final ResumeTracker tracker = ResumeTracker()..settleAck(1);
      expect(tracker.observe(2), isNull);
      expect(tracker.observe(3), isNull);
      expect(tracker.anchor, equals(3));
    });
  });

  group('seqOf', () {
    test('reads seq from a sequenced push frame', () {
      expect(seqOf(push('message.new', <String, Object?>{'seq': 9})), equals(9));
    });

    test('accepts the double form Flutter Web produces', () {
      expect(
        seqOf(push('message.new', <String, Object?>{'seq': 9.0})),
        equals(9),
      );
    });

    test('returns null for an unsequenced frame rather than throwing', () {
      // typing.start carries no seq. Only some payloads are sequenced.
      expect(seqOf(push('typing.start', <String, Object?>{})), isNull);
    });

    test('returns null for a non-push frame', () {
      final ErrorFrame frame = ErrorFrame(
        v: 1,
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: DateTime.utc(2026),
        error: const ErrorPayload(
          code: ErrorCode.internal,
          message: 'x',
          retryable: true,
        ),
      );
      expect(seqOf(frame), isNull);
    });
  });
}
