// @vitest-environment node
//
// The 'node' environment on purpose, matching ssr.test.ts's reasoning: these
// three hooks are the only ones in the package that touch browser-only APIs
// (`IntersectionObserver`, `navigator.mediaDevices`, `MediaRecorder`,
// `AudioContext`), so they are the ones most likely to break a Next.js server
// render. A jsdom-backed test would pass for the wrong reason — a stray
// `window`/`navigator` read would silently find jsdom's fake one instead of
// throwing the way a real server render does.

import { describe, expect, it } from 'vitest';

import { renderToStaticMarkup } from 'react-dom/server';

import { ChatProvider } from '../src/context.js';
import { useAudioWaveform } from '../src/use-audio-waveform.js';
import { useReadTracker } from '../src/use-read-tracker.js';
import { useVoiceRecorder } from '../src/use-voice-recorder.js';
import { createFakeChatClient } from './fake-chat-client.js';
import { h } from './h.js';

describe('DOM hooks under server rendering', () => {
  it('this file genuinely has no DOM', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof IntersectionObserver).toBe('undefined');
    expect(typeof MediaRecorder).toBe('undefined');
    expect(typeof AudioContext).toBe('undefined');
  });

  it('useReadTracker renders with no IntersectionObserver present', () => {
    const client = createFakeChatClient();

    function View() {
      const { observeMessage } = useReadTracker(null, { onDelivered: () => {}, onRead: () => {} });
      return h('div', null, typeof observeMessage);
    }

    expect(renderToStaticMarkup(h(ChatProvider, { client }, h(View)))).toContain('function');
  });

  it('useVoiceRecorder renders with no navigator/MediaRecorder present', () => {
    function View() {
      const { isRecording, durationMs, amplitude, error } = useVoiceRecorder();
      return h('div', null, `${String(isRecording)}:${durationMs}:${amplitude}:${error === null ? 'none' : error.code}`);
    }

    // `isSupported` is deliberately NOT asserted here: it is probed in an
    // effect (which never runs on the server) and starts optimistically true
    // so a record button is not rendered disabled and then enabled a frame
    // into hydration.
    expect(renderToStaticMarkup(h(View))).toContain('false:0:0:none');
  });

  it('useAudioWaveform renders idle with no AudioContext present', () => {
    function View() {
      const { status, peaks } = useAudioWaveform(null);
      return h('div', null, `${status}:${peaks.length}`);
    }

    expect(renderToStaticMarkup(h(View))).toContain('idle:0');
  });
});
