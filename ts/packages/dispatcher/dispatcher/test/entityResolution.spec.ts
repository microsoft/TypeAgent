// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { resolveEntityPlaceholders } from "../src/execute/pendingActions.js";
import { PromptEntity } from "agent-cache";

function makeMap(entries: Array<[string, string]>): Map<string, PromptEntity> {
    return new Map(
        entries.map(([key, name]) => [
            key,
            {
                name,
                type: ["table"],
                sourceAppAgentName: "excel",
            } satisfies PromptEntity,
        ]),
    );
}

// Richer entity shape for path-navigation tests — mirrors a real PromptEntity
// with facets and a uniqueId so dotted paths have something to walk.
function makeRichMap(): Map<string, PromptEntity> {
    return new Map<string, PromptEntity>([
        [
            "${entity-0}",
            {
                name: "Sheet1",
                type: ["worksheet", "active"],
                uniqueId: "worksheet:Sheet1",
                facets: [
                    { name: "usedRange", value: "A1:A7" },
                    { name: "author", value: "R. Gruen" },
                ],
                sourceAppAgentName: "excel",
            },
        ],
        [
            "${entity-1}",
            {
                name: "Budget",
                type: ["table"],
                sourceAppAgentName: "excel",
            },
        ],
    ]);
}

describe("resolveEntityPlaceholders", () => {
    const map = makeMap([
        ["${entity-0}", "SalesData"],
        ["${entity-1}", "Budget"],
    ]);

    it("resolves a bare whole-value reference", () => {
        expect(resolveEntityPlaceholders("${entity-0}", map)).toBe("SalesData");
    });

    it("resolves an embedded structured reference", () => {
        expect(resolveEntityPlaceholders("${entity-0}[Revenue]", map)).toBe(
            "SalesData[Revenue]",
        );
    });

    it("resolves multiple embedded references in one string", () => {
        expect(
            resolveEntityPlaceholders(
                "${entity-0}[Revenue],${entity-0}[Profit]",
                map,
            ),
        ).toBe("SalesData[Revenue],SalesData[Profit]");
    });

    it("resolves references to different entities in one string", () => {
        expect(
            resolveEntityPlaceholders(
                "${entity-0}[Sales],${entity-1}[Cost]",
                map,
            ),
        ).toBe("SalesData[Sales],Budget[Cost]");
    });

    it("passes through strings with no placeholders unchanged", () => {
        expect(resolveEntityPlaceholders("A1:D10", map)).toBe("A1:D10");
        expect(resolveEntityPlaceholders("SalesData[Revenue]", map)).toBe(
            "SalesData[Revenue]",
        );
    });

    it("throws when a placeholder index is not in the map", () => {
        expect(() =>
            resolveEntityPlaceholders("${entity-99}[Revenue]", map),
        ).toThrow("Entity reference not found: ${entity-99}");
    });

    it("throws when the map is undefined", () => {
        expect(() =>
            resolveEntityPlaceholders("${entity-0}", undefined),
        ).toThrow("Entity reference not found: ${entity-0}");
    });
});

describe("resolveEntityPlaceholders — path navigation", () => {
    const rich = makeRichMap();

    describe('mode "off"', () => {
        it("passes dotted paths through untouched (legacy behavior)", () => {
            expect(
                resolveEntityPlaceholders(
                    "${entity-0.facets[0].value}",
                    rich,
                    "off",
                ),
            ).toBe("${entity-0.facets[0].value}");
        });

        it("still resolves bare forms when mode is off", () => {
            expect(resolveEntityPlaceholders("${entity-0}", rich, "off")).toBe(
                "Sheet1",
            );
        });
    });

    describe('mode "throw"', () => {
        it("resolves a valid facet path to a scalar value", () => {
            expect(
                resolveEntityPlaceholders(
                    "${entity-0.facets[0].value}",
                    rich,
                    "throw",
                ),
            ).toBe("A1:A7");
        });

        it("resolves a direct scalar property", () => {
            expect(
                resolveEntityPlaceholders(
                    "${entity-0.uniqueId}",
                    rich,
                    "throw",
                ),
            ).toBe("worksheet:Sheet1");
        });

        it("resolves an embedded path in a longer string", () => {
            expect(
                resolveEntityPlaceholders(
                    "range=${entity-0.facets[0].value} in ${entity-0.name}",
                    rich,
                    "throw",
                ),
            ).toBe("range=A1:A7 in Sheet1");
        });

        it("JSON-encodes object/array leaves", () => {
            // facets is an array of objects — walking to it without indexing
            // should surface JSON rather than "[object Object]".
            expect(
                resolveEntityPlaceholders("${entity-0.facets}", rich, "throw"),
            ).toMatch(/^\[\{"name":"usedRange"/);
        });

        it("throws on a missing property path with a descriptive error", () => {
            expect(() =>
                resolveEntityPlaceholders(
                    "${entity-0.nonexistent.field}",
                    rich,
                    "throw",
                ),
            ).toThrow(/Entity path did not resolve/);
        });

        it("throws on an out-of-bounds array index", () => {
            expect(() =>
                resolveEntityPlaceholders(
                    "${entity-0.facets[99].value}",
                    rich,
                    "throw",
                ),
            ).toThrow(/Entity path did not resolve/);
        });

        it("throws on malformed path syntax", () => {
            expect(() =>
                resolveEntityPlaceholders(
                    "${entity-0 bad path}",
                    rich,
                    "throw",
                ),
            ).toThrow(/Entity path did not resolve/);
        });
    });

    describe('mode "fallback-to-name"', () => {
        it("returns the entity name on path miss", () => {
            expect(
                resolveEntityPlaceholders(
                    "${entity-0.nonexistent}",
                    rich,
                    "fallback-to-name",
                ),
            ).toBe("Sheet1");
        });

        it("still resolves valid paths", () => {
            expect(
                resolveEntityPlaceholders(
                    "${entity-0.facets[1].value}",
                    rich,
                    "fallback-to-name",
                ),
            ).toBe("R. Gruen");
        });
    });

    describe('mode "passthrough"', () => {
        it("leaves the literal placeholder on path miss", () => {
            expect(
                resolveEntityPlaceholders(
                    "${entity-0.nonexistent}",
                    rich,
                    "passthrough",
                ),
            ).toBe("${entity-0.nonexistent}");
        });

        it("still resolves valid paths", () => {
            expect(
                resolveEntityPlaceholders(
                    "${entity-0.facets[0].value}",
                    rich,
                    "passthrough",
                ),
            ).toBe("A1:A7");
        });
    });
});
