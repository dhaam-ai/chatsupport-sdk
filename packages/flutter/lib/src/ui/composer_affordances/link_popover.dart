/// Asking for a URL, inside the widget.
///
/// Ports the link half of `packages/widget/src/ui/composer.ts`
/// (`:371-459`).
///
/// ── Why this is a widget and not a platform dialog ───────────────────────
///
/// The original was `window.prompt()`. That is the HOST's dialog, not the
/// widget's: it renders in the browser's own chrome, unthemed and outside the
/// widget's root, and on embeds where the host had stubbed `prompt` out or
/// the frame was sandboxed without `allow-modals` it never appeared at all —
/// so "add link" was a button that visibly did nothing. The Flutter form of
/// the same mistake is a platform `showDialog` carrying a bare text field, or
/// worse a native alert: a question the widget asks belongs inside the
/// widget's own tree, where it is themed by the merchant's own colours and
/// cannot be suppressed by the host.
///
/// ── One validator, and a rejection that keeps the customer's typing ──────
///
/// [safeLinkUrl] is the only thing that decides. Not a second regular
/// expression here, not the platform's own URL keyboard, not a `TextField`
/// validator with its own idea of what a URL is — because two validators mean
/// two answers to "may this be inserted", and the looser one is the one an
/// attacker uses. A rejection therefore stays INSIDE this popover, next to
/// the field it is about, and **leaves the value in place** so a customer who
/// typed `htps://` fixes one character rather than retyping the whole URL.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show safeLinkUrl;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Shown when [safeLinkUrl] refuses. A plain sentence naming the shape that
/// would work — never the raw value echoed back, and never a scheme name that
/// reads as a suggestion to try it.
const String kLinkRejectionMessage =
    'That does not look like a valid https:// link.';

/// A URL field and two buttons, stacked above the message box.
class LinkPopover extends StatefulWidget {
  const LinkPopover({super.key, required this.onInsert, this.onCancel});

  /// A URL passed [safeLinkUrl]. Delivered in the form the validator returned
  /// — trimmed, otherwise verbatim — so what the customer sees inserted is
  /// what they typed.
  final ValueChanged<String> onInsert;

  /// Cancel, or Escape. Absent means the popover cannot be dismissed from
  /// inside itself.
  final VoidCallback? onCancel;

  @override
  State<LinkPopover> createState() => _LinkPopoverState();
}

class _LinkPopoverState extends State<LinkPopover> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _fieldFocus = FocusNode();
  String? _error;

  @override
  void initState() {
    super.initState();
    // The popover exists to be typed into, and it is only ever built at the
    // moment the customer asked for it.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _fieldFocus.requestFocus();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _fieldFocus.dispose();
    super.dispose();
  }

  void _submit() {
    final String? url = safeLinkUrl(_controller.text);
    if (url == null) {
      // Open, with the value untouched and focus back on it: the customer is
      // one keystroke from a working URL, and clearing the field here would
      // make them retype it to find out.
      setState(() => _error = kLinkRejectionMessage);
      _fieldFocus.requestFocus();
      return;
    }
    widget.onInsert(url);
  }

  KeyEventResult _onKey(FocusNode _, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (event.logicalKey != LogicalKeyboardKey.escape) {
      return KeyEventResult.ignored;
    }
    final VoidCallback? cancel = widget.onCancel;
    if (cancel == null) return KeyEventResult.ignored;
    cancel();
    // Handled, so the surrounding panel's own Escape handler never sees it —
    // an Escape meant for this popover must not close the conversation.
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final String? error = _error;
    return Focus(
      onKeyEvent: _onKey,
      // A container, not a bare Column: a screen reader that lands here
      // should be told it is in a named group rather than reading a loose
      // field followed by two unexplained buttons.
      child: Semantics(
        container: true,
        label: 'Insert a link',
        child: Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              TextField(
                key: const Key('composer.link.url'),
                controller: _controller,
                focusNode: _fieldFocus,
                // `url` rather than a platform URL keyboard's own validation:
                // this only shapes the keys offered, and nothing about it
                // decides what may be inserted.
                keyboardType: TextInputType.url,
                autocorrect: false,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
                decoration: InputDecoration(
                  labelText: 'Link URL',
                  hintText: 'https://…',
                  isDense: true,
                  errorText: error,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: <Widget>[
                  TextButton(
                    key: const Key('composer.link.cancel'),
                    onPressed: widget.onCancel,
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    key: const Key('composer.link.insert'),
                    onPressed: _submit,
                    child: const Text('Insert'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
