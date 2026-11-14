# Docgent: plan

Status: draft, 2026-11-13. Kept apart from the method's own files: the
docgent is built from them, not part of them.

## The idea

Today a writer's agent compresses what it knows into a document, and the
reader's agent decompresses it, with losses at both steps that nobody
measures. A docgent removes the document in the middle: the reader asks
an agent that holds the sources, curated, and that has passed a gold set
of questions and answers agreed by the human and the design agent before
it is distributed. It can be enriched with visualizations it tours on
request.

The first docgent explains the interface-first method in
`ts/examples/modular`.

## In the method's terms

| Method | Docgent |
|---|---|
| Interfaces and rules | The corpus and the docgent's instructions |
| Contract tests | The gold Q&A, each item with its sources |
| Adversaries | Damaged corpora (a section removed, a wrong claim planted, a design term swapped for a harness term) that some gold question must catch |
| Phase 3 | Two docgents built independently, or two models, answering the same questions; where they differ, the sources leave something open |
| Stopped report | Questions the docgent can't ground in its corpus: it says so, and records them |

## Packaging

A zip someone extracts, then runs Claude Code in. The main session is the
docgent:

- `CLAUDE.md`: role, audience profile, grounding rules, available tours.
- `.claude/settings.json`: read-only; Bash only to open a visualization.
- `corpus/`: a snapshot from one commit (method documents, interface
  files with their rules, chosen reports and costs, worked examples).
- `visuals/`: self-contained HTML pages, each a tour of numbered steps.
- `MANIFEST`: source commit, build date, the Q&A version it passed.
- `feedback/`: where the docgent records questions it couldn't ground.

## Audiences

One at first, with a profile in `CLAUDE.md`; more later as profiles over
the same corpus, with gold items tagged by audience.

**The first reader** is a colleague: a Berkeley computer science PhD, then
VP of engineering, VP of marketing, and for 14 years CEO of a SaaS
company. He is technically astute and is exploring how a business could
let this method thrive in open source. The division of labor is
deliberate: he works on the business; we supply the raw material, which
is what is possible and what it costs. So the docgent answers technical
questions, with costs and evidence, and doesn't offer business strategy:
a business question gets the technical facts that bear on it and a note
that the rest is his to work out. That discipline keeps the
conversations crisp.

His first question of that kind: can an existing repository be extracted
into a design in this method (a blueprint of interfaces with rules, and
scenarios)? It hasn't been assessed yet; it is planned for a future
session, and its answer belongs in the corpus when it exists.

## The gold Q&A

- Each item: question, audience, gold answer, key points an answer must
  contain, claims it must not make, source files.
- Graded at first by the human and the design agent: key points present,
  no forbidden claims, sources cited, agreed and pending told apart.
- Later by a grading subagent, itself checked against the hand-graded
  items.
- 40 to 60 items for the first audience: facts, whys, cross-source
  questions, and traps whose honest answer is "not decided" or "the
  corpus doesn't say".

## Visualizations

Built in advance and tested, not generated on request. Candidates: a
round through the phases; what each agent can read and write; one rule
evaluated (history, `old`, `atEvent`, verdict); phase 3's distinguishing
tests and their findings. Tours get gold items too.

## Open questions

1. The first audience.
2. Who drafts gold answers: the design agent drafts and the human edits,
   or the human writes questions and the design agent drafts answers.
3. What may go in the corpus (reports, costs, usage figures).
4. The reader's setup: which Claude Code and model it assumes.
5. The build: a script here that assembles the zip from a commit.

## First step

The gold Q&A, before any docgent exists, as contracts come before
implementations.
