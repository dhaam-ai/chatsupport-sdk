import { useTypingIndicator } from '@dhaam-ccrm/react';

/**
 * Remote typing state.
 *
 * The live region is always rendered, even when nobody is typing — a
 * `aria-live` container has to exist in the DOM *before* its content changes
 * for the change to be announced. Mounting it only while someone types is the
 * classic way to make an announcement never fire.
 */
export function TypingIndicator(): JSX.Element {
  const { isTyping, participantId } = useTypingIndicator();

  return (
    <p className="typing" role="status">
      {isTyping ? `${participantId ?? 'Someone'} is typing…` : ''}
    </p>
  );
}
