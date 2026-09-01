/// The §8 connection state machine.
///
/// Owns: opening the socket, the `connection.hello` → `connection.ack`
/// handshake (§7.3), heartbeat, full-jitter reconnect (§8.2), resume anchoring
/// (§8.3, D2), and the auth escalation in §10.6. Owns nothing above that —
/// messages, optimistic echo and session state live in `client.dart`.
library;

import 'dart:async';

import '../auth/keys.dart';
import '../auth/token.dart';
import '../protocol/envelope.dart';
import '../protocol/errors.dart';
import '../protocol/frames.dart';
import '../protocol/ulid.dart';
import '../resume/resume_tracker.dart';
import 'backoff.dart';
import 'socket.dart';

/// §8.1 states.
enum ConnectionState {
  /// No connection attempted yet.
  idle,

  /// Socket opening.
  connecting,

  /// Socket open, `connection.hello` sent, awaiting `connection.ack`.
  authenticating,

  /// Ack received; sends flow normally.
  connected,

  /// Transport dropped or ack timed out; auto-retrying per §8.2.
  reconnecting,

  /// Auto-retry stopped. Requires an explicit [ConnectionController.connect].
  suspended,

  /// [ConnectionController.disconnect] was called. Terminal.
  closed,
}

/// Why auto-retry stopped (§8.1, §6.5).
///
/// §6.5 types this as `'auth' | 'maxAttempts'`, which does not cover §7.5's
/// requirement that an unsupported protocol version "must surface as a
/// suspended state, not retry-loop". [protocolUnsupported] fills that hole.
/// Note that `maxAttempts` in §6.5 can only ever mean the AUTH attempt cap,
/// since §8.2 has transport failures retry indefinitely.
enum SuspendReason {
  /// `getToken()` failed, or the server rejected fresh tokens
  /// [BackoffPolicy.maxAuthAttempts] times running (§10.6).
  auth,

  /// The server cannot speak any version this client offers (§7.5).
  protocolUnsupported,
}

/// Raised on a [ConnectionController.connect] future that was still pending
/// when [ConnectionController.disconnect] was called.
class ConnectionClosedError implements Exception {
  const ConnectionClosedError();

  @override
  String toString() =>
      'ConnectionClosedError: disconnect() was called before the connection '
      'reached connected';
}

/// Emitted whenever a reconnect is scheduled (§6.5).
class ReconnectingEvent {
  const ReconnectingEvent({required this.attempt, required this.delay});

  final int attempt;
  final Duration delay;
}

/// Drives one WebSocket connection through §8's state machine.
class ConnectionController {
  ConnectionController({
    required Uri wsUrl,
    required PublishableKey publishableKey,
    required TokenProvider getToken,
    ChatSocketFactory? socketFactory,
    Scheduler scheduler = const SystemScheduler(),
    Backoff? backoff,
    ResumeTracker? resumeTracker,
    UlidGenerator? ulids,
    this.connectTimeout = const Duration(seconds: 10),
    this.handshakeTimeout = const Duration(seconds: 10),
    this.heartbeatInterval = const Duration(seconds: 25),
  })  : _wsUrl = wsUrl,
        _publishableKey = publishableKey,
        _getToken = getToken,
        _socketFactory = socketFactory ?? WebSocketChatSocket.connect,
        _scheduler = scheduler,
        _backoff = backoff ?? Backoff(),
        _resume = resumeTracker ?? ResumeTracker(),
        _ulids = ulids ?? UlidGenerator();

  final Uri _wsUrl;
  final PublishableKey _publishableKey;
  final TokenProvider _getToken;
  final ChatSocketFactory _socketFactory;
  final Scheduler _scheduler;
  final Backoff _backoff;
  final ResumeTracker _resume;
  final UlidGenerator _ulids;

  /// How long one connect attempt may spend before the socket is up.
  ///
  /// ── The gap no callback can cover ─────────────────────────────────────
  ///
  /// Retry is reachable from exactly one place in this class —
  /// [_scheduleReconnect], driven by a terminated attempt — so an attempt
  /// that never terminates is an attempt that is never retried. Both things
  /// this method awaits before a socket exists can hang without ever
  /// throwing: `getToken()` is host code talking to the host's own backend,
  /// and the socket factory reaches the network, where "server down" and "no
  /// route to host" look on many platforms like a connect that simply does
  /// not call back until the OS's own TCP timeout gives up — tens of seconds
  /// to several minutes later, with no WebSocket-level event in between.
  /// Without this deadline the client sits in [ConnectionState.connecting]
  /// for all of it and a host cannot tell that apart from a slow connect.
  ///
  /// Armed at the start of every attempt and cancelled the moment the socket
  /// is up, after which [handshakeTimeout] bounds the rest. 10 seconds
  /// matches the TypeScript core's `DEFAULT_CONNECT_TIMEOUT_MS` and this
  /// file's other two deadlines; nothing about iOS, Android or Flutter Web
  /// argues for a different number, and a mobile round trip has a long way
  /// to go before it needs more.
  final Duration connectTimeout;

  /// How long to wait for `connection.ack` after sending `connection.hello`.
  ///
  /// SPEC GAP: §8.1 says `authenticating` ends on "`connection.ack` or
  /// `error`" and never bounds the wait. A server that accepts the socket and
  /// then says nothing — a half-open connection through a NAT that dropped
  /// state, which is routine on mobile — would otherwise leave a client in
  /// `authenticating` forever. The server does impose its own hello timeout
  /// and closes with 1008, but a client cannot depend on a close frame
  /// arriving over a path that is already broken.
  final Duration handshakeTimeout;

  /// How often to send `system.heartbeat` (§7.3).
  ///
  /// SPEC GAP: v2 states no interval. 25 seconds matches v1 (§12.11) and the
  /// server's reaper tick. See [WebSocketChatSocket] for why the reaper does
  /// not actually run off these frames.
  final Duration heartbeatInterval;

  final StreamController<ConnectionState> _stateController =
      StreamController<ConnectionState>.broadcast();
  final StreamController<ServerFrame> _frameController =
      StreamController<ServerFrame>.broadcast();
  final StreamController<ResumeGap> _gapController =
      StreamController<ResumeGap>.broadcast();
  final StreamController<ErrorPayload> _errorController =
      StreamController<ErrorPayload>.broadcast();
  final StreamController<ReconnectingEvent> _reconnectingController =
      StreamController<ReconnectingEvent>.broadcast();

  ConnectionState _state = ConnectionState.idle;
  ChatSocket? _socket;
  StreamSubscription<String>? _subscription;
  Cancellable? _retryTimer;
  Cancellable? _heartbeatTimer;
  Cancellable? _handshakeTimer;
  Cancellable? _connectTimer;

  /// Which connect attempt owns this controller right now.
  ///
  /// Every terminal callback carries the generation it was armed for, so a
  /// close, an error or a deadline belonging to an attempt that has already
  /// been superseded cannot terminate the attempt that replaced it.
  int _attemptGeneration = 0;

  /// Whether the current attempt is still unterminated. This is what makes
  /// [_finishAttempt] idempotent — see there.
  bool _attemptLive = false;
  Completer<void>? _connectCompleter;
  int _transportAttempt = 0;
  int _authFailures = 0;
  bool _disposed = false;

  /// Current state.
  ConnectionState get state => _state;

  /// State transitions. Broadcast; late subscribers miss earlier transitions,
  /// so read [state] for the current value.
  Stream<ConnectionState> get states => _stateController.stream;

  /// Validated inbound frames, including replayed ones.
  ///
  /// Replayed frames are emitted here in `seq` order before the ack's own
  /// effects, so a subscriber sees a single ordered history and cannot tell a
  /// replayed message from a live one — which is the point.
  Stream<ServerFrame> get frames => _frameController.stream;

  /// Spans of `seq` that were never delivered and must be refetched (§6.3).
  Stream<ResumeGap> get gaps => _gapController.stream;

  /// Protocol and transport errors (§7.4, §6.5).
  Stream<ErrorPayload> get errors => _errorController.stream;

  /// Reconnect scheduling, so a host can render "reconnecting…" without
  /// reimplementing §8.2.
  Stream<ReconnectingEvent> get reconnecting => _reconnectingController.stream;

  /// Why auto-retry stopped, when [state] is [ConnectionState.suspended].
  SuspendReason? get suspendReason => _suspendReason;
  SuspendReason? _suspendReason;

  /// The `seq` this client would resume from (§8.3, D2).
  int? get resumeFrom => _resume.anchor;

  /// Opens the connection and drives it to [ConnectionState.connected].
  ///
  /// Completes when `connection.ack` arrives. Completes with an error only on
  /// an unrecoverable auth or protocol failure — never for a transport
  /// failure, which is retried indefinitely (§8.2).
  ///
  /// Calling this from [ConnectionState.suspended] clears the suspension and
  /// resets the auth counter, which is the §8.1 "requires an explicit
  /// connect() call, typically after the host app fixes auth" path.
  Future<void> connect() {
    if (_disposed) {
      throw StateError('ConnectionController has been disposed');
    }
    if (_state == ConnectionState.connected) return Future<void>.value();

    final Completer<void>? existing = _connectCompleter;
    if (existing != null && !existing.isCompleted) return existing.future;

    // An explicit connect() is the host telling us the problem is fixed.
    _authFailures = 0;
    _transportAttempt = 0;
    _suspendReason = null;

    final Completer<void> completer = Completer<void>();
    _connectCompleter = completer;
    unawaited(_openSocket());
    return completer.future;
  }

  /// Abandons the armed backoff and attempts NOW, from attempt 0.
  ///
  /// For one caller: something outside this controller has learned that the
  /// reason the last attempts failed has gone away. On a phone that is not
  /// hypothetical — it is a connectivity stream reporting wifi or mobile data
  /// back after a tunnel, a lift, or airplane mode. Backoff is a guess about
  /// when to try again, and a host holding that fact has better information
  /// than the guess. Without this the customer waits out a delay that has
  /// already grown toward [BackoffPolicy.cap] (30s) while their signal bar is
  /// plainly full again.
  ///
  /// ── Why this is not [connect] ─────────────────────────────────────────
  ///
  /// [connect] returns the in-flight completer's future whenever one is
  /// pending, and on a client that has never reached `connection.ack` that is
  /// the whole retry loop — so it would open no socket at all in exactly the
  /// case that matters. It also resets the auth failure counter, and a network
  /// blip is not evidence that a rejected credential has been fixed.
  ///
  /// So this takes neither liberty: no completer is created or completed, the
  /// auth counter is untouched, and only the TRANSPORT attempt counter — the
  /// one the network genuinely invalidated — goes back to 0.
  ///
  /// Returns whether an attempt was actually started. `false` is a pure no-op
  /// and is safe to call on any cadence. It covers every other state:
  /// [ConnectionState.connecting] and [ConnectionState.authenticating] already
  /// have an attempt in flight, which must not be superseded a frame before it
  /// opens; [ConnectionState.connected] has nothing to retry; and §8.1 makes
  /// [ConnectionState.suspended] and [ConnectionState.closed] recoverable only
  /// by an explicit [connect], because a credential fault or the host's own
  /// [disconnect] is not something coming back online has fixed.
  bool retryNow() {
    if (_disposed || _state != ConnectionState.reconnecting) return false;

    _retryTimer?.cancel();
    _retryTimer = null;
    _transportAttempt = 0;
    // Every terminal callback carries the generation it was armed for, and
    // [_openSocket] bumps it — so a retry timer callback that had already been
    // dispatched cannot terminate the attempt this starts.
    unawaited(_openSocket());
    return true;
  }

  /// User-initiated close. Terminal — no auto-reconnect follows (§8.1).
  Future<void> disconnect() async {
    _attemptLive = false;
    _cancelTimers();
    _setState(ConnectionState.closed);
    _failConnect(const ConnectionClosedError());
    await _teardownSocket();
  }

  /// Sends a frame. Silently drops when not connected.
  ///
  /// Dropping is correct HERE and would not be correct one layer up: §8.4
  /// requires unacked client frames to move to the durable offline queue
  /// rather than be lost. That queue is out of scope for this pass, so
  /// `client.dart` marks such sends as failed rather than pretending they
  /// went. This method reports whether the frame reached the socket so the
  /// layer above can tell.
  bool send(ClientFrame frame) {
    final ChatSocket? socket = _socket;
    if (socket == null || _state != ConnectionState.connected) return false;
    socket.send(frame.encode());
    return true;
  }

  /// Builds an envelope with a fresh ULID and the current clock.
  ///
  /// `ts` is a [DateTime] and is encoded as epoch millis by [ClientFrame] —
  /// see there for why that is not the caller's choice.
  ClientFrame buildFrame(String type, Map<String, Object?> payload) =>
      ClientFrame(
        type: type,
        id: _ulids.next(),
        ts: _scheduler.now(),
        d: payload,
      );

  /// Releases every resource. The controller cannot be reused afterwards.
  Future<void> dispose() async {
    _disposed = true;
    _attemptLive = false;
    _cancelTimers();
    await _teardownSocket();
    await _stateController.close();
    await _frameController.close();
    await _gapController.close();
    await _errorController.close();
    await _reconnectingController.close();
  }

  // ── Handshake ───────────────────────────────────────────────────────────

  Future<void> _openSocket() async {
    final int generation = _beginAttempt();
    _setState(ConnectionState.connecting);

    final String token;
    try {
      token = await _getToken();
    } on Object catch (error) {
      // §10.6: getToken throwing IS an auth failure. The host's exception is
      // kept as `cause` and never interpolated into a message — this package
      // cannot know whether it embeds the token it failed to parse.
      _onAuthFailure(
        generation,
        const ErrorPayload(
          code: ErrorCode.authInvalid,
          message: 'getToken() failed',
          retryable: false,
        ),
        cause: error,
      );
      return;
    }

    // The deadline may have fired while that future was outstanding, in which
    // case this attempt is already retried and everything below belongs to
    // nobody. Checked after every await for the same reason.
    if (!_isCurrentAttempt(generation)) return;

    if (token.isEmpty) {
      // §10.6 counts "resolves to a falsy value" as a failure. An empty token
      // would otherwise be sent and rejected a round trip later, which spends
      // one of only three auth attempts on a question already answered here.
      _onAuthFailure(
        generation,
        const ErrorPayload(
          code: ErrorCode.authInvalid,
          message: 'getToken() returned an empty token',
          retryable: false,
        ),
      );
      return;
    }

    final ChatSocket socket;
    try {
      socket = await _socketFactory(_wsUrl);
    } on Object catch (_) {
      _finishAttempt(generation);
      return;
    }

    if (!_isCurrentAttempt(generation) ||
        _state == ConnectionState.closed ||
        _disposed) {
      // A socket that arrived for an attempt nobody is waiting on any more.
      // Closing it is not tidiness: left open it stays authenticated
      // server-side until the liveness reaper collects it, and its eventual
      // close would tear down whatever connection replaced this one.
      await socket.close();
      return;
    }

    // The socket is up, which is this transport's `onopen`. The connect
    // deadline has done its job and [handshakeTimeout] bounds the rest —
    // leaving it armed would kill a healthy connection ten seconds in.
    _connectTimer?.cancel();
    _connectTimer = null;

    _socket = socket;
    _subscription = socket.frames.listen(
      _onFrameText,
      // NOT a log statement. Nothing across this seam guarantees that a done
      // follows an error — `web_socket_channel`'s backends deliver the two
      // independently — so an error that only logged would strand the
      // connection with no close to retry from. Both route into the same
      // funnel, which is what keeps the pair from producing two retries.
      onError: (Object _) => _finishAttempt(generation),
      onDone: () => _finishAttempt(generation),
      cancelOnError: false,
    );

    _setState(ConnectionState.authenticating);

    socket.send(
      buildFrame(
        'connection.hello',
        connectionHelloPayload(
          token: token,
          publishableKey: _publishableKey.value,
          // Omitted, not null, when this client has never applied a seq. The
          // server reads absent as "fresh" and 0 as "replay everything".
          resumeFrom: _resume.anchor,
        ),
      ).encode(),
    );

    _handshakeTimer = _scheduler.schedule(handshakeTimeout, () {
      if (_state == ConnectionState.authenticating) _finishAttempt(generation);
    });
  }

  void _onFrameText(String text) {
    final ServerFrame frame;
    try {
      frame = decodeServerFrame(text);
    } on FrameDecodeException catch (error) {
      // §14: a malformed frame is never partially applied. It is surfaced and
      // dropped; it does not tear down a healthy connection, because one bad
      // frame from a server that is otherwise fine is not a reason to
      // reconnect the whole fleet.
      _emitError(
        ErrorPayload(
          code: ErrorCode.validationFailed,
          message: 'inbound frame rejected: ${error.reason}',
          retryable: false,
          details: <String, Object?>{'path': error.path},
        ),
      );
      return;
    }

    switch (frame) {
      case ErrorFrame(:final ErrorPayload error):
        _onErrorFrame(error);
        break;
      case PushFrame(type: 'connection.ack'):
        _onAck(frame);
        break;
      case PushFrame(type: 'system.pong'):
        // Answered. The server's reaping runs off protocol-level pongs, so
        // nothing here depends on this arriving.
        break;
      case PushFrame():
        _deliver(frame);
        break;
      case AckSuccessFrame():
        _emitFrame(frame);
        break;
      case AckFailureFrame(:final ErrorPayload error):
        _emitFrame(frame);
        _emitError(error);
        break;
    }
  }

  void _onAck(PushFrame frame) {
    _handshakeTimer?.cancel();
    _handshakeTimer = null;

    final ConnectionAck ack;
    try {
      ack = ConnectionAck.fromJson(frame.d);
    } on FrameDecodeException catch (error) {
      _emitError(
        ErrorPayload(
          code: ErrorCode.validationFailed,
          message: 'connection.ack rejected: ${error.reason}',
          retryable: false,
        ),
      );
      _finishAttempt(_attemptGeneration);
      return;
    }

    if (ack.protocolVersion != kProtocolVersion) {
      // §7.5 forbids silently downgrading behaviour for a version this client
      // did not offer. Negotiation is min(client, server), so a value other
      // than ours means the server chose something we cannot speak.
      _suspend(SuspendReason.protocolUnsupported);
      _emitError(
        const ErrorPayload(
          code: ErrorCode.protocolVersionUnsupported,
          message: 'server negotiated a protocol version this client does not '
              'implement',
          retryable: false,
        ),
      );
      return;
    }

    // Replay first, in seq order, then the ack's own anchor — so a gap between
    // replayed frames and a gap the ack merely claimed are both reported, and
    // in that order. Ordering is by `seq`; `ts` is never consulted (D2).
    final List<ServerFrame> replay = List<ServerFrame>.of(ack.replay)
      ..sort((ServerFrame a, ServerFrame b) =>
          (seqOf(a) ?? 0).compareTo(seqOf(b) ?? 0));

    for (final ServerFrame replayed in replay) {
      _deliver(replayed);
    }

    final ResumeGap? gap = _resume.settleAck(ack.seq);
    if (gap != null) _emitGap(gap);

    _transportAttempt = 0;
    _authFailures = 0;
    _setState(ConnectionState.connected);
    _startHeartbeat();

    // The ack itself is delivered last, so a subscriber that rebuilds session
    // state from it (§9.4 — overwrite wholesale) does so after every replayed
    // message has already landed.
    _emitFrame(frame);

    final Completer<void>? completer = _connectCompleter;
    if (completer != null && !completer.isCompleted) completer.complete();
  }

  void _deliver(ServerFrame frame) {
    final int? seq = seqOf(frame);
    if (seq != null) {
      final ResumeGap? gap = _resume.observe(seq);
      if (gap != null) _emitGap(gap);
    }
    _emitFrame(frame);
  }

  void _onErrorFrame(ErrorPayload error) {
    _emitError(error);

    switch (error.code) {
      case ErrorCode.authInvalid:
      case ErrorCode.authExpired:
        // Arrived on this attempt's own socket, so the attempt in flight is
        // by definition the one being failed.
        _onAuthFailure(_attemptGeneration, error);
        break;
      case ErrorCode.protocolVersionUnsupported:
        _suspend(SuspendReason.protocolUnsupported);
        break;
      case ErrorCode.rateLimited:
      case ErrorCode.validationFailed:
      case ErrorCode.sessionNotFound:
      case ErrorCode.sessionClosed:
      case ErrorCode.internal:
        // Not lifecycle events. The server sends a standalone VALIDATION_FAILED
        // for a resumeFrom ahead of its own last_seq WITHOUT closing the
        // socket, so treating any of these as a disconnect would tear down a
        // healthy connection.
        break;
    }
  }

  // ── Failure paths ───────────────────────────────────────────────────────

  void _onAuthFailure(int generation, ErrorPayload error, {Object? cause}) {
    // Claimed through the same funnel every other terminal path uses, so a
    // close arriving from this attempt's socket afterwards cannot spend a
    // second auth attempt on the same failure.
    if (!_claimAttempt(generation)) return;

    _authFailures++;
    if (_authFailures >= _backoff.policy.maxAuthAttempts) {
      _suspend(SuspendReason.auth, cause: cause);
      return;
    }
    // Below the cap, retry — which re-invokes getToken(), so a merely expired
    // token recovers without the host doing anything (§10.4).
    unawaited(_teardownSocket());
    _scheduleReconnect();
  }

  void _suspend(SuspendReason reason, {Object? cause}) {
    // Not a claim: [_onAuthFailure] has already claimed by the time it gets
    // here, while the §7.5 version path arrives with the attempt still live.
    // Setting the flag directly is idempotent and works for both.
    _attemptLive = false;
    _cancelTimers();
    _suspendReason = reason;
    _setState(ConnectionState.suspended);
    unawaited(_teardownSocket());
    _failConnect(
      TokenUnavailableError(
        reason == SuspendReason.auth
            ? 'authentication failed repeatedly; connection suspended'
            : 'protocol version unsupported; connection suspended',
        cause: cause,
      ),
    );
  }

  /// Starts a connect attempt, arming the deadline that guarantees it ends.
  int _beginAttempt() {
    _cancelTimers();
    _attemptLive = true;
    final int generation = ++_attemptGeneration;
    _connectTimer = _scheduler.schedule(connectTimeout, () {
      _connectTimer = null;
      _finishAttempt(generation);
    });
    return generation;
  }

  /// Whether [generation] is still the attempt this controller is running.
  bool _isCurrentAttempt(int generation) =>
      _attemptLive && generation == _attemptGeneration;

  /// Claims the right to terminate [generation], exactly once.
  ///
  /// Returns false for an attempt that has already ended and for one that has
  /// been superseded — which is the whole reason every terminal signal routes
  /// through here rather than acting directly. A socket that errors and then
  /// closes, a handshake that times out just before the server's close frame
  /// lands, a deadline that fires as the connect finally resolves: all of
  /// those deliver two terminal signals for one attempt, and two retries mean
  /// a double-advanced backoff counter and a phantom "reconnecting in Ns" a
  /// host will render.
  ///
  /// Cancelling the timers HERE, rather than in each caller, is what stops
  /// the connect deadline leaking: there is no terminal path that does not
  /// pass through this method.
  bool _claimAttempt(int generation) {
    if (!_isCurrentAttempt(generation)) return false;
    _attemptLive = false;
    _cancelTimers();
    return true;
  }

  /// The one funnel every ended attempt runs through, and the only route into
  /// [_scheduleReconnect] for a transport failure.
  void _finishAttempt(int generation) {
    if (!_claimAttempt(generation)) return;
    if (_state == ConnectionState.closed ||
        _state == ConnectionState.suspended ||
        _disposed) {
      return;
    }
    unawaited(_teardownSocket());
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_state == ConnectionState.closed ||
        _state == ConnectionState.suspended ||
        _disposed) {
      return;
    }
    _cancelTimers();
    _setState(ConnectionState.reconnecting);

    final Duration delay = _backoff.nextDelay(_transportAttempt);
    if (!_reconnectingController.isClosed) {
      _reconnectingController
          .add(ReconnectingEvent(attempt: _transportAttempt, delay: delay));
    }
    _transportAttempt++;

    _retryTimer = _scheduler.schedule(delay, () {
      if (_state == ConnectionState.reconnecting) unawaited(_openSocket());
    });
  }

  // ── Housekeeping ────────────────────────────────────────────────────────

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = _scheduler.periodic(heartbeatInterval, () {
      send(buildFrame('system.heartbeat', heartbeatPayload()));
    });
  }

  void _cancelTimers() {
    _connectTimer?.cancel();
    _connectTimer = null;
    _retryTimer?.cancel();
    _retryTimer = null;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _handshakeTimer?.cancel();
    _handshakeTimer = null;
  }

  Future<void> _teardownSocket() async {
    final StreamSubscription<String>? subscription = _subscription;
    final ChatSocket? socket = _socket;
    _subscription = null;
    _socket = null;
    await subscription?.cancel();
    await socket?.close();
  }

  void _emitFrame(ServerFrame frame) {
    if (!_frameController.isClosed) _frameController.add(frame);
  }

  void _emitError(ErrorPayload error) {
    if (!_errorController.isClosed) _errorController.add(error);
  }

  void _emitGap(ResumeGap gap) {
    if (!_gapController.isClosed) _gapController.add(gap);
  }

  void _setState(ConnectionState next) {
    if (_state == next) return;
    _state = next;
    if (!_stateController.isClosed) _stateController.add(next);
  }

  void _failConnect(Object error) {
    final Completer<void>? completer = _connectCompleter;
    _connectCompleter = null;
    if (completer != null && !completer.isCompleted) {
      completer.completeError(error);
    }
  }
}
