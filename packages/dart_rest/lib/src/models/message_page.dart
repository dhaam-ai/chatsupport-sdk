/// `GET /chat/sessions/{sessionId}/messages`'s response.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMessage;

/// One page of history.
///
/// Mirrors TS's `WireMessagePage<TMessage>`, but concretely typed rather than
/// generic: `dart_rest` returns `dhaam_chat`'s own [ChatMessage] directly, so
/// there is no caller-supplied message type to be generic over. TS needs the
/// parameter because `createHistorySource` is one of five structural seams
/// `createChatClient` accepts; nothing in this workspace composes a Dart
/// `ChatClient` that way.
///
/// A backward cursor and [hasMore], with no forward cursor — live messages
/// arrive over the WebSocket, not by polling this.
class RestMessagePage {
  const RestMessagePage({required this.messages, required this.hasMore});

  /// Rows this SDK could decode, in the order the service returned them.
  ///
  /// A row it could not decode costs that ONE message, not the page — see
  /// `internal/message_decode.dart`'s `projectHistoryRow`. So this list can be
  /// shorter than the page the service sent, and a caller must not infer
  /// "there is no more history" from its length. That is what [hasMore] is
  /// for.
  final List<ChatMessage> messages;

  /// Whether an older page exists.
  ///
  /// Read strictly from the wire's own boolean, never inferred from
  /// [messages]'s length: a page that lost every row to a decode failure would
  /// otherwise read as the end of history and silently truncate a customer's
  /// transcript.
  final bool hasMore;
}
