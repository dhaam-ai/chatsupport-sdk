// A hand-driven ChatSessionActions — no HTTP, no envelope, no REST package.
//
// This is the payoff of the seam: `packages/flutter` does not depend on
// `dhaam_chat_rest`, so the whole end-of-conversation flow is testable
// against a fake that answers in `dhaam_chat`'s own vocabulary. The
// 404-vs-SESSION_NOT_FOUND classification that produces a `CsatRouteMissing`
// is the REST adapter's job and is tested there
// (`packages/dart_rest/test/csat_lookup_test.dart`).

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';

class FakeSessionActions implements ChatSessionActions {
  /// What `readCsat` answers. Change it mid-test to stand in for a rating
  /// that landed from somewhere else while a card was open.
  CsatStatus csatOnFile = const CsatUnrated();

  /// Thrown by `readCsat` instead of answering. `CsatRouteMissing()` is the
  /// deployment-has-no-route case; anything else is an ordinary failure.
  Object? csatLookupFails;

  int readCsatCalls = 0;

  /// `[sessionId, rating, comment]` per accepted write.
  final List<List<Object?>> submitted = <List<Object?>>[];

  final List<String> closed = <String>[];
  final List<String> reopened = <String>[];

  /// The id `reopenSession` answers with. Null means "the one asked for";
  /// setting it stands in for convergence onto an already-active session.
  String? reopenSettlesAs;

  Object? submitFails;
  Object? closeFails;
  Object? reopenFails;

  @override
  Future<CsatStatus> readCsat(String sessionId) async {
    readCsatCalls += 1;
    final Object? failure = csatLookupFails;
    if (failure != null) throw failure;
    return csatOnFile;
  }

  @override
  Future<void> submitCsat(
    String sessionId, {
    required int rating,
    String? comment,
  }) async {
    final Object? failure = submitFails;
    if (failure != null) throw failure;
    submitted.add(<Object?>[sessionId, rating, comment]);
  }

  @override
  Future<void> closeSession(String sessionId) async {
    final Object? failure = closeFails;
    if (failure != null) throw failure;
    closed.add(sessionId);
  }

  @override
  Future<String> reopenSession(String sessionId) async {
    final Object? failure = reopenFails;
    if (failure != null) throw failure;
    reopened.add(sessionId);
    return reopenSettlesAs ?? sessionId;
  }
}
