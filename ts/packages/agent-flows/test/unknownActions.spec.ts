// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    makeRegistry,
    findUnknownActionCalls,
    formatUnknownActionError,
    closestActions,
    levenshtein,
} from "../src/index.js";

const registry = makeRegistry(
    new Map<string, Set<string>>([
        ["excel.range", new Set(["setCellValue", "setFont", "getRangeValues"])],
        ["excel.table", new Set(["createTable", "filterTable"])],
    ]),
);

describe("findUnknownActionCalls", () => {
    test("returns empty when every call is known", () => {
        const script = `
            await api.callAction("excel.range", "setCellValue", { value: 1 });
            await api.callAction("excel.table", "createTable", {});
        `;
        expect(findUnknownActionCalls(script, registry)).toEqual([]);
    });

    test("flags an unknown action in a known schema with suggestions", () => {
        const script = `await api.callAction("excel.range", "setRangeItalic", {});`;
        const findings = findUnknownActionCalls(script, registry, {
            aliases: { setrangeitalic: ["setFont"] },
        });
        expect(findings).toHaveLength(1);
        const f = findings[0];
        expect(f.schemaName).toBe("excel.range");
        expect(f.actionName).toBe("setRangeItalic");
        // Alias should win the top suggestion slot.
        expect(f.suggestions[0]).toBe("setFont");
        expect(f.line).toBe(1);
    });

    test("flags an unknown schema with schema-name suggestions", () => {
        const script = `await api.callAction("excel.rang", "setCellValue", {});`;
        const findings = findUnknownActionCalls(script, registry);
        expect(findings).toHaveLength(1);
        expect(findings[0].schemaName).toBe("excel.rang");
        expect(findings[0].suggestions).toContain("excel.range");
    });

    test("dynamicSchemas allow-list suppresses findings for those schemas", () => {
        const script = `await api.callAction("excel-flow", "myFlow", {});`;
        const findings = findUnknownActionCalls(script, registry, {
            dynamicSchemas: new Set(["excel-flow"]),
        });
        expect(findings).toEqual([]);
    });

    test("deduplicates: the same (schema, action) pair called twice yields one finding", () => {
        const script = [
            `await api.callAction("excel.range", "totallyMadeUp", {});`,
            `await api.callAction("excel.range", "totallyMadeUp", {});`,
        ].join("\n");
        const findings = findUnknownActionCalls(script, registry);
        expect(findings).toHaveLength(1);
        // Anchored at the FIRST call site so the repair loop sees a stable line.
        expect(findings[0].line).toBe(1);
    });

    test("skips non-literal arguments (template literals, variables)", () => {
        const script = [
            "const s = 'excel.range';",
            "await api.callAction(s, 'setCellValue', {});",
            "await api.callAction(`excel.range`, `setCellValue`, {});",
        ].join("\n");
        // None of these match the literal-string-only regex, so nothing is flagged.
        expect(findUnknownActionCalls(script, registry)).toEqual([]);
    });

    test("respects maxSuggestions cap", () => {
        const big = makeRegistry(
            new Map<string, Set<string>>([
                [
                    "s",
                    new Set([
                        "setFoo",
                        "setBar",
                        "setBaz",
                        "setQux",
                        "setQuux",
                    ]),
                ],
            ]),
        );
        const script = `await api.callAction("s", "set", {});`;
        const findings = findUnknownActionCalls(script, big, {
            maxSuggestions: 2,
        });
        expect(findings[0].suggestions.length).toBeLessThanOrEqual(2);
    });
});

describe("formatUnknownActionError", () => {
    test("includes line, qualified name, and a 'Did you mean' trailer", () => {
        const msg = formatUnknownActionError({
            schemaName: "excel.range",
            actionName: "setRangeItalic",
            line: 42,
            suggestions: ["setFont", "setCellValue"],
        });
        expect(msg).toMatch(/Line 42/);
        expect(msg).toMatch(/excel\.range\.setRangeItalic/);
        expect(msg).toMatch(/Did you mean/);
        expect(msg).toMatch(/'setFont'/);
        expect(msg).toMatch(/'setCellValue'/);
    });

    test("omits the 'Did you mean' trailer when no suggestions exist", () => {
        const msg = formatUnknownActionError({
            schemaName: "s",
            actionName: "a",
            line: 1,
            suggestions: [],
        });
        expect(msg).not.toMatch(/Did you mean/);
    });
});

describe("closestActions", () => {
    test("alias matches are placed before fuzzy matches and deduplicated", () => {
        const actions = ["setFont", "setFill", "setBorder"];
        const result = closestActions("setRangeItalic", actions, {
            setrangeitalic: ["setFont"],
        });
        expect(result[0]).toBe("setFont");
        // Should not appear twice even though Levenshtein would also surface it.
        expect(result.filter((a) => a === "setFont")).toHaveLength(1);
    });

    test("alias candidates that aren't in the action set are silently dropped", () => {
        const actions = ["setFont"];
        const result = closestActions("foo", actions, {
            foo: ["doesNotExist"],
        });
        expect(result).not.toContain("doesNotExist");
    });

    test("substring containment beats pure Levenshtein distance", () => {
        // "save" appears inside "loadSaveDocument" but the edit distance is
        // larger than to "delete" (5). The substring-containment boost should
        // promote "loadSaveDocument" ahead of the closer-by-distance "delete".
        const actions = ["loadSaveDocument", "delete"];
        const result = closestActions("save", actions);
        expect(result[0]).toBe("loadSaveDocument");
    });

    test("returns at most maxSuggestions entries", () => {
        const actions = ["setA", "setB", "setC", "setD", "setE"];
        const result = closestActions("set", actions, {}, 2);
        expect(result.length).toBeLessThanOrEqual(2);
    });
});

describe("levenshtein", () => {
    test("identical strings are distance 0", () => {
        expect(levenshtein("abc", "abc")).toBe(0);
    });

    test("empty / non-empty cases use the longer length", () => {
        expect(levenshtein("", "abc")).toBe(3);
        expect(levenshtein("abc", "")).toBe(3);
    });

    test("single insertion is distance 1", () => {
        expect(levenshtein("abc", "abcd")).toBe(1);
    });

    test("single substitution is distance 1", () => {
        expect(levenshtein("kitten", "kitten".replace("k", "s"))).toBe(1);
    });

    test("classic kitten → sitting is distance 3", () => {
        expect(levenshtein("kitten", "sitting")).toBe(3);
    });
});
