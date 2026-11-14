# Gold Q&A: first reader (held-back set)

Status: draft by the design agent, 2026-11-13, for the human to edit and
agree. Not to be seen by whoever writes the docgent's instructions or
chooses its corpus: when that work runs as a task, this file is Hidden.
Format as in `gold.md`.

## em-h1: What does it cost to build something this way?

- **Kind:** cross
- **Gold answer:** Measured at API list prices, one round of the example
  (round 4, 20 implementation attempts including reruns) cost $47.40.
  Single tasks typically cost a few dollars each; Sonnet runs cost about
  half what Opus runs do. On a personal Ultra plan, all the design and
  implementation work to date used about 6% of one week's limit. A week's
  capacity was estimated at roughly $1,600 at list prices, so the work so
  far is roughly $100 at list prices; the $1,600 is what the plan offers,
  not what the work cost. For enterprises spending $1,000 to
  $2,000 per developer per month, the human judged it feasible.
- **Key points:** list-price basis; $47.40 for round 4 over 20 attempts;
  a few dollars per task; Sonnet about half; all work to date about 6% of
  an Ultra week (roughly $100 at list prices); the enterprise framing is
  the human's judgment.
- **Must not claim:** that these are an organization's actual bills; that
  the work cost $1,600 or that a week of it costs $1,600; human costs
  beyond the recorded hours.
- **Sources:** `STATE.md`, `design-costs.json`, `costs.md`.

## em-h2: How long does a task take an agent?

- **Kind:** fact
- **Gold answer:** Minutes. The recorded runs take from about 5 to about
  14 minutes each; task 9's run that added the operation log took about
  7 minutes.
- **Key points:** minutes per task; a range from `costs.md`.
- **Must not claim:** elapsed time for a whole feature or for humans.
- **Sources:** `costs.md`.

## em-h3: If the tests pass, why is a review still needed?

- **Kind:** why
- **Gold answer:** Because some things tests don't settle. A report lists
  the choices the agent made; review decides whether each was really
  left open or was an interpretation the agent should have stopped on.
  And budgets: an implementation can pass the measurement with an
  algorithm outside the stated complexity class, which only reading the
  code shows. Review has caught exactly that.
- **Key points:** choices may hide interpretations; budgets need reading;
  a concrete catch.
- **Must not claim:** that review re-tests the code.
- **Sources:** `method.md` (2b), `reports/task-9.2.review-3.md`.

## em-h4: What happens to a test that passes on both of the two implementations in phase 3?

- **Kind:** fact
- **Gold answer:** It doesn't count: the check runs every distinguishing
  test on each implementation and on a reference, and fails any test that
  passes or fails on both. A test that breaks a caller's obligation is
  caught by the reference's result and by review.
- **Key points:** must pass on exactly one; checked mechanically; the
  reference catches tests that break requirements.
- **Must not claim:** that such tests are kept as findings.
- **Sources:** `method.md` (3, Enforced).

## em-h5: Is the design written in a special language?

- **Kind:** fact
- **Gold answer:** No: TypeScript. Interfaces are TypeScript; each rule
  is a tagged comment with a TypeScript boolean expression; scenarios are
  TypeScript data. A small rule language (`rules.ts`) adds a few forms,
  such as the value before a call and an object's history of calls.
- **Key points:** TypeScript throughout; rules as tagged expressions; a
  small rule language.
- **Must not claim:** a separate specification language.
- **Sources:** `rules.ts`, `method.md` (1).

## em-h6: Does it work with teams of several developers?

- **Kind:** trap
- **Gold answer:** The corpus doesn't address it. The method's roles are
  one human with a design agent, plus fresh agents per task; how several
  humans share agreement isn't described.
- **Key points:** not addressed; the roles as described.
- **Must not claim:** that it supports teams, or that it doesn't.
- **Sources:** `method.md`, `CLAUDE.md`.

## em-h7: Why use a second model in phase 3 rather than the same one twice?

- **Kind:** why
- **Gold answer:** To make the two implementations as independent as
  possible, so that where they agree reflects the spec rather than one
  model's habits, and where they differ shows what the spec leaves open.
- **Key points:** independence; agreement should come from the spec.
- **Must not claim:** that the second model is meant to be better or
  cheaper.
- **Sources:** `method.md` (3, A second run).
