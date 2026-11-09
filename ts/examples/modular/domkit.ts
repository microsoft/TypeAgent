// A recording DOM for testing web renderers: a document that implements
// exactly the subset in dom.ts, computes the semantic tree a browser's
// accessibility tree would expose for its elements, and acts as a user
// would. It follows browsers where renderers commonly go wrong: a disabled
// button gets no click; a range input's value is clamped and snapped to its
// step; setting the value property marks it dirty, after which the value
// attribute no longer changes it; and aria-label wins over text content.
//
// How a semantic tree maps to elements is the web renderer's decided
// behavior (impl-specs.md, webRenderer.ts):
//
// | Role | Element | Label | State |
// |---|---|---|---|
// | group, toolbar, radio-group, view-host | div, role group, toolbar, radiogroup or region | aria-label | aria-disabled="true" when disabled |
// | text | div, role status | aria-label; the value is its text | aria-disabled="true" when disabled |
// | button | button | its text | disabled |
// | radio | button, role radio | its text | aria-checked "true" or "false"; disabled |
// | slider | input, type range, with min, max and step attributes and the value property | aria-label | disabled |
//
// Every element has data-key set to its node's key and style position
// absolute, with left, top, width and height in px relative to its parent
// node's bounds (the root's relative to the container). Children are the
// elements of child nodes, in order. Elements without data-key, such as a
// view's canvas placed in a view-host, are not part of the tree.
//
// Fidelity to real browsers is an assumption, to be checked once in a
// browser (moduleTooling.md, open questions).

import type { Rectangle } from "./geometry.ts";
import type { DomButtonElement, DomDocument, DomEvent, DomInputElement, DomNode, DomStyle } from "./dom.ts";
import type { Renderer, Role, SemanticNode } from "./ui.ts";
import type { RendererFixture } from "./ui.contract.ts";

type Listener = (event: DomEvent) => void;

export class RecordingElement implements DomInputElement, DomButtonElement {
  readonly nodeType = 1;
  readonly tagName: string;
  parent: RecordingElement | undefined;
  children: (RecordingElement | string)[] = [];
  /** How many times the child list was replaced, for renderers that should leave it alone. */
  childListChanges = 0;
  private readonly attributes = new Map<string, string>();
  private readonly styles = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();
  private dirtyValue: string | undefined;
  readonly style: DomStyle = { setProperty: (property, value) => void this.styles.set(property, value) };

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }

  set textContent(text: string | null) {
    for (const c of this.children) if (typeof c !== "string") c.parent = undefined;
    this.children = text ? [text] : [];
    this.childListChanges++;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name.toLowerCase(), String(value));
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  /** A style property, as set. */
  styleOf(property: string): string | undefined {
    return this.styles.get(property);
  }

  get disabled(): boolean {
    return this.attributes.has("disabled");
  }

  set disabled(on: boolean) {
    if (on) this.attributes.set("disabled", "");
    else this.attributes.delete("disabled");
  }

  /** A range input's value: the dirty value or the value attribute, clamped and snapped as a browser does. */
  get value(): string {
    const num = (name: string, fallback: number) => {
      const v = Number(this.getAttribute(name) ?? NaN);
      return Number.isFinite(v) ? v : fallback;
    };
    const min = num("min", 0);
    const max = Math.max(min, num("max", 100));
    const step = num("step", 1) > 0 ? num("step", 1) : 1;
    const raw = Number(this.dirtyValue ?? this.getAttribute("value") ?? "");
    const wanted = Number.isFinite(raw) && (this.dirtyValue ?? this.getAttribute("value")) !== "" ? raw : min + (max - min) / 2;
    const stepped = min + Math.round((Math.min(max, Math.max(min, wanted)) - min) / step) * step;
    return String(stepped > max ? stepped - step : stepped);
  }

  set value(v: string) {
    this.dirtyValue = String(v);
  }

  append(...nodes: (DomNode | string)[]): void {
    for (const n of nodes) {
      if (typeof n === "string") {
        this.children.push(n);
        continue;
      }
      const el = n as RecordingElement;
      el.remove();
      el.parent = this;
      this.children.push(el);
    }
    this.childListChanges++;
  }

  replaceChildren(...nodes: (DomNode | string)[]): void {
    for (const c of this.children) if (typeof c !== "string") c.parent = undefined;
    this.children = [];
    this.append(...nodes);
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent.childListChanges++;
    this.parent = undefined;
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    if (!list.includes(listener)) this.listeners.set(type, [...list, listener]);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }

  /** Fires an event at this element, as the browser would for a user's action. */
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ type });
  }

  /** The number of listeners for type, for tests of removal. */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }

  /** Child elements, without text. */
  elements(): RecordingElement[] {
    return this.children.filter((c): c is RecordingElement => typeof c !== "string");
  }
}

export class RecordingDocument implements DomDocument {
  createElement(tagName: "div"): RecordingElement;
  createElement(tagName: "button"): RecordingElement;
  createElement(tagName: "input"): RecordingElement;
  createElement(tagName: string): RecordingElement {
    return new RecordingElement(tagName);
  }
}

const divRoles: Record<string, Role> = { group: "group", toolbar: "toolbar", radiogroup: "radio-group", region: "view-host", status: "text" };

function roleOf(el: RecordingElement): Role {
  const role = el.getAttribute("role");
  if (el.tagName === "DIV" && role !== null && role in divRoles) return divRoles[role];
  if (el.tagName === "BUTTON") return role === "radio" ? "radio" : "button";
  if (el.tagName === "INPUT" && el.getAttribute("type") === "range") return "slider";
  throw new Error(`a <${el.tagName.toLowerCase()}> with role ${role} has no semantic role in the mapping`);
}

const px = (el: RecordingElement, property: string) => {
  const m = /^(-?[\d.]+)px$/.exec(el.styleOf(property) ?? "");
  return m ? Number(m[1]) : NaN;
};

function semantic(el: RecordingElement, origin: { x: number; y: number }): SemanticNode {
  const role = roleOf(el);
  const bounds: Rectangle = el.styleOf("position") === "absolute"
    ? { x: origin.x + px(el, "left"), y: origin.y + px(el, "top"), width: px(el, "width"), height: px(el, "height") }
    : { x: NaN, y: NaN, width: NaN, height: NaN };
  const ariaDisabled = el.getAttribute("aria-disabled") === "true";
  const enabled = el.tagName === "DIV" ? !ariaDisabled : !el.disabled;
  const label = el.getAttribute("aria-label") ?? (role === "button" || role === "radio" ? el.textContent : "");
  const key = el.getAttribute("data-key") ?? "";
  const containers: Role[] = ["group", "toolbar", "radio-group"];
  const children = containers.includes(role)
    ? el.elements().filter((c) => c.getAttribute("data-key") !== null).map((c) => semantic(c, bounds))
    : [];
  const node: Record<string, unknown> = { role, key, label };
  if (role === "slider") {
    node.value = Number(el.value);
    node.min = Number(el.getAttribute("min") ?? 0);
    node.max = Number(el.getAttribute("max") ?? 100);
    node.step = Number(el.getAttribute("step") ?? 1);
  }
  if (role === "text") node.value = el.textContent;
  if (role === "radio") node.selected = el.getAttribute("aria-checked") === "true";
  node.enabled = enabled;
  node.bounds = bounds;
  node.children = children;
  return node as unknown as SemanticNode;
}

/** The semantic tree a browser exposes for what container holds, or undefined when it holds no keyed element. */
export function presentedIn(container: RecordingElement): SemanticNode | undefined {
  const root = container.elements().find((c) => c.getAttribute("data-key") !== null);
  return root && semantic(root, { x: 0, y: 0 });
}

/** The element with data-key key under container, if any. */
export function elementByKey(container: RecordingElement, key: string): RecordingElement | undefined {
  for (const c of container.elements()) {
    if (c.getAttribute("data-key") === key) return c;
    const found = elementByKey(c, key);
    if (found) return found;
  }
  return undefined;
}

/** The user clicks the element for key; a disabled button gets no click, as in a browser. */
export function click(container: RecordingElement, key: string): void {
  const el = elementByKey(container, key);
  if (!el || ((el.tagName === "BUTTON" || el.tagName === "INPUT") && el.disabled)) return;
  el.dispatch("click");
}

/** The user drags the range input for key to value: the value changes, then input and change fire. */
export function drag(container: RecordingElement, key: string, value: number): void {
  const el = elementByKey(container, key);
  if (!el || el.tagName !== "INPUT" || el.getAttribute("type") !== "range" || el.disabled) return;
  el.value = String(value);
  el.dispatch("input");
  el.dispatch("change");
}

/** A Renderer contract fixture for a web renderer made on a recording document and container. */
export function webFixture(make: (doc: RecordingDocument, container: RecordingElement) => Renderer): RendererFixture {
  const doc = new RecordingDocument();
  const container = doc.createElement("div");
  const renderer = make(doc, container);
  return {
    renderer,
    presented: () => presentedIn(container),
    activate: (key) => click(container, key),
    setValue: (key, value) => drag(container, key, value),
    widget: (key) => elementByKey(container, key),
  };
}
