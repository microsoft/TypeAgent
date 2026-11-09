import { MapShapeCollection } from "./mapShapeCollection.ts";
import { shapeCollectionContract } from "./shapeCollection.contract.ts";

shapeCollectionContract(() => new MapShapeCollection());
