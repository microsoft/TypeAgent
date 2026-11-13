// The test platform's app driver: assembles a circles app from parts, and
// does the scenarios' actions with its controls. On the test platform an
// app's controls are methods (TestCirclesApp), and a tap is an event
// delivered to an EventDistributor (layout.ts) for the window, at the
// drawing's offset. Scenario tests use only the driver, so they run on any
// assembly: all references, one generated part among references, or every
// real part.
//
// The driver runs two apps on one drawing, mine and a peer's, each made
// from the same parts, and is the message infrastructure (dataModel.ts)
// for both. It owns their processors: each app gets only its model and a
// LocalSend. An operation sent is enqueued on its sender's local queue at
// once; it is sequenced either then or, while the scenario holds, when a
// release or sync says (NetStep, scenarios.ts). Sequencing gives it the
// next seq and enqueues it on both processors' remote queues: its
// acknowledgment for the sender, a remote operation for the other. Each
// client's operations are sequenced in the order it sent them
// (MessageProcessor.client-order). Only the driver calls process: after
// each step, and again after the frames. An in-memory server, as Fluid's
// tinylicious is, is deferred until the collaboration protocol is
// specified; this sequencer stands in for one.

import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle, Shape, ShapeId } from "./shape.ts";
import type { LocalSend } from "./dataModel.ts";
import type { ShapeCollection, ShapeMessageProcessor, ShapeOp } from "./shapeModel.ts";
import type { ShapeView } from "./shapeView.ts";
import type { EventDistributor, LayoutObject } from "./layout.ts";
import type { FrameScheduler } from "./frames.ts";
import type { MakeShapeView } from "./shapeView.contract.ts";
import type { Driver } from "./scenario.contract.ts";
import type { CirclesSettings, Mode, NetStep, Who } from "./scenarios.ts";
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

/** One app on the drawing, with its own processor, view and distributor. */
interface Client {
  readonly processor: ShapeMessageProcessor;
  readonly app: TestCirclesApp;
  readonly view: ShapeView;
  readonly distributor: EventDistributor<TapEvents>;
  readonly scheduler: ManualScheduler;
  readonly painted: (p: Point) => Color;
  /** Operations sent while the scenario holds, not yet sequenced, in the order sent. */
  readonly held: ShapeOp[];
  /** The model as of the last settle, for frames.complete. */
  settledModel: { center: Point; radius: number; color: Color }[];
}

export function makeDriver(makers: AppMakers, settings: CirclesSettings): Driver {
  const { width, height } = settings.drawing;
  const window: Rectangle = { x: 0, y: 0, width, height: controlsHeight + height };
  const surface: LayoutObject = { region: { x: 0, y: controlsHeight, width, height } };
  let seq = 0;
  let holding = false;
  // Every held operation, in the order sent, with its sender.
  const sent: [Client, ShapeOp][] = [];

  const sequence = (op: ShapeOp) => {
    const stamped = { ...op, seq: seq++ };
    for (const c of Object.values(clients)) c.processor.remote.enqueue(stamped);
  };
  const makeClient = (clientId: string): Client => {
    const processor = makers.processor(clientId);
    const scheduler = new ManualScheduler();
    const { view, painted } = makers.view(processor.model, scheduler, width, height);
    const distributor = makers.distributor(window, (event) => event.at);
    const held: ShapeOp[] = [];
    let client: Client;
    const localSend: LocalSend<ShapeOp> = (content) => {
      const op = processor.local.enqueue(content);
      if (holding) {
        held.push(op);
        sent.push([client, op]);
      } else sequence(op);
    };
    const app = makers.app({
      model: processor.model, localSend, newShapeId: () => processor.newShapeId(), view, surface, distributor, scheduler, settings,
      makeCircle: makers.makeCircle,
    });
    client = { processor, app, view, distributor, scheduler, painted, held, settledModel: [] };
    return client;
  };
  const clients: Record<Who, Client> = { me: makeClient("me"), peer: makeClient("peer") };

  // A client's circles, bottom to top.
  const model = (c: Client) => entries(c.processor.model).map(([, s]: [unknown, Shape]) => {
    const circle = s as Circle;
    return { center: { x: circle.center.x, y: circle.center.y }, radius: circle.radius, color: { ...circle.color } };
  });
  const runFrames = (c: Client) => {
    for (let i = 0; i < 10 && c.scheduler.anyRequested(); i++) c.scheduler.runFrame();
  };
  const processAll = async () => {
    for (const c of Object.values(clients)) await c.processor.process();
  };
  // As a display would: after each step, process what was sent and
  // delivered, and run the frames anything asks for. The step must have
  // sent everything before it returned (frames.complete), so running frames
  // and processing again, then or later, changes neither model.
  const recheck = async () => {
    for (const c of Object.values(clients)) runFrames(c);
    await processAll();
    for (const c of Object.values(clients)) {
      if (!deepEqual(model(c), c.settledModel)) throw new Error("frames.complete: the model changed after an action's operations were processed");
    }
  };
  const settle = async (step: () => void) => {
    step();
    await processAll();
    for (const c of Object.values(clients)) c.settledModel = model(c);
    await recheck();
  };
  // Sequences held operations that match which, in the order they were sent: the first count of them, or all.
  const releaseHeld = (which: (c: Client) => boolean, count = Infinity) => {
    for (const [c, op] of sent.filter(([c]) => which(c)).slice(0, count)) {
      sequence(op);
      c.held.splice(c.held.indexOf(op), 1);
      sent.splice(sent.findIndex(([, o]) => o === op), 1);
    }
  };
  for (const c of Object.values(clients)) runFrames(c);

  return {
    act: (a, by = "me") => settle(() => {
      const { app, distributor } = clients[by];
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
    net: (step: NetStep) => settle(() => {
      if (step.net === "hold") holding = true;
      else if (step.net === "release") releaseHeld((c) => c === clients[step.from], step.count);
      else {
        releaseHeld(() => true);
        holding = false;
      }
    }),
    settled: recheck,
    painted: (p, on = "me") => clients[on].painted(p),
    circles: (on = "me") => model(clients[on]),
    dispose: () => {
      for (const c of Object.values(clients)) {
        c.app.dispose();
        c.view.dispose();
      }
    },
  };
}
