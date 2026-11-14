// Adversary: The locator is updated after change is emitted, so a query a listener makes during the change misses it.
import { shapeCollectionWriterContract } from "../shapeModel.contract.ts";
import { KeyedWriter } from "./_1b-shapeModel.ts";

shapeCollectionWriterContract(() => new KeyedWriter("index-after-emit"));
