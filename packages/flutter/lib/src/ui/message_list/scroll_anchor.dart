/// Whether the transcript should follow new messages down. Ports
/// `ui/message-list.ts`'s `isNearBottom`.
library;

/// The tolerance, in logical pixels, for "at the bottom".
///
/// A tolerance rather than an exact zero, because sub-pixel scroll offsets
/// and fractional device pixel ratios mean a list a user has scrolled to the
/// end of routinely reports a remainder of half a pixel to two pixels. An
/// exact test would silently stop auto-scrolling on exactly the high-DPI
/// phones this is aimed at.
///
/// 40 is `message-list.ts`'s own number, kept rather than re-tuned: it is
/// also wide enough that a user who has drifted a line or two up still gets
/// followed down, which is what they meant by staying at the end.
const double kNearBottomTolerancePx = 40;

/// Whether [pixels] is within [kNearBottomTolerancePx] of [maxScrollExtent].
///
/// Takes numbers rather than a `ScrollPosition` so the rule is assertable
/// without a laid-out widget — the same reason `message-list.ts` factored it
/// out of `render()`.
///
/// Must be read BEFORE the list grows: reading a scroll offset after an
/// append gives the post-append value, which would make "was the user at the
/// bottom" always true for a growing list.
bool isNearBottom({required double pixels, required double maxScrollExtent}) {
  return maxScrollExtent - pixels <= kNearBottomTolerancePx;
}
