// Read/delivery tracking for Angular.
//
// The two-watermark logic — why registering a row is "delivered" while only
// crossing 60% visibility is "read", why the read watermark advances by
// position in core's ordered list rather than by intersection-callback arrival
// order, and why `isIntersecting` alone is not the 60% test v1 believed it was
// — lives in `@dhaam-ccrm/browser`'s `createReadTracker`. This file adds two
// Angular things and nothing else: the message list is read off a `ChatStore`
// (or a bare `ChatClient`) instead of a hand-written callback, and teardown
// rides on `DestroyRef`.

import { createReadTracker as createBrowserReadTracker } from '@dhaam-ccrm/browser';
import type { ReadTracker, ReadTrackerOptions } from '@dhaam-ccrm/browser';
import type { ChatClient } from '@dhaam-ccrm/core';
import { DestroyRef } from '@angular/core';

import { injectIfAvailable } from './injection-context.js';
import type { ChatStore } from './chat-store.js';

export { DEFAULT_READ_DEBOUNCE_MS, DEFAULT_READ_THRESHOLD } from '@dhaam-ccrm/browser';

/** The message-list source: either binding's store, or the raw client under it. */
export type ReadTrackerSource = Pick<ChatStore, 'client'> | Pick<ChatClient, 'getState'>;

export interface AngularReadTrackerOptions
  extends Omit<ReadTrackerOptions, 'getMessages'> {
  /**
   * Tear down on this `DestroyRef`. Defaults to the ambient one when created
   * inside an injection context. Pass `null` to own `destroy()` yourself.
   */
  destroyRef?: { onDestroy: (callback: () => void) => void } | null;
}

function getStateOf(source: ReadTrackerSource): ChatClient {
  return 'client' in source ? source.client : (source as ChatClient);
}

/**
 * Tracks which message rows are rendered and which are actually on screen,
 * reporting each through its own callback.
 *
 * ```ts
 * readonly chat = injectChatStore();
 * readonly tracker = createReadTracker(this.chat, {
 *   root: this.listElement.nativeElement,
 *   onDelivered: (seq) => this.chat.client.markRead(),
 *   onRead: (id) => console.log('read up to', id),
 * });
 * ```
 *
 * SSR-safe: `IntersectionObserver` is only ever touched behind a `typeof`
 * guard inside the tracker, so a server render registers rows and observes
 * nothing.
 */
export function createReadTracker(
  source: ReadTrackerSource,
  options: AngularReadTrackerOptions,
): ReadTracker {
  const { destroyRef: destroyRefOption, ...trackerOptions } = options;
  const client = getStateOf(source);

  const tracker = createBrowserReadTracker({
    ...trackerOptions,
    // Read at FLUSH time, never captured: the debounce window is 600ms, and an
    // ack can assign a `seq` inside it to a row that had none when it
    // registered.
    getMessages: () => client.getState().messages,
  });

  const destroyRef = destroyRefOption === undefined ? injectIfAvailable(DestroyRef) : destroyRefOption;
  destroyRef?.onDestroy(() => tracker.destroy());

  return tracker;
}
