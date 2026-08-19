/// Resume anchoring and gap detection — PRD §8.3, §0.5 D2.
///
/// D2: "`seq` — never `ts` — is core's ordering key and gap-detection signal
/// (a `seq` jump means refetch)." This module is the whole of that rule. It
/// holds one integer, the ANCHOR: the highest `seq` this client has fully
/// applied. That integer is what goes out as `connection.hello.d.resumeFrom`,
/// and every inbound `seq` is checked against it.
///
/// ── The two checks, and why one is not enough ─────────────────────────────
///
/// [observe] walks the frames actually delivered and reports a jump BETWEEN
/// them. [settleAck] then adopts the ack's own `seq` and reports anything the
/// ack CLAIMED to be current as of but never delivered.
///
/// The second check is the one that catches D2's over-cap path. When a client
/// is more than 200 frames behind, the server sends NO replay and a truthful
/// `seq`; there are no frames for [observe] to walk, and only the ack's own
/// number reveals that a span went missing. The same check also covers the
/// undocumented case where the server's replay read or projection failed — it
/// omits `replay` and still acks truthfully, which degrades into the identical
/// signal.
///
/// ── SPEC GAP ──────────────────────────────────────────────────────────────
///
/// None of this is in §8.3, which predates D2 and still describes `resumeFrom`
/// as "the id/seq of the last frame" and leaves inline-replay-vs-REST-cursor
/// open. §0.4 row 2 records the over-cap behaviour in one clause ("which the
/// client reads as one gap") and never says what a client must do to read it
/// that way. `connection.ack.d.seq` — the anchor this whole module turns on —
/// is named nowhere in the PRD.
library;

import '../protocol/envelope.dart';

/// A span of `seq` values that were never delivered (§6.3 — refetch these).
class ResumeGap {
  const ResumeGap({required this.fromSeq, required this.toSeq});

  /// First missing `seq`, inclusive.
  final int fromSeq;

  /// Last missing `seq`, inclusive.
  final int toSeq;

  /// How many frames are missing.
  int get length => toSeq - fromSeq + 1;

  @override
  String toString() => 'ResumeGap($fromSeq..$toSeq)';

  @override
  bool operator ==(Object other) =>
      other is ResumeGap && other.fromSeq == fromSeq && other.toSeq == toSeq;

  @override
  int get hashCode => Object.hash(fromSeq, toSeq);
}

/// Tracks the resume anchor and reports gaps.
class ResumeTracker {
  int? _anchor;

  /// The highest `seq` fully applied, or `null` before the first connect.
  ///
  /// This is what goes into `connection.hello.d.resumeFrom` — an INTEGER, not
  /// a frame id. When it is null the field is OMITTED rather than sent as
  /// null or zero: the server reads absent as "fresh", and zero as "replay
  /// everything from the beginning of the session".
  int? get anchor => _anchor;

  /// Applies one frame's `seq`, returning a [ResumeGap] if one preceded it.
  ///
  /// A `seq` at or below the anchor is a duplicate — a replayed frame this
  /// client already applied — and is ignored. That is D1's dedup working as
  /// designed and is not an error.
  ResumeGap? observe(int seq) {
    final int? anchor = _anchor;

    if (anchor == null) {
      // First frame of a fresh session. There is no earlier anchor to compare
      // against, so nothing is provably missing — history before this point
      // comes from REST pagination, not from replay.
      _anchor = seq;
      return null;
    }

    if (seq <= anchor) return null;

    if (seq == anchor + 1) {
      _anchor = seq;
      return null;
    }

    final ResumeGap gap = ResumeGap(fromSeq: anchor + 1, toSeq: seq - 1);
    _anchor = seq;
    return gap;
  }

  /// Adopts the ack's `seq` after every replayed frame has been observed.
  ///
  /// Returns a [ResumeGap] covering anything the ack claimed but did not
  /// deliver — "an ack that says it is current as of 40 after replaying
  /// nothing past 12 has left 13..40 unaccounted for".
  ///
  /// Returns null when [ackSeq] is at or below the anchor. That is the
  /// deliberate never-rewind rule, and it has a consequence worth stating: a
  /// client whose anchor is somehow AHEAD of the server — a rolled-over
  /// session, a restored backup, a forged value — will read a truthful ack as
  /// "nothing is missing" and keep its impossible anchor forever. The server
  /// closes that hole out of band by also sending a VALIDATION_FAILED error
  /// naming its own `seq`; a host handling that error should call [reset].
  /// Nothing in the PRD describes this exchange.
  ResumeGap? settleAck(int ackSeq) {
    final int? anchor = _anchor;

    if (anchor == null) {
      _anchor = ackSeq;
      return null;
    }

    if (ackSeq <= anchor) return null;

    final ResumeGap gap = ResumeGap(fromSeq: anchor + 1, toSeq: ackSeq);
    _anchor = ackSeq;
    return gap;
  }

  /// Discards the anchor, so the next `connection.hello` omits `resumeFrom`.
  ///
  /// The recovery for an anchor the server says it has never issued.
  void reset() => _anchor = null;
}

/// The `seq` a frame carries, or null if it carries none.
///
/// Only some payloads are sequenced — `message.new` is, `typing.start` is not
/// — so this is deliberately nullable rather than throwing. In practice every
/// frame in a `connection.ack.d.replay` array is a `message.new`, because the
/// server builds that list from message rows alone.
int? seqOf(ServerFrame frame) {
  if (frame is! PushFrame) return null;
  final Object? seq = frame.d['seq'];
  if (seq is int) return seq;
  // Every Dart number is a double on Flutter Web.
  if (seq is double && seq.isFinite && seq == seq.roundToDouble()) {
    return seq.toInt();
  }
  return null;
}
