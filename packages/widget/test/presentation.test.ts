// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { resolvePresentation } from '../src/ui/presentation.js';

describe('resolvePresentation', () => {
  it('resolves auto to a sheet at or below the breakpoint, and a bubble above it', () => {
    expect(resolvePresentation('auto', { width: 360 }, 640)).toBe('sheet');
    expect(resolvePresentation('auto', { width: 640 }, 640)).toBe('sheet');
    expect(resolvePresentation('auto', { width: 641 }, 640)).toBe('bubble');
    expect(resolvePresentation('auto', { width: 1440 }, 640)).toBe('bubble');
  });

  it('honours an explicitly named mode at EVERY width', () => {
    // The load-bearing case. A host that asked for a sidebar on a 320px phone
    // has a layout reason we cannot see — a tablet kiosk, a fixed-width
    // embedded frame. Silently overriding them is the bug, not the feature.
    for (const width of [320, 375, 640, 641, 1024, 1920]) {
      expect(resolvePresentation('sidebar', { width }, 640)).toBe('sidebar');
      expect(resolvePresentation('bubble', { width }, 640)).toBe('bubble');
      expect(resolvePresentation('sheet', { width }, 640)).toBe('sheet');
    }
  });

  it('moves the boundary with the configured breakpoint', () => {
    expect(resolvePresentation('auto', { width: 800 }, 900)).toBe('sheet');
    expect(resolvePresentation('auto', { width: 800 }, 700)).toBe('bubble');
  });
});
