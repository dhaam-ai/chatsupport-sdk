/// The merchant's "Common Questions" — quick-tap prompts configured in the
/// console (Chatbot → Behaviour → Common Questions).
///
/// ── A bordered list here, a chip row in the JS widget ───────────────────
///
/// `ui/common-questions.ts` renders these as a wrapped row of pill chips.
/// This package's own screen brief calls for "Common Questions as a
/// bordered list" instead — a deliberate, stated platform difference, not a
/// simplification of the JS behaviour: a vertical list reads better on a
/// phone-width column than a chip row that wraps to several short lines,
/// and every question keeps equal width regardless of label length.
library;

import 'package:flutter/material.dart';

import '../config/remote_config.dart';

class CommonQuestionsList extends StatelessWidget {
  const CommonQuestionsList({super.key, required this.questions, required this.onSelect});

  final List<CommonQuestion> questions;

  /// The customer tapped one. Sends `prompt` as their first message — same
  /// contract `common-questions.ts`'s own `onSelect` documents.
  final ValueChanged<CommonQuestion> onSelect;

  @override
  Widget build(BuildContext context) {
    // Absent config ⇒ behaves as before: no built-in default list is ever
    // substituted for an empty one (remote_config.dart's own rule for this
    // field), so an empty list renders nothing here either.
    if (questions.isEmpty) return const SizedBox.shrink();

    final ColorScheme scheme = Theme.of(context).colorScheme;
    return Semantics(
      container: true,
      label: 'Common questions',
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border.all(color: scheme.outlineVariant),
          borderRadius: BorderRadius.circular(12),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              for (int i = 0; i < questions.length; i++) ...<Widget>[
                if (i > 0) Divider(height: 1, thickness: 1, color: scheme.outlineVariant),
                ListTile(
                  title: Text(questions[i].label),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => onSelect(questions[i]),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
