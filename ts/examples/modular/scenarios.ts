// Scenarios: named stories of what a user does in the circles app and what
// they see, as data. Each one fixes one interpretation of the rules exactly:
// exact text, exact order, exact positions. scenario.contract.ts runs them
// on any app assembly through a driver (driver.ts), and helpers.check.ts
// runs them on the reference assembly, so a scenario that disagrees with
// the rules is found before any implementation exists.
//
// Points are in the view's coordinates. Painted points are at least a unit
// from every circle's edge, so that a platform's antialiasing can't change
// the answer.

import type { Point } from "./geometry.ts";
import type { Role, Size } from "./ui.ts";
import type { ChromeOptions } from "./chrome.ts";

export type Step =
  | { act: "activate"; role: Role; label: string }
  | { act: "setValue"; role: Role; label: string; value: number }
  | { act: "tapView"; at: Point }
  | { expect: "value"; role: Role; label: string; is: string | number }
  | { expect: "selected"; role: Role; label: string; is: boolean }
  | { expect: "enabled"; role: Role; label: string; is: boolean }
  /** is: a palette label, or "transparent". */
  | { expect: "painted"; at: Point; is: string };

export interface Scenario {
  id: string;
  story: string;
  steps: Step[];
}

/** The options and window size scenarios run with, and the demo page uses. */
export const demoOptions: ChromeOptions = {
  palette: [
    { label: "Red", color: { r: 220, g: 40, b: 40, a: 1 } },
    { label: "Blue", color: { r: 40, g: 90, b: 220, a: 1 } },
    { label: "Green", color: { r: 30, g: 160, b: 70, a: 1 } },
  ],
  radius: { min: 2, max: 40, step: 2, initial: 10 },
};
export const demoSize: Size = { width: 800, height: 600 };

const tap = (x: number, y: number): Step => ({ act: "tapView", at: { x, y } });
const radio = (label: string): Step => ({ act: "activate", role: "radio", label });
const status = (is: string): Step => ({ expect: "value", role: "text", label: "Status", is });
const painted = (x: number, y: number, is: string): Step => ({ expect: "painted", at: { x, y }, is });
const selected = (label: string, is: boolean): Step => ({ expect: "selected", role: "radio", label, is });
const enabled = (role: Role, label: string, is: boolean): Step => ({ expect: "enabled", role, label, is });

export const scenarios: Scenario[] = [
  {
    id: "Scenario.starts",
    story: "A new window is in draw mode with the first color and the initial radius, and shows nothing.",
    steps: [
      selected("Draw", true), selected("Red", true),
      { expect: "value", role: "slider", label: "Radius", is: 10 },
      status("No circles"), enabled("button", "Clear", false), painted(100, 100, "transparent"),
    ],
  },
  {
    id: "Scenario.draw-one",
    story: "A tap draws a circle of the current color and radius centered where it landed.",
    steps: [
      tap(100, 100),
      status("1 circle"), enabled("button", "Clear", true),
      painted(100, 100, "Red"), painted(100, 108, "Red"), painted(100, 112, "transparent"), painted(89, 100, "transparent"),
    ],
  },
  {
    id: "Scenario.color-and-radius",
    story: "Choosing a color and a radius changes what the next tap draws.",
    steps: [
      radio("Blue"), { act: "setValue", role: "slider", label: "Radius", value: 20 }, tap(200, 200),
      selected("Blue", true), selected("Red", false), { expect: "value", role: "slider", label: "Radius", is: 20 },
      painted(218, 200, "Blue"), painted(222, 200, "transparent"),
    ],
  },
  {
    id: "Scenario.erase-top-of-overlap",
    story: "Two overlapping circles; erasing where they overlap removes only the top one.",
    steps: [
      tap(40, 40), radio("Blue"), tap(50, 40), status("2 circles"), painted(45, 40, "Blue"),
      radio("Erase"), tap(45, 40),
      status("1 circle"), painted(45, 40, "Red"), painted(35, 40, "Red"), painted(55, 40, "transparent"),
    ],
  },
  {
    id: "Scenario.erase-misses",
    story: "Erasing where there is no circle changes nothing.",
    steps: [tap(100, 100), radio("Erase"), tap(300, 300), status("1 circle"), painted(100, 100, "Red")],
  },
  {
    id: "Scenario.erase-disables-drawing-controls",
    story: "In erase mode the color and radius controls are disabled and do nothing; back in draw mode they work again.",
    steps: [
      radio("Erase"),
      enabled("radio", "Red", false), enabled("radio", "Blue", false), enabled("slider", "Radius", false),
      radio("Blue"), selected("Red", true), selected("Blue", false),
      radio("Draw"), enabled("radio", "Blue", true), radio("Blue"), selected("Blue", true),
    ],
  },
  {
    id: "Scenario.clear",
    story: "Clear removes every circle, and is disabled when there is nothing to clear.",
    steps: [
      tap(50, 50), tap(150, 50), tap(250, 50), status("3 circles"),
      { act: "activate", role: "button", label: "Clear" },
      status("No circles"), enabled("button", "Clear", false),
      painted(50, 50, "transparent"), painted(150, 50, "transparent"), painted(250, 50, "transparent"),
    ],
  },
  {
    id: "Scenario.clear-in-erase-mode",
    story: "Clear works in erase mode too.",
    steps: [tap(50, 50), tap(150, 50), radio("Erase"), { act: "activate", role: "button", label: "Clear" }, status("No circles")],
  },
  {
    id: "Scenario.draw-after-erase-is-on-top",
    story: "After erasing, a new circle goes on top of what is left.",
    steps: [
      tap(40, 40), radio("Blue"), tap(50, 40), radio("Erase"), tap(45, 40),
      radio("Draw"), radio("Green"), tap(50, 40),
      painted(45, 40, "Green"), painted(35, 40, "Red"), status("2 circles"),
    ],
  },
];
