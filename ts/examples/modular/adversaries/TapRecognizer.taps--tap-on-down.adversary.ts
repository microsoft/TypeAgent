// Adversary: the tap is emitted at the down, before the press ends.
import { tapRecognizerContract } from "../tapRecognizer.contract.ts";
import { makeTestTaps } from "./_taps.ts";

tapRecognizerContract(makeTestTaps("tap-on-down"));
