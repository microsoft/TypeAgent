// A Renderer (ui.ts) for tests that keeps the tree it was given and acts as
// its own fixture: presented, activate and setValue behave as a platform
// with correct widgets would. helpers.check.ts runs the Renderer contract
// on it.

import type { Renderer, SemanticNode, UiEvent } from "./ui.ts";
import type { RendererFixture } from "./ui.contract.ts";
import { byKey, nodes } from "./ui.vocab.ts";
import { Events } from "./eventkit.ts";

export class TreeRenderer extends Events<{ input: [UiEvent] }> implements Renderer, RendererFixture {
  readonly renderer: Renderer = this;
  private tree: SemanticNode | undefined;
  private widgets = new Map<string, { role: string }>();
  private disposed = false;

  render(tree: SemanticNode): void {
    if (this.disposed) return;
    const next = new Map<string, { role: string }>();
    for (const n of nodes(tree)) {
      const old = this.widgets.get(n.key);
      next.set(n.key, old !== undefined && old.role === n.role ? old : { role: n.role });
    }
    this.widgets = next;
    this.tree = structuredClone(tree);
  }

  dispose(): void {
    this.disposed = true;
    this.tree = undefined;
    this.widgets.clear();
  }

  presented(): SemanticNode | undefined {
    return this.tree;
  }

  activate(key: string): void {
    const node = this.tree && byKey(this.tree, key);
    if (!node || !node.enabled) return;
    if (node.role === "button" || (node.role === "radio" && !node.selected)) this.emit("input", { kind: "activate", key });
  }

  setValue(key: string, value: number): void {
    const node = this.tree && byKey(this.tree, key);
    if (node && node.enabled && node.role === "slider") this.emit("input", { kind: "set-value", key, value });
  }

  widget(key: string): unknown {
    return this.widgets.get(key);
  }
}
