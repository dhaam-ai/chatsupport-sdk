// The Cubit's half of the offline story: the three inputs the bar needs that
// no `ChatWidgetState` field previously carried, and the reconnect cadence
// that keeps a recoverable outage from looking stuck.
//
// ── Why the cadence is here and not in `dhaam_chat` ──────────────────────
//
// "How long is too long to look stuck" is a product decision, not a protocol
// one. `dhaam_chat`'s full-jitter backoff (§8.2) is exactly right about
// servers — it protects a restarting one from every client it dropped
// reconnecting in lockstep — and exactly wrong about one handset leaving a
// tunnel, which is not part of any herd and is made to wait out a delay that
// has grown to 30 seconds.
//
// The cadence caps that wait without becoming a second retry loop, and the
// reason it cannot become one is in `dhaam_chat` rather than in a rule here:
// `retryNow()` acts only in `reconnecting` — no socket open, a timer counting
// down — and no-ops everywhere else, including the `connecting` of an attempt
// already in flight. The last two tests in the cadence group are that
// property, asserted rather than assumed.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_widget_chat_client.dart';

/// A scheduler whose timers fire only when the test says so.
///
/// The same shape `dhaam_chat`'s own connection tests use, reproduced here
/// rather than imported because that one lives in its test directory.
class FakeScheduler implements Scheduler {
  final List<FakeTimer> _timers = <FakeTimer>[];
  DateTime _now = DateTime.utc(2026, 1, 1);

  /// Timers armed and not yet fired or cancelled.
  List<FakeTimer> get live =>
      _timers.where((FakeTimer t) => !t.cancelled && !t.fired).toList();

  @override
  DateTime now() => _now;

  @override
  Cancellable schedule(Duration delay, void Function() callback) {
    final FakeTimer timer = FakeTimer(delay, callback);
    _timers.add(timer);
    return timer;
  }

  @override
  Cancellable periodic(Duration interval, void Function() callback) {
    final FakeTimer timer = FakeTimer(interval, callback, repeating: true);
    _timers.add(timer);
    return timer;
  }

  /// Moves time forward, firing every timer that comes due.
  void advance(Duration by) {
    _now = _now.add(by);
    for (final FakeTimer timer in _timers.toList()) {
      if (timer.cancelled || timer.fired) continue;
      if (timer.delay > by) continue;
      timer.fired = !timer.repeating;
      timer.callback();
    }
  }
}

/// Public rather than private only because [FakeScheduler.live] hands them
/// back to a test, which then reads `delay` and fires `callback` by hand.
class FakeTimer implements Cancellable {
  FakeTimer(this.delay, this.callback, {this.repeating = false});

  final Duration delay;
  final void Function() callback;
  final bool repeating;
  bool cancelled = false;
  bool fired = false;

  @override
  void cancel() => cancelled = true;
}

void main() {
  late FakeWidgetChatClient client;
  late FakeScheduler scheduler;
  late ChatWidgetCubit cubit;

  setUp(() {
    client = FakeWidgetChatClient();
    scheduler = FakeScheduler();
    cubit = ChatWidgetCubit(client: client, scheduler: scheduler);
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  group('the three inputs the banner needs', () {
    test('failedAttempts counts scheduled retries and resets on connected',
        () async {
      // Neither number is in any state snapshot — `connectionState` cycles
      // `connecting → reconnecting → connecting` forever and never says how
      // many attempts have already failed. That gap is the whole reason this
      // is tracked here.
      client.emitConnectionState(ConnectionState.reconnecting);
      client.emitReconnecting();
      await Future<void>.delayed(Duration.zero);
      expect(cubit.state.failedAttempts, 1);

      client.emitReconnecting(attempt: 1);
      await Future<void>.delayed(Duration.zero);
      expect(cubit.state.failedAttempts, 2);

      // A completed handshake is the only proof the run is over. Without this
      // the bar stays up forever after one bad minute.
      client.emitConnectionState(ConnectionState.connected);
      await Future<void>.delayed(Duration.zero);
      expect(cubit.state.failedAttempts, 0);
    });

    test('queuedCount follows the client, on messages and on transitions',
        () async {
      client.queued = 2;
      client.emitMessage(testMessage(id: 'm1'));
      await Future<void>.delayed(Duration.zero);
      expect(cubit.state.queuedCount, 2);

      // The drain happens on the `connected` edge, so the count is read after
      // the client has had it.
      client.queued = 0;
      client.emitConnectionState(ConnectionState.connected);
      await Future<void>.delayed(Duration.zero);
      expect(cubit.state.queuedCount, 0);
    });

    test('online defaults to true and is the host’s to set', () {
      // A widget that has not been told otherwise must not paint an offline
      // notice on its first frame — see ChatWidgetState.initial.
      expect(cubit.state.online, isTrue);

      cubit.setOnline(false);
      expect(cubit.state.online, isFalse);
    });
  });

  group('coming back online', () {
    test('retries at once rather than waiting out the backoff', () async {
      client.emitConnectionState(ConnectionState.reconnecting);
      await Future<void>.delayed(Duration.zero);

      cubit.setOnline(false);
      expect(client.retryNowCalls, isEmpty);

      cubit.setOnline(true);
      expect(client.retryNowCalls,
          <ConnectionState>[ConnectionState.reconnecting]);
    });

    test('an unchanged value is not a signal', () async {
      // A plugin that re-emits the same connectivity result on every network
      // change (they do) must not turn into a retry per event.
      client.emitConnectionState(ConnectionState.reconnecting);
      await Future<void>.delayed(Duration.zero);

      cubit.setOnline(true);
      cubit.setOnline(true);
      expect(client.retryNowCalls, isEmpty);
    });
  });

  group('the reconnect cadence', () {
    test('arms only while a backoff is counting down', () async {
      expect(scheduler.live, isEmpty);

      client.emitConnectionState(ConnectionState.reconnecting);
      await Future<void>.delayed(Duration.zero);
      expect(scheduler.live, hasLength(1));
      expect(scheduler.live.single.delay, kReconnectInterval);

      client.emitConnectionState(ConnectionState.connecting);
      await Future<void>.delayed(Duration.zero);
      expect(scheduler.live, isEmpty);
    });

    test('caps the wait at three seconds', () async {
      client.emitConnectionState(ConnectionState.reconnecting);
      await Future<void>.delayed(Duration.zero);

      scheduler.advance(kReconnectInterval);

      expect(client.retryNowCalls,
          <ConnectionState>[ConnectionState.reconnecting]);
    });

    test('a tick that fires after the state moved does nothing', () async {
      client.emitConnectionState(ConnectionState.reconnecting);
      await Future<void>.delayed(Duration.zero);
      final FakeTimer armed = scheduler.live.single;

      // Move the client without letting the Cubit's own subscription cancel
      // the timer first — the same-turn race the re-check inside the callback
      // exists for.
      client.emitConnectionState(ConnectionState.connected);
      armed.callback();

      expect(client.retryNowCalls, isEmpty);
    });

    test('a healthy connection has no periodic work at all', () async {
      client.emitConnectionState(ConnectionState.connected);
      await Future<void>.delayed(Duration.zero);

      scheduler.advance(const Duration(minutes: 10));

      expect(client.retryNowCalls, isEmpty);
      expect(scheduler.live, isEmpty);
    });

    test('nothing survives close()', () async {
      client.emitConnectionState(ConnectionState.reconnecting);
      await Future<void>.delayed(Duration.zero);
      expect(scheduler.live, hasLength(1));

      await cubit.close();
      expect(scheduler.live, isEmpty);

      // close() is idempotent for the tearDown that follows.
      client.emitConnectionState(ConnectionState.reconnecting);
      expect(client.retryNowCalls, isEmpty);
    });
  });
}
