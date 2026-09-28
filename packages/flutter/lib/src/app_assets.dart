library;

/// Asset constants for files bundled by this Flutter package.
///
/// Use [AppAssets.packageName] with `Image.asset`/SVG widgets, and
/// [AppAssets.bundleKey] for APIs that read directly from the asset bundle.
class AppAssets {
  const AppAssets._();

  static const String packageName = 'dhaam_chat_flutter';

  static const String chime = 'assets/chime.wav';

  static const String attachmentIcon = 'assets/icons/attachment.svg';
  static const String homeIcon = 'assets/icons/home.svg';
  static const String linkIcon = 'assets/icons/link.svg';
  static const String messageBubblesIcon = 'assets/icons/message_bubbles.svg';
  static const String messagesIcon = 'assets/icons/messages.svg';
  static const String replyToIcon = 'assets/icons/reply_to.svg';
  static const String sendIcon = 'assets/icons/send.svg';
  static const String editIcon = 'assets/icons/edit.svg';

  static const String chimeBundleKey = 'packages/$packageName/assets/chime.wav';

  static String bundleKey(String asset) => 'packages/$packageName/$asset';
}
