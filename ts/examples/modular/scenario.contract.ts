// Scenario tests for the circles app: each scenario in scenarios.ts, run
// through an app fixture, with the scenario's ID as the test's name. The
// fixture is the only thing a platform writes for these tests: it does
// each action with the platform's own controls and reads what the drawing
// shows. When given a reference, also runs random sequences of actions on
// both and compares what the drawing shows on a grid of points after each.
//
// frames.complete (frames.ts): after each action a fixture processes what
// the app sent and runs the frames the app asks for, as a display would,
// then processes again, and throws, with the rule's ID in its message, if
// the model changed after the first processing. A test of that name runs
// random sequences of actions, and after each waits for a timer and asks
// the fixture to check again, so that a send deferred to a timer is seen.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Action, CirclesSettings, Scenario } from "./scenarios.ts";
import { demoSettings, scenarios } from "./scenarios.ts";
import { deepEqual } from "./rules.ts";

/** A running circles app, as a user sees it. */
export interface AppFixture {
  /** Does what the user does, with the app's controls, then processes what the app sent and runs the frames it asks for. */
  act(action: Action): Promise<void>;
  /**
   * Runs the frames the app asks for and processes anything it has sent
   * since its last action was settled; throws, with frames.complete in the
   * message, if that changes the model.
   */
  settled(): Promise<void>;
  /** What the drawing shows at p, in the drawing's coordinates. */
  painted(p: Point): Color;
  dispose(): void;
}

const transparent: Color = { r: 0, g: 0, b: 0, a: 0 };

function colorNamed(settings: CirclesSettings, name: string): Color {
  if (name === "transparent") return transparent;
  const entry = settings.palette.find((p) => p.label === name);
  if (!entry) throw new Error(`no palette color ${name}`);
  return entry.color;
}

/** Runs one scenario on a fresh fixture; throws at the first step that fails. */
export async function runScenario(app: AppFixture, scenario: Scenario): Promise<void> {
  for (const [i, step] of scenario.steps.entries()) {
    if ("act" in step) await app.act(step);
    else {
      const where = `${scenario.id}, step ${i + 1}: ${JSON.stringify(step)}`;
      assert.deepEqual(app.painted(step.at), colorNamed(demoSettings, step.is), where);
    }
  }
  app.dispose();
}

const { radius } = demoSettings;
const radiusSteps = Math.round((radius.max - radius.min) / radius.step);

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({ x: fc.integer({ min: 0, max: 10 }), y: fc.integer({ min: 0, max: 10 }) })
      .map(({ x, y }): Action => ({ act: "tap", at: { x: 20 * x + 5, y: 20 * y + 5 } })),
  },
  { weight: 2, arbitrary: fc.constantFrom(...demoSettings.palette.map((p) => p.label)).map((label): Action => ({ act: "color", label })) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: radiusSteps }).map((n): Action => ({ act: "radius", value: radius.min + n * radius.step })) },
  { weight: 2, arbitrary: fc.constantFrom<Action>({ act: "mode", mode: "draw" }, { act: "mode", mode: "erase" }) },
  { weight: 1, arbitrary: fc.constant<Action>({ act: "clear" }) },
);

const grid: Point[] = Array.from({ length: 121 }, (_, i) => ({ x: 20 * (i % 11) + 0.5, y: 20 * Math.floor(i / 11) + 0.5 }));

export function scenarioContract(make: () => AppFixture, reference?: () => AppFixture): void {
  describe("Scenarios", () => {
    for (const scenario of scenarios) {
      test(scenario.id, () => runScenario(make(), scenario));
    }

    test("frames.complete", async () => {
      await fc.assert(fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 25 }), async (actions) => {
        const app = make();
        for (const a of actions) {
          await app.act(a);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await app.settled();
        }
        app.dispose();
      }), { numRuns: 50 });
    });

    if (reference) {
      test("Scenario.random", async () => {
        await fc.assert(fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 25 }), async (actions) => {
          const app = make();
          const ref = reference();
          for (const a of actions) {
            await app.act(a);
            await ref.act(a);
            assert.ok(grid.every((p) => deepEqual(app.painted(p), ref.painted(p))), `the drawings differ after ${JSON.stringify(a)}`);
          }
          app.dispose();
          ref.dispose();
        }), { numRuns: 50 });
      });
    }
  });
}
