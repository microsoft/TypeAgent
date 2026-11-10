// Scenario tests for the circles app: each scenario in scenarios.ts, run
// through a driver (driver.ts), with the scenario's ID as the test's name.
// The driver checks window.complete after every action, and a test of that
// name runs random sequences of actions. When given a reference assembly, also runs random sequences of user
// actions on both and compares, after every action, the presented tree,
// the layer's circles and what the view shows on a grid of points.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Driver } from "./driver.ts";
import type { Scenario, Step } from "./scenarios.ts";
import { demoOptions, scenarios } from "./scenarios.ts";
import { deepEqual, keys } from "./app.vocab.ts";

const transparent: Color = { r: 0, g: 0, b: 0, a: 0 };

function colorNamed(name: string): Color {
  if (name === "transparent") return transparent;
  const entry = demoOptions.palette.find((p) => p.label === name);
  if (!entry) throw new Error(`no palette color ${name}`);
  return entry.color;
}

function describeStep(step: Step): string {
  return JSON.stringify(step);
}

/** Runs one scenario on a fresh driver; throws at the first step that fails. */
export function runScenario(driver: Driver, scenario: Scenario): void {
  scenario.steps.forEach((step, i) => {
    const where = `${scenario.id}, step ${i + 1}: ${describeStep(step)}`;
    if ("act" in step) {
      if (step.act === "tapView") driver.tapView(step.at);
      else if (step.act === "activate") driver.activate(driver.find(step.role, step.label));
      else driver.setValue(driver.find(step.role, step.label), step.value);
      return;
    }
    switch (step.expect) {
      case "painted":
        assert.deepEqual(driver.painted(step.at), colorNamed(step.is), where);
        break;
      case "value":
        assert.equal(driver.find(step.role, step.label).value, step.is, where);
        break;
      case "selected":
        assert.equal(driver.find(step.role, step.label).selected, step.is, where);
        break;
      case "enabled":
        assert.equal(driver.find(step.role, step.label).enabled, step.is, where);
        break;
    }
  });
  driver.dispose();
}

type Action = { act: "activate"; key: number } | { act: "radius"; value: number } | { act: "tap"; p: Point };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 3, arbitrary: fc.nat().map((key): Action => ({ act: "activate", key })) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 20 }).map((n): Action => ({ act: "radius", value: 2 * n })) },
  {
    weight: 4,
    arbitrary: fc.record({ x: fc.integer({ min: 0, max: 10 }), y: fc.integer({ min: 0, max: 10 }) })
      .map(({ x, y }): Action => ({ act: "tap", p: { x: 20 * x + 5, y: 20 * y + 5 } })),
  },
);

/** Does a on d. An activate picks its key from keyed's tree, so that two drivers activate the same control. */
function act(d: Driver, a: Action, keyed: Driver = d): void {
  if (a.act === "tap") d.tapView(a.p);
  else if (a.act === "radius") d.setValue(d.find("slider", "Radius"), a.value);
  else {
    const all = keys(keyed.tree());
    d.activate({ ...keyed.tree(), key: all[a.key % all.length] });
  }
}

const grid: Point[] = Array.from({ length: 121 }, (_, i) => ({ x: 20 * (i % 11) + 0.5, y: 20 * Math.floor(i / 11) + 0.5 }));

const sameCircles = (a: Driver, b: Driver) => deepEqual(
  a.circles().map((c) => ({ center: { x: c.center.x, y: c.center.y }, radius: c.radius, color: { ...c.color } })),
  b.circles().map((c) => ({ center: { x: c.center.x, y: c.center.y }, radius: c.radius, color: { ...c.color } })),
);

export function scenarioContract(make: () => Driver, reference?: () => Driver): void {
  describe("Scenarios", () => {
    for (const scenario of scenarios) {
      test(scenario.id, () => runScenario(make(), scenario));
    }

    // The driver checks the rule after every action, so the scenarios check
    // it too; this test gives it random actions under the rule's ID.
    test("window.complete", () => {
      fc.assert(fc.property(fc.array(actionArb, { minLength: 1, maxLength: 25 }), (actions) => {
        const app = make();
        for (const a of actions) act(app, a);
        app.dispose();
      }), { numRuns: 50 });
    });

    if (reference) {
      test("Scenario.random", () => {
        fc.assert(fc.property(fc.array(actionArb, { minLength: 1, maxLength: 25 }), (actions) => {
          const app = make();
          const ref = make === reference ? app : reference();
          for (const a of actions) {
            for (const d of [app, ref]) act(d, a, ref);
            assert.deepEqual(app.tree(), ref.tree(), "presented trees differ");
            assert.ok(sameCircles(app, ref), "circles differ");
            assert.ok(grid.every((p) => deepEqual(app.painted(p), ref.painted(p))), "views differ");
          }
          app.dispose();
          if (ref !== app) ref.dispose();
        }), { numRuns: 50 });
      });
    }
  });
}
