// An App for adversaries: correct unless a bug is switched on.
// helpers.check.ts runs the App contract against it with no bug.

import type { Point } from "../geometry.ts";
import type { UiEvent } from "../ui.ts";
import type { App, AppParts } from "../app.ts";

export type AppBug =
  | "none"
  | "no-initial-render"        // nothing is rendered until the chrome first changes
  | "not-interactive"          // the view is left not interactive
  | "renders-twice"            // each change renders twice
  | "renders-on-input"         // renders after passing on input, not on chrome change
  | "input-twice"              // each input is dispatched twice
  | "drops-taps"               // view taps aren't passed on
  | "listens-twice"            // listens to the view's taps twice
  | "dispose-order"            // dispose disposes the renderer first
  | "dispose-keeps-listeners"  // dispose leaves the app's listeners
  | "dispose-twice";           // a second dispose disposes the parts again

export class TestApp implements App {
  private readonly parts: AppParts;
  private readonly bug: AppBug;
  private disposed = false;
  private readonly render = () => this.parts.renderer.render(this.parts.chrome.present(this.parts.size));
  private readonly onChange = () => {
    if (this.bug === "renders-on-input") return;
    this.render();
    if (this.bug === "renders-twice") this.render();
  };
  private readonly onInput = (event: UiEvent) => {
    this.parts.chrome.dispatch(event);
    if (this.bug === "input-twice") this.parts.chrome.dispatch(event);
    if (this.bug === "renders-on-input") this.render();
  };
  private readonly onTap = (p: Point) => this.parts.chrome.tap(p);

  constructor(parts: AppParts, bug: AppBug = "none") {
    this.parts = parts;
    this.bug = bug;
    if (bug !== "no-initial-render") this.render();
    parts.view.interactive = bug !== "not-interactive";
    parts.chrome.on("change", this.onChange);
    parts.renderer.on("input", this.onInput);
    if (bug !== "drops-taps") parts.view.on("tap", this.onTap);
    if (bug === "listens-twice") parts.view.on("tap", this.onTap);
  }

  dispose(): void {
    if (this.disposed && this.bug !== "dispose-twice") return;
    this.disposed = true;
    const { chrome, view, renderer } = this.parts;
    if (this.bug !== "dispose-keeps-listeners") {
      chrome.off("change", this.onChange);
      renderer.off("input", this.onInput);
      view.off("tap", this.onTap);
    }
    if (this.bug === "dispose-order") {
      renderer.dispose();
      chrome.dispose();
      view.dispose();
      return;
    }
    chrome.dispose();
    view.dispose();
    renderer.dispose();
  }
}

export const makeTestApp = (bug: AppBug = "none") => (parts: AppParts): App => new TestApp(parts, bug);
