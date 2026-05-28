// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isCollision } from "../src/translation/matchCollision.js";
import {
    MatchResult,
    RequestAction,
    createExecutableAction,
} from "agent-cache";

function makeMatch(
    schemaName: string,
    actionName: string,
    overrides: Partial<MatchResult> = {},
): MatchResult {
    const action = createExecutableAction(schemaName, actionName);
    const ra = new RequestAction("test request", [action]);
    return {
        type: "grammar",
        match: ra,
        matchedCount: 5,
        nonOptionalCount: 5,
        wildcardCharCount: 0,
        implicitParameterCount: 0,
        entityWildcardPropertyNames: [],
        ...overrides,
    };
}

describe("matchCollision.isCollision", () => {
    describe("classifier=distinctActions", () => {
        it("returns false for a single match", () => {
            expect(
                isCollision([makeMatch("a", "play")], "distinctActions"),
            ).toBe(false);
        });

        it("returns false when all matches share schema and action", () => {
            const matches = [makeMatch("a", "play"), makeMatch("a", "play")];
            expect(isCollision(matches, "distinctActions")).toBe(false);
        });

        it("returns true when two matches differ in schema", () => {
            const matches = [
                makeMatch("player", "play"),
                makeMatch("video", "play"),
            ];
            expect(isCollision(matches, "distinctActions")).toBe(true);
        });

        it("returns true when two matches differ in action", () => {
            const matches = [
                makeMatch("list", "addItems"),
                makeMatch("list", "removeItems"),
            ];
            // distinctActions is keyed on (schema, action) tuples — same schema
            // but different actions still counts as distinct.
            expect(isCollision(matches, "distinctActions")).toBe(true);
        });
    });

    describe("classifier=tiedHeuristics", () => {
        it("returns false for a single match", () => {
            expect(
                isCollision([makeMatch("a", "play")], "tiedHeuristics"),
            ).toBe(false);
        });

        it("returns true when top two share matchedCount/nonOptional/wildcard", () => {
            const matches = [
                makeMatch("a", "x", {
                    matchedCount: 5,
                    nonOptionalCount: 5,
                    wildcardCharCount: 2,
                }),
                makeMatch("b", "y", {
                    matchedCount: 5,
                    nonOptionalCount: 5,
                    wildcardCharCount: 2,
                }),
            ];
            expect(isCollision(matches, "tiedHeuristics")).toBe(true);
        });

        it("returns false when top two differ in matchedCount", () => {
            const matches = [
                makeMatch("a", "x", { matchedCount: 5 }),
                makeMatch("b", "y", { matchedCount: 4 }),
            ];
            expect(isCollision(matches, "tiedHeuristics")).toBe(false);
        });

        it("returns false when top two differ in wildcardCharCount", () => {
            const matches = [
                makeMatch("a", "x", { wildcardCharCount: 0 }),
                makeMatch("b", "y", { wildcardCharCount: 5 }),
            ];
            expect(isCollision(matches, "tiedHeuristics")).toBe(false);
        });
    });
});
