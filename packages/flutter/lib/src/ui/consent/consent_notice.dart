/// The consent notice itself: the merchant's words, and the one control that
/// answers them.
///
/// ── Directly above the composer it gates ─────────────────────────────────
///
/// Placed by `conversation_screen.dart` immediately above the composer, and
/// that placement is load-bearing rather than cosmetic — the reference's own
/// note on the same line: "the notice and the control it disables are read as
/// one thing rather than as an unrelated banner". A visitor who finds a dead
/// composer must be able to see, without scrolling or hunting, what is
/// holding it shut and how to open it.
///
/// ── Renders nothing when it is not gating ────────────────────────────────
///
/// Not an empty box and not a zero-height node: a caller places this
/// unconditionally and gets the right answer for a merchant who required
/// nothing, a merchant who switched the toggle on and wrote nothing, and a
/// visitor who has already agreed — without three `if`s of its own, which is
/// three places to get the gate wrong. The same shape `PreChatFieldsBlock`
/// uses for the same reason.
library;

import 'package:flutter/material.dart';

/// The merchant's notice and an "I agree" button, or nothing at all.
class ConsentNotice extends StatelessWidget {
  const ConsentNotice({
    super.key,
    required this.gating,
    required this.agreed,
    required this.text,
    required this.onAgree,
  });

  /// Whether the notice is in force — `consentGating(config)`. Passed in
  /// rather than derived from a [RemoteConfig] here, so this widget and the
  /// composer's `enabled` cannot come to different conclusions about the same
  /// merchant setting.
  final bool gating;

  /// Whether this visitor has already agreed.
  final bool agreed;

  /// The merchant's own words. Free text they wrote — never trusted to be
  /// short, and never parsed for meaning.
  final String text;

  /// Run when the visitor agrees. The owner records the answer; this widget
  /// records nothing and knows about no store.
  final VoidCallback onAgree;

  @override
  Widget build(BuildContext context) {
    if (!gating || agreed) return const SizedBox.shrink();

    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
      // The port of the reference's `role="group"` + `aria-label="Consent"`.
      // `explicitChildNodes` keeps the notice and the button as their own
      // nodes underneath it — a group that swallowed its children would
      // announce the merchant's whole notice as one unlabelled blob and hide
      // the button that answers it.
      child: Semantics(
        container: true,
        explicitChildNodes: true,
        label: 'Consent',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              text,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.tonal(
                onPressed: onAgree,
                child: const Text('I agree'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
