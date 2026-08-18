import { useUnreadCount } from '@dhaam-ccrm/react';

/**
 * Unread count, plus the button that clears it.
 *
 * `useUnreadCount` is its own hook precisely so this component re-renders on
 * the count and nothing else — not on every arriving message. The count is
 * spelled out in words rather than shown only as a coloured pill, so it reads
 * correctly aloud.
 */
export function UnreadBadge(): JSX.Element {
  const { unreadCount, markRead } = useUnreadCount();

  return (
    <div className="unread">
      <p role="status" className="unread__text">
        {unreadCount === 0
          ? 'No unread messages'
          : `${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`}
      </p>
      <button type="button" onClick={markRead} disabled={unreadCount === 0}>
        Mark read
      </button>
    </div>
  );
}
