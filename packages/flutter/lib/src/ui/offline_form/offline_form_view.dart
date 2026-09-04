/// The out-of-hours form: leave a message when the team is closed.
///
/// Reached only when the server says so — `isOpenNow == false` AND
/// `offlineMode == COLLECT_MESSAGE`, which is `shouldCollectOffline`. The
/// other two modes never get here: SHOW_MESSAGE leaves the composer alone and
/// says the team is closed, and HIDE_WIDGET never mounted anything.
///
/// ── Business hours are the SERVER's to decide ────────────────────────────
///
/// This module receives a boolean. It never sees a schedule, a timezone or a
/// day/time range, and must not start: the merchant's calendar lives in the
/// console, the widget runs on a customer's device with a clock the customer
/// controls, and "are you open" computed on that device is a guess that
/// disagrees with the answer the agent sees. chat-service resolves it and
/// publishes `isOpenNow`; the same split the reference keeps.
///
/// ── Its own two built-ins are NOT the merchant's pre-chat questions ──────
///
/// [extraFields] is what the pre-chat gate decided to ask (see
/// `preChatFieldsToAsk`), and a signed-in visitor or an unconfigured merchant
/// supplies none. Name and contact are asked regardless, because they are the
/// REPLY CHANNEL for an answer that will arrive out of band — an agent
/// reading this tomorrow morning has no socket to answer down. That is why
/// the pre-chat gate does not cover them.
library;

import 'package:flutter/material.dart';

import '../../forms/forms.dart';
import 'offline_message.dart';

/// The two fields this form always asks, whatever the merchant configured.
///
/// Top-level constants rather than inline literals so the de-duplication rule
/// in `offline_message.dart` and the fields it protects are readable next to
/// one another: these are exactly the two questions
/// [kOfflineBuiltInLabel] exists to stop being asked twice.
const FieldSpec kOfflineNameField = FieldSpec(
  id: 'name',
  label: 'Name',
  type: FieldKind.text,
  isRequired: true,
);

/// The reply channel. `email` rather than `phone` for the keyboard, because
/// the field accepts either and an email address is the one of the two a
/// numeric keypad cannot type.
const FieldSpec kOfflineContactField = FieldSpec(
  id: 'contact',
  label: 'Email or phone',
  type: FieldKind.email,
  isRequired: true,
);

/// The out-of-hours form, or — once it has been sent — its confirmation.
class OfflineFormView extends StatefulWidget {
  const OfflineFormView({
    super.key,
    this.extraFields = const <FieldSpec>[],
    required this.onSubmit,
    required this.onError,
    this.offlineMessage,
  });

  /// The merchant's pre-chat questions, as `preChatFieldsToAsk` decided them.
  /// The ones duplicating this form's own two built-ins are dropped — see
  /// [offlineCustomFields].
  final List<FieldSpec> extraFields;

  /// Where the finished message goes. Async so a caller whose send can fail
  /// gets the re-enable and the failure sentence [FormSubmitController]
  /// guarantees; a caller whose send is queued and cannot fail simply never
  /// takes that path.
  final Future<void> Function(OfflineMessage message) onSubmit;

  /// Where a rejected submit's exception goes — never onto the screen.
  final FormErrorReporter onError;

  /// `RemoteConfig.offlineMessage`, the merchant's own words under the
  /// heading. Null falls back to this package's sentence.
  final String? offlineMessage;

  @override
  State<OfflineFormView> createState() => _OfflineFormViewState();
}

class _OfflineFormViewState extends State<OfflineFormView> {
  late final FieldView _name = FieldView(kOfflineNameField);
  late final FieldView _contact = FieldView(kOfflineContactField);

  /// The merchant's questions, already stripped of built-in duplicates.
  /// Built ONCE, in the initialiser, and not re-derived per build: these own
  /// a [TextEditingController] each, and rebuilding them would throw away
  /// whatever the customer had typed on every repaint.
  late final List<FieldView> _custom = offlineCustomFields(widget.extraFields)
      .map(FieldView.new)
      .toList(growable: false);

  final TextEditingController _message = TextEditingController();
  final FocusNode _messageFocus = FocusNode(debugLabel: 'OfflineForm(message)');

  final FormSubmitController _submit = FormSubmitController(
    label: 'Send message',
    busyLabel: 'Sending…',
  );

  /// Whether the message has been sent. The confirmation REPLACES the form
  /// rather than sitting above it: the form is spent once it has been sent,
  /// and leaving it on screen invites a second identical message from a
  /// customer who is not sure the first one landed.
  bool _sent = false;

  /// What the confirmation says it will reply to. Captured at send time,
  /// because the fields are disposed with this state and the confirmation
  /// outlives the form on screen.
  String _replyTo = '';

  final FocusNode _confirmationFocus =
      FocusNode(debugLabel: 'OfflineForm(confirmation)');

  @override
  void dispose() {
    _name.dispose();
    _contact.dispose();
    for (final FieldView field in _custom) {
      field.dispose();
    }
    _message.dispose();
    _messageFocus.dispose();
    _confirmationFocus.dispose();
    _submit.dispose();
    super.dispose();
  }

  /// The first thing wrong with the form, said, and focused. Null when there
  /// is nothing wrong.
  ///
  /// Ordered top-to-bottom, which is the order the fields are rendered in:
  /// the customer is sent to the first thing they missed, not to whichever
  /// check happened to run last.
  ///
  /// The two built-ins get bespoke sentences rather than
  /// [missingRequiredMessage]'s "Name is required." — "Please add an email or
  /// phone number so we can reply" says WHY, and the why is the whole reason
  /// this form asks at all. The merchant's own fields go through
  /// [FormSubmitController.requireAll], so a console field is refused in
  /// exactly the words every other surface in this package refuses one.
  bool _isReady() {
    if (_name.value.isEmpty) {
      _submit.showStatus('Please add your name.');
      _name.focus();
      return false;
    }
    if (_contact.value.isEmpty) {
      _submit.showStatus(
        'Please add an email or phone number so we can reply.',
      );
      _contact.focus();
      return false;
    }
    if (!_submit.requireAll(_custom)) return false;
    if (_message.text.trim().length < kOfflineMinMessageLength) {
      _submit.showStatus('Please tell us a little about what you need.');
      _messageFocus.requestFocus();
      return false;
    }
    return true;
  }

  Future<void> _run() async {
    if (!_isReady()) return;

    final String contact = _contact.value;
    final OfflineMessage message = OfflineMessage(
      name: _name.value,
      contact: contact,
      message: offlineMessageBody(
        message: _message.text,
        customFields: _custom,
      ),
    );

    final bool sent = await _submit.submitOnce(
      run: () => widget.onSubmit(message),
      failureMessage: 'We could not send that. Please try again.',
      onError: widget.onError,
    );
    if (!sent || !mounted) return;

    setState(() {
      _sent = true;
      _replyTo = contact;
    });
    // Focus follows the surface. Leaving it on the now-gone submit button
    // would strand a keyboard customer on a control that no longer exists to
    // them, with no announcement that anything happened.
    _confirmationFocus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: _sent ? _confirmation(context) : _form(context),
    );
  }

  Widget _confirmation(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Focus(
      focusNode: _confirmationFocus,
      child: Semantics(
        liveRegion: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text('Message received', style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              "We'll reply to $_replyTo as soon as the team is back online.",
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }

  Widget _form(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text("We're currently offline.", style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          widget.offlineMessage ??
              "Leave us a message and we'll get back to you.",
          style: theme.textTheme.bodyMedium
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 16),
        FormFieldInput(field: _name, textInputAction: TextInputAction.next),
        const SizedBox(height: 12),
        FormFieldInput(field: _contact, textInputAction: TextInputAction.next),
        for (final FieldView field in _custom) ...<Widget>[
          const SizedBox(height: 12),
          FormFieldInput(field: field, textInputAction: TextInputAction.next),
        ],
        const SizedBox(height: 12),
        TextField(
          controller: _message,
          focusNode: _messageFocus,
          minLines: 4,
          maxLines: 6,
          keyboardType: TextInputType.multiline,
          decoration: const InputDecoration(
            labelText: 'How can we help?',
            border: OutlineInputBorder(),
          ),
        ),
        FormStatusLine(controller: _submit),
        const SizedBox(height: 16),
        FormSubmitButton(controller: _submit, onPressed: _run),
      ],
    );
  }
}
