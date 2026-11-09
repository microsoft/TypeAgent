// The reference App (app.ts): three listeners and a dispose, written as
// simply as possible. Tests of the parts an app connects use it.
// helpers.check.ts runs the App contract on it. The app's own generation
// task never sees this file.

import type { App, AppParts } from "./app.ts";
import type { UiEvent } from "./ui.ts";
import type { Point } from "./geometry.ts";

export class KitApp implements App {
  private readonly parts: AppParts;
  private disposed = false;
  private readonly onChange = () => this.parts.renderer.render(this.parts.chrome.present(this.parts.size));
  private readonly onInput = (event: UiEvent) => this.parts.chrome.dispatch(event);
  private readonly onTap = (p: Point) => this.parts.chrome.tap(p);

  constructor(parts: AppParts) {
    this.parts = parts;
    parts.renderer.render(parts.chrome.present(parts.size));
    parts.view.interactive = true;
    parts.chrome.on("change", this.onChange);
    parts.renderer.on("input", this.onInput);
    parts.view.on("tap", this.onTap);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const { chrome, view, renderer } = this.parts;
    chrome.off("change", this.onChange);
    renderer.off("input", this.onInput);
    view.off("tap", this.onTap);
    chrome.dispose();
    view.dispose();
    renderer.dispose();
  }
}

export const kitConnect = (parts: AppParts): App => new KitApp(parts);
