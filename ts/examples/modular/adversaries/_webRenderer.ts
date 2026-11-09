// A web Renderer for adversaries: correct unless a bug is switched on.
// helpers.check.ts runs the Renderer contract against it with no bug, on a
// recording document (domkit.ts).

import type { Role, Renderer, SemanticNode, UiEvent } from "../ui.ts";
import type { DomDocument, DomElement, DomInputElement } from "../dom.ts";
import type { RendererFixture } from "../ui.contract.ts";
import { byKey } from "../ui.vocab.ts";
import { Events } from "../eventkit.ts";
import { webFixture } from "../domkit.ts";

export type WebBug =
  | "none"
  | "rebuilds"                // every render makes new elements
  | "emits-for-selected"      // activating a selected radio emits
  | "disabled-not-blocked"    // buttons are disabled with aria-disabled only, and clicks aren't checked
  | "input-and-change"        // sliders report both input and change events
  | "absolute-bounds"         // left and top are window coordinates, not relative to the parent
  | "emits-on-render"         // render reports a slider whose value it changed
  | "keeps-dom-on-dispose"    // dispose leaves the elements in place
  | "label-in-title"          // containers get title instead of aria-label
  | "value-attribute"         // slider values are set with the value attribute, not the property
  | "checked-attribute";      // radios get aria-selected instead of aria-checked

const divRole: Partial<Record<Role, string>> = { "group": "group", "toolbar": "toolbar", "radio-group": "radiogroup", "view-host": "region", "text": "status" };

interface Entry {
  role: Role;
  el: DomElement;
  /** For containers, the child elements as last set. */
  kids: DomElement[];
}

const containers: Role[] = ["group", "toolbar", "radio-group"];

export class TestWebRenderer extends Events<{ input: [UiEvent] }> implements Renderer {
  private readonly doc: DomDocument;
  private readonly container: DomElement;
  private readonly bug: WebBug;
  private entries = new Map<string, Entry>();
  private rootEl: DomElement | undefined;
  private tree: SemanticNode | undefined;
  private disposed = false;

  constructor(doc: DomDocument, container: DomElement, bug: WebBug = "none") {
    super();
    this.doc = doc;
    this.container = container;
    this.bug = bug;
  }

  private create(node: SemanticNode): DomElement {
    const key = node.key;
    if (node.role === "button" || node.role === "radio") {
      const el = this.doc.createElement("button");
      el.addEventListener("click", () => this.clicked(key));
      return el;
    }
    if (node.role === "slider") {
      const el = this.doc.createElement("input");
      el.setAttribute("type", "range");
      el.addEventListener("input", () => this.slid(key, el));
      if (this.bug === "input-and-change") el.addEventListener("change", () => this.slid(key, el));
      return el;
    }
    const el = this.doc.createElement("div");
    el.setAttribute("role", divRole[node.role]!);
    return el;
  }

  private clicked(key: string): void {
    const node = this.tree && byKey(this.tree, key);
    if (this.disposed || !node) return;
    if (!node.enabled && this.bug !== "disabled-not-blocked") return;
    if (node.role === "button" || (node.role === "radio" && (!node.selected || this.bug === "emits-for-selected"))) {
      this.emit("input", { kind: "activate", key });
    }
  }

  private slid(key: string, el: DomInputElement): void {
    const node = this.tree && byKey(this.tree, key);
    if (this.disposed || !node || !node.enabled) return;
    this.emit("input", { kind: "set-value", key, value: Number(el.value) });
  }

  private update(node: SemanticNode, el: DomElement, parent: { x: number; y: number }): void {
    el.setAttribute("data-key", node.key);
    const origin = this.bug === "absolute-bounds" ? { x: 0, y: 0 } : parent;
    el.style.setProperty("position", "absolute");
    el.style.setProperty("left", `${node.bounds.x - origin.x}px`);
    el.style.setProperty("top", `${node.bounds.y - origin.y}px`);
    el.style.setProperty("width", `${node.bounds.width}px`);
    el.style.setProperty("height", `${node.bounds.height}px`);
    switch (node.role) {
      case "button":
      case "radio": {
        const button = el as DomInputElement;
        if (node.role === "radio") {
          button.setAttribute("role", "radio");
          button.setAttribute(this.bug === "checked-attribute" ? "aria-selected" : "aria-checked", String(node.selected));
        }
        if (button.textContent !== node.label) button.textContent = node.label;
        if (this.bug === "disabled-not-blocked") {
          if (node.enabled) button.removeAttribute("aria-disabled");
          else button.setAttribute("aria-disabled", "true");
        } else {
          button.disabled = !node.enabled;
        }
        break;
      }
      case "slider": {
        const input = el as DomInputElement;
        input.setAttribute("aria-label", node.label);
        input.setAttribute("min", String(node.min));
        input.setAttribute("max", String(node.max));
        input.setAttribute("step", String(node.step));
        const value = String(node.value);
        if (input.value !== value) {
          if (this.bug === "value-attribute") input.setAttribute("value", value);
          else input.value = value;
          if (this.bug === "emits-on-render") this.slid(node.key, input);
        }
        input.disabled = !node.enabled;
        break;
      }
      default: {
        el.setAttribute(this.bug === "label-in-title" && node.role !== "text" ? "title" : "aria-label", node.label);
        if (node.enabled) el.removeAttribute("aria-disabled");
        else el.setAttribute("aria-disabled", "true");
        if (node.role === "text" && el.textContent !== node.value) el.textContent = String(node.value);
      }
    }
  }

  render(tree: SemanticNode): void {
    if (this.disposed) return;
    // Look nodes up in the new tree from here on, so that events during the render see it.
    this.tree = tree;
    const next = new Map<string, Entry>();
    const build = (node: SemanticNode, parent: { x: number; y: number }): DomElement => {
      const old = this.entries.get(node.key);
      const entry: Entry = old && old.role === node.role && this.bug !== "rebuilds" ? old : { role: node.role, el: this.create(node), kids: [] };
      next.set(node.key, entry);
      this.update(node, entry.el, parent);
      if (containers.includes(node.role)) {
        const kids = node.children.map((c) => build(c, node.bounds));
        if (kids.length !== entry.kids.length || kids.some((k, i) => k !== entry.kids[i])) {
          entry.el.replaceChildren(...kids);
          entry.kids = kids;
        }
      }
      return entry.el;
    };
    const root = build(tree, { x: 0, y: 0 });
    if (root !== this.rootEl) {
      this.container.replaceChildren(root);
      this.rootEl = root;
    }
    this.entries = next;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.bug !== "keeps-dom-on-dispose") this.container.replaceChildren();
    this.entries.clear();
    this.rootEl = undefined;
    this.tree = undefined;
  }
}

/** A fixture for the Renderer contract: a TestWebRenderer on a recording document. */
export const makeTestWeb = (bug: WebBug = "none"): (() => RendererFixture) =>
  () => webFixture((doc, container) => new TestWebRenderer(doc, container, bug));
