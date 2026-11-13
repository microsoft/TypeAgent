import { MapShapeCollection } from "./mapShapeCollection.ts";
import { shapeCollectionWriterContract } from "./shapeModel.contract.ts";
import { ListIndex } from "./modelkit.ts";

// Over the reference locator, so that these tests depend on no other generated
// implementation. shapeModel.integration.test.ts wires the real locators.
shapeCollectionWriterContract(() => new MapShapeCollection(new ListIndex()));
