// The memory half of the mute switch: that the visitor's decision to silence
// the chime survives the app being closed.
//
// The counterpart of `consent_wiring_test.dart`, and worth its own file for
// the same reason: the failure is silent. A visitor who muted, quit and came
// back is chimed at again with nothing on screen to say the switch was
// forgotten — and no rule test in `chime_test.dart` fails, because the rules
// inside `Chime` are all still correct.
//
// `ChatWidgetCubit` is the public boundary here: a host's app restart is a
// new Cubit reading the same store, which is exactly what these build.

import 'dart:async';

import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../state/fake_widget_chat_client.dart';

final PublishableKey _tenant = PublishableKey.parse('dhp_test_abc123');
final PublishableKey _otherTenant = PublishableKey.parse('dhp_test_def456');

void main() {
  late FakeWidgetChatClient client;

  setUp(() => client = FakeWidgetChatClient());
  tearDown(() async => client.dispose());

  /// A Cubit wired to [storage] for [key] — one "launch" of a host's app.
  ChatWidgetCubit launch(ChatStorage storage, {PublishableKey? key}) {
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      mute: MuteMemory(
        storage: storage,
        publishableKey: key ?? _tenant,
      ),
    );
    addTearDown(cubit.close);
    return cubit;
  }

  test('a visitor who muted is still muted on the next launch', () async {
    final ChatStorage storage = MemoryChatStorage();

    launch(storage).setMuted(true);
    // Let the write land before the next launch reads it back.
    await pumpEventQueue();

    final ChatWidgetCubit relaunched = launch(storage);
    await pumpEventQueue();

    expect(relaunched.state.muted, isTrue);
  });

  test('a visitor who un-muted is not muted again on the next launch',
      () async {
    // The other direction, and not the same test: an un-mute that merely
    // failed to write would ALSO leave an unmuted widget on the next launch,
    // for the wrong reason. So this starts from a store that really does hold
    // "muted" and asserts the recorded value at each step, not just the end.
    final String key = chatStorageKey(_tenant, kMutedStorageName);
    final ChatStorage storage = MemoryChatStorage();

    launch(storage).setMuted(true);
    await pumpEventQueue();
    expect(await storage.read(key), kMutedStoredValue);

    // The second launch restores the mute FIRST and the visitor turns it off
    // after — the only order the header menu can produce, since the label it
    // paints is read from the restored state.
    final ChatWidgetCubit second = launch(storage);
    await pumpEventQueue();
    expect(second.state.muted, isTrue);

    second.setMuted(false);
    await pumpEventQueue();
    expect(await storage.read(key), kUnmutedStoredValue);

    final ChatWidgetCubit relaunched = launch(storage);
    await pumpEventQueue();

    expect(relaunched.state.muted, isFalse);
  });

  // The read is asynchronous and the header menu is not. This pins the
  // ordering rule that makes that safe: the restore only ever SILENCES, so a
  // visitor who reached for the switch first keeps what they chose.
  test('a mute made before the stored answer lands survives it', () async {
    final _DeferredChatStorage storage = _DeferredChatStorage();
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      mute: MuteMemory(storage: storage, publishableKey: _tenant),
    );
    addTearDown(cubit.close);

    cubit.setMuted(true);
    expect(cubit.state.muted, isTrue);

    // The store finally answers, with the un-muted default this visitor has
    // just overruled.
    storage.pendingRead.complete(kUnmutedStoredValue);
    await pumpEventQueue();

    expect(cubit.state.muted, isTrue);
  });

  // Keyed per publishable key, exactly as consent is: a merchant testing
  // their own widget beside a customer app must not silence both.
  test('does not let one tenant mute another', () async {
    final ChatStorage storage = MemoryChatStorage();

    launch(storage).setMuted(true);
    await pumpEventQueue();

    final ChatWidgetCubit other = launch(storage, key: _otherTenant);
    await pumpEventQueue();

    expect(other.state.muted, isFalse);
  });

  group('a store that cannot be read', () {
    test('does not crash the widget', () async {
      final ChatWidgetCubit cubit = ChatWidgetCubit(
        client: client,
        mute: MuteMemory(
          storage: _BrokenChatStorage(),
          publishableKey: _tenant,
        ),
      );
      addTearDown(cubit.close);
      await pumpEventQueue();

      expect(cubit.state.muted, isFalse);
    });

    // The one that matters: the read is async and the switch is not, so a
    // rejection landing after the visitor has already reached for the menu
    // must not undo what they just did.
    test('does not silently un-mute a visitor who muted', () async {
      final ChatWidgetCubit cubit = ChatWidgetCubit(
        client: client,
        mute: MuteMemory(
          storage: _BrokenChatStorage(),
          publishableKey: _tenant,
        ),
      );
      addTearDown(cubit.close);

      cubit.setMuted(true);
      await pumpEventQueue();

      expect(cubit.state.muted, isTrue);
    });

    // A failed write is honoured for this session and asked again on the
    // next one — the same direction `ConsentGate.recordAgreed` fails in, and
    // for the same reason: a device that blocks app data is a setting the
    // visitor is entitled to, not an error to put in front of them.
    test('does not refuse the mute it could not record', () async {
      final ChatWidgetCubit cubit = ChatWidgetCubit(
        client: client,
        mute: MuteMemory(
          storage: _BrokenChatStorage(),
          publishableKey: _tenant,
        ),
      );
      addTearDown(cubit.close);

      cubit.setMuted(true);
      await pumpEventQueue();
      cubit.setMuted(false);
      await pumpEventQueue();

      expect(cubit.state.muted, isFalse);
    });
  });

  // The default, and not a test-only shim: a host that wires no durable store
  // gets exactly what `ChatWidgetState.muted` had before this landed.
  test('a host that wires no store keeps the switch for this session only',
      () async {
    final ChatWidgetCubit first = ChatWidgetCubit(client: client);
    addTearDown(first.close);
    first.setMuted(true);
    await pumpEventQueue();
    expect(first.state.muted, isTrue);

    final ChatWidgetCubit second = ChatWidgetCubit(client: client);
    addTearDown(second.close);
    await pumpEventQueue();

    expect(second.state.muted, isFalse);
  });
}

/// A store whose read does not land until the test says so — a stand-in for
/// the real disk I/O `SharedPreferencesChatStorage` does, which a
/// microtask-fast in-memory map cannot reproduce. The same shim
/// `consent_wiring_test.dart` uses, for the same ordering question.
class _DeferredChatStorage implements ChatStorage {
  final Completer<String?> pendingRead = Completer<String?>();

  @override
  Future<String?> read(String key) => pendingRead.future;

  @override
  Future<void> write(String key, String value) async {}
}

/// A store whose every operation fails — a device with app data blocked.
class _BrokenChatStorage implements ChatStorage {
  @override
  Future<String?> read(String key) async => throw StateError('no store');

  @override
  Future<void> write(String key, String value) async =>
      throw StateError('no store');
}
