// The encode/decode boundary between wire bytes and typed frames — PRD §7.2.
// A thin, deliberately named seam: `transport.ts` never calls
// `JSON.stringify`/`JSON.parse` directly, so this is the one place that
// boundary exists.

import type { AnyFrame, FrameValidationResult } from '../protocol/index.js';
import { validateFrame } from '../protocol/index.js';

/** Serializes a frame for the wire. */
export function encodeFrame(frame: AnyFrame): string {
  return JSON.stringify(frame);
}

/**
 * Decodes raw inbound WS text into a validated frame. Never throws — a
 * `JSON.parse` failure is folded into the same `FrameValidationResult`
 * failure shape `validateFrame` already returns, so callers have exactly one
 * failure path to handle, not two.
 */
export function decodeFrame(raw: string): FrameValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, path: '', reason: 'not valid JSON' };
  }
  return validateFrame(parsed);
}
