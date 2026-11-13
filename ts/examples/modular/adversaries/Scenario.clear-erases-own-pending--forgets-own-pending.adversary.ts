// Adversary: the processor's forgets-own-pending bug, seen through the app.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { TestShapeProcessor } from "./_shapeModel.ts";

scenarioContract(() => kitDriver({ processor: (id) => new TestShapeProcessor(id, "forgets-own-pending") }), () => kitDriver());
