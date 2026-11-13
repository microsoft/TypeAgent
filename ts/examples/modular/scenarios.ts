// Scenarios: named stories of what a user does in the circles app and what
// the drawing then shows, as data. They are the app's behavior. An action
// says what the user does, not which control does it: each platform does
// it with its own controls. An expectation is a color at a point of the
// drawing. Each scenario fixes one interpretation of the behavior exactly:
// exact order, exact positions.
//
// Two people can draw on one drawing: "me", and a "peer" with an app of
// their own. Steps are mine unless they say by: "peer", and an expectation
// reads my drawing unless it says on: "peer". Network steps say when the
// collaboration protocol sequences operations, so a scenario can make
// operations pending and choose the order they are sequenced in.
//
// Points are in the drawing's coordinates: the view's surface, with (0, 0)
// at its top left. A tap with a negative y lands above the drawing, where a
// platform puts its controls. Painted points are at least a unit from every
// circle's edge, so that a platform's antialiasing can't change the answer.

import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";

export type Mode = "draw" | "erase";

/** What the user does. */
export type Action =
  /** In draw mode, draws a circle centered at the point; in erase mode, erases the topmost circle there. */
  | { act: "tap"; at: Point }
  /** Chooses the color, by its label, that later circles are drawn with. */
  | { act: "color"; label: string }
  /** Chooses the radius later circles are drawn with: one of the settings' radius steps. */
  | { act: "radius"; value: number }
  | { act: "mode"; mode: Mode }
  /** Erases every circle. */
  | { act: "clear" };

/** Whose app does an action, or whose drawing an expectation reads. */
export type Who = "me" | "peer";

/**
 * When operations are sequenced. Until hold, each operation is sequenced
 * as it is sent. After hold, operations are applied by the app that sent
 * them but not sequenced: release sequences one app's held operations in
 * the order it sent them (its first count of them, if count is given),
 * and delivers them to both apps; sync sequences
 * every held operation in the order sent, and stops holding.
 */
export type NetStep = { net: "hold" } | { net: "release"; from: Who; count?: number } | { net: "sync" };

/** is: a palette label, or "transparent". */
export type Step =
  | (Action & { by?: Who })
  | NetStep
  | { expect: "painted"; at: Point; is: string; on?: Who };

export interface Scenario {
  id: string;
  story: string;
  steps: Step[];
}

/**
 * What the app offers. It starts in draw mode, with the palette's first
 * color and the initial radius. Radii run from min to max in steps of step.
 */
export interface CirclesSettings {
  readonly palette: readonly { readonly label: string; readonly color: Color }[];
  readonly radius: { readonly min: number; readonly max: number; readonly step: number; readonly initial: number };
  /** The drawing's size, in layout units. */
  readonly drawing: { readonly width: number; readonly height: number };
}

/** The settings scenarios run with, and the demo page uses. */
export const demoSettings: CirclesSettings = {
  palette: [
    { label: "Red", color: { r: 220, g: 40, b: 40, a: 1 } },
    { label: "Blue", color: { r: 40, g: 90, b: 220, a: 1 } },
    { label: "Green", color: { r: 30, g: 160, b: 70, a: 1 } },
  ],
  radius: { min: 2, max: 40, step: 2, initial: 10 },
  drawing: { width: 800, height: 552 },
};

const tap = (x: number, y: number): Action => ({ act: "tap", at: { x, y } });
const color = (label: string): Action => ({ act: "color", label });
const mode = (m: Mode): Action => ({ act: "mode", mode: m });
const painted = (x: number, y: number, is: string): Step => ({ expect: "painted", at: { x, y }, is });
const peer = (step: Action): Step => ({ ...step, by: "peer" });
const onPeer = (x: number, y: number, is: string): Step => ({ expect: "painted", at: { x, y }, is, on: "peer" });
const hold: Step = { net: "hold" };
const release = (from: Who): Step => ({ net: "release", from });

export const scenarios: Scenario[] = [
  {
    id: "Scenario.starts",
    story: "A new drawing shows nothing.",
    steps: [painted(100, 100, "transparent"), painted(5, 5, "transparent"), painted(795, 547, "transparent")],
  },
  {
    id: "Scenario.draw-one",
    story: "A tap draws a circle of the first color and the initial radius, centered where it landed.",
    steps: [
      tap(100, 100),
      painted(100, 100, "Red"), painted(100, 108, "Red"), painted(100, 112, "transparent"), painted(89, 100, "transparent"),
    ],
  },
  {
    id: "Scenario.color-and-radius",
    story: "Choosing a color and a radius changes what the next tap draws.",
    steps: [
      color("Blue"), { act: "radius", value: 20 }, tap(200, 200),
      painted(218, 200, "Blue"), painted(222, 200, "transparent"),
    ],
  },
  {
    id: "Scenario.largest-radius",
    story: "The largest radius draws a circle that large.",
    steps: [{ act: "radius", value: 40 }, tap(100, 100), painted(100, 138, "Red"), painted(100, 142, "transparent")],
  },
  {
    id: "Scenario.settings-kept-through-erase",
    story: "Erasing and going back to drawing keeps the chosen color and radius.",
    steps: [
      color("Green"), { act: "radius", value: 4 }, mode("erase"), tap(60, 60), mode("draw"), tap(60, 60),
      painted(60, 62, "Green"), painted(60, 66, "transparent"),
    ],
  },
  {
    id: "Scenario.erase-top-of-overlap",
    story: "Two overlapping circles; erasing where they overlap removes only the top one.",
    steps: [
      tap(40, 40), color("Blue"), tap(50, 40), painted(45, 40, "Blue"),
      mode("erase"), tap(45, 40),
      painted(45, 40, "Red"), painted(35, 40, "Red"), painted(55, 40, "transparent"),
    ],
  },
  {
    id: "Scenario.tap-outside",
    story: "A tap above the drawing, where the controls are, draws nothing, even where its circle would reach into the drawing.",
    steps: [tap(100, -5), painted(100, 2, "transparent"), painted(100, 4, "transparent")],
  },
  {
    id: "Scenario.erase-misses",
    story: "Erasing where there is no circle changes nothing.",
    steps: [tap(100, 100), mode("erase"), tap(300, 300), painted(100, 100, "Red")],
  },
  {
    id: "Scenario.clear",
    story: "Clear erases every circle.",
    steps: [
      tap(50, 50), tap(150, 50), tap(250, 50), { act: "clear" },
      painted(50, 50, "transparent"), painted(150, 50, "transparent"), painted(250, 50, "transparent"),
    ],
  },
  {
    id: "Scenario.clear-in-erase-mode",
    story: "Clear works in erase mode too.",
    steps: [tap(50, 50), tap(150, 50), mode("erase"), { act: "clear" }, painted(50, 50, "transparent"), painted(150, 50, "transparent")],
  },
  {
    id: "Scenario.draw-after-erase-is-on-top",
    story: "After erasing, a new circle goes on top of what is left.",
    steps: [
      tap(40, 40), color("Blue"), tap(50, 40), mode("erase"), tap(45, 40),
      mode("draw"), color("Green"), tap(50, 40),
      painted(45, 40, "Green"), painted(35, 40, "Red"),
    ],
  },
  {
    id: "Scenario.peer-draw-shows",
    story: "A circle the peer draws shows in my drawing too.",
    steps: [peer(tap(100, 100)), painted(100, 100, "Red"), onPeer(100, 100, "Red")],
  },
  {
    id: "Scenario.remote-under-pending",
    story: "While my circle is pending, the peer's overlapping circle arrives and goes under it; once mine is sequenced, it is on top in both drawings.",
    steps: [
      hold, tap(40, 40), peer(color("Blue")), peer(tap(48, 40)),
      painted(44, 40, "Red"), painted(55, 40, "transparent"), onPeer(44, 40, "Blue"), onPeer(35, 40, "transparent"),
      release("peer"),
      painted(44, 40, "Red"), painted(55, 40, "Blue"), onPeer(44, 40, "Blue"),
      release("me"),
      painted(44, 40, "Red"), onPeer(44, 40, "Red"), onPeer(35, 40, "Red"),
    ],
  },
  {
    id: "Scenario.concurrent-overlap-converges",
    story: "Two overlapping circles drawn at once: whichever is sequenced later ends on top, in both drawings.",
    steps: [
      hold, tap(40, 40), peer(color("Blue")), peer(tap(48, 40)),
      release("me"),
      painted(44, 40, "Red"), onPeer(44, 40, "Blue"), onPeer(35, 40, "Red"),
      release("peer"),
      painted(44, 40, "Blue"), onPeer(44, 40, "Blue"), painted(35, 40, "Red"),
    ],
  },
  {
    id: "Scenario.clear-keeps-unseen",
    story: "Clear erases only the circles I had seen: one the peer drew that hadn't reached me survives.",
    steps: [
      tap(40, 40), hold, peer(tap(100, 100)), { act: "clear" },
      painted(40, 40, "transparent"), onPeer(100, 100, "Red"),
      release("peer"), release("me"),
      painted(100, 100, "Red"), onPeer(100, 100, "Red"), onPeer(40, 40, "transparent"),
    ],
  },
  {
    id: "Scenario.clear-erases-own-pending",
    story: "Clear erases my own circle even while it is still pending.",
    steps: [hold, tap(60, 60), { act: "clear" }, painted(60, 60, "transparent"), { net: "sync" }, painted(60, 60, "transparent"), onPeer(60, 60, "transparent")],
  },
  {
    id: "Scenario.pending-stack-in-order",
    story: "My circles stay in the order I drew them while pending, while some are sequenced, and once all are.",
    steps: [
      hold, tap(40, 40), color("Blue"), tap(48, 40), painted(44, 40, "Blue"),
      { net: "release", from: "me", count: 1 }, painted(44, 40, "Blue"), onPeer(44, 40, "Red"),
      release("me"), painted(44, 40, "Blue"), onPeer(44, 40, "Blue"), onPeer(35, 40, "Red"),
    ],
  },
  {
    id: "Scenario.clear-removes-seen",
    story: "Clear erases a circle the peer drew once it has reached me.",
    steps: [peer(tap(100, 100)), painted(100, 100, "Red"), { act: "clear" }, painted(100, 100, "transparent"), onPeer(100, 100, "transparent")],
  },
];
