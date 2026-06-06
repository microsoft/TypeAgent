// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EntityResolver,
    normalizeName,
    SimilarityFn,
} from "../src/resolver.js";
import { ObservedEntity } from "../src/model.js";

function observed(
    name: string,
    types: string[] = [],
    facets?: { name: string; value: string | number | boolean }[],
): ObservedEntity {
    return { name, types, facets };
}

describe("normalizeName", () => {
    test("lowercases, strips punctuation and diacritics, collapses space", () => {
        expect(normalizeName("  Adrian  Tchaikovsky! ")).toBe(
            "adrian tchaikovsky",
        );
        expect(normalizeName("Café")).toBe("cafe");
    });
});

describe("EntityResolver", () => {
    test("mints a new entity for an unseen name", async () => {
        const r = new EntityResolver();
        const { entity, created } = await r.resolve(
            observed("Adrian Tchaikovsky", ["author"]),
        );
        expect(created).toBe(true);
        expect(entity.id).toMatch(
            /^https:\/\/typeagent\.microsoft\.com\/rem\/entity\//,
        );
        expect(entity.aliases).toContain("Adrian Tchaikovsky");
        expect(entity.types).toContain("author");
    });

    test("merges exact normalized matches and unions types/aliases", async () => {
        const r = new EntityResolver();
        const a = await r.resolve(observed("Adrian Tchaikovsky", ["author"]));
        const b = await r.resolve(
            observed("adrian   tchaikovsky", ["novelist", "author"]),
        );
        expect(b.created).toBe(false);
        expect(b.entity.id).toBe(a.entity.id);
        expect(b.entity.types.sort()).toEqual(["author", "novelist"]);
        expect(r.all()).toHaveLength(1);
    });

    test("uses injected similarity to merge near-duplicates", async () => {
        const similarity: SimilarityFn = async (x, y) =>
            x.includes("Tchaikovsky") && y.includes("Tchaikovsky") ? 0.95 : 0;
        const r = new EntityResolver({ similarity, mergeThreshold: 0.9 });
        const a = await r.resolve(observed("Adrian Tchaikovsky"));
        const b = await r.resolve(observed("A. Tchaikovsky"));
        expect(b.created).toBe(false);
        expect(b.entity.id).toBe(a.entity.id);
        expect(b.entity.aliases).toContain("A. Tchaikovsky");
    });

    test("does not merge when similarity is below threshold", async () => {
        const similarity: SimilarityFn = async () => 0.1;
        const r = new EntityResolver({ similarity, mergeThreshold: 0.9 });
        await r.resolve(observed("Alice"));
        const b = await r.resolve(observed("Bob"));
        expect(b.created).toBe(true);
        expect(r.all()).toHaveLength(2);
    });

    test("merges facets with later-write-wins per facet name", async () => {
        const r = new EntityResolver();
        await r.resolve(
            observed("Book", ["work"], [{ name: "year", value: 2015 }]),
        );
        const b = await r.resolve(
            observed("book", [], [{ name: "year", value: 2016 }]),
        );
        const year = b.entity.facets.find((f) => f.name === "year");
        expect(year?.value).toBe(2016);
    });

    test("seed populates the alias index for later resolution", async () => {
        const r = new EntityResolver();
        r.seed([
            {
                id: "rem:entity/seeded",
                name: "Children of Time",
                aliases: ["Children of Time"],
                types: ["book"],
                facets: [],
            },
        ]);
        const { entity, created } = await r.resolve(
            observed("children of time"),
        );
        expect(created).toBe(false);
        expect(entity.id).toBe("rem:entity/seeded");
    });
});
