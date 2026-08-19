// One `WidgetConfig` in, one live `ChatStore` out.
//
// This is the file that earns the widget its "drop-in" claim. examples/demo
// does the same assembly in ~140 lines that an integrator has to read,
// understand, and keep correct — the generic type arguments on the REST
// factories, the seconds-vs-milliseconds token conversion, the shared token
// cache between core and REST. None of that is interesting to someone who
// wants a chat bubble on their food-ordering page, so it lives here once.

import { createChatStore } from '@dhaam-ccrm/js';
import type { ChatStore } from '@dhaam-ccrm/js';
import type {
  AttachmentMetadata,
  ChatClientConfig,
  ChatMessage,
  ChatSession,
} from '@dhaam-ccrm/core';
import { createChatClient } from '@dhaam-ccrm/core';
import {
  RestClient,
  createAttachmentUploader,
  createHistorySource,
  createSessionActions,
} from '@dhaam-ccrm/rest';

import { createTokenSource } from './auth.js';
import type { ResolvedConfig } from './config.js';

/**
 * Builds the client and wraps it in `@dhaam-ccrm/js`'s store.
 *
 * The store, not the raw client, because everything the UI below does is
 * "call me when this slice of state changes" — which is precisely the one job
 * `@dhaam-ccrm/js` exists to do, with per-subscription selector caching this
 * package would otherwise have had to write itself. `store.client` remains
 * reachable for the ~18 imperative operations (§6.2/§6.3).
 */
export function createWidgetStore(config: ResolvedConfig): ChatStore {
  const { publishableKey, tokens } = createTokenSource(config);

  const rest = new RestClient({
    apiUrl: config.apiUrl,
    publishableKey,
    getAccessToken: tokens.getAccessToken,
  });

  const clientConfig: ChatClientConfig = {
    publishableKey,
    getToken: tokens.getToken,
    apiUrl: config.apiUrl,
    wsUrl: config.wsUrl,

    // A page-embedded widget is always the customer side. An agent console is
    // a different product with a different token, and guessing wrong here
    // mislabels every optimistic echo the user sees.
    localSender: { senderId: config.identity.userId, senderType: 'CUSTOMER' },

    // The explicit type arguments are load-bearing, not decoration: these
    // factories are generic over the wire shape and infer `unknown` without
    // them, which then fails to satisfy core's seam interfaces.
    history: createHistorySource<ChatMessage>(rest),
    uploader: createAttachmentUploader<AttachmentMetadata>(rest),
    sessionActions: createSessionActions<ChatSession>(rest),

    // §14: core promises this never receives credentials or message content,
    // so routing it to the host's error sink is safe. Only `warn`/`error` are
    // forwarded — `debug` on a customer's production page is noise they did
    // not ask for.
    logger: (level, message) => {
      if (level === 'warn' || level === 'error') config.onError(`[chat-sdk] ${message}`);
    },
  };

  return createChatStore(createChatClient(clientConfig), { onError: config.onError });
}
