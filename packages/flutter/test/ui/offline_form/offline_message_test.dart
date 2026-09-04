// The rules half of the out-of-hours form: which of the merchant's fields
// survive alongside the two built-ins, and how the answers become one message
// a human reads.
//
// The anchored-vs-substring question is asserted here rather than through a
// pumped form because it is the rule a merchant's own wording is judged by,
// and because it is the one that fails SILENTLY: a substring match drops the
// field, the customer is never asked, and nothing on screen says a question
// went missing.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

const FieldSpec _name = FieldSpec(
  id: 'p1',
  label: 'Your name',
  type: FieldKind.text,
  isRequired: true,
);
const FieldSpec _email = FieldSpec(
  id: 'p2',
  label: 'Email address',
  type: FieldKind.email,
  isRequired: true,
);
const FieldSpec _order = FieldSpec(
  id: 'p3',
  label: 'Order number',
  type: FieldKind.text,
  isRequired: false,
);

/// The merchant field the anchoring exists to protect. It CONTAINS "Name" and
/// must survive.
const FieldSpec _product = FieldSpec(
  id: 'x',
  label: 'Name of the product you ordered',
  type: FieldKind.text,
  isRequired: false,
);

List<String> _labels(List<FieldSpec> specs) =>
    specs.map((FieldSpec spec) => spec.label).toList();

void main() {
  group('offlineCustomFields — de-duplicating the built-ins', () {
    // The console seeds every workspace with "Your name" and "Email address",
    // so without this every untouched merchant asks for a name twice.
    test('drops console fields that duplicate the built-ins', () {
      expect(
        _labels(offlineCustomFields(<FieldSpec>[_name, _email, _order])),
        <String>['Order number'],
      );
    });

    test('keeps a merchant field that merely CONTAINS a built-in word', () {
      expect(
        _labels(offlineCustomFields(<FieldSpec>[_product])),
        <String>['Name of the product you ordered'],
      );
    });

    test('matches the seeded labels case-insensitively', () {
      expect(
        offlineCustomFields(<FieldSpec>[
          _name.copyLabel('YOUR NAME'),
          _email.copyLabel('email address'),
        ]),
        isEmpty,
      );
    });

    test('trims before judging, so a stray space is not a new question', () {
      expect(
          offlineCustomFields(<FieldSpec>[_name.copyLabel(' Name ')]), isEmpty);
    });

    test('drops every seeded label the console can produce', () {
      const List<String> seeded = <String>[
        'name',
        'your name',
        'email',
        'email address',
        'phone',
        'contact',
        'contact details',
      ];
      for (final String label in seeded) {
        expect(
          offlineCustomFields(<FieldSpec>[_name.copyLabel(label)]),
          isEmpty,
          reason: '"$label" is one of the console\'s own seeds',
        );
      }
    });

    test('keeps the merchant order it was given', () {
      expect(
        _labels(offlineCustomFields(<FieldSpec>[_order, _product])),
        <String>['Order number', 'Name of the product you ordered'],
      );
    });

    // ── The mutation check ────────────────────────────────────────────────
    //
    // Not a test of the shipped code: a demonstration that the anchors are
    // load-bearing. `kOfflineBuiltInLabel` without `^`/`$` is the substring
    // rule, and this shows exactly what it would cost — the merchant's own
    // question is swallowed and the customer is never asked which product.
    test('the anchors are what save "Name of the product you ordered"', () {
      final RegExp anchored = kOfflineBuiltInLabel;
      final RegExp unanchored = RegExp(
        anchored.pattern.replaceFirst('^', '').replaceFirst(r'$', ''),
        caseSensitive: false,
      );

      const String merchantLabel = 'Name of the product you ordered';

      // What ships: the merchant's field survives.
      expect(anchored.hasMatch(merchantLabel), isFalse);
      // What a substring match would do: swallow it.
      expect(unanchored.hasMatch(merchantLabel), isTrue);

      // ...while both still catch the console's own seed, which is why the
      // difference is invisible on the happy path and only shows up on a
      // merchant who wrote their own question.
      expect(anchored.hasMatch('Your name'), isTrue);
      expect(unanchored.hasMatch('Your name'), isTrue);
    });
  });

  group('offlineMessageBody — flattened into the message, on purpose', () {
    // A `FieldView` needs no widget tree; it owns a controller and a focus
    // node and nothing else.
    FieldView answered(FieldSpec spec, String value) {
      final FieldView view = FieldView(spec);
      view.controller.text = value;
      addTearDown(view.dispose);
      return view;
    }

    test('appends answered custom fields as "Label: value"', () {
      expect(
        offlineMessageBody(
          message: 'My parcel never arrived',
          customFields: <FieldView>[answered(_order, 'ORD-42')],
        ),
        'My parcel never arrived\n\nOrder number: ORD-42',
      );
    });

    // Absent, never "Order number: ". An empty line under a label says the
    // customer was asked and answered with nothing.
    test('leaves an unanswered optional field out of the body entirely', () {
      expect(
        offlineMessageBody(
          message: 'Where is my order',
          customFields: <FieldView>[answered(_order, '')],
        ),
        'Where is my order',
      );
    });

    test('orders the lines by the merchant\'s fields, not by the answers', () {
      expect(
        offlineMessageBody(
          message: 'Hello there',
          customFields: <FieldView>[
            answered(_order, 'ORD-42'),
            answered(_product, 'A kettle'),
          ],
        ),
        'Hello there\n\nOrder number: ORD-42'
        '\n\nName of the product you ordered: A kettle',
      );
    });

    test('trims the typed message', () {
      expect(
        offlineMessageBody(
          message: '  spaced out  ',
          customFields: const <FieldView>[],
        ),
        'spaced out',
      );
    });
  });
}

extension on FieldSpec {
  FieldSpec copyLabel(String label) => FieldSpec(
        id: id,
        label: label,
        type: type,
        isRequired: isRequired,
      );
}
