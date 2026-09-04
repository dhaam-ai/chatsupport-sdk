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

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMessage;

import 'client.dart';
import 'errors.dart';
import 'internal/envelope.dart';
import 'internal/message_decode.dart';
import 'models/message_page.dart';

/// Route names as they appear in a [RestMalformedResponseException].
///
/// Caller-side constants, never built from a value off the wire — see
/// [RestMalformedResponseException.context] for why that rule is absolute.
const String _historyContext = 'GET /chat/sessions/{sessionId}/messages';

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
}
