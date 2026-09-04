/// Unwrapping `{success, data}` — the Dart mirror of `@dhaam-ccrm/rest`'s
/// `envelope.ts`.
///
/// Every route this package calls replies with that envelope — history
/// (`chat.routes.ts:276`), close (`:289-292`), reopen (`:310-313`), upload
/// (`upload.routes.ts:166-175`) — while `RestClient.request` returns the
/// parsed body verbatim.
///
/// ── Why this is per-adapter and NOT inside RestClient.request ─────────────
///
/// The same service deliberately serves several routes WITHOUT the envelope —
/// `/tokens`, `/health*`, `/ready`, `/live`, and the metrics route. Unwrapping
/// globally would mean carrying a route-exception list inside the HTTP client,
/// which puts knowledge of individual endpoints into the one module whose job
/// is to know none of them. Each typed method knows its own route, so each
/// typed method unwraps its own response.
///
/// ── What this covers, and what it does not ────────────────────────────────
///
/// The customer-facing routes this package calls, where the whole payload is
/// one object under `data`. That is not the only envelope chat-service uses,
/// and this function is not a general client for the service:
///
///  * Some routes reply `{success: true, message: '…'}` with no `data` at all
///    (`agent.routes.ts:175`, `:322`, `:538`). Those throw here. Loud is the
///    right answer for a caller that expected a payload, but it is not
///    "supported".
///  * `GET /agent/queue` replies `{success, data: […], nextCursor, hasMore}` —
///    an ARRAY under `data`, with the pagination fields as SIBLINGS of it.
///    This rejects that shape rather than returning the array and dropping the
///    cursor, which would silently break paging.
///
/// A future agent-facing adapter needs its own unwrap, not a looser one here:
/// relaxing this to accept both shapes would mean the strictness the
/// customer-facing routes rely on stops applying to any of them.
library;

import '../errors.dart';

/// Returns `body.data`, or throws if [body] is not a successful envelope.
///
/// ── Why strict rather than a tolerant pass-through ────────────────────────
///
/// Handing the envelope back unchanged when it does not match would type a
/// `{success, data}` object as the payload itself. Nothing would throw: a
/// decoder would read `url` off the envelope, find nothing, and a binding
/// would render an attachment bubble pointing nowhere. A silently wrong bubble
/// is strictly worse to diagnose than a thrown exception, so a mismatch fails
/// here — at the seam that knows what the response should have been.
///
/// ── One TS check has no Dart equivalent to write ──────────────────────────
///
/// TS must test `Array.isArray(envelope.data)` by hand, because `typeof [] ===
/// 'object'` makes an array pass its object check. In Dart a `List` is not a
/// `Map`, so the `is! Map<String, Object?>` test below already rejects it.
/// The rejection is therefore structural rather than written — but it is still
/// asserted by test, because "an array under `data` is refused" is a
/// behavioural requirement of this function, not an incidental property of the
/// language it happens to be written in.
///
/// [context] names the route, e.g. `'POST /upload'`. It must be a caller-side
/// constant: it is the only detail that reaches the exception, because
/// response bodies on this service can carry signed URLs (§14) and must never
/// be echoed into something a host application might log.
Map<String, Object?> unwrapEnvelope(Object? body, String context) {
  if (body is! Map<String, Object?> ||
      body['success'] != true ||
      body['data'] is! Map<String, Object?>) {
    throw RestMalformedResponseException(
      context: context,
      // Fixed text. Never the body, never a field off it — see the class doc.
      detail: 'did not return a { success: true, data } envelope',
    );
  }

  // `{}` passes deliberately. Validating the payload's own fields belongs to
  // the typed method that knows which ones its route promises, not here.
  return body['data']! as Map<String, Object?>;
}
