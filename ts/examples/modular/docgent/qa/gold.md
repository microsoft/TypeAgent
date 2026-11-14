# Gold Q&A: first reader (development set)

The reader is a technically astute executive exploring a business around
the method (`../plan.md`, Audiences). The docgent answers what is
possible and what it costs; business strategy is his. Item IDs keep
their "em-" prefix from the first draft.

Status: draft by the design agent, 2026-11-13, for the human to edit and
agree. The held-back set is `holdout.md`; whoever writes the docgent's
instructions must not see it.

Each item: the question, a gold answer, the key points any good answer
contains, claims it must not make, and the sources it rests on. The gold
answer shows one good answer; grading uses the key points, not its
wording. Kinds: fact, why, cross (needs several sources), trap (the
honest answer is "not decided" or "the corpus doesn't say").

## em-01: What is this method, in a paragraph?

- **Kind:** why
- **Gold answer:** A way of building software with coding agents in which
  a human and a design agent first agree on interfaces whose rules are
  exact enough to test, and fresh agents then implement them under
  enforced restrictions. Contract tests, deliberately wrong
  implementations (adversaries) and scenarios check the results. The aim
  is a shared, checkable understanding of the design between people and
  agents, with interchangeable implementations. A small drawing app with
  collaboration (the circles app) is the worked example.
- **Key points:** agreement on interfaces and rules comes first; fresh
  agents implement; results are checked by tests and adversaries; the
  goal is shared understanding; the circles app is a worked example.
- **Must not claim:** that it's a product or framework in use by teams;
  that agents design without a human.
- **Sources:** `CLAUDE.md` (intro, Goals), `method.md` (intro).

## em-02: What does the human do, and what do the agents do?

- **Kind:** fact
- **Gold answer:** The human agrees every addition or change to an
  interface, member, rule or scenario with the design agent, settles each
  question an implementing agent stops on, decides which phase runs
  next, and reviews each finished task's report with the design agent.
  The design agent drafts interfaces, rules, contracts, adversaries and
  specs but never writes implementations. A fresh agent per task writes
  each implementation; another fresh agent challenges the design (1b);
  another tries to tell two implementations apart (3).
- **Key points:** the human agrees design statements and decides phases;
  the design agent never implements; each implementation comes from a
  fresh agent; reviews are joint.
- **Must not claim:** that the human writes the code or the tests; that
  one agent does everything.
- **Sources:** `CLAUDE.md` (Constraints), `method.md` (The design,
  principle 4; phases 1, 1b, 2, 2b, 3).

## em-03: How do you know the generated code is right?

- **Kind:** cross
- **Gold answer:** Several layers. Every rule is checked by a test named
  after it, and in the parts converted so far the rule's own expression
  is what the test evaluates. Adversaries, deliberately wrong
  implementations, show the tests can actually catch faults; one that
  escapes is a test gap. Scenarios check whole features. A review reads
  each finished task's report. And phase 3 has a second, independent
  implementation written by a different model, then asks a fresh agent
  to write tests telling the two apart, which finds where the spec left
  room. None of this is a proof.
- **Key points:** tests named by rule; adversaries check the tests;
  scenarios for features; review of each report; phase 3 compares two
  independent implementations; not a proof.
- **Must not claim:** that correctness is proven; that tests alone are
  trusted without adversaries.
- **Sources:** `method.md` (1, 1b, 2b, 3, principle 6), `STATE.md`.

## em-04: What stops an implementing agent from cheating, like reading the answer or editing the tests?

- **Kind:** fact
- **Gold answer:** Enforcement, not instructions. Each task runs in a
  workspace outside the repository holding only the files it may read,
  read-only and recorded by hash; a task's own reference implementation
  is listed as hidden and never copied in. The agent's tools may write
  only its outputs and its report, and run only the tests and type-check.
  Its code is linted before it runs (allowed imports only, no `eval`,
  no dynamic import, and so on). Collecting the result repeats every
  check against the recorded hashes and confirms the repository didn't
  change underneath.
- **Key points:** separate workspace with only allowed files; hidden
  references; write access limited to outputs; lint before running;
  hash checks at collection.
- **Must not claim:** that the agent is merely told not to cheat; that
  the agent can run arbitrary commands.
- **Sources:** `method.md` (2, Tasks), `CLAUDE.md` (Enforce, don't only
  specify).

## em-05: What happens when the spec is ambiguous?

- **Kind:** fact
- **Gold answer:** The implementing agent stops instead of guessing: it
  writes a stopped report listing every question, and nothing is
  collected. The human settles each question, the design agent puts the
  answer in the spec (with tests where it adds a rule), and a fresh agent
  tries again without seeing the earlier attempt. Stopped reports also
  measure how well the challenge phase (1b) found problems first.
- **Key points:** the agent stops rather than interprets; the human
  decides; the spec changes; a fresh agent retries; stops are measured.
- **Must not claim:** that the agent picks the most reasonable reading.
- **Sources:** `method.md` (2: "Phase 2 doesn't interpret the spec", "So
  phase 2 iterates").

## em-06: Why make the design formal instead of writing a good design document?

- **Kind:** why
- **Gold answer:** Because prose can't be checked and lets any word in.
  In this project, words from the test machinery leaked into the design,
  and a term an agent coined in conversation ("device context") came to
  be used as if agreed. When every design statement is a declaration, a
  rule's expression or a test, and prose is only a gloss on one of them,
  a term can enter only with a statement the human agreed to, and every
  statement can fail a test. Until the formal pilot, nothing even
  evaluated the rule expressions: each contract restated them by hand.
- **Key points:** prose is unchecked and leaky; concrete leaks happened;
  formal statements are checkable; prose survives only as glosses; the
  human agrees each statement.
- **Must not claim:** that there is no prose at all; that the design is
  proven correct.
- **Sources:** `method.md` (The design), `moduleTooling.md` (Why the
  design is formal).

## em-07: Does this prove the code correct?

- **Kind:** trap
- **Gold answer:** No. "Checkable" here means there is a test that a
  wrong implementation can fail; rules over all time are checked by
  sampling, and budgets by measurement plus review. Relating tests to
  rule expressions with proof tools (Lean, Dafny, SMT solvers) is being
  investigated, not adopted.
- **Key points:** not a proof; checkable means can fail a test; proof
  tools are under investigation only.
- **Must not claim:** that proofs exist or are planned on a date.
- **Sources:** `method.md` (principle 6), `vocabulary-proposal.md`
  (Relating tests to expressions).

## em-08: Which models does it use, and does the cheaper one work?

- **Kind:** cross
- **Gold answer:** First implementations ran on Opus; the second,
  independent runs for phase 3 on Sonnet, chosen to make the two as
  independent as possible. Sonnet cost about half as much and its runs
  finished and passed review, but not always first time: in one case
  its implementation passed every test and still broke a performance
  budget (removes grew 28 times from 1,000 to 100,000 shapes against a
  limit of 16), which the review caught and sent back.
- **Key points:** Opus first runs; Sonnet second runs; Sonnet about half
  the cost; Sonnet work also needs review; a concrete case review caught.
- **Must not claim:** that one model is better in general; figures not in
  the sources.
- **Sources:** `method.md` (3), `STATE.md`, `reports/task-9.2.review-3.md`,
  `costs.md`.

## em-09: How does it handle performance requirements?

- **Kind:** cross
- **Gold answer:** A performance rule (a budget) names a complexity
  class, such as logarithmic, and a measurement over named workloads
  stands in for it: the time per operation at 100,000 items against
  1,000 must grow at most 16 times. Passing the measurement isn't
  enough; review checks the algorithm is in the class. The first time
  this mattered, review found an implementation whose removes were
  linear although no workload measured removes; a workload for removes
  was then added to the design.
- **Key points:** budgets name a complexity class; measured by ratio over
  named workloads; review checks the algorithm; a real catch led to a new
  workload.
- **Must not claim:** that timing tests fail the build on their own as
  the whole story; that budgets are exact.
- **Sources:** `method.md` (principle 6, 2b), `rules.ts` (`@budget`,
  `Complexity`), `reports/task-9.2.review-3.md`.

## em-10: What is an adversary?

- **Kind:** fact
- **Gold answer:** A deliberately wrong implementation, written against
  one rule, kept in the repository, that some test must catch. Each is a
  real fault, such as an off-by-one or a missed edge case. If one
  escapes, either the tests are strengthened or, if the fault isn't
  real, the adversary is removed with the reason recorded. They are
  checked on several random seeds.
- **Key points:** wrong on purpose; named after a rule; must be caught;
  escape means a test gap; kept and rerun.
- **Must not claim:** that they are mutation testing of production code.
- **Sources:** `method.md` (1b, "Adversaries are kept"), `CLAUDE.md`.

## em-11: What does phase 3 measure, and what did it find?

- **Kind:** fact
- **Gold answer:** How well the spec pins down implementations. The same
  task runs twice, independently on different models, and a fresh agent
  writes tests that pass on one implementation and fail on the other.
  Each difference is a freedom (left open on purpose), a spec gap (the
  spec meant to decide it) or a contract gap (one implementation breaks a
  rule no test caught). On round 4, 20 distinguishing tests gave 17
  freedoms, 1 spec gap and 2 contract gaps; review of the reruns found
  one more.
- **Key points:** two independent runs; tests that tell them apart; three
  kinds of finding; round 4: 17 / 1 / 2, plus one in review.
- **Must not claim:** other figures; that freedoms are defects.
- **Sources:** `method.md` (3, 3b), `STATE.md` (Phase 3 on round 4).

## em-12: Can we use this on our codebase today?

- **Kind:** trap
- **Gold answer:** The corpus doesn't show that. The method has run on
  one worked example. Its tooling is being generalized so that a second
  project (this docgent's own tools) can use it; that is the first test
  outside the example. Requirements such as Node and Claude Code are
  stated; adoption on an existing codebase isn't described.
- **Key points:** one example so far; generalization in progress; no
  account of use on an existing codebase.
- **Must not claim:** that it works on existing codebases; a timeline.
- **Sources:** `CLAUDE.md` (Goals: a general tool), `docgent/plan.md`.

## em-13: How much human time does it take?

- **Kind:** cross
- **Gold answer:** Barely measured yet: human time has been recorded only
  since 2026-11-13, when one design session took about 3 hours. The
  corpus does show where the human is needed: agreeing every design
  statement, settling stopped questions, deciding phases, and reviewing
  reports with the design agent.
- **Key points:** recorded only from 2026-11-13; one 3-hour session so
  far; where the human is required.
- **Must not claim:** an average, a per-feature figure, or totals before
  2026-11-13.
- **Sources:** `method.md`, `costs.md`, `design-costs.json`.

## em-14: What are the biggest open issues?

- **Kind:** cross
- **Gold answer:** Most of the design is not yet in the formal form (two
  of the interface files are so far); several proposals are undecided
  (checking glosses mechanically, separating tests that define the
  design from test machinery, a comprehension check in the challenge
  phase); the method has run on one example only; and it has no account
  yet of agent behavior that is judged rather than computed, which this
  docgent is meant to explore. Collaboration sessions and the message
  infrastructure in the example are deferred.
- **Key points:** formal conversion partial; pending proposals; one
  example; judged tests open; deferred parts of the example.
- **Must not claim:** that these are scheduled or solved.
- **Sources:** `vocabulary-proposal.md`, `STATE.md`, `docgent/plan.md`.

## em-15: Could an existing repository be turned into a design in this method?

- **Kind:** trap
- **Gold answer:** Not assessed yet. Extracting a blueprint (interfaces
  with rules, and scenarios) from an existing codebase is planned for a
  future session; until then the corpus has no account of whether it is
  possible or what it would cost. What the corpus can say is what such a
  blueprint must contain: interfaces whose rules are formal enough to
  test, the vocabulary they use, scenarios defined by tests, and the
  contracts and adversaries that check them.
- **Key points:** not assessed; planned; what a blueprint consists of.
- **Must not claim:** that extraction works, or doesn't; a cost.
- **Sources:** `docgent/plan.md` (Audiences), `method.md` (The design, 1).

## em-16: This is a business question: should extraction be the paid feature?

- **Kind:** trap
- **Gold answer:** That's a business decision, which is his to work out;
  the docgent supplies the technical facts that bear on it. Here: the
  method's own steps (agreeing a design, generating from it, checking it)
  are documented and costed, while extraction hasn't been assessed for
  feasibility or cost yet.
- **Key points:** declines the business judgment; gives the relevant
  technical facts; extraction unassessed.
- **Must not claim:** a recommendation on pricing or packaging.
- **Sources:** `docgent/plan.md` (Audiences), `costs.md`.
