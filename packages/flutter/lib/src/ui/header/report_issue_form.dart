/// "Report an issue" — a form that files a real ticket without a conversation.
///
/// Ports `packages/widget/src/ui/report-issue.ts`.
///
/// The point of the form is that it is NOT a chat: a customer who already
/// knows what went wrong should not have to talk their way to a ticket. So it
/// stands IN PLACE OF the transcript the way the pre-chat and out-of-hours
/// forms do, in the one surface slot they share, rather than opening as a
/// dialog over it.
///
/// ── Why so few fields ────────────────────────────────────────────────────
///
/// Subject and details, and nothing else required. The customer is already
/// authenticated — the route resolves their email from the session's own
/// record when the form does not supply one — so asking for contact details a
/// second time is asking them to retype something the system already knows.
/// The email field exists only for the case where they want the reply
/// somewhere else.
///
/// Attachments are deliberately absent. The route accepts attachment
/// METADATA, but a ticket system that cannot read the bytes gets a reference
/// to nothing, and a file input that silently discarded the file would be
/// worse than no file input.
library;

import 'package:flutter/material.dart';

import '../../forms/forms.dart';
import 'transcript_email.dart';

/// The two single-line fields, in order.
///
/// The email's label is `'Reply to a different email'` and NOT the reference's
/// `'Reply to a different email (optional)'`: this package's form substrate
/// appends the optional marker itself (`FieldView.displayLabel`), so carrying
/// the reference's baked-in suffix would render it twice. The rendered result
/// is the same string, produced by the one rule that produces it everywhere
/// else.
const List<FieldSpec> kReportIssueFields = <FieldSpec>[
  FieldSpec(
    id: 'subject',
    label: 'What went wrong?',
    type: FieldKind.text,
    isRequired: true,
  ),
  FieldSpec(
    id: 'contactEmail',
    label: 'Reply to a different email',
    type: FieldKind.email,
    isRequired: false,
  ),
];

/// Shown when the details box is empty. A sentence of its own, because the
/// details are a textarea rather than a [FieldView] and so are not covered by
/// [FormSubmitController.requireAll].
const String kReportDetailsRequiredMessage = 'Details are required.';

/// Shown when the submit rejects. A plain sentence: the error itself carries a
/// stack and possibly a URL, and goes to the reporter instead.
const String kReportFailureMessage =
    "We couldn't send that report. Please try again.";

class ReportIssueForm extends StatefulWidget {
  const ReportIssueForm({
    super.key,
    required this.onSubmit,
    required this.onCancel,
    required this.onError,
  });

  /// Files the report. Rejects on failure — the form shows its own message
  /// and keeps what the customer typed.
  final IssueReporter onSubmit;

  /// The customer backing out, and also the way OUT of the confirmation.
  ///
  /// One callback for both, because the job is the same one: hand the surface
  /// slot back and return to the screen this was opened from.
  final VoidCallback onCancel;

  final FormErrorReporter onError;

  @override
  State<ReportIssueForm> createState() => _ReportIssueFormState();
}

class _ReportIssueFormState extends State<ReportIssueForm> {
  final List<FieldView> _fields =
      kReportIssueFields.map(FieldView.new).toList();
  final TextEditingController _details = TextEditingController();
  final FocusNode _detailsFocus = FocusNode(debugLabel: 'report.details');
  final FocusNode _dismissFocus = FocusNode(debugLabel: 'report.done');
  final FormSubmitController _submit =
      FormSubmitController(label: 'Send report', busyLabel: 'Sending…');

  /// Whether the report has been filed and the confirmation has taken over.
  bool _sent = false;

  @override
  void dispose() {
    for (final FieldView field in _fields) {
      field.dispose();
    }
    _details.dispose();
    _detailsFocus.dispose();
    _dismissFocus.dispose();
    _submit.dispose();
    super.dispose();
  }

  FieldView _field(String id) =>
      _fields.firstWhere((FieldView f) => f.spec.id == id);

  Future<void> _send() async {
    // Named AND focused, through the substrate — so this form's refusal reads
    // the same as every other form's.
    if (!_submit.requireAll(_fields)) return;

    final String details = _details.text.trim();
    if (details.isEmpty) {
      _submit.showStatus(kReportDetailsRequiredMessage);
      _detailsFocus.requestFocus();
      return;
    }

    final String email = _field('contactEmail').value;
    final bool ok = await _submit.submitOnce(
      run: () => widget.onSubmit(
        RestIssueReport(
          subject: _field('subject').value,
          details: details,
          // Omitted rather than sent empty: the route treats an ABSENT email
          // as "use the address already on file", and `''` would fail its own
          // `.email()` check for no reason.
          contactEmail: email.isEmpty ? null : email,
        ),
      ),
      failureMessage: kReportFailureMessage,
      onError: widget.onError,
    );
    if (!ok || !mounted) return;

    setState(() => _sent = true);
    // Focus follows the content that replaced what it was on: the submit
    // button the customer just pressed is gone from the tree, and focus left
    // on a removed node falls back to nothing at all.
    _dismissFocus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return _sent ? _buildConfirmation(context) : _buildForm(context);
  }

  Widget _buildForm(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        Text('Report an issue', style: text.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Tell us what happened and we will open a ticket.',
          style: text.bodySmall,
        ),
        const SizedBox(height: 16),
        for (final FieldView field in _fields) ...<Widget>[
          FormFieldInput(field: field, textInputAction: TextInputAction.next),
          const SizedBox(height: 12),
        ],
        // A multi-line box rather than another `FieldSpec`, because
        // `FormFieldInput` builds single-line inputs and the whole value of
        // this form is the room to explain. Its label reaches assistive tech
        // the same way every other field's does, through `labelText`.
        TextField(
          controller: _details,
          focusNode: _detailsFocus,
          minLines: 4,
          maxLines: 8,
          keyboardType: TextInputType.multiline,
          decoration: const InputDecoration(
            labelText: 'Details',
            hintText: 'What happened, and what did you expect instead?',
            border: OutlineInputBorder(),
            alignLabelWithHint: true,
          ),
        ),
        FormStatusLine(controller: _submit),
        const SizedBox(height: 16),
        FormSubmitButton(controller: _submit, onPressed: _send),
        const SizedBox(height: 8),
        // Disabled while the submit is in flight, for the same reason the
        // end-conversation dialog disables "Keep chatting": a cancel landing
        // mid-request would tear the surface down under an outcome that still
        // has to land somewhere.
        ListenableBuilder(
          listenable: _submit,
          builder: (BuildContext context, Widget? child) => TextButton(
            onPressed: _submit.isBusy ? null : widget.onCancel,
            child: const Text('Cancel'),
          ),
        ),
      ],
    );
  }

  /// The confirmation, which REPLACES the form.
  ///
  /// Not a toast and not a banner above the form: replacing it is what makes
  /// filing the same report twice impossible by pressing the button again.
  ///
  /// It carries its own way out, and that is not politeness. This surface
  /// stands in place of the transcript, and the surface slot never preempts
  /// one the customer opened — so a confirmation with no control of its own
  /// hands the slot back to nobody: the transcript and composer stay hidden,
  /// and on a panel opened straight onto a conversation there is no Back
  /// either. `onCancel` rather than a second callback, because the job it does
  /// is the same one Cancel does.
  Widget _buildConfirmation(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Semantics(
      liveRegion: true,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Text('Report sent', style: text.titleMedium),
          const SizedBox(height: 4),
          // No ticket reference is quoted. The route does not return one, and
          // inventing a reassuring "we'll be in touch shortly" that nothing
          // guarantees is the kind of small dishonesty this package avoids.
          Text(
            'Our team has it and will follow up by email.',
            style: text.bodySmall,
          ),
          const SizedBox(height: 16),
          TextButton(
            focusNode: _dismissFocus,
            onPressed: widget.onCancel,
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }
}
