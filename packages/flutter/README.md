# `dhaam_chat_flutter` — Flutter UI for the Dhaam chat widget

The screens, navigation and state container that turn `dhaam_chat`'s streams
into something a customer can look at. This is a **library a host app mounts**,
not an app: `ChatWidget` builds a scoped `Theme` and a `Scaffold` and no
`MaterialApp` of its own, because it is meant to live inside a route, a modal
or a pane that the host owns.

There is a runnable host app in [`example/`](example/). If you want to see this
work rather than read about it, start there — [Running the
example](#running-the-example) below.

---

## The three packages, and why the split is where it is

| Package | What it is | Depends on |
|---|---|---|
| `packages/dart` — `dhaam_chat` | The WebSocket protocol client. Pure Dart, **no HTTP dependency at all**, no Flutter. Frames, sessions, messages, resume, backoff. | `web_socket_channel` |
| `packages/dart_rest` — `dhaam_chat_rest` | The REST surface the socket deliberately does not speak: history pagination, `POST /upload`, session close/reopen, CSAT, the session picker, identify, `ip-watermark`. Pure Dart, no Flutter. | `dhaam_chat`, `http`, `http_parser` |
| `packages/flutter` — `dhaam_chat_flutter` | **This package.** Widgets, `ChatWidgetCubit`, the remote-config model, the theme layer. | `dhaam_chat`, `dhaam_chat_rest`, `flutter_bloc`, `http`, `url_launcher`, `file_picker`, `mime` |

**The dependency runs one way.** `dhaam_chat` imports nothing from
`dhaam_chat_rest`, and that is asserted by a test
(`packages/dart_rest/test/no_core_import_test.dart`) rather than left as a
convention. Its zero-HTTP boundary is the reason `dhaam_chat_rest` exists as a
separate package instead of living inside it.

This is deliberately **the opposite** of the TypeScript pair, where
`@dhaam-ccrm/rest` imports nothing from `@dhaam-ccrm/core`. That invariant
exists in TS to keep `rest` installable standalone, because `createChatClient`
accepts five independently-substitutable structural seams. Nothing in this
workspace composes a Dart `ChatClient` and a REST layer behind such a function,
so enforcing it here would protect nothing while costing two incompatible
`TokenProvider` types, a duplicated `PublishableKey.parse` (which carries the
secret-key-in-client refusal), and parallel message/attachment hierarchies
needing a translation layer in this package.

### This package does not modify `packages/dart`

`ChatClientAdapter` wraps a `ChatClient` to satisfy `WidgetChatClient` by
delegation, rather than having `ChatClient` implement that interface directly.
That is the boundary: `dhaam_chat` is a protocol client with its own tests and
its own consumers, and a Flutter-shaped interface on it would be this package
reaching upward into a package that must not know Flutter exists. The narrowing
also buys something concrete — `WidgetChatClient` is small enough that every
widget test in this package drives the Cubit with a fake and never opens a
socket.

### Why `Cubit` and not `Bloc`

Both sibling apps (`dh-customer-app-flutter`, `dh-merchant-app-flutter`)
standardise on `flutter_bloc` `^9.1.1`, so that choice was made before this
package existed. Within it, `ChatWidgetCubit` is a `Cubit` for the same reason
`dh-customer-app-flutter`'s own `ConnectivityCubit` is one: the job is mirroring
an external source's streams into widget-renderable state via direct method
calls, not routing a taxonomy of discrete user-typed events through
transformers. `flutter_bloc` is the one pattern; Cubit vs Bloc is a style choice
inside it, not a second pattern introduced alongside it.

### The host publishes appearance; the host cannot override it

`remote-config.ts` supports a host-precedence merge — a host passes appearance
fields that win over the console publish. **That does not carry over here, and
it is a deliberate divergence rather than an omission.** The console publish
remains the single source of truth for appearance on Flutter, which means a
Flutter host **cannot pin an appearance field against a publish**. The
consequence inside the code is that this package never builds the fully-resolved
appearance shape TS's `config.ts` uses: the published, possibly-partial reading
is the only one that exists, which is why `appearance.dart`'s fields are
nullable on one class rather than wrapped in a second `Partial<T>`-shaped type.

---

## Running the example

```bash
cd packages/flutter/example
flutter pub get

flutter run \
  --dart-define=DHAAM_WS_URL=wss://chat.your-host.example \
  --dart-define=DHAAM_API_URL=https://api.your-host.example \
  --dart-define=DHAAM_PUBLISHABLE_KEY=pk_test_yourkey \
  --dart-define=DHAAM_ACCESS_TOKEN=your.jwt.here
```

You land on a plain host screen — the merchant's app — with an **Open chat**
button that pushes the panel, plus a diagnostics section showing what the
config fetch and `captureContactInfo` came back with, and which seams this
example was able to wire.

**Nothing is hardcoded and there are no defaults.** Launch it with a key
missing and you get a page naming every key that is missing and the command to
fix it — not a stack trace, and not a socket retrying in backoff forever under
the word "Connecting…". That page is the point: `PublishableKey.parse` throws
and `ChatClient` retries silently, so an unvalidated config fails in whichever
of those two ways is least legible.

### The `--dart-define` keys

| Key | Required | What it is |
|---|---|---|
| `DHAAM_WS_URL` | yes | The WebSocket endpoint. `ws://` or `wss://`. Goes to `ChatClient(wsUrl:)`. |
| `DHAAM_API_URL` | yes | The REST **origin**, `http://` or `https://`, **with no path** — `RestClient`, `fetchRemoteConfig` and `fetchIpWatermark` each append `/chat-services/api/v1` themselves. Passing a value that already carries the base path builds a doubled one, and the symptom (every REST call 404s while the socket works fine) is hard to read backwards, so the example refuses it up front. |
| `DHAAM_PUBLISHABLE_KEY` | yes | The tenant key, `pk_live_…` or `pk_test_…`. Public by design: it identifies a tenant and grants nothing. |
| `DHAAM_ACCESS_TOKEN` | yes | A user JWT for this run. **See the warning below.** |
| `DHAAM_SESSION_ID` | no | A conversation to open on. Unset lands on Home, which is what a visitor arriving fresh sees. |

`--dart-define` rather than a checked-in constant or a `.env` file: one of these
values is a credential, a constant would put it in git history, and a `.env`
file would need a plugin, an asset entry and a `.gitignore` rule to end up no
safer.

### The static token is an example-only shortcut

`ChatClient` and `RestClient` both take `TokenProvider`, which is
`Future<String> Function()` — a **callback**, never a string. §6.1 requires it
to be structurally impossible to pass a static token in place of one, and in
Dart that is free, because a `String` is not a `Future<String> Function()`.

A real host implements it as a call to **its own backend**, which holds the
secret key and mints a short-lived token via `POST /tokens`. The secret key
never travels to the device, and both clients re-read the callback on every
connect, reauth and request, so a refreshed token is picked up without
restarting anything.

The example closes over a string from `--dart-define` and returns the same
value every time, which means a run outlives its token by exactly as long as the
token had left. That is the one place in `example/seams.dart` where copying the
code verbatim into a production host would be wrong, and it says so in place.

---

## Host platform entries

The package cannot add these for you; they belong to the app that ships it.

### macOS — `macos/Runner/{DebugProfile,Release}.entitlements`

```xml
<key>com.apple.security.network.client</key>
<true/>
<key>com.apple.security.files.user-selected.read-only</key>
<true/>
```

* **`com.apple.security.network.client`** — required for *any* outbound
  request under App Sandbox. `flutter create` scaffolds only
  `network.server`, which is for the debug VM service, so without this the
  chat socket and every REST call fail with `SocketException: Connection
  failed (OS Error: Operation not permitted, errno = 1)`.
  ([Flutter macOS docs](https://docs.flutter.dev/platform-integration/macos/building))
* **`com.apple.security.files.user-selected.read-only`** — the *User Selected
  File Read* entitlement the attachment picker needs. `file_picker` 11.0.3's
  own `pickFiles` doc states it verbatim: *"Note: This requires the User
  Selected File Read entitlement on macOS."* Read-**only**, not read-write:
  the plugin's own example asks for the wider one because it also demonstrates
  `saveFile`, and this SDK never writes a file back.

### Android — `android/app/src/main/AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.INTERNET"/>
```

`flutter create` puts `INTERNET` in `src/debug` and `src/profile` only, where
the Flutter tool needs it for hot reload — **not** in `main`. A host that never
adds this line debugs perfectly and then cannot connect at all once shipped.

### iOS — nothing

`file_picker` 11.0.3 declares no `uses-permission` on Android and no
`NSUsageDescription` keys on iOS (its Android manifest carries a `<queries>`
block and nothing else). No other dependency of this package needs one either.

### Microphone — not yet

`NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` and
`RECORD_AUDIO` are **not** listed here, because there is no voice module:
`lib/src/ui/voice/` does not exist. Add them when it does, and not before —
a permission string for a feature that cannot run is a prompt a customer is
asked to answer for nothing.

---

## What is not wired yet

The parity port is not finished, and the honest list matters more than the
green test count. Everything below is a real gap between this package and
`packages/widget/src/**`, not a rough edge.

**A customer cannot attach a file.** `AttachmentDraftController`,
`AttachmentAttachButton` and `AttachmentDraftBar` exist, are tested, and are
referenced by nothing outside their own module — `conversation_screen.dart`
builds its `Composer` with no attach controls. The seam
(`AttachmentPicker`/`AttachmentUploader`) and the real `file_picker`
implementation are both there; only the composer hop is missing.

**No Retry button renders on a failed message.** `dhaam_chat`'s
`MessageDelivery` is a bare enum carrying neither a failure reason nor
`retryable`, so no per-message failure can be surfaced at all. The message list
was built to render nothing rather than to guess, which is why the absence looks
like a missing feature rather than a broken one.

**The Reply action does not render.** Message actions ship Copy and Reply;
Reply's affordance is absent because there is no reply *target* that survives a
rebuild (no `ChatWidgetState.replyingTo`) and no reply chip above the composer.
Copy works. The wire hop exists — `sendMessage` already takes
`replyToMessageId`.

**"Start a new conversation" cannot start one.** `dhaam_chat`'s `ChatClient` has
no `startNewSession`, and `connectionHelloPayload` has no `newSession`,
`subject` or `topic` field. The topic chip resolves its label correctly and
there is nowhere to send it.

**The conversation app bar shows a stale agent.** `IdentityHeader`,
`HeaderAvatar` and `HeaderMenu` are built and tested, and
`chat_widget.dart`'s `_ConversationAppBar` does not use any of them: it
re-derives the title as `session?.handledBy?.displayName ?? 'Conversation'`,
with no `isHandledByCurrent` gate, so a session reactivated to
`WAITING_FOR_AGENT` keeps its previous agent's name — and the fallback is the
literal `'Conversation'` rather than the merchant's configured title.
`agent.joined`/`agent.left` also never reach `ChatWidgetState.session`, so the
header cannot update mid-conversation.

**Nothing plays the chime.** `Chime` and `playSystemChime` exist; no code in
this package constructs a `Chime`, so no message arrival reaches a player.
`HeaderMenu`, which owns the mute state its `play` needs, is not mounted either.

**`captureContactInfo` has nowhere to deliver.** `dhaam_chat_rest` captures
user agent, IP, watermark and geolocation through a `ContactInfoSink`, and
`connectionHelloPayload` has no field for any of it — `token`,
`publishableKey`, `protocolVersion`, `resumeFrom` and nothing else. The example
displays what it captured because displaying it is the only consumer that
exists.

**Consent gate, offline form, and the hero-header collapse-oscillation guard**
are not ported (`lib/src/ui/consent_offline/` does not exist). Voice input is
not ported. `mergeRemoteConfig` host-precedence is deliberately not ported (see
above). ADR `docs/adr/0005-flutter-parity-scope.md`, which is to record the
full deliberately-N/A table, is not written yet.

### Deliberately not ported, and not coming

`embed.ts` (script-tag entry), `attributes.ts` (`data-*` → config — it cannot
even express `identity.profile`), `singleton.ts` (one widget per page across
separately-evaluated bundle copies; pub guarantees one copy, and multi-instance
is the *normal* case in Flutter), `ui/dom.ts`, `ui/focus.ts`,
`ui/platform-color.ts` (it samples the **host page's** computed colours, and
there is no host page), `ui/presentation.ts`, `ui/styles.ts`, `ui/root.ts`, and
the launcher/auto-open/**exit-intent** cluster. Exit-intent is structurally
impossible — it fires on a pointer leaving the document toward *browser
chrome* — and the widget already degrades it to `'never'` on touch devices, so
omitting it is behaviourally identical to the web widget on the same class of
device. Those fields are parsed and exposed; nothing acts on them.

---

## Tests

```bash
cd packages/flutter && flutter test
```

`packages/flutter/example` has its own small suite (`flutter test` from inside
`example/`) covering the one behaviour there whose failure mode is a runtime
one: an unset `--dart-define` produces a page rather than a crash.

`dart format` is **not** clean on this package and that is known: it is written
at a wider line length than the formatter's fixed 80 columns, and the one-shot
reformat is deliberately deferred so it does not collide with in-flight work.
(`dart format --output=none --set-exit-if-changed lib test` reports 43 of 148
files changed as of this writing — a figure worth re-measuring rather than
quoting, which is why the command is here and the number is parenthetical.) The CI job runs `analyze --fatal-infos`
and `test` here, and keeps its format gate on `packages/dart` and
`packages/dart_rest`, which are both clean.
