// Adversary: The locator is updated after change is emitted, so a listener's queries miss the change.
import { shapeCollectionWriterContract } from "../shapeModel.contract.ts";
import { KeyedWriter } from "./_1b-shapeModel.ts";

shapeCollectionWriterContract(() => new KeyedWriter("index-after-emit"));
