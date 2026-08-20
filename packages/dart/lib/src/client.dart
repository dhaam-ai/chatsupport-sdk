/// The public client — PRD §6.
library;

import 'dart:async';

import 'auth/keys.dart';
import 'auth/token.dart';
import 'connection/backoff.dart';
import 'connection/connection.dart';
import 'connection/socket.dart';
import 'protocol/enums.dart';
import 'protocol/envelope.dart';
import 'protocol/errors.dart';
import 'protocol/frames.dart';
import 'protocol/ulid.dart';
import 'resume/resume_tracker.dart';

/// A remote participant's typing state (§6.5).
class TypingEvent {
  const TypingEvent({required this.isTyping, this.participantId});

  final bool isTyping;
  final String? participantId;
}

/// Whether a send whose failure carried no server verdict may be retried.
///
/// Mirrors the TypeScript core's `DEFAULT_RETRYABLE_FALLBACK`. It applies only
/// where there is nothing to mirror — a send this client could not hand to the
/// transport at all never produced a wire [ErrorPayload] to read `retryable`
/// off. Defaulting to `true` rather than `false` is deliberate: the flag gates
/// a UI affordance, so guessing `false` silently removes a Retry button that
/// would have worked, while guessing `true` costs one refused round trip that
/// the server answers with a real verdict.
const bool kDefaultRetryable = true;

/// How [ChatClient.retry] resolved.
///
/// A result type rather than a thrown error or a bare bool, because refusal is
/// an expected outcome a caller branches on — and because the reasons are not
/// interchangeable: [RetryRefusalReason.notRetryable] means retrying this send
/// will never get anywhere, while the other two mean it did not happen now.
sealed class RetryOutcome {
  const RetryOutcome();
}

/// The original envelope went back onto the wire.
final class RetryRetried extends RetryOutcome {
  const RetryRetried(this.message);

  /// The same message, under the same id, back to
  /// [MessageDelivery.pending]. Also pushed onto [ChatClient.messages].
  final ChatMessage message;
}

/// Nothing was sent.
final class RetryRefused extends RetryOutcome {
  const RetryRefused(this.reason);

  final RetryRefusalReason reason;
}

/// Why [ChatClient.retry] declined.
enum RetryRefusalReason {
  /// No failed send under this id: never sent, already succeeded, still in
  /// flight, or already retried by an earlier call. None of those are
  /// distinguished, because a caller can do nothing different about them.
  notFound,

  /// The server said retrying is futile — its own `retryable` flag, not a
  /// second copy of §7.4's code table maintained here.
  notRetryable,

  /// The transport could not take the frame, so there is nowhere for it to go
  /// right now.
  ///
  /// ── A reason the TypeScript core does not have ────────────────────────
  ///
  /// There, a retry is accepted into the durable offline queue (§9.1) and
  /// drains when the socket returns, so "disconnected" is not a refusal. This
  /// package has no such queue — see the class doc's out-of-scope list — and
  /// reporting `retried` for a frame that reached nothing would be a promise
  /// with nothing behind it. The failure record survives the refusal, so the
  /// identical call succeeds once the connection is back. When the durable
  /// queue lands, this value goes away rather than changing meaning.
  disconnected,
}

/// A send that has been handed to the transport and is awaiting its `ack`.
class _InFlightSend {
  const _InFlightSend(this.frame, this.message);

  /// The frame AS SENT. Kept rather than rebuilt, because a retry must replay
  /// this exact envelope — see [ChatClient.retry].
  final ClientFrame frame;

  /// The optimistic echo, still [MessageDelivery.pending].
  final ChatMessage message;
}

/// A send that failed and that a host may offer a Retry affordance for.
class _FailedSend {
  const _FailedSend(this.frame, this.message, this.retryable);

  final ClientFrame frame;
  final ChatMessage message;

  /// The server's verdict, or null when the failure never reached a server to
  /// produce one. Null resolves through [kDefaultRetryable].
  final bool? retryable;
}

/// The chat client.
///
/// ── Shape ─────────────────────────────────────────────────────────────────
///
/// Streams for things that keep happening, Futures for things that finish.
/// [connect] completes once; [messages] never does. This is deliberately NOT
/// the TypeScript core's `subscribe(state => …)` + `on(event, handler)` pair:
/// that shape exists because JavaScript has no standard observable, and Dart
/// does. A Flutter host wires [messages] into a `StreamBuilder` and is done.
///
/// ── Out of scope for this pass, with the seams left open ──────────────────
///
///  * The durable offline queue (§9.1). [sendMessage] marks a send it cannot
///    hand to the transport as [MessageDelivery.failed] rather than queueing
///    it. The seam is [ConnectionController.send] returning a bool. [retry]
///    is the in-memory half of what that queue would do — it replays a failed
///    send under its original id — but it is not durable, not ordered, and
///    does not survive a restart.
///  * Delivery ticks (`message.markDelivered`/`message.delivered`). The frames
///    decode; nothing acts on them.
///  * Voice and attachments. [AttachmentMetadata] decodes so an inbound
///    message carrying one parses; there is no upload path.
///  * REST: pagination, session history, `pastSessions`. [gaps] tells a host
///    exactly which `seq` span to refetch, and refetching is its job for now.
class ChatClient {
  ChatClient({
    required Uri wsUrl,
    required PublishableKey publishableKey,
    required TokenProvider getToken,
    ChatSocketFactory? socketFactory,
    Scheduler scheduler = const SystemScheduler(),
    BackoffPolicy backoffPolicy = const BackoffPolicy(),
    UlidGenerator? ulids,
  })  : _scheduler = scheduler,
        _connection = ConnectionController(
          wsUrl: wsUrl,
          publishableKey: publishableKey,
          getToken: getToken,
          socketFactory: socketFactory,
          scheduler: scheduler,
          backoff: Backoff(policy: backoffPolicy),
          resumeTracker: ResumeTracker(),
          ulids: ulids,
        ) {
    _subscription = _connection.frames.listen(_onFrame);
  }

  final ConnectionController _connection;
  final Scheduler _scheduler;

  late final StreamSubscription<ServerFrame> _subscription;

  final StreamController<ChatMessage> _messages =
      StreamController<ChatMessage>.broadcast();
  final StreamController<SessionSnapshot> _sessions =
      StreamController<SessionSnapshot>.broadcast();
  final StreamController<TypingEvent> _typing =
      StreamController<TypingEvent>.broadcast();
  final StreamController<SessionClosed> _sessionClosed =
      StreamController<SessionClosed>.broadcast();
  final StreamController<AgentEvent> _agentJoined =
      StreamController<AgentEvent>.broadcast();
  final StreamController<PresenceEntry> _presence =
      StreamController<PresenceEntry>.broadcast();

  /// Optimistic sends awaiting an `ack`, keyed by envelope id.
  ///
  /// Under D1 that key IS the permanent message id, so this map never has to
  /// translate one id into another — the entire optimistic-id-swap machinery
  /// v1 needed (§12.9) does not exist here.
  final Map<String, _InFlightSend> _pending = <String, _InFlightSend>{};

  /// Failed sends, keyed by the same permanent id, each holding the frame AS
  /// SENT so [retry] can replay it rather than rebuild it.
  final Map<String, _FailedSend> _failed = <String, _FailedSend>{};

  String? _sessionId;

  // ── Connection ──────────────────────────────────────────────────────────

  /// Current connection state (§8.1).
  ConnectionState get connectionState => _connection.state;

  /// Connection state transitions.
  Stream<ConnectionState> get connectionStates => _connection.states;

  /// Reconnect scheduling, for a "reconnecting…" affordance (§6.5).
  Stream<ReconnectingEvent> get reconnecting => _connection.reconnecting;

  /// Why auto-retry stopped, when suspended.
  SuspendReason? get suspendReason => _connection.suspendReason;

  /// Opens the connection and drives it to connected (§6.2).
  ///
  /// Completes on `connection.ack`. Fails only on an unrecoverable auth or
  /// protocol error — never for a transport failure, which retries forever.
  Future<void> connect() => _connection.connect();

  /// User-initiated close. Terminal (§6.2, §8.1).
  Future<void> disconnect() => _connection.disconnect();

  // ── Inbound ─────────────────────────────────────────────────────────────

  /// Messages, optimistic and server-sent alike.
  ///
  /// A message this client sent appears TWICE with the SAME [ChatMessage.id]:
  /// once immediately as [MessageDelivery.pending], then again as
  /// [MessageDelivery.confirmed] with its `seq`. Because the id is permanent
  /// (D1), a host keys its list on it and the second emission replaces the
  /// first with no reconciliation.
  Stream<ChatMessage> get messages => _messages.stream;

  /// Authoritative session snapshots. Overwrite local state wholesale (§9.4).
  Stream<SessionSnapshot> get sessions => _sessions.stream;

  /// Remote typing state (§6.5).
  Stream<TypingEvent> get typing => _typing.stream;

  /// Session closure, carrying a structured reason (§12.5).
  Stream<SessionClosed> get sessionClosed => _sessionClosed.stream;

  /// Agent arrival and departure.
  Stream<AgentEvent> get agentEvents => _agentJoined.stream;

  /// Presence updates.
  Stream<PresenceEntry> get presence => _presence.stream;

  /// `seq` spans that were never delivered and must be refetched over REST.
  Stream<ResumeGap> get gaps => _connection.gaps;

  /// Protocol and transport errors (§7.4).
  Stream<ErrorPayload> get errors => _connection.errors;

  // ── Outbound ────────────────────────────────────────────────────────────

  /// Sends a message and returns the optimistic local echo immediately.
  ///
  /// ── D1, and why there is no Future here ───────────────────────────────
  ///
  /// The returned [ChatMessage] already carries its PERMANENT id: the ULID
  /// minted here is the id the server stores (D1), so this value is not a
  /// placeholder to be reconciled later. It is also pushed onto [messages],
  /// so a host can either use the return value or listen — whichever suits.
  ///
  /// This does not return a `Future` because there is nothing useful to await:
  /// §6.3 requires that sending never throw for "offline", and the ack only
  /// adds `seq`. Watching [messages] for the confirmed echo is the honest way
  /// to observe delivery, and it works identically for a message that was
  /// queued and one that went straight out.
  ChatMessage sendMessage(
    String content, {
    MessageType type = MessageType.text,
    String? replyToMessageId,
    AttachmentMetadata? attachment,
  }) {
    // The envelope id IS the permanent message id (D1), so it is minted by
    // the same generator every other frame uses and then read back off the
    // frame — rather than generated here and handed down, which is the shape
    // that lets the two drift apart.
    final ClientFrame frame = _connection.buildFrame(
      'message.send',
      messageSendPayload(
        content: content,
        type: type,
        replyToMessageId: replyToMessageId,
        attachment: attachment,
      ),
    );
    final String id = frame.id;

    final ChatMessage optimistic = ChatMessage(
      id: id,
      sessionId: _sessionId ?? '',
      // The server attributes the real sender; v2 is customer-only today and
      // hardcodes CUSTOMER server-side, so this echo says the same thing
      // rather than inventing an id the server will overwrite.
      senderId: '',
      senderType: SenderType.customer,
      type: type,
      content: content,
      seq: null,
      createdAt: _scheduler.now(),
      replyToMessageId: replyToMessageId,
      attachment: attachment,
      delivery: MessageDelivery.pending,
    );

    final bool handed = _connection.send(frame);
    final ChatMessage echo = handed ? optimistic : optimistic.failed();
    if (handed) _pending[id] = optimistic;

    _emit(_messages, echo);
    return echo;
  }

  /// Joins a session (§6.2).
  void joinSession(String sessionId) {
    _sessionId = sessionId;
    _connection.send(
      _connection.buildFrame(
        'session.join',
        sessionJoinPayload(sessionId: sessionId),
      ),
    );
  }

  /// Leaves the current session (§6.2).
  void leaveSession() {
    _connection
        .send(_connection.buildFrame('session.leave', <String, Object?>{}));
    _sessionId = null;
  }

  /// Asks for a human agent (§6.2).
  void requestAgent({String? reason}) {
    _connection.send(
      _connection.buildFrame(
        'session.requestAgent',
        sessionRequestAgentPayload(reason: reason),
      ),
    );
  }

  /// Advances the read watermark (§6.3, §9.5).
  ///
  /// Exactly one write path — there is no parallel REST call to keep in sync
  /// by hand, which is v1's §12.9 mistake.
  void markRead({String? upToMessageId}) {
    _connection.send(
      _connection.buildFrame(
        'message.markRead',
        messageMarkReadPayload(upToMessageId: upToMessageId),
      ),
    );
  }

  /// Signals that the local user started typing (§6.3).
  void startTyping() =>
      _connection.send(_connection.buildFrame('typing.start', typingPayload()));

  /// Signals that the local user stopped typing (§6.3).
  void stopTyping() =>
      _connection.send(_connection.buildFrame('typing.stop', typingPayload()));

  /// Sets presence (§6.5).
  void setPresence(PresenceStatus status) {
    _connection.send(
      _connection.buildFrame(
          'presence.set', presenceSetPayload(status: status)),
    );
  }

  /// Releases every resource.
  Future<void> dispose() async {
    await _subscription.cancel();
    await _connection.dispose();
    await _messages.close();
    await _sessions.close();
    await _typing.close();
    await _sessionClosed.close();
    await _agentJoined.close();
    await _presence.close();
  }

  // ── Routing ─────────────────────────────────────────────────────────────

  void _onFrame(ServerFrame frame) {
    switch (frame) {
      case AckSuccessFrame(:final String ref, :final Map<String, Object?> data):
        _settlePending(ref, data);
        break;
      case AckFailureFrame(:final String ref):
        final ChatMessage? pending = _pending.remove(ref);
        if (pending != null) _emit(_messages, pending.failed());
        break;
      case PushFrame(:final String type, :final Map<String, Object?> d):
        _onPush(type, d);
        break;
      case ErrorFrame():
        // Surfaced on `errors` by the controller; nothing to apply here.
        break;
    }
  }

  void _settlePending(String ref, Map<String, Object?> data) {
    final ChatMessage? pending = _pending.remove(ref);
    if (pending == null) return;
    final Object? seq = data['seq'];
    if (seq is int) {
      _emit(_messages, pending.settled(seq: seq));
    } else if (seq is double && seq.isFinite) {
      _emit(_messages, pending.settled(seq: seq.toInt()));
    }
  }

  void _onPush(String type, Map<String, Object?> d) {
    switch (type) {
      case 'connection.ack':
        final SessionSnapshot session = ConnectionAck.fromJson(d).session;
        _sessionId = session.sessionId;
        _emit(_sessions, session);
        break;
      case 'session.updated':
        final SessionSnapshot session = SessionSnapshot.fromJson(
          d['session']! as Map<String, Object?>,
          'd.session',
          frameType: type,
        );
        _sessionId = session.sessionId;
        _emit(_sessions, session);
        break;
      case 'session.closed':
        _emit(_sessionClosed, SessionClosed.fromJson(d));
        break;
      case 'message.new':
        _emit(_messages, ChatMessage.fromJson(d, 'd', frameType: type));
        break;
      case 'typing.start':
      case 'typing.stop':
        _emit(
          _typing,
          TypingEvent(
            isTyping: type == 'typing.start',
            participantId: d['participantId'] as String?,
          ),
        );
        break;
      case 'agent.joined':
      case 'agent.left':
        // One decoder for the one canonical identity shape: the same
        // HandledBy that arrives nested on a session snapshot arrives bare
        // here, so a host cannot see two different names for one participant.
        _emit(_agentJoined, HandledBy.fromJson(d, 'd', frameType: type));
        break;
      case 'presence.update':
        _emit(_presence, PresenceEntry.fromJson(d, 'd', frameType: type));
        break;
      default:
        // message.read, message.delivered, ticket.linked, system.pong.
        // Decoded and ignored: read watermarks, delivery ticks and ticket
        // linking are out of scope for this pass, and a frame this client
        // does not act on is not an error.
        break;
    }
  }

  void _emit<T>(StreamController<T> controller, T value) {
    if (!controller.isClosed) controller.add(value);
  }
}
