/**
 * Vocabulary for rule expressions about ui.ts: walking semantic trees,
 * checking their shape, and what a renderer presents. Re-exports the
 * vocabulary of the files ui.ts imports.
 *
 * @module
 */

import type { Renderer, SemanticNode } from "./ui.ts";

export * from "./geometry.vocab.ts";

/**
 * Ghost state: the tree the platform presents for a renderer, read from
 * the platform's own widgets by the contract's fixture, or undefined when
 * it presents nothing.
 */
export declare function presented(renderer: Renderer): SemanticNode | undefined;

/** Every node of the tree, parents before children, in order. */
export function nodes(tree: SemanticNode): SemanticNode[] {
  return [tree, ...tree.children.flatMap(nodes)];
}

/** Every key in the tree, in the order nodes lists them. */
export function keys(tree: SemanticNode): string[] {
  return nodes(tree).map((n) => n.key);
}

const fieldsOf: Record<SemanticNode["role"], readonly string[]> = {
  "group": [], "toolbar": [], "radio-group": [], "view-host": [],
  "radio": ["selected"],
  "slider": ["value", "min", "max", "step"],
  "button": [],
  "text": ["value"],
};
const containers = new Set(["group", "toolbar", "radio-group"]);
const always = ["role", "key", "label", "enabled", "bounds", "children"];

/** Whether every node has exactly the fields its role uses, with values that make sense (ui.ts's well-formed). */
export function wellFormed(tree: SemanticNode): boolean {
  return nodes(tree).every((n) => {
    const fields = Object.keys(n).sort();
    const expected = [...always, ...fieldsOf[n.role]].sort();
    if (fields.length !== expected.length || fields.some((f, i) => f !== expected[i])) return false;
    if (!containers.has(n.role) && n.children.length > 0) return false;
    if (n.role === "radio-group" && n.children.some((c) => c.role !== "radio")) return false;
    if (n.role === "radio" && typeof n.selected !== "boolean") return false;
    if (n.role === "text" && typeof n.value !== "string") return false;
    if (n.role === "slider") {
      const { value, min, max, step } = n;
      if (typeof value !== "number" || min === undefined || max === undefined || step === undefined) return false;
      if (!(min <= value && value <= max && step > 0 && Number.isInteger((value - min) / step))) return false;
    }
    return true;
  });
}

/** The node with the given key, if any. */
export function byKey(tree: SemanticNode, key: string): SemanticNode | undefined {
  return nodes(tree).find((n) => n.key === key);
}
