import { useId, useRef, useState, type FormEvent } from 'react';

import { useChannel, useMessages, useTypingIndicator } from '@dhaam-ccrm/react';

/**
 * The message input.
 *
 * Real form semantics on purpose: a `<form>` with a submit button means Enter
 * sends without a keydown handler, and screen readers announce the control as
 * a form field. The label is a real `<label htmlFor>` — a placeholder is not
 * an accessible name.
 *
 * Typing notifications are the SDK's "exactly two calls" contract (§12.8):
 * startTyping() on input, stopTyping() on send. Core owns the debounce and the
 * auto-clear timer, so there is deliberately no timer here.
 */
export function Composer(): JSX.Element {
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { sendMessage } = useMessages();
  const { startTyping, stopTyping } = useTypingIndicator();
  const { connectionState } = useChannel();

  // Sends are optimistic and queue while offline, so the input stays usable in
  // every state except before the first connect attempt.
  const disabled = connectionState === 'idle';

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const content = draft.trim();
    if (content === '') return;

    setDraft('');
    setSendError(null);
    stopTyping();

    try {
      await sendMessage(content);
    } catch (error) {
      // sendMessage does not reject for "offline" — it queues. A rejection
      // here is a real programming/config error worth surfacing.
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      inputRef.current?.focus();
    }
  }

  return (
    <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
      <label className="composer__label" htmlFor={inputId}>
        Message
      </label>

      <div className="composer__row">
        <input
          id={inputId}
          ref={inputRef}
          className="composer__input"
          type="text"
          autoComplete="off"
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            startTyping();
          }}
          onBlur={stopTyping}
        />
        <button type="submit" disabled={disabled || draft.trim() === ''}>
          Send
        </button>
      </div>

      {disabled ? (
        <p className="composer__hint">Connect first to send a message.</p>
      ) : null}

      {sendError ? (
        <p role="alert" className="error">
          {sendError}
        </p>
      ) : null}
    </form>
  );
}
