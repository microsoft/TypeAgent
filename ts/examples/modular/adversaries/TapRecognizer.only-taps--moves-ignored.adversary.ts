// Adversary: only the up's distance counts, so a press that wanders away and comes back is a tap.
import { tapRecognizerContract } from "../tapRecognizer.contract.ts";
import { makeTestTaps } from "./_taps.ts";

tapRecognizerContract(makeTestTaps("moves-ignored"));
