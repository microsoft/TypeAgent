# Motivation

Why the method builds a design that humans and agents share, and the
principle the workflows are designed around. This is for our own use;
the workflows document doesn't depend on it. Agreed 2026-11-19.

## Why a shared design

The method doesn't assume who is better at what. It makes the design
something every party can check, so it should still make sense as the
strengths of each party change.

**What each brings today.**
- **Agents** bring breadth of knowledge, speed, and the patience to check
  many cases. Their reasoning is broad but not reliable: a step can be
  confidently wrong. That is why the design is formal and the checks
  (tests, adversaries, proofs) are a third party that neither side has
  to trust.
- **Humans** bring experience over time. Agents learn mostly from systems
  as they stood at a moment. What happened to a design years later is
  recorded only sparsely: whether it survived, what changing it cost,
  which abstraction became the bottleneck. A human's principles about how
  systems evolve are hard to replace. A design agent also tends to propose
  the typical design. The human notices when a project needs something
  atypical, and can develop an unusual idea over weeks.

**Reasons that hold even as agents improve.**
1. **Review at the right size.** Implementations will be too large for
   people to read. The design is the level at which a human can stay in
   charge without reading every line.
2. **The human holds the intent.** What the system is for, who uses it
   and what is acceptable live outside the repository, and someone
   accountable has to decide. This is why phases are the human's call.
3. **The design is the team's memory.** Agents start each session fresh,
   and implementers are fresh on purpose. People forget and change teams.
   The agreed design is what everyone reloads.
4. **Differing readings expose ambiguity.** When a human and an agent
   read a statement differently, it is underspecified. This is phase 3's
   principle applied to readers instead of implementations, and it works
   only if the disagreement surfaces instead of being resolved silently.
5. **Errors that don't line up.** Human and agent mistakes come from
   different sources, so each catches what the other misses.
6. **Agents need it too.** With several agents, the design is how they
   coordinate, and a fresh implementer has nothing else to go on.

## The core principle: human attention

Human attention is the scarce resource. Every workflow should spend it
only where the human's contribution is unique: intent, decisions, how the
system will evolve, and noticing when the typical answer is wrong.
Everything else goes to agents and checks. This is why we record human
hours (`../design-costs.json`).

**Smaller for the human, more detail for the AI.** When a design choice
trades size for the human against detail for the AI, prefer what is
smaller for the human. Paying attention to more details is one of AI's
great contributions, and the checks back it up. For example, the undo
list records its history as operations ("replace 0 'oat milk', was
'milk'") rather than as snapshots of the whole list: each entry is small
for a person to read, and the rules for undoing each kind of operation,
which are longer, fall to the AI. (Agreed 2026-11-19.)

**The inner loop of design.** A developer's inner loop is the time from
making a change to seeing its full effect. Shortening it changes how well
developers work, human or AI, and the effect is not linear: both a
person's short-term memory and an agent's context hold only so much, so
quick, succinct feedback lets a developer dare more changes than costly
feedback does.

The method can drive the human's inner loop of design toward zero. The
system should keep putting in front of the human design decisions,
visualizations and explanations of the right number and size, so that
the human stays engaged and in flow at the level of the design. And each
decision should get at least some feedback immediately, from a proof, a
rule check or another fast check, rather than waiting for an
implementation to be generated and reviewed.

What this asks of the workflows:
- **Size decisions to attention.** A decision comes with what is needed
  to make it, and no more; large questions are broken into ones that can
  be answered in flow.
- **Fast checks first.** Checks that need no implementation (proofs,
  consistency and determinacy of rules, the boundary checks, rule
  expressions run against references) answer in seconds and belong in
  the human's loop.
- **Slow work off the loop.** Generating and reviewing implementations
  takes minutes to hours. It runs in the background, and its results
  come back as decisions of the right size.
- **Teach as you go.** When a decision needs background the human
  doesn't have, the system supplies it at that moment.
