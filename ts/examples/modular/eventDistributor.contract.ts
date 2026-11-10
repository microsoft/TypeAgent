// Contract tests for EventDistributor (layout.ts). Every implementation runs
// this suite through a function that makes a distributor for a region and a
// locate function. Test names are rule IDs.
//
// The test platform has two event names, a and b; an event is a point and a
// serial number. Each case is one event in a fixed scene, the listeners it
// must reach in order, and what distribute must return. The cases cover the
// ways an event can miss: outside every target, in a target for another
// name only, on a right or bottom edge, in the excepted target only, in a
// target whose registrations were removed, and where a target was before it
// moved. They also cover the hits: innermost of nested targets, a target
// for another name nested inside, and except passing the event outward.
// Each test runs the cases tagged with its rule ID.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Point, Rectangle } from "./geometry.ts";
import type { EventDistributor, LayoutObject } from "./layout.ts";
import "./testkit.ts";

/** One of the test platform's events. */
export interface TestEvent {
  readonly at: Point;
  readonly serial: number;
}
export type TestEvents = { a: TestEvent; b: TestEvent };
type Name = keyof TestEvents;

/** Makes a distributor for region that finds an event's point with locate. */
export type MakeDistributor = (region: Rectangle, locate: (event: TestEvent) => Point) => EventDistributor<TestEvents>;

const region: Rectangle = { x: 0, y: 0, width: 12, height: 12 };

/** The scene: targets, and the listeners registered on them, which log their names. */
interface Scene {
  distributor: EventDistributor<TestEvents>;
  targets: LayoutObject[];
  log: { listener: string; name: Name; event: TestEvent }[];
}

//   T0 {0,0,8,8}   a: o, o, r    outer; o registered twice
//   T1 {2,2,3,3}   a: i0, i1     inner, within T0
//   T2 {5,5,2,2}   b: b          within T0, for b only
//   T3 {9,6,3,3}   a: r, removed with off; r's registration on T0 stays
//   T4 {9,9,2,2}   a: e
function scene(make: MakeDistributor): Scene {
  const distributor = make({ ...region }, (event) => event.at);
  const rects: Rectangle[] = [
    { x: 0, y: 0, width: 8, height: 8 },
    { x: 2, y: 2, width: 3, height: 3 },
    { x: 5, y: 5, width: 2, height: 2 },
    { x: 9, y: 6, width: 3, height: 3 },
    { x: 9, y: 9, width: 2, height: 2 },
  ];
  const targets: LayoutObject[] = rects.map((r) => ({ region: r }));
  const log: Scene["log"] = [];
  const listener = (label: string) => (name: Name, event: TestEvent) => log.push({ listener: label, name, event });
  const [o, r, i0, i1, b, e] = ["o", "r", "i0", "i1", "b", "e"].map(listener);
  distributor.on("a", o, targets[0]);
  distributor.on("a", o, targets[0]);
  distributor.on("a", i0, targets[1]);
  distributor.on("a", i1, targets[1]);
  distributor.on("b", b, targets[2]);
  distributor.on("a", r, targets[3]);
  distributor.on("a", r, targets[0]);
  distributor.off("a", r, targets[3]);
  distributor.on("a", e, targets[4]);
  return { distributor, targets, log };
}

interface Case {
  what: string;
  rules: string[];
  name: Name;
  at: Point;
  except?: number;
  /** Changes the scene before the event. */
  prepare?: (s: Scene) => void;
  calls: string[];
  returned: boolean;
}

const innermost = "EventDistributor.distribute.innermost";
const onlyEnclosed = "EventDistributor.distribute.only-enclosed";
const reports = "EventDistributor.distribute.reports";
const registers = "EventDistributor.on.registers";
const removesOne = "EventDistributor.off.removes-one";
const liveRegions = "EventDistributor.live-regions";
const moveT4 = (s: Scene) => (s.targets[4].region = { x: 6, y: 9, width: 2, height: 2 });

const cases: Case[] = [
  // Hits.
  { what: "nested targets: the inner one, its listeners in order", rules: [innermost, reports],
    name: "a", at: { x: 3, y: 3 }, calls: ["i0", "i1"], returned: true },
  { what: "outer target only: each registration, duplicates included", rules: [innermost, registers, removesOne, reports],
    name: "a", at: { x: 1, y: 1 }, calls: ["o", "o", "r"], returned: true },
  { what: "on the inner target's right edge: the outer one", rules: [innermost],
    name: "a", at: { x: 5, y: 3 }, calls: ["o", "o", "r"], returned: true },
  { what: "on the inner target's bottom edge: the outer one", rules: [innermost],
    name: "a", at: { x: 3, y: 5 }, calls: ["o", "o", "r"], returned: true },
  { what: "a target for another name nested inside doesn't take it", rules: [innermost],
    name: "a", at: { x: 5, y: 5 }, calls: ["o", "o", "r"], returned: true },
  { what: "except skips the inner target, so the outer one takes it", rules: [innermost, reports],
    name: "a", at: { x: 3, y: 3 }, except: 1, calls: ["o", "o", "r"], returned: true },
  { what: "after a move: the target at its new region", rules: [liveRegions],
    name: "a", at: { x: 6, y: 9 }, prepare: moveT4, calls: ["e"], returned: true },
  // Misses.
  { what: "outside every target", rules: [onlyEnclosed, reports],
    name: "a", at: { x: 11, y: 4 }, calls: [], returned: false },
  { what: "outside the distributor's region", rules: [onlyEnclosed, reports],
    name: "a", at: { x: -1, y: -1 }, calls: [], returned: false },
  { what: "in targets for the other name only", rules: [onlyEnclosed, reports],
    name: "b", at: { x: 1, y: 1 }, calls: [], returned: false },
  { what: "on a target's right edge", rules: [innermost, onlyEnclosed],
    name: "a", at: { x: 11, y: 9 }, calls: [], returned: false },
  { what: "on a target's bottom edge", rules: [innermost, onlyEnclosed],
    name: "a", at: { x: 9, y: 11 }, calls: [], returned: false },
  { what: "in the excepted target only", rules: [innermost, onlyEnclosed, reports],
    name: "a", at: { x: 9, y: 9 }, except: 4, calls: [], returned: false },
  { what: "in a target whose registrations were removed", rules: [removesOne, onlyEnclosed, reports],
    name: "a", at: { x: 10, y: 7 }, calls: [], returned: false },
  { what: "where a target was before it moved", rules: [liveRegions],
    name: "a", at: { x: 9, y: 9 }, prepare: moveT4, calls: [], returned: false },
];

/** Runs a case on a new scene and checks the calls, the event each got, and the result. */
function check(make: MakeDistributor, c: Case, detached: boolean): void {
  const s = scene(make);
  c.prepare?.(s);
  const event: TestEvent = { at: c.at, serial: 0 };
  const except = c.except === undefined ? undefined : s.targets[c.except];
  const distribute = s.distributor.distribute;
  const returned = detached ? distribute(c.name, event, except) : s.distributor.distribute(c.name, event, except);
  assert.deepEqual(s.log.map((l) => l.listener), c.calls, c.what);
  assert.ok(s.log.every((l) => l.name === c.name && l.event === event), `${c.what}: each listener gets the name and the event unchanged`);
  assert.equal(returned, c.returned, `${c.what}: returns ${c.returned}`);
}

export function eventDistributorContract(make: MakeDistributor): void {
  const rule = (id: string) =>
    test(id, () => {
      for (const c of cases.filter((c) => c.rules.includes(id))) check(make, c, false);
    });

  describe("EventDistributor", () => {
    rule(registers);
    rule(removesOne);
    rule(innermost);
    rule(onlyEnclosed);
    rule(reports);
    rule(liveRegions);

    test("EventDistributor.distribute.detached", () => {
      for (const c of cases) check(make, c, true);
    });

    // Repeated registrations interleaved on one target, where removing the wrong copy changes the order.
    test(removesOne, () => {
      fc.assert(fc.property(
        fc.array(fc.nat({ max: 1 }), { minLength: 2, maxLength: 6 }), fc.nat({ max: 1 }),
        (sequence, removed) => {
          const target: LayoutObject = { region: { x: 2, y: 2, width: 4, height: 4 } };
          const distributor = make({ ...region }, (event) => event.at);
          const calls: number[] = [];
          const listeners = [0, 1].map((i) => () => calls.push(i));
          for (const i of sequence) distributor.on("a", listeners[i], target);
          distributor.off("a", listeners[removed], target);
          distributor.distribute("a", { at: { x: 3, y: 3 }, serial: 0 });
          const last = sequence.lastIndexOf(removed);
          assert.deepEqual(calls, last < 0 ? sequence : sequence.filter((_, k) => k !== last));
        },
      ));
    });

    test("EventDistributor.snapshot", () => {
      // The first listener, when called, removes the second and adds a third.
      const target: LayoutObject = { region: { x: 2, y: 2, width: 4, height: 4 } };
      const distributor = make({ ...region }, (event) => event.at);
      const calls: string[] = [];
      const second = () => calls.push("second");
      const third = () => calls.push("third");
      const first = () => {
        calls.push("first");
        distributor.off("a", second, target);
        distributor.on("a", third, target);
      };
      distributor.on("a", first, target);
      distributor.on("a", second, target);
      distributor.distribute("a", { at: { x: 3, y: 3 }, serial: 0 });
      assert.deepEqual(calls, ["first", "second"], "removed during the call: still called; added: not called");
      calls.length = 0;
      distributor.distribute("a", { at: { x: 3, y: 3 }, serial: 1 });
      assert.deepEqual(calls, ["first", "third"], "the next call sees the changes");
    });
  });
}
