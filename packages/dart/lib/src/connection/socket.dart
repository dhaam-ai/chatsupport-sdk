/// Transport and timing seams.
///
/// Everything this package does to the outside world goes through one of the
/// three interfaces below, so the whole connection state machine — handshake,
/// backoff, heartbeat, resume — is exercisable in a unit test with no network
/// and no real clock. §14's requirement that inbound frames be validated
/// before business logic runs is only checkable if malformed frames can be
/// injected at will, and that needs this seam.
library;

import 'dart:async';

import 'package:web_socket_channel/web_socket_channel.dart';

/// One WebSocket connection.
///
/// Transport closure is signalled by [frames] completing — one signal, not a
/// separate `onClose` a caller can forget to wire up.
abstract interface class ChatSocket {
  /// Inbound text frames, in arrival order.
  Stream<String> get frames;

  /// Sends one text frame.
  void send(String frame);

  /// Closes the transport. Safe to call more than once.
  Future<void> close([int? code, String? reason]);
}

/// Opens a [ChatSocket]. Injected so tests can supply a fake.
typedef ChatSocketFactory = Future<ChatSocket> Function(Uri url);

/// A cancellable scheduled callback.
abstract interface class Cancellable {
  void cancel();
}

/// Clock and timers.
///
/// Injected for the same reason the socket is: a backoff test that waits 30
/// real seconds is a test nobody runs.
abstract interface class Scheduler {
  DateTime now();

  /// Runs [callback] once after [delay].
  Cancellable schedule(Duration delay, void Function() callback);

  /// Runs [callback] every [interval].
  Cancellable periodic(Duration interval, void Function() callback);
}

/// The real clock and real timers.
class SystemScheduler implements Scheduler {
  const SystemScheduler();

  @override
  DateTime now() => DateTime.now().toUtc();

  @override
  Cancellable schedule(Duration delay, void Function() callback) =>
      _TimerHandle(Timer(delay, callback));

  @override
  Cancellable periodic(Duration interval, void Function() callback) =>
      _TimerHandle(Timer.periodic(interval, (Timer _) => callback()));
}

class _TimerHandle implements Cancellable {
  _TimerHandle(this._timer);

  final Timer _timer;

  @override
  void cancel() => _timer.cancel();
}

/// A [ChatSocket] backed by `package:web_socket_channel`.
///
/// ── Why this package and nothing else ─────────────────────────────────────
///
/// `dart:io`'s WebSocket does not exist on Flutter Web and `dart:html`'s does
/// not exist anywhere else, so a client that targets iOS, Android and Web
/// needs one abstraction over both. `web_socket_channel` is the Dart team's,
/// and it is the only runtime dependency this package has.
///
/// ── Liveness, which is not what §7.3 implies ──────────────────────────────
///
/// §7.3 lists `system.heartbeat` and `system.pong` and §12.11 describes v1's
/// 25-second application-level ping, which together read as "keep the socket
/// alive by sending heartbeat frames". That is not what keeps it alive. The
/// server reaps dead peers using RFC 6455 PROTOCOL-level ping/pong on a
/// 25-second reaper tick, and drops any connection that has not ponged since
/// the previous tick. `system.heartbeat` is answered with a `system.pong` and
/// plays no part in reaping.
///
/// This matters for a native client: protocol-level pongs are sent
/// automatically by `dart:io`'s WebSocket, so Dart is fine here without doing
/// anything. An implementer on a socket library that does NOT auto-answer
/// control frames would be disconnected every 50 seconds while dutifully
/// sending `system.heartbeat` and reading §7.3 as the whole story. Nothing in
/// §7 or §8 mentions protocol-level ping/pong.
class WebSocketChatSocket implements ChatSocket {
  WebSocketChatSocket(this._channel);

  /// Connects to [url], completing when the socket is actually open.
  ///
  /// ── Why this awaits `ready` ───────────────────────────────────────────
  ///
  /// `WebSocketChannel.connect` returns before the handshake completes.
  /// `ready` is the package's documented "the connection is established"
  /// signal, and the documentation is explicit that it is a precondition for
  /// writing: "This future must be complete before data can be sent using
  /// [WebSocketChannel.sink]" — so returning the channel unawaited and letting
  /// the controller write `connection.hello` into the sink is a contract
  /// violation, not merely an early write.
  /// https://pub.dev/documentation/web_socket_channel/latest/web_socket_channel/WebSocketChannel/ready.html
  ///
  /// It also gives the controller the open/error/hang taxonomy it needs and
  /// this seam otherwise lacks: this future completing IS `onopen`, its error
  /// IS `onerror` (the controller retries a factory that throws), and a
  /// connect that produces neither — server down, no route to host — is the
  /// hang that `ConnectionController.connectTimeout` exists to bound. Before
  /// this, all three looked identical from up there.
  static Future<ChatSocket> connect(Uri url) async {
    final WebSocketChannel channel = WebSocketChannel.connect(url);
    await channel.ready;
    return WebSocketChatSocket(channel);
  }

  final WebSocketChannel _channel;

  @override
  Stream<String> get frames => _channel.stream.map((Object? event) {
        if (event is String) return event;
        // The v2 protocol is JSON text (§7.1). A binary frame is not something
        // this protocol defines, and decoding one as UTF-8 would be inventing
        // a rule the spec does not have.
        throw const SocketProtocolException(
          'received a binary frame; the v2 protocol is JSON text',
        );
      });

  @override
  void send(String frame) => _channel.sink.add(frame);

  @override
  Future<void> close([int? code, String? reason]) =>
      _channel.sink.close(code, reason);
}

/// Raised when the transport delivers something the protocol does not define.
class SocketProtocolException implements Exception {
  const SocketProtocolException(this.reason);

  final String reason;

  @override
  String toString() => 'SocketProtocolException: $reason';
}
