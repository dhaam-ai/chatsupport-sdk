/// The published widget configuration — the Dart mirror of
/// `packages/widget/src/remote-config.ts`'s parsing half, field for field.
///
/// ── What this file does NOT do ─────────────────────────────────────────
///
/// The TypeScript module also merges a fetched [RemoteConfig] under a HOST
/// PAGE's own explicit config (`mergeRemoteConfig`, host wins per field) —
/// that exists because the JS widget is an embedded `<script>` tag, and a
/// merchant's page may have hardcoded `data-accent` to match its own
/// checkout flow. A Flutter host has no equivalent "the page already stated
/// this" fact to defer to: whatever this package's `ChatWidget` is handed by
/// its caller IS the caller's config, stated in Dart, not scraped off a DOM
/// attribute mid-boot. So only the fetch-and-parse half is ported. A caller
/// that wants host-precedence behaviour can apply it itself with an ordinary
/// `??` per field — there is no host-page race to protect against here that
/// would make that unsafe to leave to them.
///
/// ── Every leaf is read defensively ─────────────────────────────────────
///
/// `appearance` and `behaviour` are opaque blobs the server stores and
/// re-serves without validating their contents, and the console writes them
/// by whole-object replacement — so a field can be absent because an older
/// console version never wrote it. Every leaf below is treated as
/// possibly-missing and possibly the wrong type, same as the TypeScript.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show WireEnum;
import 'package:equatable/equatable.dart';

import 'appearance.dart';

export 'appearance.dart';

/// One console-defined field on the pre-chat form.
class PreChatField extends Equatable {
  const PreChatField({
    required this.id,
    required this.label,
    required this.type,
    required this.required,
  });

  final String id;
  final String label;
  final PreChatFieldType type;
  final bool required;

  @override
  List<Object?> get props => <Object?>[id, label, type, required];
}

enum PreChatFieldType implements WireEnum {
  text('text'),
  email('email'),
  phone('phone');

  const PreChatFieldType(this.wire);

  @override
  final String wire;

  static PreChatFieldType? fromWire(String value) => lookupWire(values, value);
}

/// How the post-resolution rating is presented. The backend knows only these
/// two.
enum CsatStyle implements WireEnum {
  stars('stars'),
  emoji('emoji');

  const CsatStyle(this.wire);

  @override
  final String wire;
}

/// Whether the panel opens itself, and on what.
///
/// `exitIntent` is the pointer leaving for the browser chrome — a
/// desktop-only, pointer-and-viewport signal by nature. This package does
/// not implement it at all (there is no cursor to leave a viewport on a
/// touch-first platform, and no analogous gesture worth approximating one
/// with) — a merchant who published `exit-intent` gets `never` here rather
/// than a guessed substitute. See [AutoOpen.fromWire].
enum AutoOpen implements WireEnum {
  never('never'),
  delay('delay'),
  exitIntent('exit-intent');

  const AutoOpen(this.wire);

  @override
  final String wire;

  static AutoOpen? fromWire(String value) => lookupWire(values, value);
}

/// What the widget does when the team is closed.
///
/// Integers, not strings, because that is what the wire carries
/// (`WidgetOfflineMode` in chat-service's schema) — the one field in this
/// module that is NOT a [WireEnum], because that interface's `wire` is typed
/// `String`. Same shape, different concrete wire type.
enum OfflineMode {
  /// Say we are closed; the composer stays available.
  showMessage(1),

  /// Replace the composer with a leave-a-message form.
  collectMessage(2),

  /// Do not render the launcher at all.
  hideWidget(3);

  const OfflineMode(this.wire);

  final int wire;

  static OfflineMode? fromWire(int value) {
    for (final OfflineMode mode in values) {
      if (mode.wire == value) return mode;
    }
    return null;
  }
}

/// One console-defined New Conversation topic chip —
/// `behaviour.conversationTopics[]`. See [parseConversationTopics] for the
/// wire shape and why it has no `prompt`.
class ConversationTopic extends Equatable {
  const ConversationTopic({required this.id, required this.label});

  final String id;
  final String label;

  @override
  List<Object?> get props => <Object?>[id, label];
}

/// One console-defined quick question — `behaviour.commonQuestions[]`.
class CommonQuestion extends Equatable {
  const CommonQuestion({
    required this.id,
    required this.label,
    required this.prompt,
  });

  final String id;
  final String label;
  final String prompt;

  @override
  List<Object?> get props => <Object?>[id, label, prompt];
}

/// A published bot flow, projected down to what a widget can act on.
///
/// Parsed and carried for field-for-field parity with the wire, exactly as
/// the JS widget does — NOT executed. The bot-flow step interpreter is out
/// of scope here the same way it is there (see the SDK plan's §D).
class PublishedFlow extends Equatable {
  const PublishedFlow({
    required this.id,
    required this.name,
    required this.trigger,
    required this.keywords,
    required this.pagePattern,
    required this.steps,
  });

  final String id;
  final String name;

  /// 1 WELCOME | 2 KEYWORD | 3 PAGE | 4 OFFLINE.
  final int trigger;
  final List<String> keywords;
  final String pagePattern;

  /// Left opaque on purpose — step shapes are the console's to evolve.
  final List<Object?> steps;

  @override
  List<Object?> get props =>
      <Object?>[id, name, trigger, keywords, pagePattern, steps];
}

/// The published config, after parsing — every field already defaulted, so
/// no consumer re-decides one.
class RemoteConfig extends Equatable {
  const RemoteConfig({
    required this.enabled,
    required this.accent,
    required this.title,
    required this.theme,
    required this.position,
    required this.offsetX,
    required this.offsetY,
    required this.launcher,
    required this.launcherLabel,
    required this.launcherIcon,
    required this.launcherShadow,
    required this.design,
    required this.header,
    required this.logoUrl,
    required this.subtitle,
    required this.avatarMode,
    required this.avatarInitials,
    required this.showBranding,
    required this.brandingText,
    required this.brandingUrl,
    required this.thread,
    required this.cornerRadius,
    required this.fontFamily,
    required this.greeting,
    required this.greetingDelaySec,
    required this.autoOpen,
    required this.autoOpenDelaySec,
    required this.typingIndicator,
    required this.sound,
    required this.transcriptEmail,
    required this.consentRequired,
    required this.consentText,
    required this.privacyUrl,
    required this.supportEmail,
    required this.handoffKeywords,
    required this.reportIssue,
    required this.preChatEnabled,
    required this.preChatFields,
    required this.commonQuestions,
    required this.conversationTopics,
    required this.csatStyle,
    required this.offlineMode,
    required this.offlineMessage,
    required this.fileUploads,
    required this.isOpenNow,
    required this.flows,
    required this.botDisplayName,
    required this.publishedVersion,
  });

  final bool enabled;
  final String? accent;
  final String? title;
  final WidgetTheme? theme;
  final WidgetPosition? position;
  final double? offsetX;
  final double? offsetY;
  final LauncherStyle? launcher;
  final String? launcherLabel;
  final LauncherIcon launcherIcon;
  final LauncherShadow launcherShadow;
  final WidgetDesign? design;
  final HeaderAppearance header;
  final String? logoUrl;
  final String? subtitle;
  final AvatarMode? avatarMode;
  final String? avatarInitials;
  final bool? showBranding;
  final String? brandingText;
  final String? brandingUrl;
  final ThreadAppearance thread;
  final double? cornerRadius;
  final String? fontFamily;
  final String? greeting;
  final double greetingDelaySec;
  final AutoOpen autoOpen;
  final double autoOpenDelaySec;
  final bool typingIndicator;
  final bool sound;
  final bool transcriptEmail;
  final bool consentRequired;
  final String? consentText;

  /// `behaviour.privacyUrl` — the merchant's own policy page, offered as the
  /// Privacy item in the conversation header's menu.
  ///
  /// Absent HIDES that item rather than linking nowhere — the rule every item
  /// in that menu follows, and the reason this field exists at all: the menu
  /// has no other way to ask whether the merchant published a policy.
  ///
  /// Kept as the raw merchant-supplied string, NOT pre-validated here. It is
  /// read through `safeLinkUrl` at the one place it lands in a link, so the
  /// allowlist is applied by the code that navigates rather than by the code
  /// that parses — the same split `brandingUrl` above already has, and the
  /// reason a `javascript:` policy URL is unreachable rather than unlikely.
  final String? privacyUrl;

  /// `behaviour.supportEmail` — where a visitor goes when the chat service
  /// cannot be reached at all. Absent shows no fallback rather than a guess —
  /// see `ui/unavailable_view.dart`, the one place this is read: an address
  /// nobody monitors is worse than admitting there is no second route.
  final String? supportEmail;
  final List<String> handoffKeywords;
  final bool reportIssue;
  final bool preChatEnabled;
  final List<PreChatField> preChatFields;
  final List<CommonQuestion> commonQuestions;

  /// The New Conversation screen's topic chips. See [ConversationTopic].
  final List<ConversationTopic> conversationTopics;
  final CsatStyle csatStyle;
  final OfflineMode offlineMode;
  final String? offlineMessage;
  final bool fileUploads;

  /// `null` when the tenant does not follow business hours — NOT "closed".
  final bool? isOpenNow;
  final List<PublishedFlow> flows;
  final String? botDisplayName;
  final int publishedVersion;

  @override
  List<Object?> get props => <Object?>[
        enabled,
        accent,
        title,
        theme,
        position,
        offsetX,
        offsetY,
        launcher,
        launcherLabel,
        launcherIcon,
        launcherShadow,
        design,
        header,
        logoUrl,
        subtitle,
        avatarMode,
        avatarInitials,
        showBranding,
        brandingText,
        brandingUrl,
        thread,
        cornerRadius,
        fontFamily,
        greeting,
        greetingDelaySec,
        autoOpen,
        autoOpenDelaySec,
        typingIndicator,
        sound,
        transcriptEmail,
        consentRequired,
        consentText,
        privacyUrl,
        supportEmail,
        handoffKeywords,
        reportIssue,
        preChatEnabled,
        preChatFields,
        commonQuestions,
        conversationTopics,
        csatStyle,
        offlineMode,
        offlineMessage,
        fileUploads,
        isOpenNow,
        flows,
        botDisplayName,
        publishedVersion,
      ];
}

/// What a widget renders when the config could not be read at all.
const RemoteConfig defaultRemoteConfig = RemoteConfig(
  enabled: true,
  accent: null,
  title: null,
  theme: null,
  position: null,
  offsetX: null,
  offsetY: null,
  launcher: null,
  launcherLabel: null,
  launcherIcon: LauncherIcon(),
  launcherShadow: LauncherShadow(),
  design: null,
  header: HeaderAppearance(),
  logoUrl: null,
  subtitle: null,
  avatarMode: null,
  avatarInitials: null,
  showBranding: null,
  brandingText: null,
  brandingUrl: null,
  thread: ThreadAppearance(),
  cornerRadius: null,
  fontFamily: null,
  greeting: null,
  greetingDelaySec: 0,
  // Never opens itself. The console's own default is 'delay', and this is
  // deliberately not that — see remote-config.ts's identical note: a panel
  // that takes the screen on its own is the single most intrusive thing this
  // widget can do, and a failed config fetch is not consent to start doing it.
  autoOpen: AutoOpen.never,
  autoOpenDelaySec: 12,
  typingIndicator: true,
  // Silent. An unreadable config is not consent to play a sound.
  sound: false,
  transcriptEmail: false,
  consentRequired: false,
  consentText: null,
  // No policy published, so the menu offers no Privacy item. An unreadable
  // config cannot invent a URL to send a customer to.
  privacyUrl: null,
  supportEmail: null,
  handoffKeywords: <String>[],
  // Off, like every other surface this default touches: a widget whose
  // config never landed must look exactly as it did before.
  reportIssue: false,
  preChatEnabled: false,
  preChatFields: <PreChatField>[],
  commonQuestions: <CommonQuestion>[],
  conversationTopics: <ConversationTopic>[],
  csatStyle: CsatStyle.stars,
  offlineMode: OfflineMode.showMessage,
  offlineMessage: null,
  fileUploads: true,
  // null, not false: "we could not ask" and "the team is closed" are
  // different facts.
  isOpenNow: null,
  flows: <PublishedFlow>[],
  botDisplayName: null,
  publishedVersion: 0,
);

// ── Leaf helpers specific to this file ─────────────────────────────────────
//
// isJsonObject/readString/readFlag/readNum/readEnum live in appearance.dart
// (re-exported above) and are shared as-is — they are generic JSON-leaf
// readers, not appearance-specific. `readBool` (fallback rather than
// three-way) is the one helper this file needs that appearance.dart does
// not: every field here resolves to one settled answer, unlike the
// appearance scalars, which have to keep "absent" distinguishable from "the
// merchant chose the default" for a host-precedence merge this package does
// not implement (see this file's header) — so the three-way [readFlag] is
// kept only where [HeaderAppearance] et al. still need it.

bool readBool(Map<String, Object?> source, String key, bool fallback) {
  final Object? value = source[key];
  return value is bool ? value : fallback;
}

/// A delay in seconds, clamped to something a page can survive.
///
/// Unlike the appearance numbers, these become timer durations, so a bad
/// value is not a dropped style but a timer that never fires or fires
/// immediately. Negative is refused outright; the upper bound is an hour —
/// far past any delay a merchant means, chosen only to keep the value inside
/// what `Duration` and a `Timer` can be trusted with.
const double _maxDelaySec = 3600;

double readSeconds(Map<String, Object?> source, String key, double fallback) {
  final double? value = readNum(source, key);
  if (value == null || value < 0) return fallback;
  return value > _maxDelaySec ? _maxDelaySec : value;
}

/// `behaviour.handoffKeywords` — lower-cased and de-duplicated so the
/// matcher can stay a plain comparison, and blanks dropped: a stray empty
/// string would otherwise match every message and escalate every
/// conversation on its first word.
List<String> parseHandoffKeywords(Object? value) {
  if (value is! List<Object?>) return const <String>[];
  final Set<String> seen = <String>{};
  for (final Object? entry in value) {
    if (entry is! String) continue;
    final String word = entry.trim().toLowerCase();
    if (word.isNotEmpty) seen.add(word);
  }
  return seen.toList(growable: false);
}

List<PreChatField> parsePreChatFields(Object? value) {
  if (value is! List<Object?>) return const <PreChatField>[];
  final List<PreChatField> fields = <PreChatField>[];
  for (final Object? entry in value) {
    if (!isJsonObject(entry)) continue;
    final Map<String, Object?> source = entry! as Map<String, Object?>;
    final String? id = readString(source, 'id');
    final String? label = readString(source, 'label');
    // A field with no id has nowhere to store its answer and a field with no
    // label cannot be asked for. Skip it rather than rendering an
    // unlabelled box the customer cannot interpret.
    if (id == null || label == null) continue;
    fields.add(
      PreChatField(
        id: id,
        label: label,
        type: readEnum(source, 'type', PreChatFieldType.fromWire) ??
            PreChatFieldType.text,
        required: readBool(source, 'required', false),
      ),
    );
  }
  return fields;
}

/// `behaviour.commonQuestions` → this widget's own [CommonQuestion] list. A
/// question with no id has nowhere to key its chip, and one with no label or
/// prompt has nothing to show or nothing to send — skipped rather than
/// rendered broken.
List<CommonQuestion> parseCommonQuestions(Object? value) {
  if (value is! List<Object?>) return const <CommonQuestion>[];
  final List<CommonQuestion> questions = <CommonQuestion>[];
  for (final Object? entry in value) {
    if (!isJsonObject(entry)) continue;
    final Map<String, Object?> source = entry! as Map<String, Object?>;
    final String? id = readString(source, 'id');
    final String? label = readString(source, 'label');
    final String? prompt = readString(source, 'prompt');
    if (id == null || label == null || prompt == null) continue;
    questions.add(CommonQuestion(id: id, label: label, prompt: prompt));
  }
  return questions;
}

/// `behaviour.conversationTopics` → the New Conversation screen's chip list.
///
/// A NEW console setting (SDK plan §A/§C) — shaped `{id, label}[]`, the same
/// list-of-objects convention [CommonQuestion] uses, minus `prompt`: a topic
/// is picked, not sent, so it has nothing to say on its own. Same skip rule
/// as [parseCommonQuestions] — an entry with no id has nowhere to key its
/// chip, and one with no label has nothing to show.
List<ConversationTopic> parseConversationTopics(Object? value) {
  if (value is! List<Object?>) return const <ConversationTopic>[];
  final List<ConversationTopic> topics = <ConversationTopic>[];
  for (final Object? entry in value) {
    if (!isJsonObject(entry)) continue;
    final Map<String, Object?> source = entry! as Map<String, Object?>;
    final String? id = readString(source, 'id');
    final String? label = readString(source, 'label');
    if (id == null || label == null) continue;
    topics.add(ConversationTopic(id: id, label: label));
  }
  return topics;
}

List<PublishedFlow> parseFlows(Object? value) {
  if (value is! List<Object?>) return const <PublishedFlow>[];
  final List<PublishedFlow> flows = <PublishedFlow>[];
  for (final Object? entry in value) {
    if (!isJsonObject(entry)) continue;
    final Map<String, Object?> source = entry! as Map<String, Object?>;
    final String? id = readString(source, 'id');
    final String? name = readString(source, 'name');
    final Object? trigger = source['trigger'];
    if (id == null || name == null || trigger is! int) continue;
    final Object? rawKeywords = source['keywords'];
    final Object? rawSteps = source['steps'];
    flows.add(
      PublishedFlow(
        id: id,
        name: name,
        trigger: trigger,
        keywords: rawKeywords is List<Object?>
            ? rawKeywords.whereType<String>().toList(growable: false)
            : const <String>[],
        pagePattern: readString(source, 'pagePattern') ?? '',
        steps: rawSteps is List<Object?> ? rawSteps : const <Object?>[],
      ),
    );
  }
  return flows;
}

/// Turns a decoded response body into a [RemoteConfig], or `null` if it is
/// not one.
///
/// Exported (top-level, public) for tests: this is the half of the fetch
/// worth asserting against exhaustively, and it is a pure function of the
/// already-JSON-decoded body — same split `remote-config.ts` makes between
/// `fetchRemoteConfig` and this function.
RemoteConfig? parseRemoteConfig(Object? body) {
  if (!isJsonObject(body)) return null;
  final Object? data = (body! as Map<String, Object?>)['data'];
  if (!isJsonObject(data)) return null;
  final Map<String, Object?> dataMap = data! as Map<String, Object?>;

  final Object? rawAppearance = dataMap['appearance'];
  final Map<String, Object?> appearance = isJsonObject(rawAppearance)
      ? rawAppearance! as Map<String, Object?>
      : const <String, Object?>{};
  final Object? rawBehaviour = dataMap['behaviour'];
  final Map<String, Object?> behaviour = isJsonObject(rawBehaviour)
      ? rawBehaviour! as Map<String, Object?>
      : const <String, Object?>{};

  final Object? rawOfflineMode = dataMap['offlineMode'];
  final Object? rawCsat = behaviour['csatStyle'];
  final Object? rawIsOpen = dataMap['isOpenNow'];
  final Object? rawVersion = dataMap['publishedVersion'];

  return RemoteConfig(
    enabled: readBool(dataMap, 'enabled', defaultRemoteConfig.enabled),
    accent: readString(appearance, 'accent'),
    title: readString(appearance, 'title'),
    theme: readEnum(appearance, 'theme', WidgetTheme.fromWire),
    position: readEnum(appearance, 'position', WidgetPosition.fromWire),
    offsetX: readNum(appearance, 'offsetX'),
    offsetY: readNum(appearance, 'offsetY'),
    launcher: readEnum(appearance, 'launcher', LauncherStyle.fromWire),
    launcherLabel: readString(appearance, 'launcherLabel'),
    launcherIcon: parseLauncherIcon(appearance['launcherIcon']),
    launcherShadow: parseLauncherShadow(appearance['launcherShadow']),
    design: readEnum(appearance, 'design', WidgetDesign.fromWire),
    header: parseHeader(appearance['header']),
    logoUrl: readString(appearance, 'logoUrl'),
    subtitle: readString(appearance, 'subtitle'),
    avatarMode: readEnum(appearance, 'avatarMode', AvatarMode.fromWire),
    avatarInitials: readString(appearance, 'avatarInitials'),
    showBranding: readFlag(appearance, 'showBranding'),
    brandingText: readString(appearance, 'brandingText'),
    brandingUrl: readString(appearance, 'brandingUrl'),
    thread: parseThread(appearance['thread']),
    cornerRadius: readNum(appearance, 'cornerRadius'),
    fontFamily: readString(appearance, 'fontFamily'),
    greeting: readString(behaviour, 'greeting'),
    greetingDelaySec: readSeconds(
      behaviour,
      'greetingDelaySec',
      defaultRemoteConfig.greetingDelaySec,
    ),
    autoOpen: readEnum(behaviour, 'autoOpen', AutoOpen.fromWire) ??
        defaultRemoteConfig.autoOpen,
    autoOpenDelaySec: readSeconds(
      behaviour,
      'autoOpenDelaySec',
      defaultRemoteConfig.autoOpenDelaySec,
    ),
    typingIndicator: readBool(
      behaviour,
      'typingIndicator',
      defaultRemoteConfig.typingIndicator,
    ),
    sound: readBool(behaviour, 'sound', defaultRemoteConfig.sound),
    transcriptEmail: readBool(
      behaviour,
      'transcriptEmail',
      defaultRemoteConfig.transcriptEmail,
    ),
    consentRequired: readBool(
      behaviour,
      'consentRequired',
      defaultRemoteConfig.consentRequired,
    ),
    consentText: readString(behaviour, 'consentText'),
    privacyUrl: readString(behaviour, 'privacyUrl'),
    supportEmail: readString(behaviour, 'supportEmail'),
    handoffKeywords: parseHandoffKeywords(behaviour['handoffKeywords']),
    reportIssue:
        readBool(behaviour, 'reportIssue', defaultRemoteConfig.reportIssue),
    preChatEnabled: readBool(behaviour, 'preChatEnabled', false),
    preChatFields: parsePreChatFields(behaviour['preChatFields']),
    commonQuestions: parseCommonQuestions(behaviour['commonQuestions']),
    conversationTopics:
        parseConversationTopics(behaviour['conversationTopics']),
    csatStyle: rawCsat == 'emoji' ? CsatStyle.emoji : CsatStyle.stars,
    offlineMode: rawOfflineMode is int
        ? (OfflineMode.fromWire(rawOfflineMode) ?? OfflineMode.showMessage)
        : OfflineMode.showMessage,
    offlineMessage: readString(behaviour, 'offlineMessage'),
    fileUploads: readBool(behaviour, 'fileUploads', true),
    // Three-valued and kept that way — see the field's own doc comment.
    isOpenNow: rawIsOpen is bool ? rawIsOpen : null,
    flows: parseFlows(dataMap['flows']),
    botDisplayName: readString(dataMap, 'botDisplayName'),
    publishedVersion: rawVersion is int ? rawVersion : 0,
  );
}
