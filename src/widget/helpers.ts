export function looksLikeRawId(s: string | undefined): boolean {
  if (!s) return false;
  if (/^[0-9a-fA-F-]{20,}$/.test(s)) return true;
  if (/^\d{6,}$/.test(s)) return true;
  if (/^\d+::\d+::\d+$/.test(s)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
  if (/^(ADMIN|AGENT|BOT|SYSTEM)\d*$/i.test(s)) return true;
  return false;
}

export function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** "Just now" / "5m ago" / "Mar 3" — shared by the picker and history panel so
 *  the two cannot format the same timestamp differently. */
export function formatRelative(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000)         return 'Just now';
  if (diff < 3_600_000)      return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000)     return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
