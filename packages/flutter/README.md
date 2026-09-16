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


### The access token is minted by YOUR backend, not by an identity provider

This is the single most common way to get a working setup that will not
connect. `DHAAM_ACCESS_TOKEN` is **not** a Cognito/Auth0/Firebase token, and
not your app's own session JWT. The chat service issues its own short-lived,
scoped token:

```
POST /chat-services/api/v1/tokens
Authorization: Bearer <dhk_test_… secret key>
Content-Type: application/json

{"userId": "...", "name": "..."}
  ->  {"accessToken": "...", "expiresIn": 3600}
```

Called by your **backend**, with your secret key, which must never reach a
client (`openapi/chat-api.yaml:434`, PRD §10.3). Your frontend relays only the
resulting `accessToken`.

Handing the SDK an IdP token instead produces `AUTH_INVALID`, and the client
correctly stops after its auth cap — leaving you looking at
"authentication failed repeatedly" holding a token that is present, unexpired
and visibly a JWT. The example app decodes the token's *shape* (never its
signature) and names this case explicitly in its diagnostics strip.

### Guests need a token too — the profile is what makes a customer

There is no tokenless mode, and this is worth stating because the opposite is
a natural thing to assume: "nobody has logged in, so there is nothing to
authenticate." Every visitor needs a token, and a guest's token identifies an
anonymous **visitor**. The reference refuses a config carrying neither a
`tokenEndpoint` nor a `getToken` and gives the reason outright — "the browser
is never given a secret key, so a token has to come from your own backend"
(`packages/widget/src/config.ts`, `resolveConfig`). A Flutter app is in the
same position: it ships to devices, so it cannot hold the secret key either.

What marks somebody as a **known customer** is a different input entirely:

| | token | `identity.profile` |
|---|---|---|
| What it is | a credential, minted by your backend | data your app already has |
| Guest | **required** | omitted |
| Signed-in customer | **required** | supplied |
| Effect of omitting it | cannot connect at all | treated as a guest — the pre-chat form is asked |

`identity.userId` decides nothing here. Every visitor has one — chat-service
mints one the moment the socket acks — so a gate built on it never fires for
anybody, and `ChatIdentity.isGuest` is deliberately `profile == null` and
nothing else. `packages/widget/src/config.ts` says the same from the other
end: "Supplying it — and only supplying it — is what makes the widget upsert
that user as a Contact via `POST /identify`. `userId` alone does not and must
not, because every guest has one of those too."

The example demonstrates both modes: supply the token, then use the **Visitor**
switch on the host screen. The user id stays the same across it and only the
profile moves, which is the whole point.

### "My signed-in customer is still being asked for their name"

Reported twice, by two different integrators, both of whom had authenticated
the customer properly. Both were right about their end and the widget was
right about its end: `identity` **defaults to `ChatIdentity.guest`**, so a
host that passes a perfectly good customer token and nothing else has, as far
as this package can tell, described an anonymous visitor. It cannot tell
otherwise — the token is opaque to it by design, and the `userId` it can see
belongs to guests too.

The fix is one parameter:

```dart
ChatWidgetCubit(
  client: client,
  // Presence of the PROFILE is the fact. An empty
  // `ChatParticipantProfile()` is enough when that is all you know.
  identity: const ChatIdentity(
    userId: 'cus_1042',
    profile: ChatParticipantProfile(
      name: 'Jordan Rivera',
      email: 'jordan@example.com',
    ),
  ),
);
```

Since it could not be detected, it is at least now **said out loud**: the first
time the widget is about to put the merchant's pre-chat questions in front of a
visitor it considers a guest, it prints a short explanation of the above to the
console (`warnIfAskingAGuestForDetails`, in
`lib/src/ui/pre_chat/guest_pre_chat_warning.dart`).

**All three places those questions can appear are covered**, because the line
hangs off `preChatFieldsToAsk` — the one function that decides which fields to
draw, and the only way any of them can draw any:

* the standalone pre-chat gate, in front of an empty conversation;
* the **new-conversation form**, where the questions are folded in above the
  message box (this is where `startNewConversation()` lands, so it is the
  likeliest one to meet);
* the **out-of-hours offline form**.

The exact terms:

* **Debug builds only.** Not release — and not profile either; the check is
  `kDebugMode`, which is false in both.
* **Once per app run.** Not once per widget and not once per Cubit: three
  surfaces can each ask, a rebuilt `BlocProvider` would ask again, and two of
  the three re-run the gate on every repaint. One line says it once.
* **Nothing about the visitor or the credential.** The message is a `const`
  with no interpolation in it; the package cannot see the token at all.
* **Silent for a host that passed a profile**, and silent for a guest nobody
  asks anything — a merchant who never switched pre-chat on never sees it.

A genuinely guest-only deployment can ignore it: the line names the fix rather
than a fault, and it does not appear at all until the questions actually come
up.


## Running the example

```bash
cd packages/flutter/example
flutter pub get

flutter run \
  --dart-define=DHAAM_WS_URL=wss://chat.your-host.example \
  --dart-define=DHAAM_API_URL=https://api.your-host.example \
  --dart-define=DHAAM_PUBLISHABLE_KEY=dhp_test_yourkey \
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
| `DHAAM_PUBLISHABLE_KEY` | yes | The tenant key, `dhp_live_…` or `dhp_test_…` — **not** `pk_…`, which `PublishableKey.parse` refuses (a bare `pk_test_` is Stripe's shape, and secret scanners report such a key as a Stripe key). Public by design: it identifies a tenant and grants nothing. |
| `DHAAM_ACCESS_TOKEN` | yes | A user JWT for this run — required for **every** visitor, guests included. **See the warning below.** |
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
<key>com.apple.security.device.audio-input</key>
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
* **`com.apple.security.device.audio-input`** — *Audio Input*, which a
  sandboxed app needs before it can open a capture device at all. `record`'s
  own setup notes say to activate it "in debug AND release schemes, or
  directly in `*.entitlements` files", which is why it belongs in **both**
  `DebugProfile.entitlements` and `Release.entitlements` rather than one of
  them. macOS also needs `NSMicrophoneUsageDescription` in
  `macos/Runner/Info.plist` — the entitlement lets the app open the device,
  the plist string explains the prompt, and missing either one fails
  differently.

### Android — `android/app/src/main/AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
```

`flutter create` puts `INTERNET` in `src/debug` and `src/profile` only, where
the Flutter tool needs it for hot reload — **not** in `main`. A host that never
adds this line debugs perfectly and then cannot connect at all once shipped.

`RECORD_AUDIO` is declared by `record_android` 1.5.2's own manifest and would
merge in regardless; it is written out because a permission users are asked
for at runtime should be visible in the host's own manifest rather than
arriving invisibly through a transitive dependency.

**Android also needs `minSdk 23`**, in `android/app/build.gradle`:

```gradle
defaultConfig {
    minSdk = 23  // not flutter.minSdkVersion, which is 21
}
```

`record_android` declares `minSdk = 23`, so the Flutter 3.24.4 default of 21
fails the manifest merge outright — `uses-sdk:minSdkVersion 21 cannot be
smaller than version 23 declared in library [record_android]`. A build error
rather than a runtime one, which is the good kind, but a real cost this
dependency imposes.

### iOS — `ios/Runner/Info.plist`

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Record a voice message to send to the support team.</string>
```

`record_ios` links AVFoundation, so this is required of any host that
**builds** against this SDK, not only one that shows the voice button — App
Store review rejects a binary that links the framework without it. Write it
for the person reading the prompt; Apple rejects boilerplate.

`NSSpeechRecognitionUsageDescription` is deliberately **not** required. It
belongs to speech recognition, which this SDK does not do: the voice button
records audio and uploads it for an agent to listen to, and nothing here
transcribes anything. Declaring it would ask a host to justify a capability
to Apple that their binary does not have.

`file_picker` 11.0.3 itself needs no `NSUsageDescription` key on iOS and no
`uses-permission` on Android (its Android manifest carries a `<queries>`
block and nothing else).

### Microphone — not yet

`NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` and
`RECORD_AUDIO` are **not** listed here, because there is no voice module:
`lib/src/ui/voice/` does not exist. Add them when it does, and not before —
a permission string for a feature that cannot run is a prompt a customer is
asked to answer for nothing.

---

## The notification sound

`behaviour.sound` in the console — "Plays on the visitor's side when a reply
arrives". Two parties have to agree before anything is heard: the merchant
enabled it, and this visitor has not silenced it. `RemoteConfig.sound`
defaults to **false**, and that default is load-bearing — a config that could
not be read is not consent to make noise on somebody's device.

**It works on a fresh install, with no host wiring.** That is a change: the
chime used to play through `SystemSound.alert`, which Flutter documents as
ignored on Android, iOS and web, so on every platform a customer actually uses
the sound did not exist. The default player now plays a bundled asset through
`audioplayers`.

**The asset** is `assets/chime.wav` — 11,952 bytes of 16-bit mono PCM at
22.05 kHz, 0.27 s. It is the web widget's own chime rendered to a file: the
rising fifth (660 Hz, then 990 Hz at +90 ms) that `packages/widget/src/ui/chime.ts`
builds from two WebAudio oscillators, with the same exponential envelope, and
sine rather than square for the reason that file gives — a chime is heard on
top of whatever the visitor is already doing, and a harmonically rich waveform
at the same loudness is the one people call harsh. It is generated, not found:
`test/support/reference_chime.dart` is the source, and
`test/ui/header/chime_asset_test.dart` asserts the committed bytes really are
that chime — correct sample format, two notes at the right frequencies, not
silent, not clipped, fading rather than clicking at the end. It is registered
under `flutter: assets:`, so it ships with any app that depends on this
package and needs no entry in yours.

**It costs you no new platform permission.** None, on any of the six targets —
`audioplayers_android`'s manifest declares no `uses-permission` at all, and
`audioplayers_darwin` ships no privacy manifest and touches no capture API.
That is the difference between playing a file and opening a microphone, and it
is why `record` (above) obliges you to write `Info.plist` and manifest entries
and this does not. What it does cost is native audio code linked on six
platforms; `pubspec.yaml`'s entry states the trade in full, including the
`just_audio` and `soundpool` alternatives that were rejected and why.

**To use your own sound instead**, hand over a player. The seam is one
closure, and the package builds it at most once — on the first chime that
actually passes both gates, so a muted visitor allocates nothing:

```dart
ChatWidget(
  cubit: cubit,
  chime: Chime(createPlayer: () => () async => myPlayer.play('ping.mp3')),
);
```

`playSystemChime` is still exported for a desktop-only host that would rather
use the system alert than ship 12 KB: `Chime(createPlayer: () => playSystemChime)`.

**A failure here is always silent.** A platform with no output device, a
missing plugin, a host player that throws — all end in nothing happening and
nothing thrown. This runs on the message-arrival path, where a sound is by far
the least important thing occurring, and the alternative is an exception raised
while a customer is being handed a reply.

---

## Remembering the visitor's decisions

Two things in this package are a decision the person in front of the screen
made and expects to survive the app closing: whether they **agreed to the
merchant's consent notice**, and whether they **silenced the chime**. Both go
through one seam, `ChatStorage` (`lib/src/storage/chat_storage.dart`), and
both are keyed per publishable key — `chatsdk:<publishableKey>:consent` and
`chatsdk:<publishableKey>:muted`, the same key shape the web widget writes to
`localStorage`, so two tenants on one device cannot answer for each other.

**The default forgets.** A host that wires nothing gets `MemoryChatStorage`:
each decision is honoured for as long as the widget is up and asked again on
the next mount. That is not a degraded mode — it is exactly what the web
widget does in a browser with site data blocked.

**To make them stick**, hand over the durable store:

```dart
import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';

const ChatStorage storage = SharedPreferencesChatStorage();
final PublishableKey key = PublishableKey.parse('dhp_live_...');

ChatWidgetCubit(
  client: client,
  consent: ConsentGate(storage: storage, publishableKey: key),
  mute: MuteMemory(storage: storage, publishableKey: key),
);
```

`shared_preferences` is already a dependency of this package, so this adds
nothing to your graph and needs no platform entry on any of the six targets.

**A store that fails is never treated as a decision.** An unreadable store
reads as "not yet decided": the notice is shown again, and the chime is
audible again. A failed write costs the visitor nothing this session — the
switch they just moved stays moved — and only means they are asked again next
launch. The opposite direction is the one that cannot be allowed: a widget
that believed it held an agreement it never recorded, or that silenced
someone who never asked for silence.

**The mute restore only ever silences.** The read is asynchronous and the
header menu is not, so a visitor who reaches for the switch before the stored
answer lands keeps what they chose. An un-mute persists by leaving the
un-muted default alone rather than by overwriting a decision.

---

## Letting the customer out of the panel

`ChatWidget` takes an optional `onClose`, and a close control appears on Home
and on Messages the moment you pass one:

```dart
ChatWidget(
  cubit: cubit,
  onClose: () => Navigator.of(context).pop(),
);
```

**The pop is yours; this package never makes one.** There is no `Navigator`
call anywhere in `lib/src/` and there is not going to be. `ChatWidget` mounts
no `MaterialApp` of its own, so the only navigator in scope is *yours* — and
this widget does not know whether it is on a route at all. It may be a pushed
page, a `showModalBottomSheet`, or a tab embedded in a screen that was never
pushed. A `Navigator.pop` from in here would be this package dismissing
whatever route happened to be on top of someone else's stack. It is the same
refusal the conversation app bar already makes with
`automaticallyImplyLeading: false`, which exists so the panel's back arrow
cannot pop the host's route out from under it.

So the callback is the whole contract: pressed, it fires exactly once, and
nothing in this package moves. Pop a route, close a sheet, flip a bool that
hides an embedded panel, or ask the customer whether they meant it first —
they are all yours, and the widget stays exactly where it is until you act.

**Pass nothing and there is no control.** Not a disabled one, not a
zero-sized box: the screens build the tree they built before the parameter
existed. That is the standing "absent means off, not broken" rule this
package applies to every unwired seam — the ⋯ menu drops an unbacked row
rather than offering one that quietly does nothing, and a close button that
called nobody would be the same broken promise. A host that mounts this panel
as a permanent tab of its own app has nothing to close, and passes nothing.

**Home and Messages, not the conversation.** Those two are where a customer
sits between conversations; the conversation screen already has a header
carrying its own back arrow, identity, session switcher and ⋯ menu, and a
second dismissal control in that row would compete with the back arrow beside
it. The control is right-aligned above each screen's own content — above
Home's hero band rather than floating on it, because that band renders
nothing at all for a tenant who configured none and *collapses on scroll*, so
an icon placed on it would have had no guaranteed background and would have
scrolled away with it.

**It is a real button.** `ChatCloseButton` is an `IconButton` whose
accessible name is `kCloseChatLabel` (`'Close chat'`), carried on the
semantics node as its tooltip — the same way `HeaderMenu`'s 'Conversation
options' and the composer's 'Send message' get theirs. It takes keyboard
focus like any other button, and both screens use the one widget and the one
name, because from the customer's side this is a single affordance that
happens to be on whichever tab they are on.

---

## What is not wired yet

The parity port is not finished, and the honest list matters more than the
green test count. Everything below is a real gap between this package and
`packages/widget/src/**`, not a rough edge.

**A merchant cannot supply their OWN chime sound.** The chime itself now
plays — see "The notification sound" above — but the tone is this package's
bundled asset, and there is no console field or `RemoteConfig` key that points
at a merchant-hosted file. `behaviour.sound` is a boolean: whether a chime
happens, not which one. A host that wants a different tone replaces the whole
player through the `ChimePlayer` seam; a merchant cannot do it from the
console on either platform, and the reference cannot either.

**`captureContactInfo` still has nowhere to deliver.** `dhaam_chat_rest`
captures user agent, IP, watermark and geolocation through a
`ContactInfoSink`, and the hello frame carries no field for any of it. The
example displays what it captured because displaying it is the only consumer
that exists.

**The consent gate, the offline form, and the hero-header
collapse-oscillation guard are only partly landed.** `lib/src/ui/consent/`
and `lib/src/ui/offline_form/` exist and are mounted; the hero header carries
`kHeroCollapseSlackPx` but the second guard — the layout check read *at
collapse time* — has not been verified end to end. `mergeRemoteConfig`
host-precedence is deliberately not ported (see above). ADR
`docs/adr/0005-flutter-parity-scope.md`, which is to record the full
deliberately-N/A table, is not written yet.

**The session switcher is mounted nowhere** — and neither is
`createSessionSwitcher` in the reference (`session-picker.ts:288` has no call
site in `packages/widget/src`), so this is a faithful port of an unmounted
module rather than a gap. `SessionPickerScreen` looks like superseded code:
Home and Messages read `state.sessionSummaries` directly, expressing the same
`sessions.length > 0` gate as rows rather than as a surface.

`state.sessionSummaries` itself is no longer always empty, and there are now
**three** ways to fill it, each one step more explicit than the last. The page
still comes from outside the socket whichever you pick — `WidgetChatClient` is
the WebSocket slice and `dhaam_chat` cannot list sessions at all — but who
remembers to ask for it has changed.

**Hand over the REST client (recommended).** If you already build a
`dhaam_chat_rest` `RestClient` — for uploads, transcripts, CSAT or
close/reopen — pass it, and the list fills itself:

```dart
ChatWidgetCubit(client: client, rest: rest);
```

That is the entire wiring. The Cubit builds `restSessionSource(rest: rest)`
for itself: the `GET /chat/sessions/customer` call, the field copy from
`RestChatSessionSummary` to `ChatSessionSummary`, and the page size. It adds
nothing to your dependency graph — this package already depends on
`dhaam_chat_rest` directly. `packages/flutter/example/lib/main.dart` is this
route, and it is now the only session-list code that app contains.

**The page size is the route's maximum, deliberately.**
`kSessionListPageSize` is `kSessionSummaryLimitMax`, because this widget
cannot page: Messages renders `state.sessionSummaries` in full and there is no
"load more" behind it, so whatever it asks for is the ceiling on the
conversations a customer can ever reach. Too few silently hides one of their
own conversations with nothing on screen to say so; too many costs a few
kilobytes. To change it, go through `sessionSource` and say so —
`sessionSource: restSessionSource(rest: rest, limit: 5)`. An out-of-range
value is refused with an `ArgumentError` at that call rather than inside the
fetch, because `listSessions` raises `RestValidationException` before sending
anything and routing a caller bug through the error channel would dress it up
as a network failure.

**Or hand over just the fetch.** A host that proxies chat through its own
backend has no `dhaam_chat_rest` client to give, so `sessionSource` takes the
function instead — a `SessionListFetch`, one call, one page:

```dart
ChatWidgetCubit(
  client: client,
  sessionSource: () async => myBackend.conversations(),
);
```

**That snippet on its own now leaves every transcript blank, and this is the
warning for it.** It is flagged here, against the line a host actually copies,
rather than only in the section below. A host on this route passes no `rest:`,
so it gets no `messageHistory` either — and opening a conversation from the
list CLEARS the message store before painting the new one, deliberately, to
stop the previous conversation showing under the new one's name. Nothing then
refills it. The customer taps a conversation and gets an empty pane, for every
conversation, with no error anywhere. Wire the transcript's own source in the
same breath:

```dart
ChatWidgetCubit(
  client: client,
  sessionSource: () async => myBackend.conversations(),
  messageHistory: (String id) async => myBackend.transcript(id),
);
```

Or pass `rest:`, which fills both. Either way, read **The transcript comes
from outside the socket too** below before shipping this — it is the same
seam, one screen further in.

Back to the list itself: `toChatSessionSummary` is exported from this package
for a host still mapping `RestChatSessionSummary` rows but doing its own
fetching. `RestChatSessionSummary`
and `ChatSessionSummary` share `dhaam_chat`'s own ChatStatus/ChatMode/HandledBy,
so it is a field copy with no vocabulary to translate:

```dart
ChatWidgetCubit(
  client: client,
  sessionSource: () async => (await rest.listSessions(limit: 10))
      .map(toChatSessionSummary)
      .toList(growable: false),
);
```

**Passing both `rest` and `sessionSource` is not two fetches.** Exactly one
source is ever built, and `sessionSource` wins. The closure is the more
specific instruction — it says precisely where the conversations come from —
while `rest` is a convenience default for a client you may be holding for
other reasons entirely. Resolving it the other way would let a generic
parameter silently discard hand-written intent and fill the list from the
wrong place, and wrong rows are far harder to notice than no rows.

Both routes get the same triggers, because both end up in the same refresher.
The page is fetched when the widget opens (inside
`connect()`, which `ChatWidget.initState` already calls) and refetched
whenever a session snapshot changes something a list **row** is drawn from —
its id, its status, or the name in its `handledBy`. Routine
live-conversation traffic does not refetch, so this is not a request per
event. A fetch that **fails** is reported to `FlutterError`, leaves the page
already on screen alone rather than emptying it, and does not consume its
trigger: the next snapshot asks again. **The one gap that leaves:** if no
further snapshot ever arrives — a signed-in customer whose conversations are
all closed may get none after the open-time fetch — nothing retries, and the
list stays as it was. Closing that would need a timer this Cubit would then
have to own and cancel; `updateSessionSummaries` remains available as a
host-driven pull-to-refresh in the meantime. An **empty** page is ordinary success,
never an error — `listSessions` answers a guest with `[]`, never a 403, and
turning that into a failure would make "not identified" indistinguishable
from "the lookup failed".

`sessionSource` stays a function rather than becoming a second client
parameter: a host that proxies chat through its own backend fills this list
from something that is not `dhaam_chat_rest` and has no client-shaped thing to
pass, and a closure is also what keeps these paths testable without a network.
It is the same shape as `AttachmentUploader`, `TranscriptEmailer` and
`IssueReporter`.

**Or push your own page.** `ChatWidgetCubit.updateSessionSummaries` is
unchanged and still public, for a host that already fetches this list and
wants to decide when — including as a pull-to-refresh over either of the two
routes above.

A host that wires **none** of the three has a Messages screen with nothing to
draw. That was two integrators' bug report; `sessionSource` was the first
answer to it and `rest` is the second, because a seam nobody fills is
indistinguishable — from the customer's side — from the bug it was added to
fix. A silently empty list looks exactly like a customer who has never
started a conversation. Filling the list and stopping there is the trap
described next.

**The transcript comes from outside the socket too**, and for the same
reason: `WidgetChatClient` is the WebSocket slice, and the history of a
conversation the customer OPENS is `GET /chat/sessions/{id}/messages`. So
`state.messages` sits in exactly the position `state.sessionSummaries` did,
the parameter is `messageHistory`, and it is spelled deliberately like
`sessionSource` so the two can be read against one another. Two routes here
rather than three — there is no push-your-own-page counterpart, because the
message store is the Cubit's own and has no public writer.

**Why there is anything to fill.** Opening a past conversation used to show
the PREVIOUS one's messages: a snapshot for a different session swapped the
id and left the old transcript painted underneath it. That half is fixed — a
snapshot whose id differs is a replacement and clears the message store, in
the same emit that installs the session, so no observer ever reads one
conversation's id against another's transcript. Which opens the opposite
hole, and it is the one `messageHistory` closes. `seedReplacedSession` in
`packages/core` names it in as many words: the commit clears the transcript —
that is the whole point of it — so a replacement that nothing then seeds is
"a permanently blank pane". A customer who opens the conversation they had
yesterday then sees nothing at all, which is not obviously better than seeing
somebody else's messages and is just as broken.

**The REST client covers this one too (recommended).** The same one line
fills both:

```dart
ChatWidgetCubit(client: client, rest: rest);
```

The Cubit builds `restMessageHistory(rest: rest)` for itself beside
`restSessionSource(rest: rest)` — the route, the page size, and the one piece
of normalising a host would otherwise have to know about. It adds nothing to
your dependency graph; this package already depends on `dhaam_chat_rest`.
`packages/flutter/example/lib/main.dart` is this route.

**The page arrives REVERSED, and that is what the adapter is for.**
`listMessages` returns newest-first, paging backwards. `MessageHistoryFetch`
promises OLDEST-first, and `restMessageHistory` reconciles the two, so
knowledge of a route's page order stays in the one file that talks to that
route. It is not cosmetic: the transcript orders by `ChatMessage.seq` (D2,
the ordering key), and a history row is allowed to carry none — rows
predating sequencing legitimately lack it and keep the order they were handed
over in. A page passed straight through would paint exactly those
conversations upside down.

**The page size is a hard ceiling, deliberately.** `kMessageHistoryPageSize`
is 20, matching `DEFAULT_PAGE_SIZE` in `packages/core/src/messages/types.ts`,
so the Dart widget and the TS one open a conversation on the same page. What
that number MEANS here is not the same, and the difference is worth stating
rather than discovering: the reference can page — a scroll handler calls
`loadMore` with a backward cursor — and this package cannot. There is no
"load older" control anywhere in `lib/`, so 20 is the furthest back a
customer can read in a re-opened conversation, with nothing on screen to say
anything was left out. Left at parity rather than raised on a guess, because
"how much of an old conversation should a widget with no scrollback show" is
a product question and not the adapter's to answer. A host that knows its
conversations run long says so explicitly:
`messageHistory: restMessageHistory(rest: rest, limit: 100)`. A non-positive
limit is refused with an `ArgumentError` at that call rather than inside the
fetch, because the route answers a bad limit with a 400 — which would reach
the seed's error channel wearing the clothes of a network failure, reporting
a caller bug as an outage.

**Or hand over just the transcript fetch.** A host that proxies chat through
its own backend has no `dhaam_chat_rest` client to give, so `messageHistory`
takes the function instead — a `MessageHistoryFetch`, one call, one page, by
explicit id:

```dart
ChatWidgetCubit(
  client: client,
  sessionSource: () async => myBackend.conversations(),
  messageHistory: (String id) async => myBackend.transcript(id),
);
```

Three things that closure has to honour, because they are the ones this
package cannot check for you:

* **Oldest first.** The point above, from the other side: it is the single
  thing a host writing its own fetch cannot guess, and the REST route does
  the opposite.
* **The `sessionId` it was HANDED**, never the one currently on screen. The
  two differ exactly when it matters — a customer can open a second
  conversation while the first page is still in flight, and a fetch that
  resolved the id for itself would race the very switch it is being asked to
  seed.
* **An empty page is ordinary success**, never an error. A conversation with
  no messages in it is a real thing, and so is one whose first message has
  not been sent yet.

**Passing both `rest` and `messageHistory` is not two fetches.** Exactly one
source is built and the closure wins — the same `??`, one line from the
list's, for the same reason: it is the more specific instruction, and letting
a convenience default silently discard hand-written intent would fill the
pane from the wrong place. Wrong messages are far harder to notice than no
messages.

**When the seed fires, and when it does not.** On REPLACEMENT only: a
snapshot whose session id differs from the one on screen. A refresh for the
session already on screen cleared nothing and so has nothing to refill —
ending a conversation, an agent picking it up, a reconnect replaying the
snapshot are all that — and re-reading page one for each would be a request
per event that repaints the same rows. The first session of a connection is
not a replacement either. A conversation the customer has just STARTED is
one, and is seeded like anything else: the page comes back empty, an empty
page writes nothing at all, and that costs one request per deliberate "new
conversation" press rather than a special case that has to be carried across
the mint's round trip.

Two races are already handled, so a host's own fetch need not think about
them. A page that lands for a conversation the customer has since LEFT
repaints nothing: a seed is a round trip, on a slow connection a customer can
open two or three conversations inside one, and the transcript carries a
generation counter that a stale page cannot match. And a page never
duplicates or overwrites a message the socket already delivered — identity is
the message id (D1), and where both copies exist the LIVE one is kept,
because a page built server-side before that frame went out describes an
older view of it.

A fetch that **fails** is reported to `FlutterError`, never to the customer's
screen, and empties nothing: this seed only ever ADDS, so a failure leaves
the transcript exactly as it was — which, for a freshly opened conversation,
is empty. Nothing retries it; the next conversation opened asks again.

A host that wires **neither** route gets a pane that opens blank for every
conversation the customer taps, silently and with no error. Off, not broken,
is this package's standing answer for an unfilled seam — but it is worth
being blunt about the cost here, because blank is NOT what that host saw
before: they saw the previous conversation's messages under the new one's
name. Wiring `messageHistory` is what finishes the fix rather than moving it.

**Device details reach the CRM only if you hand them over.** `POST /identify`
upserts the visitor as a Contact and its body carries an optional `device`
block — `deviceId`, `deviceToken`, `platform`. Nothing in `packages/flutter`
called that route until now, so a host holding a push token had nowhere to put
it. Two arguments now fix that:

```dart
ChatWidgetCubit(
  client: client,
  rest: rest,
  contactProfile: RestIdentityProfile(
    name: user.name,
    email: user.email,
    device: RestIdentityDevice(
      deviceId: myDeviceId,
      deviceToken: myPushToken,
      platform: RestDevicePlatform.ios,
    ),
  ),
);
```

**The SDK forwards; it does not collect.** This is the line the whole
parameter is drawn on, and it is the integrator's own: *"the integrated
developer will append these details to the SDK — we will not; we use that
detail, send to API backend via SDK."* So there is no `device_info_plus` here,
no Firebase, no plugin of any kind added for this, and nothing that asks a
platform channel what handset it is running on. It is the same reasoning
`setOnline` states for connectivity: a library sitting between your app and
`dhaam_chat` taking a discovery plugin would add a second answer to a question
your app has already answered — and it would be the wrong one, because the
thing that minted your push token is the only thing that knows it.

Nothing is derived from `identity` either. `ChatIdentity.profile` is a
`ChatParticipantProfile` — what the socket is told — and `contactProfile` is
the CRM body; filling one from the other would be this package inventing a
value you did not supply, at the one seam whose entire point is that it does
not. Supply both if you want both.

**`platform` is lowercase on the wire** — `'ios' | 'android' | 'web'`, the
route's own spelling and unlike every other enum in `dhaam_chat_rest`, where
`'IOS'` is a validation failure. `RestDevicePlatform` is what makes that
unspellable at the call site rather than discoverable in a 400. All three
types (`RestIdentityProfile`, `RestIdentityDevice`, `RestDevicePlatform`) are
re-exported from this package, so naming what you are handing over needs no
second import.

**It never blocks and never breaks chat.** The upsert goes out from
`connect()` — the same "the panel is open" hop that fetches the session list —
and is never awaited: `ChatClient.setContactInfo`'s own doc explains why a
slow capture must not delay the socket, and that applies with more force to a
CRM write, which no part of talking to an agent depends on. A **failed**
identify is reported to `FlutterError`, never to the customer's screen, and
re-arms: the next `connect()` — a customer pressing "Try again" on the
unavailable panel — asks once more. A **settled** one is never re-sent, because
`contactProfile` is a constructor argument and cannot change for that Cubit's
lifetime, so a second upsert would carry byte-identical data.

**A device token is never logged.** It is a push credential — the backend's
own schema says so — and this package puts it nowhere but the seam: no field
of `contactProfile` reaches `ChatWidgetState`, and the error path reports the
exception without interpolating the profile into it. `dhaam_chat_rest`'s
exceptions hold up their end, keeping the request body and the URL out of
`toString()` for exactly this reason.

**Or hand over just the upsert.** `contactIdentifier` takes the function — a
`ContactIdentifier`, one call, one upsert — for a host that routes its CRM
through its own backend and holds no `dhaam_chat_rest` client:

```dart
ChatWidgetCubit(
  client: client,
  contactProfile: profile,
  contactIdentifier: (RestIdentityProfile p) => myBackend.upsertContact(p),
);
```

Both supplied, exactly one source is built and the closure wins — the same
`??`, for the same reason, as `sessionSource` and `messageHistory`. Supplying
an identifier with **no** `contactProfile` forwards nothing at all: there is
nothing host-supplied to forward, and this package will not make something up
to fill it. IP, user agent and geolocation are a different road entirely —
they ride `ChatClient.setContactInfo` on the hello frame, not this route.

**A CLOSED conversation is no longer offered to the customer.** Every
conversation surface in this package reads `state.customerVisibleSessions` —
Home's most-recent card, the Messages list, the header's session switcher —
and the Messages tab badge counts `state.customerVisibleUnreadCount` off that
same list, so the number on the badge and the rows behind it cannot disagree.

**RESOLVED is not withheld, and that distinction is the whole rule.**
`ChatStatus.closed` and `ChatStatus.resolved` are two different states and
exactly one of them is held back. A resolved conversation is finished but
still the customer's to pick up again — tapping it joins it, and the next
message reactivates it server-side — so it keeps its row, its status label
and that route back. CLOSED is the merchant taking the conversation off the
table, and leaving it listed offered a way back into something the customer
can do nothing with. The predicate is `!= ChatStatus.closed` and deliberately
not "the terminal ones", precisely so that a seventh wire status cannot be
swept into this rule by nobody's decision.

**The conversation the customer is IN stays listed, even once it closes.**
These surfaces rebuild the moment a `session.updated` snapshot lands, so a
conversation someone is reading can be closed underneath them — and pulling a
row out from under a finger mid-tap is a worse failure than showing one
finished row. The session named by `state.session` keeps its row, and stays
marked as the current one, until the customer leaves it; the next rebuild
then drops it like any other closed conversation.

**It is a DISPLAY rule and only that.** No status changes, no REST query
changes, no page size changes. `state.sessionSummaries` still holds the whole
page exactly as the host supplied it — read that, not the filtered list, if
you want the unfiltered record — `ChatWidgetCubit.openConversation` still
accepts a closed session id, and a host that mounts `SessionPickerScreen`
with a list of its own is unaffected. The reply CHIME follows the same rule
as the badge — it watches `state.customerVisibleUnreadCount`, not the
whole-page `state.unreadCount` — so a message arriving in a conversation this
widget will not list changes neither the badge nor the sound. A chime with no
badge change, no row and nowhere to go is one the customer can neither
explain nor act on. `state.unreadCount` is still the unfiltered whole-page
sum, and still the number to read if that is what you want.

**The inline report-issue entry point is not ported.** `widget.ts` opens the
report form from two places — the header menu (`:858`, ported) and an inline
button on the seam between the transcript and the composer (`:1401`). Only
the first exists here.

**Voice notes are WAV, where the web widget records WebM or MP4.** `record`'s
stream mode is the only capture path that works on all six platforms without
`dart:io`, and its only universally-available encoder there is `pcm16bits`,
which this package wraps in a WAVE header. The result is uncompressed: about
32 KB per second at 16 kHz mono, so the 25 MiB attachment cap lands at
roughly thirteen minutes rather than the hour a compressed codec would give.
Refused in words at the cap, like any other oversized file.

**Taking `record` imposes three things on every host**, whether or not it
shows the microphone, because the plugin's native code is linked at build
time: `NSMicrophoneUsageDescription` in `ios/Runner/Info.plist`; the same key
plus the `com.apple.security.device.audio-input` entitlement in **both**
`macos/Runner/*.entitlements`; and `RECORD_AUDIO` with **`minSdk 23`** on
Android — the Flutter 3.24.4 default of 21 fails the manifest merge outright.
`packages/flutter/example/` carries exactly these entries and no invented
ones. `NSSpeechRecognitionUsageDescription` is deliberately **not** among
them: this SDK records audio and never transcribes it, so declaring it would
ask a host to justify a capability their binary does not have.

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
