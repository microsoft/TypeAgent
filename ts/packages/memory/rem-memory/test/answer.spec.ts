// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { filterByWeight, formatContext, SYSTEM_PROMPT } from "../src/answer.js";
import { Entity, Facet, RecallResult, TrustTier } from "../src/model.js";

function entity(id: string, name: string, facets: Facet[] = []): Entity {
    return { id, name, aliases: [name], types: [], facets };
}

function result(
    subject: Entity,
    predicate: string,
    object: Entity,
    weight = 1,
): RecallResult {
    return {
        relation: {
            id: `${subject.id}#${predicate}#${object.id}`,
            subjectId: subject.id,
            predicate,
            objectId: object.id,
        },
        subject,
        object,
        tier: TrustTier.ExtractorInferred,
        weight,
    };
}

describe("formatContext", () => {
    test("returns a placeholder when there are no results", () => {
        expect(formatContext([])).toBe("(no relevant facts in memory)");
    });

    test("renders numbered relations without an ENTITY DETAILS section", () => {
        const adrian = entity("e:1", "Adrian Tchaikovsky");
        const book = entity("e:2", "Children of Time");
        const text = formatContext([result(adrian, "wrote", book)]);

        expect(text).toContain(
            "1. Adrian Tchaikovsky — wrote — Children of Time",
        );
        expect(text).not.toContain("ENTITY DETAILS");
    });

    test("surfaces entity facets in an ENTITY DETAILS section", () => {
        const adrian = entity("e:1", "Adrian Tchaikovsky", [
            { name: "unsuccessful writing", value: "7 years" },
            { name: "nationality", value: "British" },
        ]);
        const book = entity("e:2", "Children of Time");
        const text = formatContext([result(adrian, "wrote", book)]);

        expect(text).toContain("ENTITY DETAILS:");
        expect(text).toContain(
            "- Adrian Tchaikovsky: unsuccessful writing: 7 years; nationality: British",
        );
    });

    test("lists each entity's facets only once across relations", () => {
        const adrian = entity("e:1", "Adrian Tchaikovsky", [
            { name: "nationality", value: "British" },
        ]);
        const book1 = entity("e:2", "Children of Time");
        const book2 = entity("e:3", "Children of Ruin");
        const text = formatContext([
            result(adrian, "wrote", book1),
            result(adrian, "wrote", book2),
        ]);

        const occurrences = text.split("- Adrian Tchaikovsky:").length - 1;
        expect(occurrences).toBe(1);
    });
});

describe("filterByWeight", () => {
    const a = entity("e:1", "A");
    const b = entity("e:2", "B");
    const c = entity("e:3", "C");

    test("drops results below the weight floor", () => {
        const results = [
            result(a, "wrote", b, 0.9),
            result(a, "wrote", c, 0.2),
        ];
        const kept = filterByWeight(results, 0.5);
        expect(kept).toHaveLength(1);
        expect(kept[0].object.name).toBe("B");
    });

    test("a floor of 0 (or below) is a no-op", () => {
        const results = [result(a, "wrote", b, 0.1)];
        expect(filterByWeight(results, 0)).toBe(results);
        expect(filterByWeight(results, -1)).toBe(results);
    });

    test("can filter everything out", () => {
        const results = [result(a, "wrote", b, 0.1)];
        expect(filterByWeight(results, 1)).toHaveLength(0);
    });
});

describe("SYSTEM_PROMPT grounding", () => {
    test("answers only from the facts without adding unsupported details", () => {
        // Guards the anti-hallucination contract: answers must stay inside the
        // recalled facts and never add names from general knowledge, while
        // still allowing the model to read/combine the facts to answer.
        expect(SYSTEM_PROMPT).toContain("ONLY the information in the MEMORY");
        expect(SYSTEM_PROMPT).toContain("read, interpret, and combine");
        expect(SYSTEM_PROMPT).toContain(
            "do not add any name, entity, or detail",
        );
        expect(SYSTEM_PROMPT).toContain("speculate beyond");
    });
});
