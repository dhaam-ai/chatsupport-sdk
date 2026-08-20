// @vitest-environment jsdom
//
// The domain composables as a real component would consume them: mounted with
// @vue/test-utils, read through the template, and torn down by unmounting.
//
// Components are defined in plain TS with render functions rather than SFCs —
// the root vitest.config.ts globs `*.test.ts` only, so there is no SFC compiler
// in this pipeline and a `.vue` file here would simply not run.

import { createConformanceChatClient } from '@dhaam-ccrm/binding-conformance';
import type { ChatMessage } from '@dhaam-ccrm/core';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import {
  createChatPlugin,
  provideChatClient,
  useChannel,
  useChatError,
  useChatEvent,
  useMessages,
  useTypingIndicator,
  useUnreadCount,
} from '../src/index.js';

enableAutoUnmount(afterEach);

type Client = ReturnType<typeof createConformanceChatClient>;

function mountWith(client: Client, setup: () => () => unknown) {
  return mount(defineComponent({ setup }), { global: { plugins: [createChatPlugin(client)] } });
}

/** One store mutation, fully settled: the harness's microtask flush, then Vue's render queue. */
async function push(client: Client, patch: Parameters<Client['__harness']['setState']>[0]): Promise<void> {
  client.__harness.setState(patch);
  await client.__harness.flushMicrotasks();
  await nextTick();
}

function buildMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg_1',
    sessionId: 'session_1',
    senderId: 'participant_local',
    senderType: 'CUSTOMER',
    type: 'TEXT',
    content: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useChannel', () => {
  it('renders connection state and re-renders when it changes', async () => {
    const client = createConformanceChatClient({ connectionState: 'idle' });
    const wrapper = mountWith(client, () => {
      const { connectionState } = useChannel();
      return () => h('div', connectionState.value);
    });

    expect(wrapper.text()).toBe('idle');
    await push(client, { connectionState: 'connected' });
    expect(wrapper.text()).toBe('connected');
  });

  it('delegates every action to the client', () => {
    const client = createConformanceChatClient();
    const spies = {
      connect: vi.spyOn(client, 'connect'),
      disconnect: vi.spyOn(client, 'disconnect'),
      joinSession: vi.spyOn(client, 'joinSession'),
      leaveSession: vi.spyOn(client, 'leaveSession'),
      requestAgent: vi.spyOn(client, 'requestAgent'),
      closeSession: vi.spyOn(client, 'closeSession'),
    };

    let channel!: ReturnType<typeof useChannel>;
    mountWith(client, () => {
      channel = useChannel();
      return () => null;
    });

    void channel.connect();
    channel.disconnect();
    channel.joinSession('session_9');
    channel.leaveSession();
    channel.requestAgent('billing');
    void channel.closeSession();

    expect(spies.connect).toHaveBeenCalledTimes(1);
    expect(spies.disconnect).toHaveBeenCalledTimes(1);
    expect(spies.joinSession).toHaveBeenCalledWith('session_9');
    expect(spies.leaveSession).toHaveBeenCalledTimes(1);
    expect(spies.requestAgent).toHaveBeenCalledWith('billing');
    expect(spies.closeSession).toHaveBeenCalledTimes(1);
  });
});

describe('useMessages', () => {
  it('exposes the list, pagination and upload flag, each updating independently', async () => {
    const client = createConformanceChatClient();
    let renders = 0;

    const wrapper = mountWith(client, () => {
      const { messages } = useMessages();
      return () => {
        renders += 1;
        return h('div', String(messages.value.length));
      };
    });

    expect(wrapper.text()).toBe('0');
    expect(renders).toBe(1);

    await push(client, { messages: [buildMessage()] });
    expect(wrapper.text()).toBe('1');
    expect(renders).toBe(2);

    // `uploading` is a different ref; a component that never reads it is not
    // re-rendered when it flips.
    await push(client, { uploading: true });
    expect(renders).toBe(2);
  });

  it('delegates sendMessage and loadOlderMessages to the client', async () => {
    const client = createConformanceChatClient();
    const sendMessage = vi.spyOn(client, 'sendMessage');
    const loadOlderMessages = vi.spyOn(client, 'loadOlderMessages');

    let api!: ReturnType<typeof useMessages>;
    mountWith(client, () => {
      api = useMessages();
      return () => null;
    });

    await api.sendMessage('hi', { type: 'TEXT' });
    await api.loadOlderMessages();

    expect(sendMessage).toHaveBeenCalledWith('hi', { type: 'TEXT' });
    expect(loadOlderMessages).toHaveBeenCalledTimes(1);
  });
});

describe('useTypingIndicator', () => {
  it('does not re-render a typing-only component when a message arrives', async () => {
    // The concrete case behind "typing must not re-render on every message".
    const client = createConformanceChatClient({ typing: { isTyping: false } });
    let renders = 0;

    const wrapper = mountWith(client, () => {
      const { isTyping } = useTypingIndicator();
      return () => {
        renders += 1;
        return h('div', isTyping.value ? 'typing' : 'idle');
      };
    });

    expect(renders).toBe(1);

    await push(client, { messages: [buildMessage()] });
    await push(client, { messages: [buildMessage(), buildMessage({ id: 'msg_2' })] });
    await push(client, { unreadCount: 3 });
    expect(renders, 'three unrelated store changes must not have re-rendered a typing-only component').toBe(1);

    await push(client, { typing: { isTyping: true, participantId: 'agent_1' } });
    expect(renders).toBe(2);
    expect(wrapper.text()).toBe('typing');
  });

  it('exposes participantId separately, so an isTyping-only component ignores a change of typist', async () => {
    const client = createConformanceChatClient({ typing: { isTyping: true, participantId: 'agent_1' } });
    let renders = 0;

    mountWith(client, () => {
      const { isTyping } = useTypingIndicator();
      return () => {
        renders += 1;
        return h('div', String(isTyping.value));
      };
    });

    await push(client, { typing: { isTyping: true, participantId: 'agent_2' } });
    expect(renders).toBe(1);
  });

  it('delegates startTyping/stopTyping', () => {
    const client = createConformanceChatClient();
    const startTyping = vi.spyOn(client, 'startTyping');
    const stopTyping = vi.spyOn(client, 'stopTyping');

    let api!: ReturnType<typeof useTypingIndicator>;
    mountWith(client, () => {
      api = useTypingIndicator();
      return () => null;
    });

    api.startTyping();
    api.stopTyping();
    expect(startTyping).toHaveBeenCalledTimes(1);
    expect(stopTyping).toHaveBeenCalledTimes(1);
  });
});

describe('useUnreadCount / useChatError', () => {
  it('tracks unreadCount and delegates markRead', async () => {
    const client = createConformanceChatClient({ unreadCount: 2 });
    const markRead = vi.spyOn(client, 'markRead');

    let api!: ReturnType<typeof useUnreadCount>;
    const wrapper = mountWith(client, () => {
      api = useUnreadCount();
      return () => h('span', String(api.unreadCount.value));
    });

    expect(wrapper.text()).toBe('2');
    await push(client, { unreadCount: 5 });
    expect(wrapper.text()).toBe('5');

    api.markRead();
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it('surfaces lastError and clears back to null', async () => {
    const client = createConformanceChatClient();
    let error!: ReturnType<typeof useChatError>;
    mountWith(client, () => {
      error = useChatError();
      return () => null;
    });

    expect(error.value).toBeNull();

    const failure = { source: 'transport' as const, code: null, message: 'boom', retryable: true };
    await push(client, { lastError: failure });
    expect(error.value).toEqual(failure);

    await push(client, { lastError: null });
    expect(error.value).toBeNull();
  });
});

describe('useChatEvent', () => {
  it('delivers payloads and stops on unmount', () => {
    const client = createConformanceChatClient();
    const received: unknown[] = [];

    const wrapper = mountWith(client, () => {
      useChatEvent('typing', (payload) => received.push(payload));
      return () => null;
    });

    client.__harness.emit('typing', { isTyping: true, participantId: 'p1' });
    expect(received).toEqual([{ isTyping: true, participantId: 'p1' }]);
    expect(client.__harness.eventListenerCount('typing')).toBe(1);

    wrapper.unmount();
    expect(client.__harness.eventListenerCount('typing')).toBe(0);

    client.__harness.emit('typing', { isTyping: false, participantId: 'p1' });
    expect(received, 'no delivery after unmount').toHaveLength(1);
  });

  it('returns an unsubscribe that stops delivery before the scope ends', () => {
    const client = createConformanceChatClient();
    const received: unknown[] = [];

    let off!: () => void;
    mountWith(client, () => {
      off = useChatEvent('agentLeft', (payload) => received.push(payload));
      return () => null;
    });

    off();
    client.__harness.emit('agentLeft', { kind: 'AGENT', id: 'agent_1', displayName: 'Jamie' });
    expect(received).toEqual([]);
    expect(client.__harness.eventListenerCount('agentLeft')).toBe(0);

    // Idempotent — the scope teardown will call it again on unmount.
    expect(() => off()).not.toThrow();
  });
});

describe('provideChatClient', () => {
  it('scopes a client to one subtree, so two widgets can run two clients in one app', async () => {
    const outer = createConformanceChatClient({ unreadCount: 1 });
    const inner = createConformanceChatClient({ unreadCount: 100 });

    const Badge = defineComponent({
      setup() {
        const { unreadCount } = useUnreadCount();
        return () => h('span', String(unreadCount.value));
      },
    });

    const InnerHost = defineComponent({
      setup() {
        provideChatClient(inner);
        return () => h(Badge);
      },
    });

    const wrapper = mount(defineComponent({ setup: () => () => h('div', [h(Badge), h(InnerHost)]) }), {
      global: { plugins: [createChatPlugin(outer)] },
    });

    expect(wrapper.text()).toBe('1100');

    await push(inner, { unreadCount: 101 });
    expect(wrapper.text(), 'only the inner subtree follows the inner client').toBe('1101');

    await push(outer, { unreadCount: 2 });
    expect(wrapper.text()).toBe('2101');
  });
});
