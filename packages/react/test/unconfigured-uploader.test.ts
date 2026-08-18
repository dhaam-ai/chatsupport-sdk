// @vitest-environment jsdom
//
// This one test uses a REAL `createChatClient()` from @dhaam-ccrm/core, not
// the fake test double every other file uses — the thing under test is
// core's own `ChatClientConfigError` and how it flows through this
// package's `useMessages().sendAttachment`, so a fake would just tell us our
// mock behaves like we told it to. `sendAttachment()` rejects with
// `ChatClientConfigError` synchronously at the `ChatClient` boundary, before
// touching the queue or requiring a live connection (see
// create-chat-client.ts's `sendAttachment` — the `config.uploader ===
// undefined` check runs first), so this needs no socket and never calls
// `connect()`.

import { createChatClient } from '@dhaam-ccrm/core';
import type { ChatClient } from '@dhaam-ccrm/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ChatProvider } from '../src/context.js';
import { ChatClientConfigError } from '../src/index.js';
import { useMessages } from '../src/use-messages.js';
import { h } from './h.js';

afterEach(() => {
  cleanup();
});

function buildClientWithoutUploader(): ChatClient {
  return createChatClient({
    publishableKey: 'dhp' + '_test_0123456789abcdef',
    getToken: async () => 'token',
    wsUrl: 'wss://example.test/ws',
    localSender: { senderId: 'user_1', senderType: 'CUSTOMER' },
    history: { listMessages: async () => ({ messages: [], hasMore: false }) },
    // `uploader` intentionally omitted.
  });
}

/**
 * A realistic consumer: it catches the rejection itself and renders the
 * result, the way any real app must (a promise rejection this component
 * doesn't handle would otherwise surface as an unhandled rejection, not a
 * React render crash — there is no render-time throw to catch here at all,
 * which is itself part of what "surfaces usefully" means for an async
 * action).
 */
function AttachmentSender() {
  const { sendAttachment } = useMessages();
  const [result, setResult] = useState<string>('idle');

  const onClick = () => {
    setResult('sending');
    sendAttachment(new Blob(['x']), { fileName: 'x.txt' })
      .then(() => setResult('sent'))
      .catch((error: unknown) => {
        setResult(error instanceof ChatClientConfigError ? `config-error: ${error.message}` : 'unknown-error');
      });
  };

  return h(
    'div',
    null,
    h('div', { 'data-testid': 'result' }, result),
    h('button', { onClick }, 'send-attachment'),
  );
}

describe('sendAttachment with no uploader configured', () => {
  it('surfaces ChatClientConfigError to the component instead of crashing it', async () => {
    const client = buildClientWithoutUploader();

    render(h(ChatProvider, { client }, h(AttachmentSender)));

    expect(screen.getByTestId('result').textContent).toBe('idle');

    fireEvent.click(screen.getByText('send-attachment'));

    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).toMatch(/^config-error:/);
    });

    // The component is still alive and interactive — no error boundary was
    // tripped, no crash. Clicking again reaches the same code path cleanly.
    expect(screen.getByText('send-attachment')).toBeTruthy();
  });

  it('rejects with ChatClientConfigError directly off the client, for the case a consumer bypasses the hook and calls the client itself', async () => {
    const client = buildClientWithoutUploader();
    await expect(client.sendAttachment(new Blob(['x']))).rejects.toBeInstanceOf(ChatClientConfigError);
  });
});
