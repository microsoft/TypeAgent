// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Construction } from "../src/constructions/constructions.js";
import { ConstructionCache } from "../src/constructions/constructionCache.js";
import {
    createMatchPart,
    isMatchPart,
} from "../src/constructions/matchPart.js";

describe("construction cache", () => {
    // Make sure that construction store can match original request after import (and merging)
    describe("merge", () => {
        it("should merge same construction", () => {
            const cache = new ConstructionCache("test");
            const part = createMatchPart(["a"], "name");
            const construction = Construction.create([part], new Map());

            const first = cache.addConstruction(["test"], construction, true);
            expect(first.added).toEqual(true);
            expect(first.existing).toEqual([]);
            const second = cache.addConstruction(["test"], construction, true);
            expect(second.added).toEqual(false);
            if (first.added) {
                expect(second.existing).toEqual([first.construction]);
            }
        });

        it("should merge mergeset", () => {
            const cache = new ConstructionCache("test");
            const part1 = createMatchPart(["a"], "name");
            const construction1 = Construction.create([part1], new Map());

            const first = cache.addConstruction(["test"], construction1, true);
            expect(first.added).toEqual(true);
            expect(first.existing).toEqual([]);

            const part2 = createMatchPart(["b"], "name");
            const construction2 = Construction.create([part2], new Map());
            const second = cache.addConstruction(["test"], construction2, true);
            expect(second.added).toEqual(false);
            if (first.added) {
                expect(second.existing).toEqual([first.construction]);
                expect(isMatchPart(first.construction.parts[0])).toBe(true);
                if (isMatchPart(first.construction.parts[0])) {
                    const matches =
                        first.construction.parts[0].matchSet!.matches;
                    expect(Array.from(matches.values()).sort()).toEqual([
                        "a",
                        "b",
                    ]);
                }
            }
        });
    });
});
