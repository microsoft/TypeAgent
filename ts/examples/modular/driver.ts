// A driver for whole-app tests: finds controls by role and label in the
// semantic tree the platform presents, acts on them as a user would, taps
// the view, and reads what the view shows. Scenario tests use only this, so
// they run on any app assembly: all test doubles, one generated part among
// doubles, or every real part.

import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle, Shape } from "./shape.ts";
import type { DrawingLayer } from "./shapeView.ts";
import type { Role, SemanticNode, Size } from "./ui.ts";
import type { Chrome, ChromeOptions, MakeCircle } from "./chrome.ts";
import type { App, AppParts } from "./app.ts";
import type { MakeShapeView } from "./shapeView.contract.ts";
import type { RendererFixture } from "./ui.contract.ts";
import type { Region, RootRegion, TapRecognizer } from "./pointer.ts";
import { byKey, controls, deepEqual, entries, nodes } from "./app.vocab.ts";
import { ManualScheduler } from "./viewkit.ts";

/** How to make each part of an app. */
export interface AppMakers {
  layer: () => DrawingLayer;
  makeCircle: MakeCircle;
  chrome: (layer: DrawingLayer, options: ChromeOptions, makeCircle: MakeCircle) => Chrome;
  view: MakeShapeView;
  renderer: () => RendererFixture;
  connect: (parts: AppParts) => App;
  /** The window's root region, which mouse events are delivered to. */
  root: (width: number, height: number) => RootRegion;
  taps: (region: Region, slop: number) => TapRecognizer;
}

/** How far, in layout units, a press may wander and still be a tap. */
export const tapSlop = 4;

export interface Driver {
  /** The tree the platform presents. */
  tree(): SemanticNode;
  /** The one node with this role and label; throws if there is none, or more than one. */
  find(role: Role, label: string): SemanticNode;
  activate(node: SemanticNode): void;
  setValue(node: SemanticNode, value: number): void;
  /** A tap on the view, at p in the view's coordinates: a press and release delivered to the window at the view's offset. */
  tapView(p: Point): void;
  /** What the view shows at p. The driver runs the frames the view asks for after every action, as a display would. */
  painted(p: Point): Color;
  /** The drawing layer's circles, bottom to top. */
  circles(): Circle[];
  dispose(): void;
}

export function makeDriver(makers: AppMakers, options: ChromeOptions, size: Size): Driver {
  const layer = makers.layer();
  const chrome = makers.chrome(layer, options, makers.makeCircle);
  const host = byKey(controls(options, chrome.state, size), "view")!.bounds;
  const scheduler = new ManualScheduler();
  const root = makers.root(size.width, size.height);
  const taps = makers.taps(root.add(host), tapSlop);
  let time = 0;
  const { view, painted } = makers.view({ layers: [layer] }, scheduler, taps, host.width, host.height);
  const fixture = makers.renderer();
  const app = makers.connect({ chrome, view, renderer: fixture.renderer, size });

  // What the user's actions have changed: the layer's circles, the chrome's state and the controls presented.
  const model = () => ({
    circles: entries(layer).map(([id, s]: [unknown, Shape]) => {
      const c = s as Circle;
      return { id, center: { x: c.center.x, y: c.center.y }, radius: c.radius, color: { ...c.color } };
    }),
    state: chrome.state,
    tree: fixture.presented(),
  });
  // As a display would: after each action, run the frames the view asks for.
  // The action must be complete before they run (window.complete).
  const settle = (action: () => void) => {
    action();
    const before = model();
    for (let i = 0; i < 10 && scheduler.isRequested(view); i++) scheduler.runFrame();
    if (!deepEqual(model(), before)) throw new Error("window.complete: running frames after an action changed the model or the controls");
  };
  settle(() => {});
  const tree = () => {
    const t = fixture.presented();
    if (!t) throw new Error("the renderer presents nothing");
    return t;
  };
  return {
    tree,
    find(role, label) {
      const found = nodes(tree()).filter((n) => n.role === role && n.label === label);
      if (found.length !== 1) throw new Error(`expected one ${role} labeled ${label}, found ${found.length}`);
      return found[0];
    },
    activate: (node) => settle(() => fixture.activate(node.key)),
    setValue: (node, value) => settle(() => fixture.setValue(node.key, value)),
    tapView: (p) => settle(() => {
      const at = { x: host.x + p.x, y: host.y + p.y };
      root.deliver("down", at, (time += 50));
      root.deliver("up", at, (time += 50));
    }),
    painted: (p) => painted(p),
    circles: () => entries(layer).map(([, s]: [unknown, Shape]) => s as Circle),
    dispose: () => app.dispose(),
  };
}
