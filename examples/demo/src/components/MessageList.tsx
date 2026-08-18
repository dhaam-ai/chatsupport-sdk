import { useMessages, type ChatMessage } from '@dhaam-ccrm/react';

import { TypingIndicator } from './TypingIndicator';

/**
 * The message list and its pagination.
 *
 * Accessibility: the list is `role="log"`, which carries an implicit
 * `aria-live="polite"` — a screen reader announces arriving messages without
 * stealing focus from the composer. https://www.w3.org/TR/wai-aria-1.2/#log
 *
 * Delivery state is text, not just styling, for the same reason the
 * connection state is: "Sending…" and "Failed" have to survive being read
 * aloud or viewed without colour.
 */

function deliveryLabel(message: ChatMessage): string | null {
  if (!message.delivery) return null;
  return message.delivery.state === 'queued'
    ? 'Sending…'
    : `Failed — ${message.delivery.reason}`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
}

export function MessageList({ localSenderId }: { localSenderId: string }): JSX.Element {
  const { messages, pagination, loadOlderMessages } = useMessages();

  return (
    <div className="messages">
      {pagination.hasMore ? (
        <button
          type="button"
          className="load-more"
          onClick={() => void loadOlderMessages()}
          disabled={pagination.loadingMore}
        >
          {pagination.loadingMore ? 'Loading…' : 'Load older messages'}
        </button>
      ) : null}

      <ol className="message-log" role="log" aria-label="Conversation">
        {messages.map((message) => {
          const mine = message.senderId === localSenderId;
          const delivery = deliveryLabel(message);

          return (
            <li
              key={message.id}
              className={`message ${mine ? 'message--mine' : 'message--theirs'}`}
            >
              <p className="message__meta">
                {/* senderType, not a colour, tells you who spoke. */}
                <span className="message__sender">{mine ? 'You' : message.senderType}</span>
                <span className="message__time">{formatTime(message.createdAt)}</span>
              </p>

              <p className="message__body">{message.content}</p>

              {message.attachment ? (
                <p className="message__attachment">Attachment: {message.attachment.fileName}</p>
              ) : null}

              {delivery ? (
                <p
                  className={`message__delivery ${
                    message.delivery?.state === 'failed' ? 'message__delivery--failed' : ''
                  }`}
                >
                  {delivery}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {messages.length === 0 ? (
        <p className="empty">No messages yet. Connect, then say something.</p>
      ) : null}

      <TypingIndicator />
    </div>
  );
}
