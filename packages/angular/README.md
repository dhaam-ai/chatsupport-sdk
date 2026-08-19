# `@dhaam-ccrm/angular`

Angular bindings for [`@dhaam-ccrm/core`](../core). One injectable store that
projects core's observable snapshot store onto Angular **signals**, plus the
§6.5 event catalog with `DestroyRef`-driven teardown.

Everything else — WebSocket transport, reconnect and backoff, message ordering
and dedup, the offline send queue, token refresh, read/delivery watermarks — is
core's, and is tested there. This package is a reactivity mapping and nothing
else.

## Install

```sh
pnpm add @dhaam-ccrm/angular @dhaam-ccrm/core
```

`@angular/core` is a **peer dependency**, minimum **18.0.0** (see
[Versions](#versions)). There is no `rxjs` peer dependency — see
[Signals, not Observables](#signals-not-observables).

## Quick start

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideChatClient } from '@dhaam-ccrm/angular';

bootstrapApplication(AppComponent, {
  providers: [
    provideChatClient({
      publishableKey: 'dhp_live_…',
      getToken: () => fetch('/api/chat-token').then((r) => r.text()),
      wsUrl: 'wss://chat.example.com/ws',
      localSender: { senderId: currentUserId, senderType: 'CUSTOMER' },
      history: { listMessages: (opts) => api.listMessages(opts) },
    }),
  ],
});
```

`provideChatClient` also accepts a `ChatClient` you built yourself, in which
case you own its `connect()`/`disconnect()` lifecycle. It returns
`EnvironmentProviders`, so it goes in the application config or a lazy
`Route.providers` — scoping the client, and its teardown, to that route
subtree while leaving an outer one untouched. That is deliberately the smallest
scope on offer: a store per component instance would mean a socket per
component instance. Outside DI entirely, `createChatStore(client)` gives you a
store you own and `destroy()` yourself.

```ts
@Component({
  selector: 'app-chat',
  template: `
    <p>{{ chat.connectionState() }}</p>

    @for (row of rows(); track row.message.id) {
      <li>{{ row.message.content }} — {{ row.tick }}</li>
    }

    @if (chat.typing().isTyping) { <p>typing…</p> }

    <span class="badge">{{ chat.unreadCount() }}</span>
    <button (click)="chat.sendMessage(draft)">Send</button>
  `,
})
export class ChatComponent {
  readonly chat = inject(CHAT_STORE);
  private readonly me = inject(CURRENT_USER_ID);

  // One signal, built once. `select`/`tickState` return a NEW signal per call,
  // so never call them from a template expression.
  readonly rows = this.chat.select((state) =>
    state.messages.map((message) => ({
      message,
      tick: deriveTickStateFromState(state, message, this.me),
    })),
  );

  constructor() {
    // Unsubscribes with this component — no manual bookkeeping.
    this.chat.on('error', (error) => this.toasts.show(error.message));
  }
}
```

For a single message — a bubble component with a signal `input()` — pass the
signal straight to `tickState` and it stays reactive to it:

```ts
export class MessageBubble {
  readonly messageId = input.required<string>();
  readonly tick = inject(CHAT_STORE).tickState(this.messageId, inject(CURRENT_USER_ID));
}
```

## API

| Symbol | What it is |
| --- | --- |
| `provideChatClient(clientOrConfig)` | `EnvironmentProviders` wiring `CHAT_CLIENT` and `CHAT_STORE` into an injector |
| `CHAT_STORE` | `InjectionToken<ChatStore>` — the store |
| `CHAT_CLIENT` | `InjectionToken<ChatClient>` — the raw client |
| `injectChatStore()` / `injectChatClient()` | named `inject(...)` calls |
| `createChatStore(client, options?)` | builds a store outside DI (tests, plain functions) |
| `defaultIsEqual` / `shallowEqual` | selector equalities for `ChatStore.select` |

`ChatStore` exposes every §6.4 field as a `Signal` (`state`, `connectionState`,
`session`, `messages`, `typing`, `unreadCount`, `pagination`, `uploading`,
`pastSessions`, `readWatermarks`, `deliveredWatermarks`, `presence`,
`lastError`), plus:

- `select(selector, isEqual?)` — a derived signal that only changes when the
  *selected* value does. `isEqual` defaults to `Object.is`; pass `shallowEqual`
  for a selector that builds a new object from several fields.
- `tickState(messageId, localParticipantId)` — the delivery tick, derived by
  core's `deriveTickState` and nothing else. Both arguments accept a signal.

  > `select` and `tickState` each build a **new** signal per call. Call them
  > once — a class field — never from a template expression.
- `on(event, handler, options?)` — §6.5 events. Adopts the ambient `DestroyRef`
  when called inside an injection context; otherwise the returned
  `Unsubscribe` is yours. `{ destroyRef }` overrides either way, and
  `{ destroyRef: null }` opts out. Either way the store itself is a backstop:
  `destroy()` releases every handler still live, so nothing it registered can
  outlive it.
- every §6.2/§6.3 operation, forwarded verbatim to the client.
- `client` — the escape hatch — and `destroy()`, which the injector calls for
  you.

Core's types and its list algebra (`sortMessages`, `upsertMessage`, …) are
re-exported so a consumer never needs a second dependency entry.

## Signals, not Observables

Core's store is a synchronous, reference-stable snapshot store: `getState()` is
readable at any instant and returns the identical reference until something
actually changes. That is a signal's contract exactly. An `Observable` has no
current value and needs a `BehaviorSubject`/`shareReplay(1)` to fake one, plus
cold/hot and late-subscriber rules core does not have.

Two more reasons the choice is not close:

- `computed(fn, { equal })` **is** the selector cache PRD §6.4 makes every
  binding write, already built and already correct: on an `equal` hit Angular
  keeps the previous value and does not bump the signal version, so nothing
  re-renders. The React binding hand-rolls the same thing with a
  `{ raw, selected }` ref.
- The signal graph is glitch-free. A consumer selecting two fields at once can
  never observe an intermediate state, which `combineLatest` over two RxJS
  selectors can.

**On an RxJS codebase you lose nothing.** `toObservable(store.messages)` from
`@angular/core/rxjs-interop` is a one-liner, and because it is *derived from*
the same signal rather than being a second subscription to the client, the two
consumers cannot disagree. Shipping both surfaces from this package would have
created exactly that second source of truth.

§6.5 events are deliberately not signals: an event is an occurrence, not a
state, and two identical `typing` frames must both be delivered. `on()` stays a
plain subscription.

## Zone.js

A `message` frame arrives on a socket callback that may or may not be inside
Angular's zone. If change detection does not run, the data is right, the
signals are right, every test is green — and the UI silently goes stale. Two
mechanisms cover it:

1. **Structural.** Since Angular 18, a signal write that dirties a consumer
   notifies Angular's change-detection scheduler, which schedules
   `ApplicationRef.tick()` *regardless of which zone the write happened in* —
   the same mechanism that makes zoneless apps work. This binding's only push
   into Angular is one `signal.set(...)`, so it inherits that guarantee.
2. **Belt and braces.** If an `NgZone` is reachable and the notification
   demonstrably arrived outside it, the write is wrapped in `ngZone.run(...)`.
   Not redundant: `provideZoneChangeDetection({ ignoreChangesOutsideZone: true })`
   switches mechanism 1 off by design.

`provideZonelessChangeDetection()` is fully supported and needs no extra
configuration. zone.js is never imported by this package.

## Versions

| | |
| --- | --- |
| `@angular/core` | `>=18.0.0` (peer) |
| `rxjs` | not required |
| `zone.js` | optional |

Angular 18 is the floor because it is the first release where a signal write
schedules change detection independently of zone.js, and the first with a
zoneless mode. Nothing in `src/` needs an API newer than 17.2, but 16/17 are
untested and would rely on mechanism 2 alone.

## Testing

Every test in this package runs in vitest's default `node` environment — no
jsdom, no zone.js (except the one file that tests zone re-entry and imports it
explicitly), no `TestBed`, no `@angular/compiler`, no
`@angular/platform-browser`. `test/angular-test-host.ts` builds a real
`EnvironmentInjector` with a manually-flushed effect queue; that file is the
only place any Angular internal is touched, and `src/` is scanned by
`test/source-invariants.test.ts` to prove the shipped package touches none.

The package runs the shared
[`@dhaam-ccrm/binding-conformance`](../binding-conformance) suite against its
own public API, which is what keeps it behaving identically to the React, Vue,
and vanilla bindings.

## DOM-side stores

Voice recording, waveform decode, and read tracking are implemented in
[`@dhaam-ccrm/browser`](../browser), a framework-free package with zero
dependencies. The Angular factories here (`createVoiceRecorder`,
`createAudioWaveform`, `createReadTracker`) are thin wrappers that wire those
state machines to Signal lifecycle and the DI context.

### Voice recording

```ts
import { createVoiceRecorder } from '@dhaam-ccrm/angular';
import { Component, effect } from '@angular/core';

@Component({
  selector: 'app-voice-recorder',
  template: `
    <button (click)="recorder.startRecording()" [disabled]="recorder.status() !== 'idle'">
      {{ recorder.status() === 'recording' ? 'Stop' : 'Record' }}
    </button>
    <span *ngIf="recorder.status() === 'recording'">Amplitude: {{ recorder.amplitude() }}</span>
  `,
})
export class VoiceRecorderComponent {
  readonly recorder = createVoiceRecorder();

  stopAndSend() {
    const result = this.recorder.stopRecording();
    if (result.status === 'success') {
      this.chat.sendAttachment({ blob: result.blob });
    }
  }
}
```

### Waveform

```ts
import { createAudioWaveform } from '@dhaam-ccrm/angular';
import { Component } from '@angular/core';

@Component({
  selector: 'app-waveform',
  template: `
    <div class="waveform" *ngIf="waveform().status === 'success'">
      <div *ngFor="let peak of waveform().peaks" [style.height]="peak * 100 + '%'"></div>
    </div>
  `,
})
export class WaveformComponent {
  waveform = createAudioWaveform(() => this.message().attachment?.blob);

  constructor(private message: MessageSignal) {}
}
```

### Read tracking

```ts
import { createReadTracker } from '@dhaam-ccrm/angular';
import { Component, afterRender } from '@angular/core';

@Component({
  selector: 'app-read-tracker',
})
export class ReadTrackerComponent {
  private readonly tracker = createReadTracker({
    getMessages: () => this.chat.messages(),
    onRead: (ids, watermark) => this.chat.markRead(watermark),
  });

  constructor() {
    afterRender(() => {
      this.tracker.registerElements(
        this.chat.messages().map((m) => ({
          id: m.id,
          element: document.getElementById(m.id),
        }))
      );
    });
  }
}
