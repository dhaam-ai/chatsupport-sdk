// The conversation lists (Home's "Recent conversation", Messages) show the newest activity first.
//
// The server's page is ordered by the session's own `updatedAt`, which is not the time of its last message (a status
// change moves it, a new message may not), and the list is only re-fetched on a few events. So the widget orders what it
// holds: by the last message's time, newest first, with the conversation that is open counted at the time of its newest
// message in memory (a message just sent or received is not in the fetched page yet).

import type { ChatSessionSummary } from '@dhaam-ccrm/core';

const when = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

export function orderByLatestActivity(
  sessions: readonly ChatSessionSummary[],
  live?: { readonly sessionId: string | null; readonly at: string | null },
): ChatSessionSummary[] {
  const liveAt = when(live?.at);
  return sessions
    .map((summary, index) => {
      const own = when(summary.lastMessageAt ?? summary.createdAt);
      const newer = live !== undefined && summary.id === live.sessionId && liveAt > own;
      return { summary: newer ? { ...summary, lastMessageAt: live!.at } : summary, at: newer ? liveAt : own, index };
    })
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map((row) => row.summary);
}
