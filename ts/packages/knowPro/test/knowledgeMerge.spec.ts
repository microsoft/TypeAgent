// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mergeConcreteEntities } from "../src/knowledgeMergeEx.js";

describe("knowledge.merge", () => {
    it("should merge concrete entities with case sensitivity", () => {
        const entity1 = {
            type: ["Person"],
            name: "Alice",
            facets: [{ name: "Location", value: "Seattle" }],
        };
        const entity2 = {
            type: ["person"],
            name: "alice",
            facets: [{ name: "location", value: "seattle" }],
        };
        const merged = mergeConcreteEntities([entity1, entity2], {
            caseSensitive: true,
        });
        expect(merged).toHaveLength(2);
        expect(merged).toContainEqual(entity1);
        expect(merged).toContainEqual(entity2);
    });
    it("should merge concrete entities with case insensitivity", () => {
        const entity1 = {
            type: ["Person"],
            name: "Alice",
            facets: [{ name: "Location", value: "Seattle" }],
        };
        const entity2 = {
            type: ["person"],
            name: "alice",
            facets: [{ name: "location", value: "seattle" }],
        };
        const merged = mergeConcreteEntities([entity1, entity2]);
        expect(merged).toHaveLength(1);
        expect(merged).toContainEqual(entity1);
    });
    it("Merge additional type and facet with case sensitivity", () => {
        const entity1 = {
            type: ["Person"],
            name: "Alice",
            facets: [
                { name: "Location", value: "Seattle" },
                { name: "Location", value: "portland" },
            ],
        };
        const entity2 = {
            type: ["person", "artist"],
            name: "Alice",
            facets: [
                { name: "Location", value: "seattle" },
                { name: "Location", value: "portland" },
                { name: "Location", value: "portland" },
                { name: "location", value: "Vancouver" },
                { name: "Profession", value: "Artist" },
            ],
        };
        const expected = {
            type: ["Person", "artist", "person"], // sorted.
            name: "Alice",
            facets: [
                { name: "Location", value: "Seattle; portland; seattle" }, // REVIEW: should the merge value be in an array
                { name: "location", value: "Vancouver" },
                { name: "Profession", value: "Artist" },
            ],
        };
        const merged = mergeConcreteEntities([entity1, entity2], {
            caseSensitive: true,
        });
        expect(merged).toHaveLength(1);
        expect(merged).toContainEqual(expected);
    });
    it("Merge additional type and facet with case insensitivity", () => {
        const entity1 = {
            type: ["Person"],
            name: "Alice",
            facets: [{ name: "Location", value: "Seattle" }],
        };
        const entity2 = {
            type: ["person", "artist"],
            name: "alice",
            facets: [
                { name: "location", value: "seattle" },
                { name: "location", value: "portland" },
                { name: "Profession", value: "Artist" },
            ],
        };
        const expected = {
            type: ["Person", "artist"], // sorted.
            name: "Alice",
            facets: [
                { name: "Location", value: "Seattle; portland" }, // REVIEW: should the merge value be in an array
                { name: "Profession", value: "Artist" },
            ],
        };
        const merged = mergeConcreteEntities([entity1, entity2]);
        expect(merged).toHaveLength(1);
        expect(merged).toContainEqual(expected);
    });
});
