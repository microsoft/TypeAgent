// Scenario tests for the circles app: each scenario in scenarios.ts, run
// through an app driver, with the scenario's ID as the test's name. The
// driver is the only thing a platform writes for these tests: it does
// each action with the platform's own controls and reads what the drawing
// shows. When given a reference, also runs random sequences of actions on
// both and compares what the drawing shows on a grid of points after each,
// leaving out points within a unit of any of the reference's circles'
// edges, as the scenarios do, so antialiasing can't change the answer.
// The random sequences include the peer's actions and network steps, and
// end with a sync, after which both drawings must be the same
// (MessageProcessor.converges).
//
// frames.complete (frames.ts): after each action a driver processes what
// the app sent and runs the frames the app asks for, as a display would,
// then processes again, and throws, with the rule's ID in its message, if
// the model changed after the first processing. A test of that name runs
// random sequences of actions, and after each waits for a timer and asks
// the driver to check again, so that a send deferred to a timer is seen.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Action, CirclesSettings, NetStep, Scenario, Step, Who } from "./scenarios.ts";
import { demoSettings, scenarios } from "./scenarios.ts";
import { deepEqual } from "./rules.ts";

/**
 * A running circles app, as a user sees it, and a peer's app on the same
 * drawing. The driver is the message infrastructure for both: it
 * sequences what each sends, as a NetStep says, and delivers it to both.
 */
export interface Driver {
  /** Does what the user (by default) or the peer does, with that app's controls, then processes what was sent and delivered, and runs the frames asked for. */
  act(action: Action, by?: Who): Promise<void>;
  /** Changes when operations are sequenced (scenarios.ts), then settles as act does. */
  net(step: NetStep): Promise<void>;
  /**
   * Runs the frames the app asks for and processes anything it has sent
   * since its last action was settled; throws, with frames.complete in the
   * message, if that changes the model.
   */
  settled(): Promise<void>;
  /** What my drawing (by default) or the peer's shows at p, in the drawing's coordinates. */
  painted(p: Point, on?: Who): Color;
  dispose(): void;
  /**
   * My drawing's (by default) or the peer's circles, bottom to top, in the
   * drawing's coordinates. Only a reference needs it: Scenario.random uses
   * it to leave out points near an edge.
   */
  circles?(on?: Who): readonly { readonly center: Point; readonly radius: number }[];
}

/** Whether p is a unit or more from the edge of every circle: where a platform's antialiasing can't change the color. */
function clearOfEdges(p: Point, circles: readonly { readonly center: Point; readonly radius: number }[]): boolean {
  return circles.every((c) => Math.abs(Math.hypot(p.x - c.center.x, p.y - c.center.y) - c.radius) >= 1);
}

const transparent: Color = { r: 0, g: 0, b: 0, a: 0 };

function colorNamed(settings: CirclesSettings, name: string): Color {
  if (name === "transparent") return transparent;
  const entry = settings.palette.find((p) => p.label === name);
  if (!entry) throw new Error(`no palette color ${name}`);
  return entry.color;
}

/** Does one step that isn't an expectation. */
async function doStep(app: Driver, step: Exclude<Step, { expect: "painted" }>): Promise<void> {
  if ("net" in step) await app.net(step);
  else await app.act(step, step.by);
}

/** Runs one scenario on a fresh driver; throws at the first step that fails. */
export async function runScenario(app: Driver, scenario: Scenario): Promise<void> {
  for (const [i, step] of scenario.steps.entries()) {
    if (!("expect" in step)) await doStep(app, step);
    else {
      const where = `${scenario.id}, step ${i + 1}: ${JSON.stringify(step)}`;
      assert.deepEqual(app.painted(step.at, step.on), colorNamed(demoSettings, step.is), where);
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

/** Mostly my actions, some of the peer's, and network steps. */
const stepArb: fc.Arbitrary<Exclude<Step, { expect: "painted" }>> = fc.oneof(
  { weight: 6, arbitrary: actionArb },
  { weight: 2, arbitrary: actionArb.map((a) => ({ ...a, by: "peer" as const })) },
  {
    weight: 1,
    arbitrary: fc.constantFrom<NetStep>(
      { net: "hold" }, { net: "release", from: "me" }, { net: "release", from: "peer" },
      { net: "release", from: "me", count: 1 }, { net: "release", from: "peer", count: 1 }, { net: "sync" },
    ),
  },
);

const grid: Point[] = Array.from({ length: 121 }, (_, i) => ({ x: 20 * (i % 11) + 0.5, y: 20 * Math.floor(i / 11) + 0.5 }));

export function scenarioContract(make: () => Driver, reference?: () => Driver): void {
  describe("Scenarios", () => {
    for (const scenario of scenarios) {
      test(scenario.id, () => runScenario(make(), scenario));
    }

    test("frames.complete", async () => {
      await fc.assert(fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 25 }), async (steps) => {
        const app = make();
        for (const s of steps) {
          await doStep(app, s);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await app.settled();
        }
        app.dispose();
      }), { numRuns: 50 });
    });

    if (reference) {
      test("Scenario.random", async () => {
        await fc.assert(fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 25 }), async (steps) => {
          const app = make();
          const ref = reference();
          if (!ref.circles) throw new Error("a reference driver lists its circles");
          const circlesOf = ref.circles.bind(ref);
          const compare = (after: string) => {
            for (const who of ["me", "peer"] as const) {
              const circles = circlesOf(who);
              const differ = grid.filter((p) => clearOfEdges(p, circles) && !deepEqual(app.painted(p, who), ref.painted(p, who)));
              assert.deepEqual(differ, [], `${who === "me" ? "my" : "the peer's"} drawings differ after ${after}`);
            }
          };
          for (const s of steps) {
            await doStep(app, s);
            await doStep(ref, s);
            compare(JSON.stringify(s));
          }
          await app.net({ net: "sync" });
          await ref.net({ net: "sync" });
          compare("the final sync");
          const mine = circlesOf("me");
          const differ = grid.filter((p) => clearOfEdges(p, mine) && !deepEqual(app.painted(p, "me"), app.painted(p, "peer")));
          assert.deepEqual(differ, [], "MessageProcessor.converges: after the final sync, my drawing and the peer's differ");
          app.dispose();
          ref.dispose();
        }), { numRuns: 50 });
      });
    }
  });
}
