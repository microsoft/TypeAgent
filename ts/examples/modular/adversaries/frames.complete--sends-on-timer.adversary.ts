// Adversary: Every operation is sent from a zero-delay timer, after the handler returns. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitFixture } from "../scenariokit.ts";
import { makeTimerSendCircles } from "./_1b-circles.ts";

scenarioContract(() => kitFixture({ app: makeTimerSendCircles() }), () => kitFixture());
