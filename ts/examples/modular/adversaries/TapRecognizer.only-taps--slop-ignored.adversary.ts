// Adversary: any press is a tap, however far it wanders.
import { tapRecognizerContract } from "../tapRecognizer.contract.ts";
import { makeTestTaps } from "./_taps.ts";

tapRecognizerContract(makeTestTaps("slop-ignored"));
