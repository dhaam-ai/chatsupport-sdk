/// The scrollback itself. Draws whatever [MessageListPresenter] projected
/// and decides nothing of its own.
///
/// The one thing this widget owns that the projection cannot is the scroll
/// anchor: whether the customer was at the bottom has to be read from a laid
/// out list, and read BEFORE it grows (see [isNearBottom]).
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show AttachmentMetadata, ChatMessage;
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../quick_replies.dart';
import 'linkified_text.dart';
import 'message_actions.dart';
import 'message_list_presenter.dart';
import 'message_row.dart';
import 'reply_quote.dart';
import 'scroll_anchor.dart';
import 'tick_state.dart';

/// Everything the transcript hands back to its host.
class MessageListCallbacks {
  const MessageListCallbacks({
    required this.onRetry,
    required this.onCopyMessage,
    required this.onReplyToMessage,
    required this.onQuickReply,
    this.onOpenLink,
  });

  /// Replays THIS message — the object core gave the row, id and all, never
  /// its rendered text. A retry keyed on `message.id` can therefore never
  /// see the §12.10 placeholder-stripped string.
  final ValueChanged<ChatMessage> onRetry;

  /// Puts the message's text on the clipboard. Throws if the platform
  /// refuses.
  final Future<void> Function(ChatMessage message) onCopyMessage;

  /// Starts a reply addressed to this message.
  ///
  /// The resolved sender name rides along because only the transcript can
  /// resolve it: a [ChatMessage] carries no display name, and the composer
  /// needs the name for its quote chip and for the send's `reply` metadata
  /// without re-deriving it from state a second way.
  final void Function(ChatMessage message, String senderName) onReplyToMessage;

  /// Sends one of the bot's suggested follow-ups as the customer's next
  /// message — verbatim, which is why the chip row is handoff-filtered.
  final ValueChanged<String> onQuickReply;

  /// Opens a link the customer tapped. `null` renders links inert.
  final ValueChanged<String>? onOpenLink;
}

class MessageListView extends StatefulWidget {
  const MessageListView({
    super.key,
    required this.inputs,
    required this.callbacks,
    this.presenter,
    this.attachmentBuilder,
  });

  final MessageListInputs inputs;
  final MessageListCallbacks callbacks;

  /// The projection. Externally owned when a caller needs its remembered bot
  /// name or its announce watermark to survive this widget; otherwise this
  /// widget owns one for its lifetime.
  final MessageListPresenter? presenter;

  /// Draws one attachment. Left as a seam: attachment rendering is its own
  /// node's work, and a half-built one here would be the "menu item that
  /// cannot work" mistake in another shape.
  final Widget Function(BuildContext context, AttachmentMetadata attachment)?
      attachmentBuilder;

  @override
  State<MessageListView> createState() => _MessageListViewState();
}

class _MessageListViewState extends State<MessageListView> {
  final ScrollController _scroll = ScrollController();

  MessageListPresenter? _owned;
  MessageListPresenter get _presenter =>
      widget.presenter ?? (_owned ??= MessageListPresenter());

  /// Captured in [didUpdateWidget] — BEFORE the new list is laid out, since
  /// reading a scroll offset after an append gives the post-append value and
  /// would make "was the customer at the bottom" always true.
  bool _wasAtBottom = true;
  String? _spoken;

  @override
  void didUpdateWidget(MessageListView oldWidget) {
    super.didUpdateWidget(oldWidget);
    _wasAtBottom = _atBottomNow();
  }

  bool _atBottomNow() {
    if (!_scroll.hasClients) return true;
    return isNearBottom(
      pixels: _scroll.position.pixels,
      maxScrollExtent: _scroll.position.maxScrollExtent,
    );
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _afterLayout(String? announcement) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (_wasAtBottom && _scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
      if (announcement != null && announcement != _spoken) {
        _spoken = announcement;
        SemanticsService.announce(announcement, Directionality.of(context));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final MessageListRender render = _presenter.present(widget.inputs);
    _afterLayout(render.announcement);

    return Column(
      children: <Widget>[
        Expanded(
          child: render.rows.isEmpty
              ? _EmptyTranscript(show: render.showEmptyState)
              : Semantics(
                  container: true,
                  label: 'Conversation',
                  child: ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    itemCount: render.rows.length,
                    itemBuilder: (BuildContext context, int index) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: MessageBubbleRow(
                          row: render.rows[index],
                          callbacks: widget.callbacks,
                          attachmentBuilder: widget.attachmentBuilder,
                        ),
                      );
                    },
                  ),
                ),
        ),
        if (widget.inputs.isTyping) _TypingRow(label: render.typingLabel),
        if (render.quickReplies.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: QuickReplies(
              options: render.quickReplies,
              onSelect: widget.callbacks.onQuickReply,
            ),
          ),
      ],
    );
  }
}

/// One row: the avatar beside the bubble, never inside it.
///
/// The avatar sits on [MessageBubbleRow] rather than on the bubble so it is
/// not painted into the bubble's own coloured background.
class MessageBubbleRow extends StatelessWidget {
  const MessageBubbleRow({
    super.key,
    required this.row,
    required this.callbacks,
    this.attachmentBuilder,
  });

  final MessageRow row;
  final MessageListCallbacks callbacks;
  final Widget Function(BuildContext context, AttachmentMetadata attachment)?
      attachmentBuilder;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final Color bubbleColor =
        row.outgoing ? scheme.primary : scheme.surfaceContainerHighest;
    final Color textColor = row.outgoing ? scheme.onPrimary : scheme.onSurface;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisAlignment:
          row.outgoing ? MainAxisAlignment.end : MainAxisAlignment.start,
      children: <Widget>[
        if (row.avatarLetter != null) ...<Widget>[
          MessageAvatar(letter: row.avatarLetter!),
          const SizedBox(width: 6),
        ],
        Flexible(
          child: Column(
            crossAxisAlignment: row.outgoing
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: bubbleColor,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    // Above the text rather than beside the timestamp: the
                    // customer needs to know who is speaking BEFORE they
                    // read the words, and a name discovered underneath them
                    // arrives too late to frame what they just read.
                    if (row.showAuthorName && row.senderName != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 2),
                        child: Text(
                          row.senderName!,
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(color: textColor),
                        ),
                      ),
                    if (row.quote != null)
                      _QuoteStrip(quote: row.quote!, color: textColor),
                    if (row.message.attachment != null &&
                        attachmentBuilder != null)
                      attachmentBuilder!(context, row.message.attachment!),
                    if (row.text.isNotEmpty)
                      LinkifiedText(
                        row.text,
                        style: TextStyle(color: textColor),
                        onOpenLink: callbacks.onOpenLink,
                      ),
                  ],
                ),
              ),
              _MetaRow(row: row, callbacks: callbacks),
            ],
          ),
        ),
        MessageActions(
          onCopy: () => callbacks.onCopyMessage(row.message),
          onReply: () =>
              callbacks.onReplyToMessage(row.message, row.replyAttribution),
        ),
      ],
    );
  }
}

/// The per-row identity disc.
///
/// Deliberately NOT the header avatar's content: that disc's letters come
/// from the merchant's configured initials, which name the BRAND rather than
/// whoever sent this particular message. The letter here always comes from
/// the resolved sender name — the same resolution the visible author heading
/// uses.
///
/// Hidden from assistive tech: a screen reader already gets this message's
/// sender from the author heading on the first bubble of a run, and gets
/// nothing extra for a later bubble — same as a sighted reader, who has only
/// the earlier heading and the alignment to go on. This disc is a
/// sighted-only convenience on top of that rule, not a new source of truth.
class MessageAvatar extends StatelessWidget {
  const MessageAvatar({super.key, required this.letter});

  final String letter;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return ExcludeSemantics(
      child: Container(
        width: 24,
        height: 24,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: scheme.primaryContainer,
          shape: BoxShape.circle,
        ),
        child: Text(
          letter,
          style: Theme.of(context)
              .textTheme
              .labelSmall
              ?.copyWith(color: scheme.onPrimaryContainer),
        ),
      ),
    );
  }
}

/// The quoted message this one replies to: a quiet strip above the message's
/// own words, name on top.
///
/// Drawn from the message's OWN metadata — the quoted message may have
/// scrolled out of the loaded page entirely, so the excerpt travels with the
/// reply rather than being looked up.
class _QuoteStrip extends StatelessWidget {
  const _QuoteStrip({required this.quote, required this.color});

  final ReplyQuote quote;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.only(left: 8),
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: color.withOpacity(0.5))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            quote.senderName,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: color, fontWeight: FontWeight.w600),
          ),
          Text(
            quote.excerpt,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: color.withOpacity(0.85)),
          ),
        ],
      ),
    );
  }
}

/// The time, the tick, the failure sentence and the retry control.
class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.row, required this.callbacks});

  final MessageRow row;
  final MessageListCallbacks callbacks;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final TextStyle? meta = Theme.of(context)
        .textTheme
        .labelSmall
        ?.copyWith(color: scheme.onSurfaceVariant);
    final MessageTickState? tick = row.tick;
    final String? failureText = row.failureText;

    return Padding(
      padding: const EdgeInsets.only(top: 2, left: 2, right: 2),
      child: Column(
        crossAxisAlignment:
            row.outgoing ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(_time(context, row.message.createdAt), style: meta),
              if (tick != null) ...<Widget>[
                const SizedBox(width: 4),
                // The glyph carries no meaning of its own to assistive tech;
                // the word beside it does. WCAG 1.4.1: colour alone cannot
                // be the difference between "delivered" and "read".
                ExcludeSemantics(
                  child: Text(tickPresentation(tick).glyph, style: meta),
                ),
                const SizedBox(width: 2),
                Text(tickPresentation(tick).label, style: meta),
              ],
            ],
          ),
          if (failureText != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(Icons.error_outline, size: 12, color: scheme.error),
                  const SizedBox(width: 4),
                  Flexible(
                    child: Text(
                      failureText,
                      style: meta?.copyWith(color: scheme.error),
                    ),
                  ),
                  // Offered only when core said retrying is worth
                  // attempting. `showRetry` is `!failure.retryable` and
                  // nothing else — never re-derived from the reason or the
                  // code.
                  if (row.showRetry) ...<Widget>[
                    const SizedBox(width: 4),
                    TextButton(
                      onPressed: () => callbacks.onRetry(row.message),
                      style: TextButton.styleFrom(
                        minimumSize: Size.zero,
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: const Text('Retry'),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }

  static String _time(BuildContext context, DateTime createdAt) {
    return MaterialLocalizations.of(context).formatTimeOfDay(
      TimeOfDay.fromDateTime(createdAt.toLocal()),
    );
  }
}

class _EmptyTranscript extends StatelessWidget {
  const _EmptyTranscript({required this.show});

  /// `false` before the first page has come back. An empty list then means
  /// "nobody has asked yet", and telling a customer with a year of history
  /// that their conversation is empty is a lie — one they would re-read on
  /// every session switch, which clears the transcript on purpose.
  final bool show;

  @override
  Widget build(BuildContext context) {
    if (!show) return const SizedBox.expand();
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          'No messages yet. Ask us anything about your order.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        ),
      ),
    );
  }
}

/// The typing bubble. Deliberately not a live region: a typing indicator
/// that announces itself interrupts the message the user is actually
/// reading, and it can flap several times a second. The label is the only
/// channel that can say WHO — it used to be the fixed word "Agent", which
/// named a human on a session being handled by the bot.
class _TypingRow extends StatelessWidget {
  const _TypingRow({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Semantics(
            label: label,
            liveRegion: false,
            // The three animated dots say SOMEONE is composing; this label
            // is the only channel that can say who. Excluded rather than
            // merged, so a screen reader reads the name and not an ellipsis.
            excludeSemantics: true,
            child: const SizedBox(
              width: 24,
              height: 12,
              child: Center(child: Text('…')),
            ),
          ),
        ),
      ),
    );
  }
}
