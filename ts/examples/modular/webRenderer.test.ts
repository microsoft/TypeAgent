import { test } from "node:test";
import assert from "node:assert/strict";
import { rendererContract } from "./ui.contract.ts";
import { scenarioContract } from "./scenario.contract.ts";
import { kitDriver } from "./scenariokit.ts";
import { RecordingDocument, elementByKey, webFixture } from "./domkit.ts";
import { controls } from "./chrome.vocab.ts";
import { demoOptions, demoSize } from "./scenarios.ts";
import { WebRenderer } from "./webRenderer.ts";

const make = () => webFixture((doc, container) => new WebRenderer(doc, container));

rendererContract(make);

// The scenarios, with every other part a test double, compared with the reference.
scenarioContract(() => kitDriver({ renderer: make }), () => kitDriver());

// Decided for the web renderer only (impl-specs.md): a render that changes nothing leaves every child list alone.
test("WebRenderer keeps child lists", () => {
  const doc = new RecordingDocument();
  const container = doc.createElement("div");
  const renderer = new WebRenderer(doc, container);
  const tree = controls(demoOptions, { mode: "draw", color: 0, radius: 10, count: 0 }, demoSize);
  renderer.render(tree);
  const toolbar = elementByKey(container, "toolbar")!;
  const before = [container.childListChanges, toolbar.childListChanges];
  renderer.render(structuredClone(tree));
  assert.deepEqual([container.childListChanges, toolbar.childListChanges], before);
  assert.equal(renderer.elementFor("view"), elementByKey(container, "view"));
});
