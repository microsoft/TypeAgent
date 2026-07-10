// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { likelyRegression } from "../src/replay/predicate.js";
import type { FeedbackLabel } from "../src/corpus/types.js";

const up: FeedbackLabel = { rating: "up", recordedAt: 0 };
const down: FeedbackLabel = { rating: "down", recordedAt: 0 };

const play = (parameters: Record<string, unknown>) => ({
    schemaName: "player",
    actionName: "playTrack",
    parameters,
});

describe("likelyRegression predicate (structural)", () => {
    it("returns neutral for an unchanged row", () => {
        expect(likelyRegression({ equal: true })).toBe("neutral");
    });

    it("flags a lost match as a regression", () => {
        expect(
            likelyRegression({
                equal: false,
                actionA: play({ trackName: "X" }),
            }),
        ).toBe("regression");
    });

    it("treats a gained match as an improvement", () => {
        expect(
            likelyRegression({
                equal: false,
                actionB: play({ trackName: "X" }),
            }),
        ).toBe("improvement");
    });

    it("flags an action-type change as a regression", () => {
        expect(
            likelyRegression({
                equal: false,
                actionA: { schemaName: "player", actionName: "next" },
                actionB: { schemaName: "player", actionName: "previous" },
            }),
        ).toBe("regression");
    });

    it("flags a dropped parameter as a regression", () => {
        expect(
            likelyRegression({
                equal: false,
                actionA: play({ trackName: "Yellow", artists: ["Coldplay"] }),
                actionB: play({ trackName: "Yellow" }),
            }),
        ).toBe("regression");
    });

    it("flags a changed parameter value as a regression", () => {
        expect(
            likelyRegression({
                equal: false,
                actionA: play({ trackNumber: 3 }),
                actionB: play({ trackNumber: 4 }),
            }),
        ).toBe("regression");
    });

    it("treats a purely additive parameter as benign enrichment", () => {
        expect(
            likelyRegression({
                equal: false,
                actionA: play({ trackName: "One", artists: ["U2"] }),
                actionB: play({
                    trackName: "One",
                    artists: ["U2"],
                    albumName: "Achtung Baby",
                }),
            }),
        ).toBe("benign");
    });

    it("ignores key order and array order when comparing params", () => {
        expect(
            likelyRegression({
                equal: false,
                actionA: play({ trackName: "Q", artists: ["a", "b"] }),
                actionB: play({ artists: ["a", "b"], trackName: "Q" }),
            }),
        ).toBe("benign");
    });

    it("treats a null/absent A param as not-lost", () => {
        expect(
            likelyRegression({
                equal: false,
                actionA: play({ trackName: "Q", albumName: null }),
                actionB: play({ trackName: "Q" }),
            }),
        ).toBe("benign");
    });

    it("lets feedbackB.down override to regression", () => {
        expect(
            likelyRegression({
                equal: false,
                actionA: play({ trackName: "X" }),
                actionB: play({ trackName: "X", artists: ["Y"] }),
                feedbackB: down,
            }),
        ).toBe("regression");
    });

    it("lets feedbackB.up override to benign even on a lost match", () => {
        expect(
            likelyRegression({
                equal: false,
                actionA: play({ trackName: "X" }),
                feedbackB: up,
            }),
        ).toBe("benign");
    });

    it("ignores feedbackA", () => {
        expect(
            likelyRegression({
                equal: false,
                actionA: play({ trackName: "X" }),
                actionB: play({ trackName: "X", artists: ["Y"] }),
                feedbackA: up,
            }),
        ).toBe("benign");
    });
});
