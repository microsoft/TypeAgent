// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { formatContext } from "../src/answer.js";
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
