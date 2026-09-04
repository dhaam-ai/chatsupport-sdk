/// The Dart analogue of `packages/rest/src/no-core-import.test.ts` — asserting
/// the OTHER direction.
///
/// ── Why the direction is reversed ─────────────────────────────────────────
///
/// The TypeScript test guards `packages/rest` against importing
/// `@dhaam-ccrm/core`, because `createChatClient` accepts five
/// independently-substitutable structural seams and `core` depends on nothing:
/// the invariant is what keeps `@dhaam-ccrm/rest` installable standalone.
///
/// `dhaam_chat_rest` is permitted — required, in fact — to depend on
/// `dhaam_chat`, so that invariant has nothing to protect here (see the barrel
/// library comment for the full reasoning). What survives is the constraint
/// underneath it, and it points the other way:
///
///   **`dhaam_chat` imports nothing from `dhaam_chat_rest`.**
///
/// That is the load-bearing one. `dhaam_chat`'s zero-HTTP boundary — one
/// runtime dependency, `web_socket_channel`, and no network client of any kind
/// — is the entire reason this package exists as a separate package rather
/// than as a directory inside it. A single "just this once" import to borrow a
/// type would put `package:http` into the lockfile of every host app that
/// wanted only the socket, and nothing else in the suite would notice.
///
/// This file scans real source text rather than trusting inspection, for the
/// same reason its TS sibling does: the property held by convention alone
/// until something asserted it.
library;

import 'dart:io';

import 'package:test/test.dart';

/// `packages/dart_rest/` → `packages/dart/`.
///
/// Anchored on the current directory, which `dart test` sets to the package
/// root. A wrong cwd makes the reads below throw rather than quietly scan
/// nothing — a scan that silently found no files would pass every assertion
/// here while checking nothing at all, which is the one failure mode this
/// file cannot afford.
Directory get _corePackage =>
    Directory('${Directory.current.parent.path}/dart');

/// Every `.dart` file under `packages/dart/lib/` — the published surface of
/// `dhaam_chat`. Tests are excluded deliberately: a test importing this
/// package would be unusual but not a boundary violation, whereas anything
/// under `lib/` ships to a host app.
List<File> _coreLibrarySources() {
  final Directory lib = Directory('${_corePackage.path}/lib');
  return lib
      .listSync(recursive: true)
      .whereType<File>()
      .where((File file) => file.path.endsWith('.dart'))
      .toList(growable: false);
}

void main() {
  group('dhaam_chat has zero dependency on dhaam_chat_rest', () {
    test(
        'declares no dhaam_chat_rest dependency in its pubspec, under any '
        'dependency field', () {
      final String pubspec =
          File('${_corePackage.path}/pubspec.yaml').readAsStringSync();

      // A YAML parser would be a third dev-dependency to assert one absence.
      // The package name is distinctive enough that its appearance ANYWHERE in
      // that pubspec — dependencies, dev_dependencies, dependency_overrides —
      // is the finding, which is strictly stronger than checking three
      // specific sections and missing a fourth.
      expect(
        pubspec.contains('dhaam_chat_rest'),
        isFalse,
        reason: 'packages/dart/pubspec.yaml must not reference '
            'dhaam_chat_rest — its zero-HTTP boundary is why dart_rest is a '
            'separate package.',
      );
    });

    test('imports nothing from dhaam_chat_rest anywhere under lib/', () {
      final List<String> offenders = <String>[];

      for (final File file in _coreLibrarySources()) {
        final String text = file.readAsStringSync();
        if (_importsRest(text)) offenders.add(file.path);
      }

      expect(offenders, isEmpty);
    });

    test(
        'carries no HTTP dependency at all — the boundary underneath the '
        'import rule', () {
      // The import scan alone would pass if `dhaam_chat` grew its own
      // `package:http` call instead of importing this package. That is the
      // same boundary failing by a different route, so it is asserted
      // directly rather than inferred.
      final String pubspec =
          File('${_corePackage.path}/pubspec.yaml').readAsStringSync();

      for (final String forbidden in <String>[
        'http:',
        'dio:',
        'http_parser:'
      ]) {
        expect(
          pubspec.contains('\n  $forbidden'),
          isFalse,
          reason: 'packages/dart must stay HTTP-free; found $forbidden',
        );
      }
    });

    test(
        'sanity: the scan actually looked at real files, including client.dart',
        () {
      final List<File> files = _coreLibrarySources();

      expect(files.length, greaterThan(5));
      expect(
        files.map((File f) => f.uri.pathSegments.last),
        contains('client.dart'),
      );
    });

    test(
        'the import detector is capable of failing — a synthetic offending '
        'line is caught', () {
      // Without this, a detector broken into always returning false would let
      // the suite pass while asserting nothing. Its TS sibling carries the
      // same guard for the same reason.
      expect(
        _importsRest("import 'package:dhaam_chat_rest/dhaam_chat_rest.dart';"),
        isTrue,
      );
      expect(_importsRest('export "package:dhaam_chat_rest/src/client.dart";'),
          isTrue);
      expect(_importsRest("import 'package:dhaam_chat/dhaam_chat.dart';"),
          isFalse);
    });
  });
}

/// Matches an `import`/`export` of this package under either quote style.
///
/// A relative-path import (`../dart_rest/...`) is covered too: it is the way
/// the boundary would most plausibly be crossed by accident inside one
/// workspace.
bool _importsRest(String source) {
  final RegExp packageForm = RegExp(
    r'''(?:import|export)\s+['"]package:dhaam_chat_rest/''',
  );
  final RegExp relativeForm = RegExp(
    r'''(?:import|export)\s+['"][^'"]*dart_rest/''',
  );
  return packageForm.hasMatch(source) || relativeForm.hasMatch(source);
}
