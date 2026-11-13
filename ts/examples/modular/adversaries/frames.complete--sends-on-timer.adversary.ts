// Adversary: Every operation is sent from a zero-delay timer, after the handler returns. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTimerSendCircles } from "./_1b-circles.ts";

scenarioContract(() => kitDriver({ app: makeTimerSendCircles() }), () => kitDriver());
