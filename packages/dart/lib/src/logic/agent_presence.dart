/// Folding `agent.joined` / `agent.left` into the session snapshot.
///
/// Ports `applyAgentJoined` and `applyAgentLeft` from
/// `packages/core/src/client/session.ts:185` and `:217`.
///
/// ── Why this lives in `dhaam_chat` and not in the Flutter widget ──────────
///
/// Because that is where the reference puts it, and the reason is structural
/// rather than stylistic. `agent.joined` and `agent.left` carry the SAME
/// payload — one [HandledBy], no arrival/departure marker anywhere inside it
/// (see [AgentEvent], which is a typedef of [HandledBy] precisely because the
/// two `d` shapes are identical). The one and only thing that says which
/// event happened is the envelope's frame TYPE, and core reads it off the
/// `switch` in `dispatchFrame` at the moment of decode:
///
/// ```ts
/// case 'agent.joined':
///   store.setState({ session: applyAgentJoined(store.getState().session, frame.d) });
/// case 'agent.left':
///   store.setState({ session: applyAgentLeft(store.getState().session, frame.d.id) });
/// ```
///
/// `ChatClient` publishes both frames on ONE stream (`agentEvents`), so by the
/// time an event reaches a listener the discriminator is already gone. A
/// consumer downstream of that stream therefore cannot fold correctly: every
/// event looks like an arrival, and reading an `agent.left` as one puts the
/// departed agent's name straight back on the header at the moment they
/// walked away — the exact stale-agent bug the identity header exists to
/// close.
///
/// So the fold happens HERE, at the only place the discriminator still
/// exists, and the result reaches every consumer as an ordinary
/// [SessionSnapshot] on `sessions`. `agentEvents` keeps its current shape and
/// its current meaning: the EVENT (a chime, a toast), never the STATE.
///
/// ── Neither fold touches `status` ────────────────────────────────────────
///
/// Deliberate, and load-bearing in both directions. `isHandledByCurrent`
/// refuses to name a handler while `status` is `WAITING_FOR_AGENT`, so an
/// `agent.joined` that also flipped the status to OPEN would let this fold
/// decide a question that belongs to the server's own snapshot — and an
/// `agent.left` that set the status back to waiting would invent a queue
/// position nobody assigned. `status` moves on `connection.ack` and
/// `session.updated` and on nothing else.
///
/// The reference pins this from the test side too: `identity-header-mount`'s
/// "updates when an agent joins mid-conversation" has to open its session as
/// `OPEN` rather than `WAITING_FOR_AGENT`, precisely because the join does
/// not move the status itself.
library;

import '../protocol/frames.dart';

/// Records an agent (or bot) as the one now handling [session].
///
/// Null session in, null session out: an agent cannot join a conversation
/// this client has not been told about yet. The frame is not an error — the
/// next real snapshot carries the handler anyway — so it is dropped rather
/// than raised.
///
/// ── What did NOT port, and why that is not a gap ────────────────────────
///
/// TS additionally writes `assignedAgent` for `kind == 'AGENT'`. Dart's
/// [SessionSnapshot] has no `assignedAgent` field — it carries `participants`
/// and `handledBy` and nothing else — so there is no second field here to
/// keep in step. Porting one would mean inventing a field the wire never
/// sends, which is how two answers to "who is handling this" get created in
/// the first place.
SessionSnapshot? applyAgentJoined(SessionSnapshot? session, HandledBy agent) {
  if (session == null) return null;
  // Unconditional on `kind`: a BOT resuming a session after a human leaves
  // arrives as an `agent.joined` with `kind: 'BOT'` and is just as much the
  // current handler — see [HandledBy.kind]'s own doc.
  return session.copyWith(handledBy: agent);
}

/// Clears [session]'s handler when — and only when — [id] is the one on it.
///
/// ── The id gate is the whole method ─────────────────────────────────────
///
/// A departure names WHO left, and it is not always the person currently
/// shown. An agent who handed the conversation to a colleague and then
/// dropped off sends an `agent.left` for THEMSELVES, arriving after the
/// colleague's `agent.joined` has already taken the header. Clearing
/// unconditionally would blank the name of somebody who is still sitting
/// there, and the customer would watch their live agent turn back into
/// "Acme Support" mid-sentence.
///
/// Returns the SAME instance when the id does not match, so a caller can use
/// `identical` to decide whether anything actually moved rather than
/// re-deriving the comparison. `create-chat-client.ts` leans on exactly that
/// (its `store.select` compares by reference), and so does `ChatClient`.
SessionSnapshot? applyAgentLeft(SessionSnapshot? session, String id) {
  if (session == null) return null;
  if (session.handledBy?.id != id) return session;
  return session.copyWith(clearHandledBy: true);
}
