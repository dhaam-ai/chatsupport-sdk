import { describe, expect, it } from 'vitest';
import {
  CHAT_MODE_VALUES,
  CHAT_STATUS_VALUES,
  CLOSE_REASON_VALUES,
  DELIVERY_STATUS_VALUES,
  MESSAGE_TYPE_VALUES,
  MESSAGE_VISIBILITY_VALUES,
  PARTICIPANT_TYPE_VALUES,
  PRESENCE_STATUS_VALUES,
  SENDER_TYPE_VALUES,
  isChatMode,
  isChatStatus,
  isCloseReason,
  isDeliveryStatus,
  isMessageType,
  isMessageVisibility,
  isParkedCloseReason,
  isParticipantType,
  isPresenceStatus,
  isSenderType,
} from './enums.js';

describe('SenderType', () => {
  it('accepts every documented value (§12.1)', () => {
    for (const value of SENDER_TYPE_VALUES) {
      expect(isSenderType(value)).toBe(true);
    }
  });

  it('rejects the v1 integer encoding and unknown strings', () => {
    expect(isSenderType(1)).toBe(false);
    expect(isSenderType('customer')).toBe(false); // wrong case
    expect(isSenderType('MODERATOR')).toBe(false);
  });
});

describe('MessageType', () => {
  it('accepts every documented value including TYPING', () => {
    for (const value of MESSAGE_TYPE_VALUES) {
      expect(isMessageType(value)).toBe(true);
    }
  });
});

describe('ChatStatus — the six-value requirement', () => {
  it('carries all six real backend values, not v1\'s four', () => {
    expect(CHAT_STATUS_VALUES).toEqual([
      'OPEN',
      'WAITING_FOR_AGENT',
      'ASSIGNED',
      'CLOSED',
      'RESOLVED',
      'ON_HOLD',
    ]);
  });

  it('accepts RESOLVED and ON_HOLD specifically — the values v1 silently collapsed into OPEN', () => {
    expect(isChatStatus('RESOLVED')).toBe(true);
    expect(isChatStatus('ON_HOLD')).toBe(true);
  });

  it('rejects unknown statuses', () => {
    expect(isChatStatus('ARCHIVED')).toBe(false);
    expect(isChatStatus(4)).toBe(false);
  });
});

describe('ChatMode', () => {
  it('accepts BOT and HUMAN only', () => {
    for (const value of CHAT_MODE_VALUES) {
      expect(isChatMode(value)).toBe(true);
    }
    expect(isChatMode('HYBRID')).toBe(false);
  });
});

describe('DeliveryStatus', () => {
  it('accepts SENT, DELIVERED, READ', () => {
    for (const value of DELIVERY_STATUS_VALUES) {
      expect(isDeliveryStatus(value)).toBe(true);
    }
  });
});

describe('PresenceStatus', () => {
  it('accepts ONLINE, OFFLINE, AWAY, DND', () => {
    for (const value of PRESENCE_STATUS_VALUES) {
      expect(isPresenceStatus(value)).toBe(true);
    }
  });
});

describe('MessageVisibility', () => {
  it('accepts PUBLIC and INTERNAL', () => {
    for (const value of MESSAGE_VISIBILITY_VALUES) {
      expect(isMessageVisibility(value)).toBe(true);
    }
  });
});

describe('ParticipantType', () => {
  it('accepts CUSTOMER, AGENT, BOT', () => {
    for (const value of PARTICIPANT_TYPE_VALUES) {
      expect(isParticipantType(value)).toBe(true);
    }
  });
});

describe('CloseReason — genuinely-ended vs. parked (§12.5)', () => {
  it('is a real enum, not a loose string', () => {
    expect(CLOSE_REASON_VALUES).toEqual(['RESOLVED', 'MANUAL', 'SWITCHED']);
  });

  it('rejects non-canonical values', () => {
    expect(isCloseReason('switched')).toBe(false);
    expect(isCloseReason(null)).toBe(false);
  });

  it('structurally distinguishes SWITCHED (parked) from RESOLVED/MANUAL (genuinely ended)', () => {
    expect(isParkedCloseReason('SWITCHED')).toBe(true);
    expect(isParkedCloseReason('RESOLVED')).toBe(false);
    expect(isParkedCloseReason('MANUAL')).toBe(false);
  });
});
