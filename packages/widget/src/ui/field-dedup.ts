// Dropping a merchant's pre-chat field when the surface already asks for it.
//
// The console's default pre-chat fields are "Your name" (text, required) and
// "Email address" (email, required), with `preChatEnabled: true` — checked in
// `chatsupport_react app/lib/settings/chatbot.ts:391-399`, and applied under a
// stored config by `withBehaviourDefaults` in that same file. A merchant who
// never opened those settings would otherwise get a form asking for a name
// twice. Both message-leaving surfaces need the rule, and they render
// DIFFERENT built-ins, so it cannot be a list of labels:
//
//   ui/webform-form.ts   Name · Email · Phone
//   ui/offline-form.ts   Name · Email or phone
//
// A fixed list is wrong in both directions at once. It missed "Phone number" —
// the obvious label for a phone number — and so rendered two phone boxes on the
// web form, while dropping "Contact", which that form does not ask for at all,
// silently deleting the merchant's question.
//
// ── The rule ─────────────────────────────────────────────────────────────
//
// A pre-chat field is dropped when its label — lowercased, trimmed, inner runs
// of whitespace collapsed, a leading "your " removed and ONE trailing
// " address" / " number" / " details" removed — is exactly equal to the same
// normalisation of a label that surface itself renders, or, where a rendered
// label offers alternatives with " or ", of either side of it.
//
// Equality, not substring: "Name of the product you ordered" is not "name", and
// a merchant who asks it must keep getting an answer. The two affixes are the
// difference between the label a person writes and the field a form shows —
// "Your name"/"Name", "Email address"/"Email", "Phone number"/"Phone" — and
// they are stripped from BOTH sides, so a surface that one day renders "Your
// name" needs no change here.
//
// ── " or " splits a RENDERED label, never a merchant's ───────────────────
//
// `ui/offline-form.ts` asks for a reply channel in ONE input labelled "Email
// or phone", so a merchant field called "Email" collects the value the visitor
// has already typed there — the same repeat as any other, just spelled across
// two words. Splitting it makes that surface drop "Email", "Phone" and the
// console's seeded "Email address", none of which the whole label matches.
//
// The split runs on the RENDERED side only, and there is exactly one rendered
// label containing " or " across both surfaces. A merchant's label is never
// split: "Email or WhatsApp" is a question about WhatsApp, and splitting it
// would match "email" and delete the question — the split can only ever add a
// wrongful DROP, so it stays on the side of the comparison this package owns
// and can see. `test/pre-chat-dedup.test.ts` pins that direction explicitly.
//
// "Contact" survives on both surfaces: it is neither side of the split, and
// nothing either form renders is called that.
//
// ── Near misses this deliberately does NOT drop ──────────────────────────
//
// "Mobile", "Telephone", "Cell", "E-mail", "Mail", "Full name", "First name"
// and any translation are KEPT: they render in addition to the built-in, which
// is the direction that loses nothing. Handling them means a synonym table —
// a fixed list again, in a new coat, and one that has to guess in a language
// nobody here reviewed. A merchant who wants "Mobile" dropped can rename the
// field to "Phone", and the built-in field is still on screen either way.
//
// Neither `id` nor `type` is consulted WHEN MATCHING: the console lets a merchant label any
// field anything, so the label is what the visitor reads and the only thing the
// two can be compared on. `ui/offline-form.ts`'s own contact field is `id:
// 'contact'`, and a merchant field labelled "Contact" is a different question
// from the "Email or phone" that surface shows.
//
// ── `required` IS consulted, because dropping it loses something ─────────
//
// A dropped field takes its REQUIREMENT with it, and the built-ins it repeats
// are not all required — the web form's Name and Phone are optional. So a
// merchant who marked "Phone number" required would get a form that submits
// with no phone at all: the question downgraded rather than deleted, which is
// the quieter of the two failures and the harder to notice.
//
// A dropped `required: true` therefore promotes the built-in it duplicates,
// for that render only, and the promotion reaches the LABEL as well as the
// input — `ui/forms.ts` appends " (optional)" from the same spec, and a box
// marked optional that refuses to submit is a worse lie than the one being
// fixed. A dropped `required: false` promotes nothing: a merchant who marked
// their field optional must not end up with a mandatory built-in.
//
// ── Promote only what makes the submission answerable ───────────────────
//
// Not every requirement is worth enforcing on someone else's built-in. The
// test is whether losing it would make the submission UNANSWERABLE: an email
// or a phone number is how the reply gets back to the visitor — this form
// promises one ("We'll reply to …", `ui/webform-form.ts`) and cannot keep it
// without a channel — while a name is descriptive. Losing a name costs an
// agent context; losing the phone a merchant made mandatory costs the reply.
//
// So `type` decides, never the label. `ui/forms.ts` already treats `email`
// and `phone` as the two channels — they are what drive `inputmode` and the
// `autocomplete` token — so the reachability seam already exists in this
// package and this rule reads it rather than inventing a second one. A
// `label !== 'Name'` check would be the fixed list this module deleted,
// rebuilt somewhere new: it would miss a merchant's "Full name", and it would
// have nothing to say about whatever channel gets added next.
//
// A future contact type is covered the day it is added to `FieldSpec['type']`
// and named below. A future descriptive field needs no thought at all.
//
// ── The pre-existing tests are the evidence to read first ───────────────
//
// `test/product-surfaces.test.ts` and `test/pre-chat-guest-only.test.ts` were
// written against the fixed list this replaced, and both are UNEDITED. They do
// not merely tolerate the rule — they DISCRIMINATE: an independent review
// reproduced an affix-strip-only version with no " or " split, and they fail
// against it while passing against this one, unchanged.
//
// `product-surfaces.test.ts` discriminates on the promotion too — `pre-chat-
// guest-only.test.ts` does NOT, and an independent review proved it by
// mutation: it passes 10/10 against both an always-promote and a
// never-promote version, so it guards the DROP rule only. That is how the
// reachability
// narrowing above was settled rather than argued: promoting Name made the
// console's own seeded config block its submit, and `product-surfaces.test.ts`
// had to be edited to keep passing. Narrowing promotion to contact types put
// it back byte-identical to where it was written.
//
// So: a change to this rule that needs either file edited is a change of
// BEHAVIOUR, not a refactor. Read what they already assert before making one.

import type { FieldSpec } from './forms.js';

const LEADING_QUALIFIER = /^your /;
const TRAILING_QUALIFIER = / (address|number|details)$/;
/** Splits a RENDERED label only — see this module's header. */
const ALTERNATIVE = ' or ';

/**
 * Whether a built-in is a way to REACH the visitor, and so worth inheriting a
 * dropped field's requirement. The two contact types `ui/forms.ts` already
 * knows about; see this module's header for why it is the type and not the
 * label.
 */
const reaches = (spec: FieldSpec): boolean => spec.type === 'email' || spec.type === 'phone';

/** The comparison form of a field label. See this module's header for the rule. */
export function normaliseFieldLabel(label: string): string {
  const flat = label.trim().toLowerCase().replace(/\s+/g, ' ');
  return flat.replace(LEADING_QUALIFIER, '').replace(TRAILING_QUALIFIER, '');
}

/** What a surface renders, once the merchant's fields have been folded in. */
export interface DedupedFields {
  /** The surface's own built-ins, with any promoted by a drop (see below). */
  readonly rendered: readonly FieldSpec[];
  /** The merchant's fields, minus the ones that repeat a built-in. */
  readonly extra: readonly FieldSpec[];
}

/**
 * Splits the merchant's fields into what a surface should render beside its
 * own built-ins, and what those built-ins become as a result.
 *
 * `rendered` takes the surface's OWN built-in specs, so relabelling one moves
 * its dedup with it and no list here needs editing. `ui/webform-form.ts` hands
 * over the very array it maps into inputs; `ui/offline-form.ts` builds its two
 * fields one at a time and so names the same two specs at the call site,
 * beside the lines that render them, where a third would be noticed. BOTH then
 * render the `rendered` this returns rather than the constants they passed in,
 * which is what makes a promotion reach the screen.
 *
 * The returned specs are copies where promoted and the originals otherwise —
 * nothing the caller passed in is mutated, so the module-level built-in
 * constants cannot pick up one visitor's promotion and keep it for the next.
 *
 * The near-miss boundary is pinned at the DOM, per surface, in
 * `test/pre-chat-dedup.test.ts`.
 */
export function dedupeAgainstRendered(
  rendered: readonly FieldSpec[],
  fields: readonly FieldSpec[],
): DedupedFields {
  // Concept → which built-in owns it, so a drop knows what to promote.
  const owner = new Map<string, number>();
  rendered.forEach((spec, index) => {
    const whole = normaliseFieldLabel(spec.label);
    // The whole label AND each alternative: a merchant who wrote the built-in
    // out in full ("Email or phone") is repeating it just as much as one who
    // asked for half of it.
    for (const concept of [whole, ...whole.split(ALTERNATIVE).map(normaliseFieldLabel)]) {
      // Only a BLANK rendered label can produce '', and it would otherwise go
      // into the map and drop every unlabelled merchant field. An empty
      // ALTERNATIVE is unreachable: `normaliseFieldLabel` trims and collapses
      // before the split runs, and the separator carries a space on each side,
      // so "Email or ", " or phone" and "or" all keep every piece they have.
      //
      // First built-in wins a concept two of them share, which no surface has
      // today; the alternative is a silent last-one-wins.
      if (concept !== '' && !owner.has(concept)) owner.set(concept, index);
    }
  });

  const promoted = new Set<number>();
  const extra = fields.filter((spec) => {
    const index = owner.get(normaliseFieldLabel(spec.label));
    if (index === undefined) return true;
    // Dropped — so a requirement it carried has to land on the built-in that
    // replaced it, but only where losing it would cost the reply itself.
    const builtIn = rendered[index];
    if (spec.required && builtIn !== undefined && reaches(builtIn)) promoted.add(index);
    return false;
  });

  return {
    rendered:
      promoted.size === 0
        ? rendered
        : rendered.map((spec, index) =>
            promoted.has(index) && !spec.required ? { ...spec, required: true } : spec,
          ),
    extra,
  };
}
