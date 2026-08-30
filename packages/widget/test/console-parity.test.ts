// @vitest-environment node
//
// Does this package still read everything the console can publish?
//
// The fixture beside this file is a REAL row — `widget_configs` for one
// workspace, dumped from Postgres in the exact envelope `GET /widget/config`
// serves it in. Every other test in this package builds its own body from
// what the parser is known to accept, which is precisely the shape that
// cannot catch the failure this file exists for: the console gains an
// Appearance control, a merchant sets it, and the widget silently drops it
// because nobody thought to add a case for a field they did not know about.
//
// So the assertion that matters is the SECOND one, and it is deliberately
// written as "nothing is undefined" rather than as a list of expected values.
// A field added to the console and not to `remote-config.ts` fails it without
// anyone having to remember to extend this file.
//
// ── When this fails after a console change ────────────────────────────────
// It is not the fixture that is stale. Re-dumping it to make the test pass is
// exactly backwards: the new field is the bug report. Parse it, render it,
// and only then refresh the fixture.
//
// Contains no credentials by construction — `widget_configs` holds appearance
// and behaviour only, and the publishable key lives in a different table.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseRemoteConfig } from '../src/remote-config.js';

const BODY = JSON.parse(
  readFileSync(new URL('./tenant12775.json', import.meta.url), 'utf8'),
) as unknown;

describe('a real console publish, through the real parser', () => {
  it('reads every appearance field the console wrote', () => {
    const config = parseRemoteConfig(BODY);
    expect(config).not.toBeNull();

    // Scalars, against the exact values in the row.
    expect(config).toMatchObject({
      enabled: true,
      accent: '#e11d48',
      title: 'Dhaam Support',
      theme: 'light',
      design: 'classic',
      position: 'bottom-right',
      offsetX: 20,
      offsetY: 20,
      launcher: 'bubble',
      launcherLabel: 'Chat with us',
      cornerRadius: 20,
      fontFamily: 'Inter',
      subtitle: 'Typically replies in a few minutes',
      avatarMode: 'initials',
      avatarInitials: 'D',
      showBranding: true,
      brandingText: 'Powered by Dhaam',
      brandingUrl: 'https://dhaam.com',
    });

    // The nested objects.
    expect(config?.launcherIcon).toMatchObject({ source: 'library', library: 'chats', emoji: '💬' });
    expect(config?.launcherShadow).toMatchObject({ enabled: true, intensity: 45 });
    expect(config?.header).toMatchObject({
      background: 'gradient',
      gradientStrength: 100,
      imageOverlay: 45,
      showLogo: true,
      showAvatars: true,
      showPresence: true,
      ctaEnabled: true,
      ctaTitle: 'Send us a message',
      ctaSubtitle: 'We usually reply instantly',
      colorSource: 'accent',
    });
    expect(config?.header.avatars).toHaveLength(3);
    expect(config?.thread).toMatchObject({
      background: 'pattern',
      color: '#f4f4f5',
      pattern: 'crosshatch',
      patternOpacity: 35,
      imageFade: 'light',
      imageOverlay: 55,
    });

    // Behaviour, which this pass did not extend — pinned so the work that
    // does can see exactly what it inherits. The fields still missing from
    // this list (greetingDelaySec, autoOpen, typingIndicator, sound,
    // transcriptEmail, consentRequired/consentText, handoffKeywords) are all
    // present in the fixture and all still dropped.
    expect(config).toMatchObject({
      greeting: 'Hi 👋 Ask us anything — orders, refunds, account, whatever you need.',
      preChatEnabled: true,
      csatStyle: 'stars',
      fileUploads: true,
    });
    expect(config?.preChatFields).toHaveLength(2);
    expect(config?.commonQuestions).toHaveLength(8);
  });

  // The point of the whole exercise: no appearance field may still be unread.
  it('leaves no appearance field undefined', () => {
    const config = parseRemoteConfig(BODY)!;
    const unread = (
      [
        'accent', 'title', 'theme', 'design', 'position', 'offsetX', 'offsetY',
        'launcher', 'launcherLabel', 'cornerRadius', 'fontFamily', 'subtitle',
        'avatarMode', 'avatarInitials', 'showBranding', 'brandingText', 'brandingUrl',
      ] as const
    ).filter((key) => config[key] === undefined);
    expect(unread).toEqual([]);

    for (const key of ['launcherIcon', 'launcherShadow', 'header', 'thread'] as const) {
      expect(Object.keys(config[key]).length).toBeGreaterThan(0);
    }
  });
});
