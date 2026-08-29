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

import { ICONS, el, icon } from './dom.js';
import { createEmojiPicker, insertAtCaret } from './emoji.js';
import type { EmojiPickerView } from './emoji.js';
import { createVoiceRecorder } from './voice.js';
import type { VoiceRecorder } from './voice.js';

/** Above this, the browser will reject or the server will 413. Refused with words, not silence. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface ComposerCallbacks {
  readonly onSend: (text: string) => Promise<void>;
  readonly onSendAttachment: (file: File) => Promise<void>;
  readonly onTyping: () => void;
  readonly onError: (error: unknown) => void;
}

export interface ComposerView {
  readonly node: HTMLElement;
  /** The control to focus when the panel opens. */
  readonly input: HTMLTextAreaElement;
  setEnabled(enabled: boolean): void;
  setUploading(uploading: boolean): void;
  destroy(): void;
}

export function createComposer(callbacks: ComposerCallbacks): ComposerView {
  let recorder: VoiceRecorder | null = null;
  let pendingFile: File | null = null;
  let previewUrl: string | null = null;
  let enabled = true;
  let uploading = false;

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

  const attachButton = el('button', {
    attrs: { class: 'dh-icon-button', type: 'button', 'aria-label': 'Attach a file' },
    children: [icon(ICONS.paperclip, 18)],
    on: { click: () => fileInput.click() },
  });

  const micButton = el('button', {
    attrs: { class: 'dh-icon-button', type: 'button', 'aria-label': 'Record a voice message' },
    children: [icon(ICONS.mic, 18)],
    on: { click: () => { void toggleRecording(); } },
  });

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
      placeholder: 'Type a message…',
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

  const sendButton = el('button', {
    attrs: { class: 'dh-send', type: 'button', 'aria-label': 'Send message', disabled: true },
    children: [icon(ICONS.send, 18)],
    on: { click: () => { void submit(); } },
  });

  const node = el('div', {
    attrs: { class: 'dh-composer' },
    children: [
      errorLine,
      preview,
      recording,
      el('div', {
        attrs: { class: 'dh-composer-row' },
        children: [attachButton, emojiPicker.node, micButton, input, sendButton, fileInput],
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
    attachButton.disabled = !enabled || uploading;
    emojiPicker.setEnabled(enabled && !uploading);
    micButton.disabled = !enabled || uploading;
    input.disabled = !enabled;
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
      if (text !== '') await callbacks.onSend(text);
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
    setEnabled(next) {
      enabled = next;
      syncSendState();
    },
    setUploading(next) {
      uploading = next;
      syncSendState();
    },
    destroy() {
      // Order matters: the recorder holds the microphone, so it is released
      // before anything else can throw.
      recorder?.dispose();
      recorder = null;
      // Holds document-level listeners while open — releasing it here is what
      // keeps a destroyed widget from leaving them on the host's document.
      emojiPicker.destroy();
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
