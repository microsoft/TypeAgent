// The test platform's app fixture: assembles a circles app from parts, and
// does the scenarios' actions with its controls. On the test platform an
// app's controls are methods (TestCirclesApp), and a tap is an event
// delivered to an EventDistributor (layout.ts) for the window, at the
// drawing's offset. Scenario tests use only the fixture, so they run on any
// assembly: all test doubles, one generated part among doubles, or every
// real part.
//
// The fixture is also the message infrastructure (dataModel.ts) for one
// client with no collaborators. It owns the processor: the app gets only
// the model and a LocalSend. Each operation sent is enqueued at once, and
// the stamped operation enqueue returns gets the next seq and comes back
// as its acknowledgment. Only the
// fixture calls process: after each action, and again after the frames.

import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle, Shape, ShapeId } from "./shape.ts";
import type { LocalSend } from "./dataModel.ts";
import type { ShapeCollection, ShapeMessageProcessor, ShapeOp } from "./shapeModel.ts";
import type { ShapeView } from "./shapeView.ts";
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
  /** The drawing's shapes: the processor's model. */
  readonly model: ShapeCollection;
  /** Sends a local operation to the message infrastructure. */
  readonly localSend: LocalSend<ShapeOp>;
  /** An ID for a shape this client adds. */
  readonly newShapeId: () => ShapeId;
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
  processor: (clientId: string) => ShapeMessageProcessor;
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
  const processor = makers.processor("local");
  let seq = 0;
  const localSend: LocalSend<ShapeOp> = (content) => {
    const op = processor.local.enqueue(content);
    processor.remote.enqueue({ ...op, seq: seq++ });
  };
  const newShapeId = () => processor.newShapeId();
  const scheduler = new ManualScheduler();
  const { view, painted } = makers.view(processor.model, scheduler, width, height);
  const distributor = makers.distributor(window, (event) => event.at);
  const app = makers.app({
    model: processor.model, localSend, newShapeId, view, surface, distributor, scheduler, settings, makeCircle: makers.makeCircle,
  });

  // The model: its circles, bottom to top.
  const model = () => entries(processor.model).map(([, s]: [unknown, Shape]) => {
    const c = s as Circle;
    return { center: { x: c.center.x, y: c.center.y }, radius: c.radius, color: { ...c.color } };
  });
  const runFrames = () => {
    for (let i = 0; i < 10 && scheduler.anyRequested(); i++) scheduler.runFrame();
  };
  // As a display would: after each action, process what it sent and run
  // the frames anything asks for. The action must have sent everything
  // before it returned (frames.complete), so running frames and processing
  // again, then or later, changes nothing.
  let settledModel = model();
  const recheck = async () => {
    runFrames();
    await processor.process();
    if (!deepEqual(model(), settledModel)) throw new Error("frames.complete: the model changed after an action's operations were processed");
  };
  const settle = async (action: () => void) => {
    action();
    await processor.process();
    settledModel = model();
    await recheck();
  };
  runFrames();
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
    settled: recheck,
    painted: (p) => painted(p),
    dispose: () => {
      app.dispose();
      view.dispose();
    },
  };
}
