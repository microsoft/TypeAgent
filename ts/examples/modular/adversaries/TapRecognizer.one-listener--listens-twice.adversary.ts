// Adversary: the recognizer listens to down twice.
import { tapRecognizerContract } from "../tapRecognizer.contract.ts";
import { makeTestTaps } from "./_taps.ts";

tapRecognizerContract(makeTestTaps("listens-twice"));
