// The standalone entry must load with the widget, core and browser packages absent.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@dhaam-ccrm/widget', () => {
  throw new Error('commerce entry must not load @dhaam-ccrm/widget');
});
vi.mock('@dhaam-ccrm/core', () => {
  throw new Error('commerce entry must not load @dhaam-ccrm/core');
});
vi.mock('@dhaam-ccrm/browser', () => {
  throw new Error('commerce entry must not load @dhaam-ccrm/browser');
});

describe('@dhaam-ccrm/react/commerce', () => {
  it('loads without the widget, core or browser packages', async () => {
    const entry = await import('../src/commerce.js');
    expect(typeof entry.useCommerceEvents).toBe('function');
    expect(entry.CommerceEventError).toBeDefined();
    expect(entry.InvalidCommerceEventError).toBeDefined();
  });
});
