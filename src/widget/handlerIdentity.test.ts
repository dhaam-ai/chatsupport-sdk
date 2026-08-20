import { describe, it, expect } from 'vitest';
import {
  resolveHandlerIdentity,
  BOT_DISPLAY_NAME,
  DEFAULT_WIDGET_TITLE,
} from './handlerIdentity';

describe('resolveHandlerIdentity', () => {
  it('names the assigned human agent from the enriched profile', () => {
    expect(resolveHandlerIdentity({
      assignedAgentDisplayName: 'Priya Nair',
      assignedAgentId: 'agent-1',
      mode: 'HUMAN',
      status: 'ASSIGNED',
    })).toEqual({ kind: 'AGENT', name: 'Priya Nair' });
  });

  it('falls back to the name chat.agent.joined delivered when there is no profile', () => {
    expect(resolveHandlerIdentity({
      assignedAgentName: 'Priya Nair',
      assignedAgentId: 'agent-1',
      mode: 'HUMAN',
      status: 'ASSIGNED',
    })).toEqual({ kind: 'AGENT', name: 'Priya Nair' });
  });

  it('prefers the enriched profile over the WS name when both are present', () => {
    expect(resolveHandlerIdentity({
      assignedAgentDisplayName: 'Priya Nair',
      assignedAgentName: 'priya.n',
      assignedAgentId: 'agent-1',
    }).name).toBe('Priya Nair');
  });

  it("says 'Agent', not the bot, when a human is assigned but unnamed", () => {
    // sanitizeAgentName on the backend emits the literal 'Agent' when it has
    // no real name; looksLikeRawId rejects it as a display name. Falling
    // through to the bot here would claim a human conversation is automated.
    expect(resolveHandlerIdentity({
      assignedAgentName: 'Agent',
      assignedAgentId: 'agent-1',
      mode: 'HUMAN',
      status: 'ASSIGNED',
    })).toEqual({ kind: 'AGENT', name: 'Agent' });
  });

  it('never renders a raw id as a name', () => {
    expect(resolveHandlerIdentity({
      assignedAgentName: '8f14e45fceea167a5a36dedd4bea2543',
      assignedAgentId: '8f14e45fceea167a5a36dedd4bea2543',
    })).toEqual({ kind: 'AGENT', name: 'Agent' });
  });

  it('knows a human owns the chat from the id alone, before a name arrives', () => {
    expect(resolveHandlerIdentity({ assignedAgentId: 'agent-1', mode: 'HUMAN' }))
      .toEqual({ kind: 'AGENT', name: 'Agent' });
  });

  it('names the bot while the bot is handling the chat', () => {
    expect(resolveHandlerIdentity({ mode: 'BOT', status: 'OPEN' }))
      .toEqual({ kind: 'BOT', name: BOT_DISPLAY_NAME });
  });

  it('treats an unknown mode as the bot, matching the normalisers default', () => {
    expect(resolveHandlerIdentity({ status: 'OPEN' }).kind).toBe('BOT');
  });

  it('does NOT claim the bot once the chat is queued for a human', () => {
    // The bot has already handed off at WAITING_FOR_AGENT — nobody is handling
    // it, so neither name would be true.
    expect(resolveHandlerIdentity({
      mode: 'HUMAN',
      status: 'WAITING_FOR_AGENT',
      configuredTitle: 'Acme Support',
    })).toEqual({ kind: 'FALLBACK', name: 'Acme Support' });
  });

  it('does NOT claim the bot on a terminal session with nobody assigned', () => {
    expect(resolveHandlerIdentity({ mode: 'BOT', status: 'CLOSED' }).kind).toBe('FALLBACK');
    expect(resolveHandlerIdentity({ mode: 'BOT', status: 'RESOLVED' }).kind).toBe('FALLBACK');
  });

  it('keeps naming the agent who handled a session that has since closed', () => {
    expect(resolveHandlerIdentity({
      assignedAgentDisplayName: 'Priya Nair',
      assignedAgentId: 'agent-1',
      status: 'CLOSED',
    })).toEqual({ kind: 'AGENT', name: 'Priya Nair' });
  });

  it('uses the configured title as the generic fallback', () => {
    expect(resolveHandlerIdentity({ status: 'WAITING_FOR_AGENT', configuredTitle: 'Acme Support' }).name)
      .toBe('Acme Support');
  });

  it('uses the default title when the host configured none', () => {
    expect(resolveHandlerIdentity({ status: 'WAITING_FOR_AGENT' }).name).toBe(DEFAULT_WIDGET_TITLE);
    expect(resolveHandlerIdentity({ status: 'WAITING_FOR_AGENT', configuredTitle: '   ' }).name)
      .toBe(DEFAULT_WIDGET_TITLE);
  });

  it('updates live when assignment changes mid-session', () => {
    // bot → queued → assigned → agent leaves, as the reducer would drive it.
    const bot = resolveHandlerIdentity({ mode: 'BOT', status: 'OPEN', configuredTitle: 'Acme Support' });
    const queued = resolveHandlerIdentity({ mode: 'HUMAN', status: 'WAITING_FOR_AGENT', configuredTitle: 'Acme Support' });
    const assigned = resolveHandlerIdentity({
      mode: 'HUMAN', status: 'ASSIGNED', assignedAgentId: 'a1',
      assignedAgentName: 'Priya Nair', configuredTitle: 'Acme Support',
    });
    const left = resolveHandlerIdentity({ mode: 'HUMAN', status: 'WAITING_FOR_AGENT', configuredTitle: 'Acme Support' });

    expect([bot.name, queued.name, assigned.name, left.name])
      .toEqual([BOT_DISPLAY_NAME, 'Acme Support', 'Priya Nair', 'Acme Support']);
  });
});
