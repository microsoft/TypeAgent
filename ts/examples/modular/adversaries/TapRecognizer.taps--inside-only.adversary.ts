// Adversary: an up outside the region isn't a tap.
import { tapRecognizerContract } from "../tapRecognizer.contract.ts";
import { makeTestTaps } from "./_taps.ts";

tapRecognizerContract(makeTestTaps("inside-only"));
