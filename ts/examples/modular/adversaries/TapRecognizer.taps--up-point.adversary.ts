// Adversary: the tap is at the up's point, not the down's.
import { tapRecognizerContract } from "../tapRecognizer.contract.ts";
import { makeTestTaps } from "./_taps.ts";

tapRecognizerContract(makeTestTaps("up-point"));
