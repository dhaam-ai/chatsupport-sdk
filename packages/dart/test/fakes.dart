import 'dart:async';

import 'package:dhaam_chat/src/connection/socket.dart';

/// A socket whose inbound frames a test delivers by hand.
class FakeSocket implements ChatSocket {
  final StreamController<String> _controller = StreamController<String>();

  /// Every frame the controller sent, as raw JSON text.
  final List<String> sent = <String>[];

  bool closed = false;

  @override
  Stream<String> get frames => _controller.stream;

  @override
  void send(String frame) => sent.add(frame);

  @override
  Future<void> close([int? code, String? reason]) async {
    closed = true;
    if (!_controller.isClosed) await _controller.close();
  }

  /// Delivers one inbound frame.
  void deliver(String raw) {
    if (!_controller.isClosed) _controller.add(raw);
  }

  /// Simulates the transport dropping — a tunnel, a backgrounded app, a
  /// server restart. Indistinguishable from a clean close at this layer,
  /// which is why §8.2 retries both indefinitely.
  Future<void> drop() async {
    if (!_controller.isClosed) await _controller.close();
  }
}

class _Task {
  _Task(this.due, this.callback, this.interval);

  Duration due;
  final void Function() callback;

  /// Non-null for a periodic task.
  final Duration? interval;
  bool cancelled = false;
}

class _TaskHandle implements Cancellable {
  _TaskHandle(this._task);

  final _Task _task;

  @override
  void cancel() => _task.cancelled = true;
}

/// A clock a test advances by hand.
///
/// Without this, every backoff assertion would wait a real 30 seconds and the
/// heartbeat test would wait 25 — which is to say nobody would run them.
class FakeScheduler implements Scheduler {
  static final DateTime _base = DateTime.utc(2026, 8, 19, 12);

  Duration _elapsed = Duration.zero;
  final List<_Task> _tasks = <_Task>[];

  @override
  DateTime now() => _base.add(_elapsed);

  @override
  Cancellable schedule(Duration delay, void Function() callback) {
    final _Task task = _Task(_elapsed + delay, callback, null);
    _tasks.add(task);
    return _TaskHandle(task);
  }

  @override
  Cancellable periodic(Duration interval, void Function() callback) {
    final _Task task = _Task(_elapsed + interval, callback, interval);
    _tasks.add(task);
    return _TaskHandle(task);
  }

  /// Moves the clock forward, running everything that comes due in order.
  void advance(Duration by) {
    final Duration target = _elapsed + by;
    while (true) {
      _Task? next;
      for (final _Task task in _tasks) {
        if (task.cancelled || task.due > target) continue;
        if (next == null || task.due < next.due) next = task;
      }
      if (next == null) break;

      _elapsed = next.due;
      final Duration? interval = next.interval;
      if (interval == null) {
        _tasks.remove(next);
      } else {
        next.due = next.due + interval;
      }
      next.callback();
    }
    _elapsed = target;
  }

  /// Pending, uncancelled tasks.
  int get pending => _tasks.where((_Task t) => !t.cancelled).length;
}

/// Lets queued microtasks and zero-duration futures run.
///
/// `connect()` awaits getToken and then the socket factory, so a test must
/// give those futures a turn before the fake socket exists.
Future<void> flush([int turns = 8]) async {
  for (int i = 0; i < turns; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}
