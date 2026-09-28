library;

import 'package:dhaam_chat/dhaam_chat.dart' show ChatStatus;
import 'package:flutter/material.dart';

import '../session/session_display.dart';

class SessionStatusPill extends StatelessWidget {
  const SessionStatusPill({
    super.key,
    required this.status,
    this.label,
  });

  final ChatStatus status;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final _StatusPillColors colors = _statusPillColors(
      Theme.of(context).colorScheme,
      status,
    );

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label ?? homeStatusPill(status),
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: colors.foreground),
      ),
    );
  }
}

class _StatusPillColors {
  const _StatusPillColors({
    required this.background,
    required this.foreground,
  });

  final Color background;
  final Color foreground;
}

_StatusPillColors _statusPillColors(ColorScheme scheme, ChatStatus status) {
  final bool dark = scheme.brightness == Brightness.dark;

  return switch (status) {
    ChatStatus.open => _StatusPillColors(
        background: scheme.primaryContainer,
        foreground: scheme.onPrimaryContainer,
      ),
    ChatStatus.waitingForAgent => _StatusPillColors(
        background: dark ? const Color(0xFF5D4300) : const Color(0xFFFFF3D6),
        foreground: dark ? const Color(0xFFFFD36B) : const Color(0xFF765100),
      ),
    ChatStatus.assigned => _StatusPillColors(
        background: scheme.secondaryContainer,
        foreground: scheme.onSecondaryContainer,
      ),
    ChatStatus.onHold => _StatusPillColors(
        background: dark ? const Color(0xFF673A00) : const Color(0xFFFFE7D6),
        foreground: dark ? const Color(0xFFFFB873) : const Color(0xFF884000),
      ),
    ChatStatus.resolved => _StatusPillColors(
        background: dark ? const Color(0xFF0F4D32) : const Color(0xFFDFF6EA),
        foreground: dark ? const Color(0xFF8FE3B7) : const Color(0xFF137044),
      ),
    ChatStatus.closed => _StatusPillColors(
        background: scheme.surfaceContainerHighest,
        foreground: scheme.onSurfaceVariant,
      ),
  };
}
