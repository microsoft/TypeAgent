// Adversary: dispose leaves the recognizer's listeners on the region.
import { tapRecognizerContract } from "../tapRecognizer.contract.ts";
import { makeTestTaps } from "./_taps.ts";

tapRecognizerContract(makeTestTaps("dispose-keeps"));
