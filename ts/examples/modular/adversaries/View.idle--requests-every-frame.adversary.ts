// Adversary: Every frame requests the next one, as a render loop would.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("requests-every-frame"));
