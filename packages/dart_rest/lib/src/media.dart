/// History, upload, identify — and the contact-info capture that feeds the
/// console's contact panel.
///
/// ── Why these live in one file, and why they are an extension ─────────────
///
/// [RestClient] is the transport and the primitive; `request` is public
/// precisely so endpoint methods can be written against it without reopening
/// the file that owns the credentials, the base path and the failure taxonomy.
/// Each group of routes therefore lands as its own `extension on RestClient`,
/// which is what lets two of them be written at the same time without either
/// touching `client.dart`. The grouping here is a landing constraint, not a
/// taxonomy claim: history, upload and identify have no more in common with
/// each other than any two routes on the same service do.
///
/// [captureContactInfo] is the odd one out and is here for a concrete reason —
/// it composes `bootstrap.dart`'s [fetchIpWatermark], which already lives in
/// this package because that route takes no credential at all. It is not a
/// method on [RestClient] for the same reason [fetchIpWatermark] is not.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart'
    show AttachmentMetadata, ChatMessage;
import 'package:http/http.dart' as http;

import 'bootstrap.dart';
import 'client.dart';
import 'errors.dart';
import 'internal/envelope.dart';
import 'internal/json_reading.dart';
import 'internal/message_decode.dart';
import 'media_type.dart';
import 'models/identity.dart';
import 'models/message_page.dart';

/// Route names as they appear in a [RestMalformedResponseException].
///
/// Caller-side constants, never built from a value off the wire — see
/// [RestMalformedResponseException.context] for why that rule is absolute.
const String _historyContext = 'GET /chat/sessions/{sessionId}/messages';
const String _uploadContext = 'POST /upload';
const String _identifyContext = 'POST /identify';

/// What [MediaApi.uploadAttachment] declares for a file whose type the
/// platform declined to name.
///
/// ── The endpoint policy T1 deliberately left open ─────────────────────────
///
/// `RestClient`'s multipart builder refuses an unparseable `mimeType` with an
/// [ArgumentError] before any request runs, and an empty string IS
/// unparseable (`MediaType.parse('')` throws). T1 called deciding what to do
/// about that an endpoint-level question rather than a transport one and left
/// it here. It is a real one: some Android document pickers genuinely return
/// an empty type for a file they cannot classify.
///
/// The line drawn is **absent is not the same as wrong**:
///
///  * An empty or whitespace-only [mimeType] is ABSENCE — the platform said
///    nothing. It becomes this value, and the upload proceeds.
///  * A non-empty but unparseable one (`'image'`, `'not a mime type'`) is
///    WRONGNESS — the caller had a type and mangled it. That still raises
///    [ArgumentError] from the transport, unchanged.
///
/// ── Why substitute rather than refuse ─────────────────────────────────────
///
/// Refusing would fail an upload whose BYTES are perfectly good over a label
/// the platform withheld — the customer's photo does not send, and nothing in
/// the UI can explain why. `media_type.dart` already settled this exact
/// trade-off in this exact package, on the READ side of this same upload: "an
/// upload is not worth failing over a label." Failing on the write side while
/// degrading gracefully on the read side would be two answers to one question.
///
/// ── Why this value, rather than sniffing the extension ────────────────────
///
/// It is the standard spelling of "arbitrary binary data" (RFC 2046 §4.5.1),
/// and it is what `package:http` itself sends when no `contentType` is given
/// to `MultipartFile.fromBytes` — so this substitution puts on the wire
/// exactly what the transport library would have put there had the part
/// carried no declared type at all. Nothing is invented, and no sniffing
/// heuristic (or the dependency one would cost) enters the package.
///
/// The server classifies by MIME, so an unclassified type lands in the
/// `documents` folder and `normalizeMediaType` maps it to `DOCUMENT`, which
/// degrades to a generic file attachment — documented behaviour, not a bug.
/// The file arrives; only the thumbnail is lost.
///
/// It is also what the returned [AttachmentMetadata.mimeType] falls back to
/// when the route echoes none. That matters: `AttachmentMetadata.fromJson`
/// refuses an empty `mimeType`, so passing `''` through would hand a caller a
/// value this SDK's own decoder would reject on the next history load.
const String kUnknownAttachmentMimeType = 'application/octet-stream';

/// The three routes `dhaam_chat`'s WebSocket deliberately does not serve.
///
/// Written against [RestClient.request] only. Nothing here reaches into the
/// transport's internals, which is what keeps the endpoint layer and the
/// transport independently editable.
extension MediaApi on RestClient {
  /// `GET /chat/sessions/{sessionId}/messages` — one page of history, newest
  /// first, paging backwards.
  ///
  /// Mirrors `createHistorySource(client).listMessages`.
  ///
  /// ── `before` is OMITTED for the newest page, never sent empty ──────────
  ///
  /// A `null` [before] is dropped by [RestClient.request]'s own
  /// null-value skip, so the newest page is requested with no cursor at all.
  /// Sending `before=` instead would ask the route to page from a cursor
  /// spelled with the empty string, and sending `before=null` to page from one
  /// spelled `"null"` — both are a request for a page that does not exist,
  /// arriving as an empty history on the one load a customer notices most.
  ///
  /// ── One bad row costs one row, never the page ─────────────────────────
  ///
  /// Rows arrive raw — integer enums, `chatSessionId`, an attachment still
  /// buried in `metadata` — because the REST history service does no
  /// projection of its own. Each is projected through `projectHistoryRow`,
  /// which turns a row this SDK cannot decode into a `SYSTEM` placeholder
  /// carrying `kUnsupportedMessageMarker` rather than failing the request.
  /// Appending an enum value is documented as routine, so mapping the page
  /// strictly would turn one newer-typed message into ZERO history for that
  /// customer — the same user-facing outcome as the empty-transcript bug this
  /// whole layer exists to fix.
  ///
  /// [limit] is a plain `int`: Dart cannot hold `1.5` or `NaN`, so the half of
  /// TS's guard that exists to catch a non-integer JS number has no equivalent
  /// to write (contract §5.5). This route documents no range beyond "a
  /// positive count", and nothing here second-guesses the server's own 400.
  ///
  /// Throws [RestMalformedResponseException] if the response is not a
  /// `{success: true, data: {...}}` envelope — reading `messages` off the top
  /// level of one is the reload bug's exact signature, and yields an empty
  /// page with `hasMore: false` that looks just like a conversation with no
  /// history.
  Future<RestMessagePage> listMessages({
    required String sessionId,
    String? before,
    required int limit,
  }) async {
    final Object? body = await request(
      'GET',
      '/chat/sessions/${Uri.encodeComponent(sessionId)}/messages',
      query: <String, Object?>{'before': before, 'limit': limit},
    );

    final Map<String, Object?> page = unwrapEnvelope(body, _historyContext);

    // Defended rather than trusted: a caller prepends this straight into its
    // own state, and an absent `messages` should surface here, where the route
    // is still named, rather than as a crash deep inside a message list.
    final Object? rows = page['messages'];
    final List<ChatMessage> messages = <ChatMessage>[];
    if (rows is List<Object?>) {
      for (final Object? row in rows) {
        final ChatMessage? message = projectHistoryRow(row, _historyContext);
        if (message != null) messages.add(message);
      }
    }

    return RestMessagePage(
      messages: messages,
      // Strict `== true`. Anything else — absent, null, the STRING "true", the
      // number 1 — is false. `hasMore` drives whether a customer can scroll
      // further back, and a truthy non-boolean read as `true` leaves a "Load
      // older" control that can never load anything.
      hasMore: page['hasMore'] == true,
    );
  }

  /// `POST /upload` — step one of the two-step upload-then-announce flow.
  ///
  /// Mirrors `createAttachmentUploader(client).upload`. The returned
  /// [AttachmentMetadata] is `dhaam_chat`'s own type — the SAME type a
  /// `message.new` frame decodes an attachment into, and the same type
  /// `messageSendPayload`'s `attachment` parameter accepts. A caller that
  /// uploads here and announces over the socket passes this value straight
  /// through with no conversion.
  ///
  /// ── `chatSessionId` is a QUERY PARAM, not a form field ────────────────
  ///
  /// The route reads it off `request.query.chatSessionId` because a form field
  /// parsed AFTER the streamed file part never arrives in time
  /// (`upload.routes.ts:144-147`). The file part is appended first — as it
  /// must be, so a large body streams rather than buffering behind small
  /// fields — so a field here would be silently dropped and every upload would
  /// arrive unattached to any session.
  ///
  /// Nothing else rides along: the route derives the tenant from the verified
  /// token and ignores `X-Tenant-ID`, and it implements no idempotency key.
  ///
  /// ── Why [fileName] and [mimeType] are required, unlike TS's optionals ──
  ///
  /// TS's `request.file` is a browser `Blob`, which sometimes self-describes a
  /// `.name` and a `.type` and sometimes does not — hence a three-deep
  /// fallback chain ending in the literal string `'upload'`. [Uint8List] is
  /// never self-describing: there is no chain to fall back through, so this
  /// port requires the caller to state what it is uploading (contract §5.4).
  ///
  /// An empty [mimeType] is the one case that still needs an answer, and
  /// [kUnknownAttachmentMimeType] is it — see that constant for the decision
  /// and its reasoning. An empty [fileName] is deliberately NOT given a
  /// fallback here: `'upload'` was a browser workaround, not a policy, and
  /// inventing a placeholder would be this package guessing on a caller's
  /// behalf about a value only the caller can know.
  ///
  /// Throws [RestMalformedResponseException] if the envelope is missing, or if
  /// `data.url` is absent or empty — without a URL there is nothing to
  /// announce, and a caller would render an attachment bubble pointing
  /// nowhere. Every OTHER field falls back to what this side already knows
  /// rather than reaching the caller as a hole.
  Future<AttachmentMetadata> uploadAttachment({
    required String sessionId,
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
  }) async {
    final String declared = _declaredMimeType(mimeType);

    final Object? body = await request(
      'POST',
      '/upload',
      query: <String, Object?>{'chatSessionId': sessionId},
      multipart: RestMultipartFile(
        fieldName: 'file',
        fileName: fileName,
        bytes: bytes,
        mimeType: declared,
      ),
    );

    final Map<String, Object?> data = unwrapEnvelope(body, _uploadContext);

    // `optionalString` folds absent, explicit-null, `''` and wrong-typed all
    // into null — exactly TS's `typeof url !== 'string' || url === ''`.
    final String? url = optionalString(data, 'url');
    if (url == null) {
      throw const RestMalformedResponseException(
        context: _uploadContext,
        // Reads as `POST /upload — returned no attachment url`. TS spells the
        // same sentence as one string because its exception has only a
        // `message`; here the route lives in `context` by that type's own
        // contract, and duplicating it into the detail would put the route
        // name on the wire twice.
        detail: 'returned no attachment url',
      );
    }

    return AttachmentMetadata(
      url: url,
      // Read through the non-empty readers rather than TS's bare
      // `typeof === 'string'`: an echoed `''` would satisfy TS's check and
      // then be refused by `AttachmentMetadata.fromJson` on the next history
      // load. Falling back to the locally-known fact keeps the write side and
      // the read side agreeing on what a usable value is.
      fileName: optionalString(data, 'fileName') ?? fileName,
      mimeType: optionalString(data, 'mimeType') ?? declared,
      size: optionalIntValue(data['size']) ?? bytes.length,
      // `mediaType` arrives as an S3 folder name (`images`), and the consuming
      // side only knows `IMAGE|VIDEO|AUDIO` — so unnormalized, every uploaded
      // image degrades to a generic FILE attachment.
      mediaType: normalizeMediaType(data['mediaType']),
    );
  }

  /// `POST /identify` — upserts the logged-in customer into the CRM as a
  /// Contact.
  ///
  /// Mirrors `createIdentitySync(client).sync`.
  ///
  /// ── Optionals are OMITTED, never sent as null ─────────────────────────
  ///
  /// The route body is `.strict()`, so a field present with a null value is
  /// not the same request as a field that is absent, and `{"email": null}` is
  /// how an identify call starts failing validation for a customer who simply
  /// has no email on file. [RestIdentityProfile.toJson] already drops every
  /// null field, and this method sends that map verbatim rather than
  /// rebuilding it — one place decides what "absent" means.
  ///
  /// An empty profile therefore goes out as `{}`, which the route accepts.
  ///
  /// ── Nothing is retried here ───────────────────────────────────────────
  ///
  /// Identify is idempotent by construction — a repeat call converges on the
  /// same contact — so a retry is safe, but it is a CALLER's decision and not
  /// this adapter's. `kReadBackAttempts` is scoped to the close/reopen
  /// read-back and is deliberately not a pattern to generalize: that loop
  /// re-reads after a mutation that already happened, which is a different
  /// question from re-issuing a mutation.
  ///
  /// Throws [RestMalformedResponseException] if the envelope is missing or if
  /// any of `contactId`, `externalId` or `lastLoginAt` is absent or empty. All
  /// three are required: a receipt missing its contact id is not a partially
  /// successful identify, it is a response this package does not understand.
  ///
  /// `lastLoginAt` comes back as a [DateTime], not the raw string TS
  /// deliberately keeps — the same consistency argument `identity.ts` makes,
  /// applied to a Dart SDK where every wire timestamp is a [DateTime], gives
  /// the opposite concrete answer (contract §5.7).
  Future<RestIdentityResult> identify(RestIdentityProfile profile) async {
    final Object? body = await request(
      'POST',
      '/identify',
      jsonBody: profile.toJson(),
    );

    return RestIdentityResult.fromJson(
      unwrapEnvelope(body, _identifyContext),
      _identifyContext,
    );
  }
}

// ── Contact-info capture ────────────────────────────────────────────────────

/// A GPS fix, or as much of one as this feature needs.
///
/// Approximate "where is this visitor" for the console's contact panel, never
/// last-metre accuracy — which is what makes a cached fix an acceptable
/// substitute for a fresh one, and high-accuracy mode unnecessary.
class RestGeoPosition {
  const RestGeoPosition({required this.lat, required this.lng});

  final double lat;
  final double lng;
}

/// One partial contribution to the contact-info panel.
///
/// Every field is optional because [captureContactInfo] reports each capture
/// AS IT RESOLVES rather than assembling one complete record — a value that
/// arrives after the first hello has gone out simply rides along on the next
/// one, and a value that never arrives is a field the console does not show.
/// A caller merges these; it is never handed a snapshot claiming to be whole.
class RestContactInfo {
  const RestContactInfo({this.ip, this.ipWatermark, this.userAgent, this.geo});

  final String? ip;
  final String? ipWatermark;
  final String? userAgent;
  final RestGeoPosition? geo;
}

/// Where [captureContactInfo] sends each capture as it lands.
///
/// A plain callback rather than an interface: it is the narrowest shape a test
/// double can satisfy, and a host holding whatever object owns contact info
/// passes that object's method as a tear-off. TS declares a one-method
/// `ContactInfoSink` interface for the same "narrow enough that a double does
/// not need the whole thing" reason; in Dart a function type already is that.
typedef ContactInfoSink = void Function(RestContactInfo info);

/// Asks the platform for a GPS fix, bounded by [timeout].
///
/// ── This is a SEAM, and the platform side is not in this package ──────────
///
/// `dhaam_chat_rest` is pure Dart with no Flutter and no platform plugins, so
/// there is no `navigator.geolocation` here to call and no location plugin to
/// depend on. Geolocation therefore arrives as an injected callback, and the
/// real implementation — whichever plugin the Flutter layer settles on —
/// lives there. That keeps the permission prompt, the platform channels and
/// the plugin choice on the side of the boundary that can actually make them,
/// and keeps this package's dependency list at two.
///
/// ── The contract an implementation must honour ────────────────────────────
///
///  * **Resolve `null`; never reject.** Permission denied, the API absent, an
///    insecure origin, a fix that times out — every non-success path is the
///    same outcome to this feature: fall back to IP geolocation server-side.
///    [captureContactInfo] folds a probe that throws into `null` anyway, but
///    an implementation that relies on that is reporting a failure it should
///    have named.
///  * **Pass [timeout] to the platform API; do not race a second timer.** The
///    platform is the thing that can actually abandon a pending prompt and
///    stop draining the radio. A timer racing it leaves the request running
///    with nothing left to receive its answer.
///  * **Never re-prompt.** A visitor who declined has answered.
typedef GeolocationProbe = Future<RestGeoPosition?> Function(Duration timeout);

/// How long a geolocation probe may take before the platform abandons it.
///
/// Much longer than a REST round trip, deliberately: a permission prompt and a
/// GPS fix can legitimately take several seconds, and the visitor may be
/// reading the prompt. It must still be BOUNDED, because "wait indefinitely
/// for a fix that never comes because nobody answered" is exactly the block
/// this feature is not allowed to become.
const Duration kGeolocationTimeout = Duration(seconds: 5);

/// Kicks off every contact-info capture for this session and hands each result
/// to [sink] as — and if — it resolves.
///
/// ── DO NOT await this before connecting ───────────────────────────────────
///
/// That is the entire point of the design, not a performance note. This data
/// is enrichment, not a precondition: GPS in particular must never gate the
/// chat opening, and by extension neither may a slow or failed ip-watermark
/// fetch. Call this once, as early as possible, immediately BEFORE the first
/// connect, and drop the returned future on the floor. It exists so a TEST can
/// know when every capture has settled — not to gate anything in production.
///
/// A value that resolves after the first hello has already gone out rides
/// along on the next one, which is an accepted trade-off rather than a bug to
/// chase.
///
/// ── userAgent is recorded SYNCHRONOUSLY, before anything is awaited ───────
///
/// A Dart `async` function body "executes only until it encounters its first
/// `await` expression" (dart.dev/language/async), so [userAgent] reaches
/// [sink] during the CALL, before this function has returned its future. That
/// is the property that puts it on the FIRST hello even when neither async
/// capture has settled — the same guarantee TS gets from doing the same thing
/// before its own first `await`. Moving that block below an `await`, or
/// wrapping it in one, silently loses it.
///
/// [userAgent] is a parameter for the same reason [geolocation] is a seam:
/// there is no `navigator` in pure Dart. A host that cannot name one passes
/// nothing, and nothing is recorded for it — an empty string is not a user
/// agent and is treated as absent, matching TS's own length check.
///
/// ── Never throws ──────────────────────────────────────────────────────────
///
/// Same contract as [fetchIpWatermark] and for the same reason: a widget that
/// throws during boot takes the host app down with it, and enrichment that
/// failed is "send nothing", not an error. When both async captures fail,
/// [sink] sees exactly one call — the user agent — and nothing else.
Future<void> captureContactInfo({
  required ContactInfoSink sink,
  required String apiUrl,
  String? userAgent,
  GeolocationProbe? geolocation,
  http.Client? httpClient,
  Duration ipWatermarkTimeout = kIpWatermarkTimeout,
  Duration geolocationTimeout = kGeolocationTimeout,
}) async {
  // Everything above the first `await` runs during the call itself. Keep it
  // that way — see this function's doc.
  if (userAgent != null && userAgent.isNotEmpty) {
    sink(RestContactInfo(userAgent: userAgent));
  }

  // Independent of each other and of the user agent above: either, both or
  // neither may end up contributing to the session that gets created.
  await Future.wait<void>(<Future<void>>[
    _recordIpWatermark(
      sink: sink,
      apiUrl: apiUrl,
      httpClient: httpClient,
      timeout: ipWatermarkTimeout,
    ),
    _recordGeolocation(
      sink: sink,
      geolocation: geolocation,
      timeout: geolocationTimeout,
    ),
  ]);
}

Future<void> _recordIpWatermark({
  required ContactInfoSink sink,
  required String apiUrl,
  required http.Client? httpClient,
  required Duration timeout,
}) async {
  // Already collapses every failure class to null and is documented never to
  // throw, so there is nothing to catch here.
  final RestIpWatermark? result = await fetchIpWatermark(
    apiUrl: apiUrl,
    httpClient: httpClient,
    timeout: timeout,
  );
  if (result == null) return;
  sink(RestContactInfo(ip: result.ip, ipWatermark: result.watermark));
}

Future<void> _recordGeolocation({
  required ContactInfoSink sink,
  required GeolocationProbe? geolocation,
  required Duration timeout,
}) async {
  // No probe at all is the Dart analogue of `navigator.geolocation` being
  // absent — a non-browser embed, or an insecure origin most browsers refuse
  // the API on. Same outcome: record nothing, ask nobody.
  if (geolocation == null) return;

  final RestGeoPosition? position;
  try {
    // The timeout goes INTO the probe, which passes it to the platform API.
    // Racing a `.timeout()` here instead would leave the platform request
    // running with nothing left to receive its answer, and would report a
    // fix that arrived at 5.1s as a failure while the radio kept draining.
    position = await geolocation(timeout);
  } catch (_) {
    // A probe is documented to resolve null rather than throw, but it is
    // caller-supplied code calling a platform channel. Letting one throw would
    // break this function's own "never throws" contract and, through
    // Future.wait, discard a perfectly good ip-watermark alongside it.
    return;
  }

  if (position == null) return;
  sink(RestContactInfo(geo: position));
}

/// Absence becomes [kUnknownAttachmentMimeType]; wrongness is left to the
/// transport to refuse. See that constant for the full reasoning.
String _declaredMimeType(String mimeType) =>
    mimeType.trim().isEmpty ? kUnknownAttachmentMimeType : mimeType;
