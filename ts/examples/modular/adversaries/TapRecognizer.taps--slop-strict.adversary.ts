// Adversary: a distance equal to the slop counts as too far.
import { tapRecognizerContract } from "../tapRecognizer.contract.ts";
import { makeTestTaps } from "./_taps.ts";

tapRecognizerContract(makeTestTaps("slop-strict"));
