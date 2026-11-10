import { renderGroupContract } from "./renderGroup.contract.ts";
import { ListCollection, ListIndex } from "./modelkit.ts";
import { ShapeGroup } from "./shapeGroup.ts";

// The group over test doubles, so that its tests depend on no other
// generated implementation. shapeGroup.integration.test.ts wires it to the
// real collection and locators.
renderGroupContract(() => new ShapeGroup(new ListCollection(), new ListIndex()));
