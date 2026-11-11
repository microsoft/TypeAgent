// Adversary: Order keys are integers 1024 apart, halved on each insert below a shape, and never renumbered.
import { shapeCollectionWriterContract } from "../shapeModel.contract.ts";
import { KeyedWriter } from "./_1b-shapeModel.ts";

shapeCollectionWriterContract(() => new KeyedWriter("keys-run-out"));
