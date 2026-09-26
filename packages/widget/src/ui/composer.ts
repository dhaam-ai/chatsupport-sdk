// The composer: text, attachment, voice, and the states in which each is
// refused.
//
// Every send path here is fire-and-forget from the DOM's point of view but
// never from the promise's: `sendMessage` and `sendAttachment` both return
// promises, and a rejected one that nothing catches becomes an
// `unhandledrejection` on the HOST's window — which lands in the host's error
// tracker as a bug in their checkout page. `report` is the single funnel that
// makes that impossible, and it is why no `void promise` appears in this file
// without a `.catch` in front of it.

import { ICONS, el, icon, safeLinkUrl } from './dom.js';
import { createEmojiPicker, insertAtCaret } from './emoji.js';
import type { EmojiPickerView } from './emoji.js';
import type { InputHint } from './input-hint.js';
import { createVoiceRecorder } from './voice.js';
import type { VoiceRecorder } from './voice.js';

/** Above this, the browser will reject or the server will 413. Refused with words, not silence. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Heroicons' `link` outline, lifted verbatim from the installed package —
 * `node_modules/@heroicons/react/24/outline/LinkIcon.js` in `chatsupport_react`
 * — the same sourcing discipline `ui/dom.ts`'s `LAUNCHER_ICONS` documents for
 * itself. Kept local rather than added to the shared `ICONS` set: nothing
 * else in this package draws a link glyph yet, and `ui/header-menu.ts`
 * already establishes that a module-local icon table is the right size for
 * "one file uses this."
 */
const LINK_ICON = [
  'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244',
];

/**
 * What the reply chip shows about the message being replied to.
 *
 * Name and excerpt only — never the message id. See `setReplyTo`'s own doc
 * for why the id stays with the widget.
 */
export interface ReplyTarget {
  /** Who wrote the quoted message, as the transcript itself names them. */
  readonly senderName: string;
  /** The quoted text, already trimmed to chip length by the caller. */
  readonly excerpt: string;
}

/**
 * Extra data that travels with ONE send. Today: the `flow_reply` metadata of a
 * tapped flow button. Deliberately per-call, never remembered: it must not
 * leak onto whatever the customer types next.
 */
export interface SendExtra {
  readonly metadata?: Record<string, unknown>;
}

export interface ComposerCallbacks {
  readonly onSend: (text: string, extra?: SendExtra) => Promise<void>;
  readonly onSendAttachment: (file: File) => Promise<void>;
  readonly onTyping: () => void;
  readonly onError: (error: unknown) => void;
  /** The customer dismissing the quoted message they were replying to. */
  readonly onCancelReply: () => void;
}

export interface ComposerView {
  readonly node: HTMLElement;
  /** The control to focus when the panel opens. */
  readonly input: HTMLTextAreaElement;

  /**
   * Sends `text` as though the customer had typed and submitted it.
   *
   * Exists for the bot's suggested replies, which are chosen by tapping a chip
   * rather than typing. Deliberately routed through the SAME `submit()` every
   * other send uses, so a suggestion is subject to every rule a typed message
   * is — most importantly the disabled state, which is how the consent gate
   * holds the composer shut. A chip that could send while consent was
   * outstanding would be a way around the gate.
   *
   * A no-op when the composer is disabled or an attachment is mid-upload, or
   * when the box already holds a draft: overwriting something half-typed to
   * send a suggestion instead would destroy the customer's own words. An
   * EMPTY box is the normal case, not a refusal — a chip is tapped instead of
   * typing, so the box is empty precisely when a suggestion should send.
   */
  submit(text: string, extra?: SendExtra): Promise<void>;

  /**
   * Shows the message being replied to, or `null` to clear it.
   *
   * The composer renders the QUOTE and nothing else — it never learns the
   * message's id. Which message a send is addressed to is the widget's state,
   * because it is the widget that calls `sendMessage`; giving the composer an
   * id it would only hand back would be two owners for one fact.
   */
  setReplyTo(target: ReplyTarget | null): void;
  setEnabled(enabled: boolean): void;
  setUploading(uploading: boolean): void;
  /**
   * `behaviour.fileUploads` — shows or hides the image and file buttons.
   * Hidden, not disabled: a greyed-out paperclip promises a feature the
   * merchant switched off.
   */
  setAttachmentsEnabled(enabled: boolean): void;
  /**
   * The keyboard a flow's question wants (email, phone, number, order), or
   * `null` to hand back the ordinary one. Only the on-screen keyboard and
   * autofill change: the box keeps accepting any text, because the server
   * validates and re-asks. The prompt text is the widget's to set (it already
   * owns the placeholder for the offline-queue state), from `hint.placeholder`.
   */
  setInputHint(hint: InputHint | null): void;
  destroy(): void;
}

export function createComposer(callbacks: ComposerCallbacks): ComposerView {
  let recorder: VoiceRecorder | null = null;
  let pendingFile: File | null = null;
  let previewUrl: string | null = null;
  let enabled = true;
  let uploading = false;
  // Set by the public `submit(text, extra)` for exactly the one send it starts,
  // and consumed (cleared) at the top of the internal `submit()`.
  let pendingExtra: SendExtra | undefined;

  const errorLine = el('p', { attrs: { class: 'dh-error', role: 'alert', hidden: true } });

  // ── attachment preview ────────────────────────────────────────────────
  const previewThumb = el('img', { attrs: { class: 'dh-preview-thumb', alt: '' } });
  const previewName = el('span', { attrs: { class: 'dh-preview-name' } });
  const previewSize = el('span', { attrs: { class: 'dh-preview-size' } });
  const previewClear = el('button', {
    attrs: { class: 'dh-icon-button', type: 'button', 'aria-label': 'Remove attachment' },
    children: [icon(ICONS.trash, 16)],
    on: { click: () => clearAttachment() },
  });
  const preview = el('div', {
    attrs: { class: 'dh-preview', hidden: true },
    children: [previewThumb, previewName, previewSize, previewClear],
  });

  // ── recording strip ───────────────────────────────────────────────────
  const levelFill = el('span', { attrs: { class: 'dh-level-fill' } });
  const duration = el('span', { attrs: { class: 'dh-recording-time' }, text: '0:00' });
  const recording = el('div', {
    attrs: {
      class: 'dh-recording',
      hidden: true,
      // A live region, unlike the typing indicator: this one reports the
      // user's OWN action, and "recording started" is the only confirmation a
      // non-sighted user gets that the microphone actually opened.
      role: 'status',
      'aria-live': 'polite',
    },
    children: [
      el('span', { attrs: { class: 'dh-sr' }, text: 'Recording voice message' }),
      duration,
      el('span', { attrs: { class: 'dh-level', 'aria-hidden': 'true' }, children: [levelFill] }),
    ],
  });

  // ── controls ──────────────────────────────────────────────────────────
  const fileInput = el('input', {
    attrs: { class: 'dh-file', type: 'file', tabindex: '-1', 'aria-hidden': 'true' },
    on: { change: () => acceptFile() },
  });

  const imageInput = el('input', {
    attrs: { class: 'dh-file', type: 'file', accept: 'image/*', tabindex: '-1', 'aria-hidden': 'true', hidden: true },
    on: {
      change: () => {
        const file = (imageInput as HTMLInputElement).files?.[0];
        if (file) {
          if (file.size > MAX_ATTACHMENT_BYTES) {
            report(new Error('File too large'), 'Files must be under 25 MB.');
            (imageInput as HTMLInputElement).value = '';
            return;
          }
          pendingFile = file;
          previewName.textContent = file.name;
          previewSize.textContent = formatBytes(file.size);
          previewUrl = URL.createObjectURL(file);
          previewThumb.src = previewUrl;
          previewThumb.hidden = false;
          preview.hidden = false;
          showError(null);
          syncSendState();
        }
        (imageInput as HTMLInputElement).value = '';
      },
    },
  });

  const imageButton = el('button', {
    attrs: { class: 'dh-icon-button dh-composer-tool-btn', type: 'button', 'aria-label': 'Attach an image' },
    children: [icon(ICONS.image, 18)],
    on: { click: () => (imageInput as HTMLInputElement).click() },
  });

  const attachButton = el('button', {
    attrs: { class: 'dh-icon-button dh-composer-tool-btn', type: 'button', 'aria-label': 'Attach a file' },
    children: [icon(ICONS.paperclip, 18)],
    on: { click: () => fileInput.click() },
  });

  const micButton = el('button', {
    attrs: { class: 'dh-icon-button', type: 'button', 'aria-label': 'Record a voice message' },
    children: [icon(ICONS.mic, 18)],
    on: { click: () => { void toggleRecording(); } },
  });

  const linkButton = el('button', {
    attrs: {
      class: 'dh-icon-button',
      type: 'button',
      'aria-label': 'Insert a link',
      'aria-expanded': 'false',
      'aria-haspopup': 'true',
    },
    children: [icon(LINK_ICON, 18)],
    on: { click: () => toggleLinkPopover() },
  });

  // ── link popover ──────────────────────────────────────────────────────
  // See `toggleLinkPopover` below for why this is a popover and not the
  // browser's prompt. A wrapping <label> rather than `for`/`id`: ids inside a
  // shadow root are scoped to it, but the association is free this way and
  // cannot collide with anything the host page names.
  const linkInput = el('input', {
    attrs: {
      class: 'dh-field-input dh-link-input',
      type: 'url',
      inputmode: 'url',
      placeholder: 'https://…',
      autocomplete: 'off',
      spellcheck: 'false',
    },
  });
  const linkError = el('p', { attrs: { class: 'dh-form-error dh-link-error', role: 'alert', hidden: true } });
  const linkCancel = el('button', {
    attrs: { class: 'dh-link-cancel', type: 'button' },
    text: 'Cancel',
    on: { click: () => dismissLinkPopover() },
  });
  const linkInsert = el('button', {
    attrs: { class: 'dh-form-submit dh-link-insert', type: 'submit' },
    text: 'Add',
  });
  const linkPopover = el('form', {
    attrs: {
      class: 'dh-link-popover',
      'aria-label': 'Insert a link',
      // `novalidate`: a `type="url"` field brings the browser's own constraint
      // bubble with it, which is the host-page chrome this popover exists to
      // avoid — and it would pass `javascript:` anyway. `safeLinkUrl` in
      // `submitLink` is the one validator.
      novalidate: true,
      hidden: true,
    },
    children: [
      el('label', {
        attrs: { class: 'dh-link-label' },
        children: [el('span', { text: 'Link URL' }), linkInput],
      }),
      linkError,
      el('div', { attrs: { class: 'dh-link-actions' }, children: [linkCancel, linkInsert] }),
    ],
    on: { submit: (event) => submitLink(event) },
  });
  let linkOpen = false;

  // Declared before `input` only because the row below needs both; the picker
  // reaches the textarea through the closure, which is initialised by the time
  // any click can happen.
  const emojiPicker: EmojiPickerView = createEmojiPicker({
    onSelect: (emoji) => {
      insertAtCaret(input, emoji);
      // Same three effects a keystroke has. Skipping any one of them is a
      // real bug: without `syncSendState` an emoji-only message leaves Send
      // disabled, and without `onTyping` the agent's typing indicator stops
      // for as long as the customer is picking glyphs.
      autoGrow();
      syncSendState();
      callbacks.onTyping();
    },
  });

  const input = el('textarea', {
    attrs: {
      class: 'dh-input',
      rows: '1',
      placeholder: 'Type your message...',
      'aria-label': 'Message',
      // The browser's own suggestion UI is unhelpful in a chat box and, on
      // iOS, its autocapitalise-sentences default fights the user mid-word.
      autocomplete: 'off',
      autocapitalize: 'sentences',
      spellcheck: 'true',
    },
    on: {
      input: () => {
        autoGrow();
        syncSendState();
        callbacks.onTyping();
      },
      keydown: (event) => {
        const key = event as KeyboardEvent;
        // Enter sends; Shift+Enter is a newline. `isComposing` is the
        // load-bearing part: an IME (Japanese, Chinese, Korean) fires Enter to
        // COMMIT a candidate, and without this check the first Enter of every
        // composition sends a half-typed message.
        if (key.key === 'Enter' && !key.shiftKey && !key.isComposing) {
          key.preventDefault();
          void submit();
        }
      },
    },
  });

  // What the box was built with, kept so `setInputHint(null)` can hand exactly
  // that back (see the method's doc) rather than a guess at the defaults.
  const ordinaryKeyboard: Record<string, string | null> = Object.fromEntries(
    ['inputmode', 'autocomplete', 'autocapitalize', 'enterkeyhint'].map((name) => [name, input.getAttribute(name)]),
  );

  const sendButton = el('button', {
    attrs: { class: 'dh-send', type: 'button', 'aria-label': 'Send message', disabled: true },
    children: [icon(ICONS.send, 18)],
    on: { click: () => { void submit(); } },
  });

  // The quoted message, shown above the input while a reply is being composed.
  // Two stacked lines — WHO on top, their words below — because the chip used
  // to show a bare excerpt behind the word "Replying to", which on a
  // transcript with two other parties (agent and bot) left the customer to
  // guess whose words they were quoting.
  const replyName = el('span', { attrs: { class: 'dh-reply-name' } });
  const replyExcerpt = el('span', { attrs: { class: 'dh-reply-excerpt' } });
  const replyChip = el('div', {
    attrs: { class: 'dh-reply-chip', hidden: true },
    children: [
      el('span', { attrs: { class: 'dh-reply-body' }, children: [replyName, replyExcerpt] }),
      el('button', {
        attrs: { class: 'dh-reply-clear', type: 'button', 'aria-label': 'Cancel reply' },
        children: [icon(ICONS.close, 14)],
        on: { click: () => callbacks.onCancelReply() },
      }),
    ],
  });

  const node = el('div', {
    attrs: { class: 'dh-composer' },
    children: [
      errorLine,
      replyChip,
      preview,
      recording,
      // The reference puts image/emoji/attach/link on a row INSIDE the
      // input's own border rather than beside it — so the border moves from
      // `.dh-input` (see styles.ts) to this wrapper, and the textarea plus
      // the icon row become its two stacked children instead of five
      // siblings in one line. Every control's callback is unchanged; only
      // the nesting is.
      el('div', {
        attrs: { class: 'dh-composer-box' },
        children: [
          input,
          el('div', {
            attrs: { class: 'dh-composer-row' },
            children: [imageButton, emojiPicker.node, attachButton, linkButton, sendButton, fileInput, imageInput],
          }),
          // A child of the box, not of the row beside its trigger the way the
          // emoji popover is: it anchors to the box's full width (see
          // .dh-link-popover in styles.ts for why), and being inside the box
          // means the box's own :focus-within border lights while the URL
          // field has focus — the two read as one control.
          linkPopover,
        ],
      }),
    ],
  });

  function report(error: unknown, shown: string): void {
    showError(shown);
    callbacks.onError(error);
  }

  function showError(message: string | null): void {
    errorLine.textContent = message ?? '';
    errorLine.hidden = message === null;
  }

  function autoGrow(): void {
    // Reset before measuring: `scrollHeight` never shrinks below the current
    // height, so without this the box only ever grows.
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function syncSendState(): void {
    const hasContent = input.value.trim() !== '' || pendingFile !== null;
    sendButton.disabled = !enabled || uploading || !hasContent;
    imageButton.disabled = !enabled || uploading;
    attachButton.disabled = !enabled || uploading;
    emojiPicker.setEnabled(enabled && !uploading);
    micButton.disabled = !enabled || uploading;
    linkButton.disabled = !enabled || uploading;
    // Same rule the emoji picker applies to itself in `setEnabled`: a disabled
    // trigger with an open popover would be unreachable and unclosable by
    // pointer — shut it rather than stranding it.
    if (linkButton.disabled) closeLinkPopover();
    input.disabled = !enabled;
  }

  /**
   * Opens (or closes) the URL popover the link button owns.
   *
   * This used to be `window.prompt`. That was the host page's dialog, not the
   * widget's: it rendered in the browser's own chrome outside the shadow root,
   * unthemed, and on embeds where the host had stubbed `prompt` out or the
   * frame was sandboxed without `allow-modals` it never appeared at all — so
   * "add link" looked like a button that did nothing. Same reason widget.ts's
   * `endConversation` moved from `confirm()` to `ui/end-conversation.ts`: a
   * question the widget asks belongs inside the widget.
   *
   * The open/close mechanics are the emoji picker's, deliberately (see
   * `createEmojiPicker`): document-level listeners registered only while
   * open, `composedPath()[0]` for the outside-press test because the listener
   * sits outside the shadow tree, and a capture-phase Escape that stops
   * propagation so the panel's own Escape does not close the conversation.
   *
   * Refused while the composer is disabled or uploading — the button is
   * disabled in both states, so this guard only matters for a synthetic
   * click, but it is the rule and it belongs here, not in the CSS.
   */
  function toggleLinkPopover(): void {
    if (linkOpen) {
      closeLinkPopover();
      return;
    }
    if (!enabled || uploading) return;
    linkOpen = true;
    // A fresh field every time: a value the customer abandoned with Cancel
    // is not one they asked to see again.
    linkInput.value = '';
    showLinkError(null);
    linkPopover.hidden = false;
    linkButton.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onLinkDocumentPointerDown);
    document.addEventListener('keydown', onLinkDocumentKeydown, true);
    linkInput.focus({ preventScroll: true });
  }

  function closeLinkPopover(): void {
    if (!linkOpen) return;
    linkOpen = false;
    linkPopover.hidden = true;
    linkButton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onLinkDocumentPointerDown);
    document.removeEventListener('keydown', onLinkDocumentKeydown, true);
  }

  /** Close without inserting — Cancel, Escape, outside press. Focus goes back where it came from. */
  function dismissLinkPopover(): void {
    if (!linkOpen) return;
    closeLinkPopover();
    linkButton.focus({ preventScroll: true });
  }

  function showLinkError(message: string | null): void {
    linkError.textContent = message ?? '';
    linkError.hidden = message === null;
    linkInput.setAttribute('aria-invalid', String(message !== null));
  }

  function onLinkDocumentPointerDown(event: Event): void {
    const pressed = (event.composedPath()[0] ?? event.target) as Node;
    // The trigger counts as inside: a press on it is handled by its own click
    // (which toggles), and closing here first would make that click reopen.
    if (linkPopover.contains(pressed) || linkButton.contains(pressed)) return;
    dismissLinkPopover();
  }

  function onLinkDocumentKeydown(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.key !== 'Escape' || !linkOpen) return;
    key.stopPropagation();
    dismissLinkPopover();
  }

  /**
   * The popover's submit: validates, inserts at the caret, closes.
   *
   * Validated with the same allowlist an `href` gets (`safeLinkUrl`), even
   * though this lands in plain text rather than an attribute: the point here
   * is not escaping, it is refusing to insert something that is not actually
   * a link into a box a customer is about to send. A rejection stays INSIDE
   * the popover, next to the field it is about, and leaves it open with the
   * value intact so the customer can fix a typo rather than retype.
   */
  function submitLink(event: Event): void {
    // Always — a form inside a shadow root would otherwise try to navigate
    // the host page.
    event.preventDefault();
    if (!linkOpen) return;

    const url = safeLinkUrl(linkInput.value);
    if (url === null) {
      showLinkError('That does not look like a valid https:// link.');
      linkInput.focus({ preventScroll: true });
      return;
    }

    closeLinkPopover();
    // `insertAtCaret` uses the textarea's own selection, which the browser
    // preserved while the URL field had focus, so the link lands where the
    // customer left the caret. It also hands focus back to the textarea.
    insertAtCaret(input, url);
    // Same three effects a keystroke has — see the emoji picker's own
    // `onSelect` above for why skipping any one of them is a real bug.
    autoGrow();
    syncSendState();
    callbacks.onTyping();
  }

  function acceptFile(): void {
    const file = fileInput.files?.[0] ?? null;
    // Reset immediately so re-picking the SAME file fires `change` again —
    // the input keeps its value otherwise and the second attempt is silent.
    fileInput.value = '';
    if (file === null) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      showError(`That file is too large. The limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
      return;
    }

    setAttachment(file);
  }

  function setAttachment(file: File): void {
    clearAttachment();
    pendingFile = file;
    previewName.textContent = file.name;
    previewSize.textContent = formatBytes(file.size);

    if (file.type.startsWith('image/')) {
      previewUrl = URL.createObjectURL(file);
      previewThumb.src = previewUrl;
      previewThumb.hidden = false;
    } else {
      previewThumb.hidden = true;
      previewThumb.removeAttribute('src');
    }

    preview.hidden = false;
    showError(null);
    syncSendState();
  }

  function clearAttachment(): void {
    pendingFile = null;
    preview.hidden = true;
    if (previewUrl !== null) {
      // Not revoking leaks the whole file into the tab's memory for the
      // lifetime of the document — on a page that stays open through a meal
      // delivery, that is a real leak of real megabytes.
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    previewThumb.removeAttribute('src');
    syncSendState();
  }

  async function submit(): Promise<void> {
    const extra = pendingExtra;
    pendingExtra = undefined;
    if (sendButton.disabled) return;

    const text = input.value.trim();
    const file = pendingFile;
    if (text === '' && file === null) return;

    // Cleared optimistically: core owns the offline queue (§9.6), so a send
    // made while disconnected is durable and re-showing the text in the box
    // would invite the user to send it twice.
    input.value = '';
    autoGrow();
    clearAttachment();
    showError(null);
    syncSendState();

    try {
      if (file !== null) {
        uploading = true;
        syncSendState();
        await callbacks.onSendAttachment(file);
      }
      // The one-argument call for an ordinary send, so a plain typed message is
      // byte-for-byte what it always was; the second argument exists only for a
      // tapped flow button.
      if (text !== '') await (extra === undefined ? callbacks.onSend(text) : callbacks.onSend(text, extra));
    } catch (error) {
      report(error, 'That message could not be sent. Please try again.');
    } finally {
      uploading = false;
      syncSendState();
    }
  }

  async function toggleRecording(): Promise<void> {
    recorder ??= createVoiceRecorder({
      onTick: (elapsed, amplitude) => {
        duration.textContent = formatDuration(elapsed);
        levelFill.style.width = `${Math.round(amplitude * 100)}%`;
      },
    });

    if (recorder.isRecording()) {
      const result = await recorder.stop();
      setRecordingUi(false);
      if (result === null) return;

      const extension = result.mimeType.includes('mp4') ? 'm4a' : 'webm';
      const file = new File([result.blob], `voice-message.${extension}`, { type: result.mimeType });
      setAttachment(file);
      return;
    }

    showError(null);
    const failure = await recorder.start();
    if (failure !== null) {
      showError(failure.message);
      setRecordingUi(false);
      return;
    }
    setRecordingUi(true);
  }

  function setRecordingUi(active: boolean): void {
    recording.hidden = !active;
    micButton.setAttribute('aria-label', active ? 'Stop recording' : 'Record a voice message');
    micButton.setAttribute('aria-pressed', String(active));
    micButton.replaceChildren(icon(active ? ICONS.stop : ICONS.mic, 18));
    if (!active) {
      duration.textContent = '0:00';
      levelFill.style.width = '0%';
    }
  }

  syncSendState();

  return {
    node,
    input,
    setReplyTo(target) {
      replyChip.hidden = target === null;
      // `textContent` on both: a display name and a message body are another
      // party's data.
      replyName.textContent = target?.senderName ?? '';
      replyExcerpt.textContent = target?.excerpt ?? '';
    },
    async submit(text, extra) {
      // Both guards are refusals, not races. `enabled` is the consent gate and
      // the closed-session rule, `uploading` the in-flight send; a non-empty
      // box is the customer's own draft, which a suggestion must not
      // overwrite. NOT `sendButton.disabled`: that also reflects "the box is
      // empty", which is exactly the state a chip is tapped in, and gating on
      // it refused every suggestion ever offered.
      if (!enabled || uploading) return;
      if (input.value.trim() !== '') return;
      const suggestion = text.trim();
      if (suggestion === '') return;
      input.value = suggestion;
      pendingExtra = extra;
      // Send is enabled by content, and the content just changed.
      syncSendState();
      await submit();
    },
    setEnabled(next) {
      enabled = next;
      syncSendState();
    },
    setUploading(next) {
      uploading = next;
      syncSendState();
    },
    setInputHint(hint) {
      if (hint === null) {
        // Back to what `createComposer` built, not to a guess at it.
        for (const [name, value] of Object.entries(ordinaryKeyboard)) {
          if (value === null) input.removeAttribute(name);
          else input.setAttribute(name, value);
        }
        return;
      }
      input.setAttribute('inputmode', hint.inputMode);
      input.setAttribute('autocomplete', hint.autocomplete);
      // An email, a phone and a number are never sentences, and iOS would
      // capitalise the first letter of an address; an order number is typed in
      // capitals by convention.
      input.setAttribute('autocapitalize', hint.type === 'order' ? 'characters' : 'none');
      input.setAttribute('enterkeyhint', 'send');
    },
    setAttachmentsEnabled(next) {
      imageButton.hidden = !next;
      attachButton.hidden = !next;
      // A file picked before the merchant turned uploads off must not still send.
      if (!next) clearAttachment();
    },
    destroy() {
      // Order matters: the recorder holds the microphone, so it is released
      // before anything else can throw.
      recorder?.dispose();
      recorder = null;
      // Both hold document-level listeners while open — releasing them here
      // is what keeps a destroyed widget from leaving them on the host's
      // document.
      emojiPicker.destroy();
      closeLinkPopover();
      clearAttachment();
    },
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
