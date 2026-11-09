/**
 * Vocabulary for rule expressions about chrome.ts: what a chrome was made
 * with, the radius slider's steps, and the controls for a state, laid out
 * as chrome.ts describes. Re-exports the vocabulary of the files chrome.ts
 * imports.
 *
 * @module
 */

import type { Rectangle } from "./geometry.ts";
import type { DrawingLayer } from "./shapeView.ts";
import type { SemanticNode, Size } from "./ui.ts";
import type { Chrome, ChromeOptions, ChromeState } from "./chrome.ts";

import { cutRect, insetRect, splitRect } from "./geometry.vocab.ts";

export * from "./shapeView.vocab.ts";
export * from "./ui.vocab.ts";

/** Ghost state: the options a chrome was made with. */
export declare function options(chrome: Chrome): ChromeOptions;

/** Ghost state: the layer a chrome was made with. */
export declare function layer(chrome: Chrome): DrawingLayer;

type Range = ChromeOptions["radius"];

/** Whether v is min plus a whole number of steps. */
export function onStep(range: Range, v: number): boolean {
  return Number.isInteger((v - range.min) / range.step);
}

/** v moved to the nearest step (half a step rounds up), then into the range. */
export function snapRadius(range: Range, v: number): number {
  const steps = Math.round((v - range.min) / range.step);
  return Math.min(range.max, Math.max(range.min, range.min + steps * range.step));
}

/** What the status text shows for count items. */
export function statusText(count: number): string {
  return count === 0 ? "No circles" : count === 1 ? "1 circle" : `${count} circles`;
}

// Layout, in layout units (chrome.ts).
const toolbarHeight = 48;
const pad = 8;
const radioWidth = 64;
const sliderWidth = 160;
const buttonWidth = 72;
const statusWidth = 112;

/** The smallest window the controls fit: the toolbar's controls in a row, and a view at least 1 high. */
export function minimumSize(options: ChromeOptions): Size {
  const widths = [2 * radioWidth, options.palette.length * radioWidth, sliderWidth, buttonWidth, statusWidth];
  return { width: pad + widths.reduce((sum, w) => sum + w + pad, 0), height: toolbarHeight + 1 };
}

/** The controls for state in a window of size, as chrome.ts describes them, carved from the window's rectangle. */
export function controls(options: ChromeOptions, state: ChromeState, size: Size): SemanticNode {
  const drawing = state.mode === "draw";
  const window: Rectangle = { x: 0, y: 0, width: size.width, height: size.height };
  const [bar, viewArea] = cutRect(window, "top", toolbarHeight);
  let row = insetRect(bar, pad);
  /** The next control's rectangle, from the left of what remains of the row, with a gap after it. */
  const next = (width: number): Rectangle => {
    const [piece, rest] = cutRect(row, "left", width);
    row = cutRect(rest, "left", pad)[1];
    return piece;
  };
  const radios = (choices: { key: string; label: string; selected: boolean }[], enabled: boolean, group: Rectangle) => {
    const cells = splitRect(group, "horizontal", choices.map(() => 1));
    return choices.map((c, i): SemanticNode => ({
      role: "radio", key: c.key, label: c.label, selected: c.selected, enabled, bounds: cells[i], children: [],
    }));
  };

  const modeBounds = next(2 * radioWidth);
  const mode: SemanticNode = {
    role: "radio-group", key: "mode", label: "Mode", enabled: true, bounds: modeBounds,
    children: radios([
      { key: "mode.draw", label: "Draw", selected: drawing },
      { key: "mode.erase", label: "Erase", selected: !drawing },
    ], true, modeBounds),
  };
  const colorBounds = next(options.palette.length * radioWidth);
  const color: SemanticNode = {
    role: "radio-group", key: "color", label: "Color", enabled: drawing, bounds: colorBounds,
    children: radios(options.palette.map((p, i) => ({ key: `color.${i}`, label: p.label, selected: i === state.color })), drawing, colorBounds),
  };
  const radius: SemanticNode = {
    role: "slider", key: "radius", label: "Radius", value: state.radius,
    min: options.radius.min, max: options.radius.max, step: options.radius.step,
    enabled: drawing, bounds: next(sliderWidth), children: [],
  };
  const clear: SemanticNode = { role: "button", key: "clear", label: "Clear", enabled: state.count > 0, bounds: next(buttonWidth), children: [] };
  const status: SemanticNode = { role: "text", key: "status", label: "Status", value: statusText(state.count), enabled: true, bounds: next(statusWidth), children: [] };

  return {
    role: "group", key: "root", label: "Circles", enabled: true, bounds: window,
    children: [
      { role: "toolbar", key: "toolbar", label: "Tools", enabled: true, bounds: bar, children: [mode, color, radius, clear, status] },
      { role: "view-host", key: "view", label: "Drawing", enabled: true, bounds: viewArea, children: [] },
    ],
  };
}
