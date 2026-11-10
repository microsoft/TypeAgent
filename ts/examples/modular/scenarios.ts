// Scenarios: named stories of what a user does in the circles app and what
// the drawing then shows, as data. An action says what the user does, not
// which control does it: each platform's fixture (scenario.contract.ts)
// does it with its own controls. An expectation is a color at a point of
// the drawing. Each scenario fixes one interpretation of the behavior
// exactly: exact order, exact positions. scenario.contract.ts runs them on
// any app through its fixture, and helpers.check.ts runs them on the
// reference app, so a scenario that disagrees with itself is found before
// any implementation exists.
//
// Points are in the drawing's coordinates: the view's surface, with (0, 0)
// at its top left. Painted points are at least a unit from every circle's
// edge, so that a platform's antialiasing can't change the answer.

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

/** is: a palette label, or "transparent". */
export type Step = Action | { expect: "painted"; at: Point; is: string };

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

const tap = (x: number, y: number): Step => ({ act: "tap", at: { x, y } });
const color = (label: string): Step => ({ act: "color", label });
const mode = (m: Mode): Step => ({ act: "mode", mode: m });
const painted = (x: number, y: number, is: string): Step => ({ expect: "painted", at: { x, y }, is });

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
];
