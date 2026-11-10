// Adversary: The color's alpha is stored from 0 to 255, as some platforms use.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("alpha-as-byte"));
