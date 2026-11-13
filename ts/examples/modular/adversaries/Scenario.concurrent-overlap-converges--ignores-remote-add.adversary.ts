// Adversary: the processor's ignores-remote-add bug, seen through the app.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { TestShapeProcessor } from "./_shapeModel.ts";

scenarioContract(() => kitDriver({ processor: (id) => new TestShapeProcessor(id, "ignores-remote-add") }), () => kitDriver());
