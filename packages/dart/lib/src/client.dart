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
///  * PERSISTENCE for the offline queue (§9.1). The queue itself is here —
///    [sendMessage] holds a send it cannot hand to the transport, and the
///    client replays the whole outbox in FIFO order on reconnect (§8.4) — but
///    it lives in memory only. A process restart loses it. The seam for the
///    durable half is [_outbox]: it is a plain FIFO list of frames already
///    built, so persisting it is serialising `ClientFrame`s, not reworking
///    the send path.
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
    _stateSubscription = _connection.states.listen(_onConnectionState);
  }

  final ConnectionController _connection;
  final Scheduler _scheduler;

  late final StreamSubscription<ServerFrame> _subscription;
  late final StreamSubscription<ConnectionState> _stateSubscription;

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

  /// Sends the server REFUSED, keyed by the same permanent id, each holding
  /// the frame as sent so [retry] can replay it rather than rebuild it.
  ///
  /// Deliberately not the same thing as [_outbox]. A send the server rejected
  /// will be rejected again, so it must not be replayed on a timer — the
  /// customer would spend their battery collecting the same verdict. These
  /// need [retry], gated on the server's own `retryable` flag.
  final Map<String, _FailedSend> _failed = <String, _FailedSend>{};

  /// Sends waiting for a connection, oldest first — the offline queue (§9.1).
  ///
  /// ── The one invariant, and what it buys ───────────────────────────────
  ///
  /// An entry leaves this list only when it has been written to a live socket.
  /// Not when it is composed, not when the connection drops, not when the
  /// customer navigates. §8.4's "an unacked frame moves into the queue when
  /// the transport drops" therefore needs no move at all for anything still
  /// held here — it never left.
  ///
  /// FIFO by construction rather than by a sort: new sends append to the tail
  /// and the drain reads from the head, so a message composed now cannot
  /// overtake one composed a minute ago in a tunnel. Orphans recovered from
  /// [_pending] go to the FRONT ([_onConnectionState]) because they were
  /// composed before everything already in the list.
  ///
  /// A `List` rather than a `Map` for exactly that reason: order IS the data
  /// structure's job here, and the id lookup [_pending] and [_failed] need is
  /// not something the drain ever performs.
  final List<_InFlightSend> _outbox = <_InFlightSend>[];

  /// The conversation this client is in — the session a message composed now
  /// is addressed to.
  ///
  /// Written by the authoritative snapshot and by nothing else:
  /// `connection.ack` and `session.updated` (§9.4 — overwrite wholesale),
  /// which are the same two frames that push [sessions] and therefore the same
  /// two moments a host repaints. One writer is the point; a second one that
  /// ran earlier is how this field and the screen come to name different
  /// conversations. See [joinSession].
  ///
  /// The one deliberate exception is [leaveSession], which clears it. Leaving
  /// names no incoming session, so there is nothing to be wrong about, and a
  /// send composed after it is unaddressed rather than addressed to a
  /// conversation the host has left.
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

  /// Abandons an armed reconnect backoff and attempts immediately.
  ///
  /// For a host that has learned the reason the last attempts failed is gone —
  /// on a phone, that is a connectivity stream reporting wifi or mobile data
  /// back. Backoff will by then have grown toward its 30-second cap, and
  /// waiting it out on a device that is plainly online again is what "it just
  /// says Connecting…" is.
  ///
  /// Narrow on purpose, and NOT a second [connect]: it completes no future,
  /// leaves the auth escalation counter alone (a network blip is no evidence a
  /// rejected token was fixed), and resets only the transport attempt counter.
  /// It acts ONLY while a backoff is counting down
  /// ([ConnectionState.reconnecting]) and returns `false` — a pure no-op, safe
  /// to call on any cadence — everywhere else, including
  /// [ConnectionState.suspended] and [ConnectionState.closed], which §8.1
  /// makes recoverable only by an explicit [connect].
  bool retryNow() => _connection.retryNow();

  /// How many composed messages are waiting for a connection.
  ///
  /// The number an "offline, your messages are safe" banner names. It counts
  /// only sends that WILL go out by themselves — never a
  /// [MessageDelivery.failed] one, which needs [retry] and its own affordance,
  /// and promising its delivery would be a lie.
  int get queuedCount => _outbox.length;

  /// The queued sends themselves, oldest first, as their optimistic echoes.
  ///
  /// An unmodifiable view: mutating the outbox from outside would break the
  /// ordering the drain depends on.
  List<ChatMessage> get queuedMessages => List<ChatMessage>.unmodifiable(
        _outbox.map((_InFlightSend entry) => entry.message.queued()),
      );

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
  ///
  /// ── The frame is ADDRESSED to the session it was composed in ──────────
  ///
  /// `d.sessionId` is stamped here, from the session this client currently
  /// holds a snapshot for, and it travels with the frame for the rest of that
  /// frame's life. The alternative — letting the server file the message under
  /// whatever the connection last joined — is a property of the CONNECTION
  /// rather than of the message, and the two diverge whenever a frame built at
  /// one moment reaches the wire at another. This package has no offline
  /// queue, so that happens in exactly two places, and both are ordinary:
  ///
  ///  * [retry] replays a frame built arbitrarily long ago, after the customer
  ///    may well have moved to another conversation;
  ///  * a reconnect's `connection.ack` carries a session this client never
  ///    asked for, and the sends orphaned by that same drop are precisely the
  ///    ones a host offers a Retry button for.
  ///
  /// Without the address, either one delivers a message the customer typed in
  /// one conversation into another, acked as success.
  ///
  /// The field is optional on the wire: absent means the old behaviour, so an
  /// older server or an older client is unaffected. Present, the server runs
  /// the same ownership check `session.join` runs and refuses outright on
  /// failure rather than falling back.
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
        // The session this message is composed in, stamped ONCE, here — see
        // the method doc. Null only before any snapshot has named a session,
        // and null omits the field rather than sending `''`.
        sessionId: _sessionId,
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

    if (_connection.send(frame)) {
      _pending[id] = _InFlightSend(frame, optimistic);
      _emit(_messages, optimistic);
      return optimistic;
    }

    // No wire to write to. HELD, not failed — this is the case §6.3 means by
    // "sending never throws for offline", and it is the commonest thing that
    // happens to a message on a phone.
    //
    // The frame is kept rather than the content, and that is the whole reason
    // this replays safely: the envelope id is the permanent message id (D1)
    // and the server dedupes on it, so an entry written just before the socket
    // dropped and replayed on the next one is deduped rather than delivered
    // twice. Rebuilding the frame at drain time would mint a fresh ULID and
    // turn exactly that case into two messages.
    _outbox.add(_InFlightSend(frame, optimistic));
    final ChatMessage echo = optimistic.queued();
    _emit(_messages, echo);
    return echo;
  }

  /// Replays a failed send under its ORIGINAL envelope id.
  ///
  /// ── Why this method exists at all ─────────────────────────────────────
  ///
  /// The envelope id IS the permanent message id (D1) and the server dedupes
  /// on it. A host that implements Retry by calling [sendMessage] again mints
  /// a fresh ULID, defeats that dedup, and produces a second, distinct
  /// message — so every press against a failure that has not gone away adds
  /// another dead message to the thread. The only fix that holds is
  /// structural: this replays a frame built once, and there is no path here
  /// that can produce a new id.
  ///
  /// Only a send currently marked [MessageDelivery.failed] is eligible; see
  /// [RetryRefusalReason] for what each refusal means. A retried send is
  /// re-emitted on [messages] as [MessageDelivery.pending] and settles
  /// through the normal ack path.
  ///
  /// This is NOT the durable offline queue §9.1 describes: nothing here
  /// survives a process restart, and a retry needs a live connection to be
  /// accepted.
  RetryOutcome retry(String id) {
    final _FailedSend? failure = _failed[id];
    if (failure == null) {
      return const RetryRefused(RetryRefusalReason.notFound);
    }

    if (!(failure.retryable ?? kDefaultRetryable)) {
      // Left in place: the host is still rendering this message as failed and
      // is entitled to ask again and get the same answer.
      return const RetryRefused(RetryRefusalReason.notRetryable);
    }

    // THE original frame. Not a copy, not a rebuild.
    if (!_connection.send(failure.frame)) {
      return const RetryRefused(RetryRefusalReason.disconnected);
    }

    // Claimed only once the frame is actually on the wire, so a refusal never
    // loses the record.
    _failed.remove(id);
    _pending[id] = _InFlightSend(failure.frame, failure.message);
    _emit(_messages, failure.message);
    return RetryRetried(failure.message);
  }

  /// Joins a session (§6.2).
  ///
  /// ── The join does not move this client until the server says so ───────
  ///
  /// This sends the frame and nothing else. Which conversation this client is
  /// in is written in exactly one place — the authoritative snapshot on
  /// `connection.ack` and `session.updated` (§9.4, overwrite wholesale) — so a
  /// join takes effect when the server's `session.updated` lands, which is
  /// also the moment [sessions] tells the host to repaint.
  ///
  /// Pointing at [sessionId] optimistically here would open a window in which
  /// this client is committed to the incoming session while [sessions] — the
  /// only thing a host renders off — still names the outgoing one. A message
  /// typed into that screen belongs to the conversation on it, and stamping it
  /// with the incoming session is the cross-conversation delivery that
  /// [sendMessage]'s address exists to prevent. The window is also
  /// unrecoverable when the join is REFUSED: nothing rolls the pointer back,
  /// so every later send names a session this client is not in.
  ///
  /// A join the server never answers therefore leaves sends composing into the
  /// session on screen, which is the conservative half of the trade and the
  /// same commit rule the TypeScript core's session switch was rebuilt around.
  void joinSession(String sessionId) {
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
    await _stateSubscription.cancel();
    await _connection.dispose();
    await _messages.close();
    await _sessions.close();
    await _typing.close();
    await _sessionClosed.close();
    await _agentJoined.close();
    await _presence.close();
  }

  // ── Routing ─────────────────────────────────────────────────────────────

  /// The two halves of §8.4, on the one edge that produces both.
  ///
  /// ── Leaving `connected`: unacked sends go back in the queue ───────────
  ///
  /// Nothing will ever settle a send that was awaiting an `ack` on a socket
  /// that is gone — the server does not re-send the reply. Left alone they
  /// stay [MessageDelivery.pending] for the life of the process: a spinner
  /// that never stops, for what is the commonest failure on a phone, where the
  /// frame reached the wire and the tunnel arrived before the reply did.
  ///
  /// They are put at the FRONT of [_outbox] rather than marked failed. Front,
  /// because they were composed before anything already waiting there, and
  /// FIFO is a claim about the order the customer typed in. Replaying one the
  /// server actually persisted is safe, and is why the ORIGINAL frame is what
  /// gets held: the server dedupes on the envelope id (D1, §9.3).
  ///
  /// This is the behaviour change from the first pass, which marked these
  /// [MessageDelivery.failed] and left the customer to press Retry. That was
  /// honest when there was no queue; with one, it is a message the SDK could
  /// have delivered and asked a human to deliver instead.
  ///
  /// ── Reaching `connected`: the queue drains ────────────────────────────
  ///
  /// In list order, onto the socket that has just come up. Written straight
  /// through rather than one-ack-at-a-time: writes on a single WebSocket
  /// arrive in the order they were made, so the order the customer typed in is
  /// preserved by the transport rather than by a second state machine here. An
  /// entry the write refuses stays queued, at the head, for the next
  /// connection — which is the invariant [_outbox] exists to hold.
  void _onConnectionState(ConnectionState state) {
    if (state == ConnectionState.connected) {
      _drainOutbox();
      return;
    }

    if (_pending.isEmpty) return;

    final List<_InFlightSend> orphans = _pending.values.toList();
    _pending.clear();
    _outbox.insertAll(0, orphans);
    for (final _InFlightSend orphan in orphans) {
      _emit(_messages, orphan.message.queued());
    }
  }

  /// Writes the queue to the live socket, oldest first.
  ///
  /// Each entry is removed only once [ConnectionController.send] has taken it,
  /// so a write that refuses stops the drain with the queue intact and in
  /// order. The alternative — clearing the list first and re-adding the
  /// failures — has a window in which a send the customer made is in neither
  /// place.
  void _drainOutbox() {
    while (_outbox.isNotEmpty) {
      final _InFlightSend entry = _outbox.first;
      if (!_connection.send(entry.frame)) return;
      _outbox.removeAt(0);
      _pending[entry.frame.id] = entry;
      _emit(_messages, entry.message);
    }
  }

  void _onFrame(ServerFrame frame) {
    switch (frame) {
      case AckSuccessFrame(:final String ref, :final Map<String, Object?> data):
        _settlePending(ref, data);
        break;
      case AckFailureFrame(:final String ref, :final ErrorPayload error):
        final _InFlightSend? inFlight = _pending.remove(ref);
        if (inFlight != null) {
          // The server's own verdict is carried into the failure record so
          // [retry] gates on it rather than on a second copy of §7.4's table.
          _failed[ref] =
              _FailedSend(inFlight.frame, inFlight.message, error.retryable);
          _emit(_messages, inFlight.message.failed());
        }
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
    final _InFlightSend? inFlight = _pending.remove(ref);
    if (inFlight == null) return;
    final ChatMessage pending = inFlight.message;
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
