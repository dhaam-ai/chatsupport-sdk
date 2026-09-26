// What kind of answer a flow's question wants (chatbot-workflows.md §9.4, §11.2).
//
// A flow's `question` step arrives as a bot message with `metadata.input.type`.
// This turns that into the keyboard and prompt the composer should use while
// that question is the newest thing on screen — an email box gets the email
// keyboard, a phone box the number pad — and nothing else. It never validates
// and never blocks: typing stays allowed whatever the hint, because the server
// owns validation and re-asks (`tries`, `retry`) and the visitor may well be
// answering something the type did not anticipate.
//
// The metadata is an open bag from another service, so this is defensive in the
// same way `readQuickReplies` is: anything not exactly a known type is `null`.

export type InputHintType = 'email' | 'phone' | 'number' | 'order';

export interface InputHint {
  readonly type: InputHintType;
  /** The composer's prompt while this question is open. */
  readonly placeholder: string;
  /** The on-screen keyboard to raise on a phone. */
  readonly inputMode: 'email' | 'tel' | 'decimal' | 'text';
  readonly autocomplete: string;
}

const HINTS: Record<InputHintType, InputHint> = {
  email: { type: 'email', placeholder: 'Your email address', inputMode: 'email', autocomplete: 'email' },
  phone: { type: 'phone', placeholder: 'Your phone number', inputMode: 'tel', autocomplete: 'tel' },
  number: { type: 'number', placeholder: 'A number', inputMode: 'decimal', autocomplete: 'off' },
  // The example is the merchant-facing one in the contract (§11.2); an order
  // number is text, not a number pad — real ones carry a letter prefix.
  order: { type: 'order', placeholder: 'e.g. DH-10482', inputMode: 'text', autocomplete: 'off' },
};

export function readInputHint(metadata: unknown): InputHint | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
  const input = (metadata as Record<string, unknown>)['input'];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const type = (input as Record<string, unknown>)['type'];
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(HINTS, type) ? HINTS[type as InputHintType] : null;
}
