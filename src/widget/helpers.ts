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
