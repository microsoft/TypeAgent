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
