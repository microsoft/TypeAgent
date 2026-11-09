import { layerContract } from "./layer.contract.ts";
import { ListCollection, ListIndex } from "./modelkit.ts";
import { ShapeLayer } from "./shapeLayer.ts";

// The layer over test doubles, so that its tests depend on no other
// generated implementation. shapeLayer.integration.test.ts wires it to the
// real collection and locators.
layerContract(() => new ShapeLayer(new ListCollection(), new ListIndex()));
