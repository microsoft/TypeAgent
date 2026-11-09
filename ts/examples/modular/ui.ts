/**
 * Platform-neutral user interface: what controls a window shows, described
 * as a semantic tree, and a renderer that presents a tree with its
 * platform's own widgets and reports what the user does with them.
 *
 * The tree is what accessibility APIs expose (ARIA on the web,
 * UIAccessibility on iOS, AccessibilityNodeInfo on Android) and what UI
 * tests find controls by: role, label, state and bounds. So every platform
 * can report the tree it presents, and tests written against trees run on
 * any platform. presented(renderer) (ui.vocab.ts) is that tree, as the
 * contract's fixture reads it from the platform.
 *
 * Bounds are in layout units, the platform's density-independent unit:
 * CSS pixels, iOS points, Android dp. They are relative to the window's top
 * left, not to the parent. How a control looks beyond its bounds and state
 * (fonts, colors, native styling) is the platform's, and outside the rules.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

import type { Rectangle } from "./geometry.ts";
import type { Emitter } from "./events.ts";

/** A size in layout units. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * What a node is. group, toolbar and radio-group contain other nodes; a
 * radio-group contains only radios. view-host is the area where a view's
 * surface goes; the renderer leaves it empty for the app to fill.
 */
export type Role = "group" | "toolbar" | "radio-group" | "radio" | "slider" | "button" | "text" | "view-host";

/**
 * One control or container. Fields that don't apply to a role are absent,
 * not undefined. A tree is plain data: comparing two trees with deepEqual
 * says whether they present the same thing.
 *
 * @invariant well-formed  Each node has exactly the fields its role uses, as wellFormed (ui.vocab.ts) checks: value, min, max and step on a slider, with step > 0 and min <= value <= max, value being min plus a whole number of steps; value as a string on text; selected on a radio; children only on group, toolbar and radio-group, and only radios in a radio-group.
 *   wellFormed(this)
 * @invariant unique-keys  Keys are unique within the tree.
 *   unique(keys(this))
 * @invariant inside  Each child's bounds lie within its parent's.
 *   nodes(this).every((n) => n.children.every((c) => within(c.bounds, n.bounds)))
 * @invariant disjoint  Siblings' bounds don't overlap, so every point of the window belongs to one path from the root, and a platform's hit testing finds the same node as pointer routing (pointer.ts).
 *   nodes(this).every((n) => n.children.every((a, i) => n.children.every((b, j) => j <= i || !rectIntersects(a.bounds, b.bounds))))
 */
export interface SemanticNode {
  readonly role: Role;
  /** Names the node across renders: the same control has the same key in every tree. */
  readonly key: string;
  /** The accessible name: what a screen reader announces, and what tests find a control by. */
  readonly label: string;
  /** A slider's number, or the text a text node shows. */
  readonly value?: number | string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Whether a radio is the chosen one in its group. */
  readonly selected?: boolean;
  /** Whether the user can act on the control. A container's children are separate controls with their own enabled. */
  readonly enabled: boolean;
  readonly bounds: Rectangle;
  readonly children: readonly SemanticNode[];
}

/** What the user did with a control, named by the control's key. */
export type UiEvent =
  | { readonly kind: "activate"; readonly key: string }
  | { readonly kind: "set-value"; readonly key: string; readonly value: number };

/**
 * Presents a semantic tree with the platform's widgets, and reports what the
 * user does with them. It knows nothing of what the controls mean: whoever
 * listens to input decides that, and renders a new tree when anything
 * changes.
 *
 * The user's actions are the fixture's (ui.contract.ts): activating a
 * control, or setting a slider to a value within its range on one of its
 * steps, the way the platform's own input would.
 *
 * @ensures starts-empty  Presents nothing until the first render.
 *   presented(this) === undefined
 * @ensures reports  When the user activates an enabled button, or an enabled radio that isn't selected, emits input once with kind activate and the control's key; when the user sets an enabled slider to a value, emits input once with kind set-value, its key and that value. Each before the user's action completes.
 * @ensures silent  Emits nothing for any other action: on a disabled control, on a selected radio, or on a node that isn't a button, radio or slider.
 * @ensures stable  A node whose key is in both the old tree and the new one, with the same role, stays the same platform widget across a render, so that focus and a drag in progress survive it.
 */
export interface Renderer extends Emitter<{ input: [UiEvent] }> {
  /**
   * Presents tree, replacing what was presented.
   *
   * @requires well-formed  tree holds SemanticNode's invariants.
   * @ensures presents  Afterward, the platform presents exactly tree.
   *   deepEqual(presented(this), tree)
   * @ensures quiet  Emits nothing.
   */
  render(tree: SemanticNode): void;

  /**
   * Removes what it presents and stops reporting. Calling it again does
   * nothing.
   *
   * @ensures removes  Afterward, presents nothing, emits nothing, and later renders do nothing.
   */
  dispose(): void;
}
