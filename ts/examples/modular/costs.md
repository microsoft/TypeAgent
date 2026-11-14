# Costs

What building with this method costs in agent usage, measured where we
can and estimated where we can't, and an estimate of the usual
alternative. All dollar figures are at API list prices. Human time is recorded
from 2026-11-13 on, as hours per session in `design-costs.json`; nothing
earlier was recorded.

## Measured

- **Implementation runs:** `node task.ts costs` prints every phase 2 and
  phase 3 attempt from `tasks.json`: dollars, turns, minutes and tokens,
  with totals by round. Round 4 cost $47.40 over 20 attempts, including
  the phase 3 second runs, the distinguishing agents and every rerun.
  Single runs cost about $1.40 to $6 and take about 5 to 15 minutes.
  Sonnet runs cost about half what Opus runs do.
- **Design-side work** (phase 1b agents, design sessions) is kept by hand
  in `design-costs.json`. The round 4 phase 1b agent used about 205,000
  tokens.

## The plan calibration (2026-11-12)

The human works on a personal Ultra plan, with a fixed price and a weekly
usage limit:

- By Thursday 2026-11-12 the week was at 3%. That covered about two
  thirds of the design work to date, round 4's phase 1b and its first
  phase 2 runs ($13.94).
- Later that day it was at 3% to 4%, after $7.98 of runs. The human
  estimated those runs at 0.5% of the week, which puts the capacity of an
  Ultra week at roughly $1,600 at list prices. That is what the plan
  gives a subscriber, not what this work cost.
- By 2026-11-13, all the design and implementation work to date had used
  about 6% of the week: roughly $100 at list prices, on that estimate.
- Human time on 2026-11-13: about 3 hours.

Two thresholds frame the numbers:
- **Independent developers** ($100 to $200 a month): success means rarely
  or never reaching a weekly limit over weeks spent mainly on such a
  project.
- **Enterprises:** budgets of $1,000 to $2,000 per developer per month,
  which the human judged feasible for this method.

## Estimate: round 4 by "whack-a-mole" (2026-11-12)

These are the design agent's estimates, not measurements. As a rule of
thumb, our runs cost about $1.70 per million tokens processed, mostly
cache reads.

"Whack-a-mole" is how most developers use coding agents today: generate
the code in one long session, then fix bugs as they show up.

**Generating the code costs about the same either way.** Round 4 is about
900 lines of implementation: the AVL collection, the processor, the
circle and the canvas view. One developer session would take 40 to 80
turns, with the context growing to 100,000 to 150,000 tokens. That is
about 4 to 8 million tokens ($7 to $14), roughly what our phase 2 spent
($13.94).

**Fixing the design is where they differ.** Round 4 has faults that show
up only under particular conditions:
- an acknowledgment processed before its own local operation;
- a remote remove or clear that misses a pending add;
- remote adds landing in the wrong z position;
- a write during a change listener;
- the half-open corner touch;
- linear renumbering of the z-order.

Phase 1b found 21 issues in round 4, and the adversaries describe about
35 faults of these kinds. Whack-a-mole pays, for each bug: noticing the
symptom; explaining it again in a long session, or starting over and
rebuilding context; 10 to 25 turns at 120,000 to 180,000 tokens of
context; and retesting. That is about 1.5 to 4 million tokens per bug,
and some fixes break something else (assume 20% to 40%).

| Bugs found and fixed | Fixing tokens | With generation | Cost |
|---|---|---|---|
| 10 | about 15 to 40 million | about 20 to 50 million | $35 to $85 |
| 20 | about 30 to 80 million | about 35 to 90 million | $60 to $150 |

Two caveats matter more than the token counts:

1. **Whack-a-mole doesn't find most of these faults.** The ordering bugs
   need two clients and a particular arrival order. A developer testing
   by hand with one client never sees them, so the cheap end of the range
   means shipping those bugs.
2. **The comparison isn't complete.** It needs this method's design-side
   cost, which is probably the larger share: long phase 1 sessions
   re-read large contexts every turn. The estimate was tens of millions
   of tokens per round, not measured.

For enterprises paying per token, the figures apply directly, less any
discount. For independent developers on monthly plans, long
whack-a-mole sessions run into the usage windows, while this method's
short, fresh runs fit them better.
