// The test platform's app fixture: assembles a circles app from parts, and
// does the scenarios' actions with its controls. On the test platform an
// app's controls are methods (TestCirclesApp), and a tap is an event
// delivered to an EventDistributor (layout.ts) for the window, at the
// drawing's offset. Scenario tests use only the fixture, so they run on any
// assembly: all test doubles, one generated part among doubles, or every
// real part.

import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle, Shape } from "./shape.ts";
import type { DrawingGroup, ShapeView } from "./shapeView.ts";
import type { EventDistributor, LayoutObject } from "./layout.ts";
import type { FrameScheduler } from "./frames.ts";
import type { MakeShapeView } from "./shapeView.contract.ts";
import type { AppFixture } from "./scenario.contract.ts";
import type { CirclesSettings, Mode } from "./scenarios.ts";
import { deepEqual, entries } from "./rules.ts";
import { ManualScheduler } from "./viewkit.ts";

/** The test platform's one event: a tap, at a point in the window's coordinates. */
export interface TapEvent {
  readonly at: Point;
}
export type TapEvents = { tap: TapEvent };

/** Makes circles, as makeCircle in circle.ts does. */
export type MakeCircle = (fields: { center: Point; radius: number; color: Color }) => Circle;

/** What a circles app is made with. */
export interface CirclesParts {
  readonly group: DrawingGroup;
  readonly view: ShapeView;
  /** Where the view's surface is, in the window. */
  readonly surface: LayoutObject;
  readonly distributor: EventDistributor<TapEvents>;
  readonly scheduler: FrameScheduler;
  readonly settings: CirclesSettings;
  readonly makeCircle: MakeCircle;
}

/** A circles app on the test platform: its controls are these methods. */
export interface TestCirclesApp {
  color(label: string): void;
  radius(value: number): void;
  mode(mode: Mode): void;
  clear(): void;
  dispose(): void;
}

/** How to make each part of an app. */
export interface AppMakers {
  group: () => DrawingGroup;
  makeCircle: MakeCircle;
  view: MakeShapeView;
  distributor: (region: Rectangle, locate: (event: TapEvent) => Point) => EventDistributor<TapEvents>;
  app: (parts: CirclesParts) => TestCirclesApp;
}

/** The height of the window above the drawing, where a platform would put its controls. */
const controlsHeight = 48;

export function makeFixture(makers: AppMakers, settings: CirclesSettings): AppFixture {
  const { width, height } = settings.drawing;
  const window: Rectangle = { x: 0, y: 0, width, height: controlsHeight + height };
  const surface: LayoutObject = { region: { x: 0, y: controlsHeight, width, height } };
  const group = makers.group();
  const scheduler = new ManualScheduler();
  const { view, painted } = makers.view({ groups: [group] }, scheduler, width, height);
  const distributor = makers.distributor(window, (event) => event.at);
  const app = makers.app({ group, view, surface, distributor, scheduler, settings, makeCircle: makers.makeCircle });

  // The model: the group's circles, bottom to top.
  const model = () => entries(group).map(([, s]: [unknown, Shape]) => {
    const c = s as Circle;
    return { center: { x: c.center.x, y: c.center.y }, radius: c.radius, color: { ...c.color } };
  });
  // As a display would: after each action, run the frames anything asks
  // for. The action must be complete before they run (frames.complete).
  const settle = (action: () => void) => {
    action();
    const before = model();
    for (let i = 0; i < 10 && scheduler.anyRequested(); i++) scheduler.runFrame();
    if (!deepEqual(model(), before)) throw new Error("frames.complete: running frames after an action changed the model");
  };
  settle(() => {});
  return {
    act: (a) => settle(() => {
      switch (a.act) {
        case "tap":
          distributor.distribute("tap", { at: { x: surface.region.x + a.at.x, y: surface.region.y + a.at.y } });
          break;
        case "color":
          app.color(a.label);
          break;
        case "radius":
          app.radius(a.value);
          break;
        case "mode":
          app.mode(a.mode);
          break;
        case "clear":
          app.clear();
          break;
      }
    }),
    painted: (p) => painted(p),
    dispose: () => {
      app.dispose();
      view.dispose();
    },
  };
}
