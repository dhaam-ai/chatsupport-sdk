/// The two-tab bottom navigation — Home and Messages. Mirrors the JS
/// widget's `ui/nav.ts`: the active tab accented, the inactive one muted,
/// and the unread count riding on the Messages tab.
///
/// ── Hand-built rather than [NavigationBar] ──────────────────────────────
///
/// `nav.ts` explicitly keeps NEITHER tab selected while a conversation is
/// open — "a conversation is not a tab, so while one is open neither reads
/// as selected" (its own comment) — because this bar stays on screen across
/// all three of [ScreenName]'s values, not just the two it offers tabs for.
/// [NavigationBar.selectedIndex] is documented only as "which destination is
/// currently selected," with no stated support for "none of them" (verified
/// against api.flutter.dev — the property's own doc page does not name a
/// sentinel for no selection), so leaning on it here would be building this
/// bar's core behaviour on undocumented territory. A small hand-built row
/// makes "neither selected" a plain, explicit case instead of a guess about
/// an edge case a stock widget may not support.
library;

import 'package:flutter/material.dart';

import '../nav/chat_screens.dart';

/// Capped, same as `nav.ts`'s own badge: "the badge is a 16px disc and a
/// real count past 99 tells the customer nothing the cap does not."
const int kUnreadBadgeCap = 99;

class ChatBottomNav extends StatelessWidget {
  const ChatBottomNav({
    super.key,
    required this.active,
    required this.unreadCount,
    required this.onSelect,
  });

  /// The screen showing right now. Only [ScreenName.home] and
  /// [ScreenName.messages] ever read as selected — see this file's header.
  final ScreenName active;
  final int unreadCount;

  /// Always called with [ScreenName.home] or [ScreenName.messages] — the
  /// same restriction `nav.ts`'s own `NavTab` type encodes, enforced here by
  /// this widget simply never building a control for anything else.
  final ValueChanged<ScreenName> onSelect;

  @override
  Widget build(BuildContext context) {
    return Material(
      // Tracks the theme's own surface rather than a hardcoded white, so
      // this bar matches whichever brightness chatThemeData resolved to.
      color: Theme.of(context).colorScheme.surface,
      child: SafeArea(
        top: false,
        child: Row(
          children: <Widget>[
            Expanded(
              child: _NavTab(
                icon: Icons.home_rounded,
                label: 'Home',
                selected: active == ScreenName.home,
                onTap: () => onSelect(ScreenName.home),
              ),
            ),
            Expanded(
              child: _NavTab(
                icon: Icons.forum_outlined,
                label: 'Messages',
                selected: active == ScreenName.messages,
                unreadCount: unreadCount,
                onTap: () => onSelect(ScreenName.messages),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavTab extends StatelessWidget {
  const _NavTab({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.unreadCount = 0,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final int unreadCount;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final Color color = selected ? scheme.primary : scheme.onSurfaceVariant;

    Widget iconWidget = Icon(icon, color: color);
    if (unreadCount > 0) {
      // Badge.count exists on this SDK (Flutter 3.24.4) but caps at 999+
      // with no way to lower that (verified against the pinned SDK's own
      // source, packages/flutter/lib/src/material/badge.dart — its
      // `maxCount` parameter does not exist yet on this version). The base
      // Badge constructor with a hand-built label is what gets nav.ts's own
      // 99+ cap exactly.
      final String label =
          unreadCount > kUnreadBadgeCap ? '$kUnreadBadgeCap+' : '$unreadCount';
      iconWidget = Badge(label: Text(label), child: iconWidget);
    }

    return Semantics(
      // A real tab semantic, matching nav.ts's own `role="tablist"` +
      // `aria-selected` — see this file's header on why neither tab is
      // `selected: true` while a conversation is open.
      button: true,
      selected: selected,
      label: unreadCount > 0 ? '$label, $unreadCount unread' : label,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              iconWidget,
              const SizedBox(height: 2),
              Text(
                label,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: color),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
