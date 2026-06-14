// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    loadGrammarFromBuffer,
    loadGrammarFromFile,
    type FileLoader,
} from "../src/index.js";
import { defaultFileLoader } from "@typeagent/action-grammar";

describe("loader", () => {
    it("loads a simple grammar from a buffer", () => {
        const source = `<Start> = hello world -> true;`;
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.grammar.grammar).toBeDefined();
            expect(result.grammar.source).toEqual({
                kind: "buffer",
                id: "test.agr",
            });
            expect(result.grammar.files).toHaveLength(1);
            expect(result.grammar.identifiers.ruleIds.length).toBeGreaterThan(
                0,
            );
        }
    });

    it("returns ok: false for unparseable input", () => {
        const source = `this is not valid grammar syntax <<<`;
        const result = loadGrammarFromBuffer("bad.agr", source);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.diagnostics.length).toBeGreaterThan(0);
            expect(result.diagnostics[0].severity).toBe("error");
        }
    });

    it("returns source files in the result", () => {
        const source = `<Start> = play $(song:string) -> { action: "play", song };`;
        const result = loadGrammarFromBuffer("player.agr", source);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.grammar.files![0].text).toBe(source);
            expect(result.grammar.files![0].id).toBe("player.agr");
        }
    });

    // ---------------------------------------------------------------
    // Empty and edge-case inputs
    // ---------------------------------------------------------------

    it("returns ok: false for empty string", () => {
        const result = loadGrammarFromBuffer("empty.agr", "");
        expect(result.ok).toBe(false);
    });

    it("handles whitespace-only input", () => {
        const result = loadGrammarFromBuffer("ws.agr", "   \n\n  ");
        expect(result.ok).toBe(false);
    });

    // ---------------------------------------------------------------
    // Warnings
    // ---------------------------------------------------------------

    it("returns diagnostics with warnings for valid grammar", () => {
        // A grammar that parses but may produce warnings (e.g. unused rule)
        // At minimum, verify warnings array is propagated
        const source = `<Start> = hello -> true;`;
        const result = loadGrammarFromBuffer("warn.agr", source);
        expect(result.ok).toBe(true);
        if (result.ok) {
            // Diagnostics may or may not be present, but the structure is valid
            if (result.diagnostics) {
                for (const d of result.diagnostics) {
                    expect(d.severity).toBe("warning");
                    expect(d.source).toBe("grammar-tools-core");
                }
            }
        }
    });

    // ---------------------------------------------------------------
    // Identifier index
    // ---------------------------------------------------------------

    it("builds identifier index with ruleIds and partIds", () => {
        const source = `<Start> = hello world -> true;
<Start> = goodbye -> false;`;
        const result = loadGrammarFromBuffer("idx.agr", source);
        expect(result.ok).toBe(true);
        if (result.ok) {
            const idx = result.grammar.identifiers;
            expect(idx.ruleIds.length).toBe(2);
            expect(idx.partIds.length).toBeGreaterThan(0);
            // ruleIndex maps each ruleId to its index
            for (let i = 0; i < idx.ruleIds.length; i++) {
                expect(idx.ruleIndex.get(idx.ruleIds[i])).toBe(i);
            }
        }
    });

    it("partIds are unique across rules", () => {
        const source = `<Start> = a b c -> 1;
<Start> = d e f -> 2;`;
        const result = loadGrammarFromBuffer("parts.agr", source);
        expect(result.ok).toBe(true);
        if (result.ok) {
            const ids = result.grammar.identifiers.partIds;
            const unique = new Set(ids);
            expect(unique.size).toBe(ids.length);
        }
    });

    // ---------------------------------------------------------------
    // GrammarDebugInfo
    // ---------------------------------------------------------------

    it("populates debugInfo with part and rule positions", () => {
        const source = `<Start> = hello world -> true;
<Start> = goodbye -> false;`;
        const result = loadGrammarFromBuffer("debug.agr", source);
        expect(result.ok).toBe(true);
        if (result.ok) {
            const dbg = result.grammar.debugInfo;
            expect(dbg).toBeDefined();
            expect(dbg!.rules.size).toBeGreaterThan(0);
            expect(dbg!.parts.size).toBeGreaterThan(0);
            // Every source location should have valid line/character
            for (const loc of dbg!.parts.values()) {
                expect(loc.range.start.line).toBeGreaterThanOrEqual(0);
                expect(loc.range.start.character).toBeGreaterThanOrEqual(0);
                expect(loc.range.start.offset).toBeGreaterThanOrEqual(0);
            }
            for (const loc of dbg!.rules.values()) {
                expect(loc.range.start.line).toBeGreaterThanOrEqual(0);
                expect(loc.range.start.character).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it("debugInfo part positions point to correct source offsets", () => {
        const source = `<Start> = play $(song:string) -> { action: "play", song };`;
        const result = loadGrammarFromBuffer("pos.agr", source);
        expect(result.ok).toBe(true);
        if (result.ok) {
            const dbg = result.grammar.debugInfo;
            expect(dbg).toBeDefined();
            // At least one part should reference a position in the source
            for (const loc of dbg!.parts.values()) {
                expect(loc.range.start.offset).toBeLessThan(source.length);
                expect(loc.fileId).toBe("pos.agr");
            }
        }
    });

    it("debugInfo grammarHash is populated", () => {
        const source = `<Start> = hello -> true;`;
        const result = loadGrammarFromBuffer("hash.agr", source);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.grammar.debugInfo!.grammarHash).toBeDefined();
            expect(
                result.grammar.debugInfo!.grammarHash.length,
            ).toBeGreaterThan(0);
        }
    });

    // ---------------------------------------------------------------
    // File I/O (loadGrammarFromFile)
    // ---------------------------------------------------------------

    it("rejects non-existent file", async () => {
        await expect(
            loadGrammarFromFile("/tmp/does-not-exist-grammar-tools.agr"),
        ).rejects.toThrow();
    });

    // ---------------------------------------------------------------
    // Not-yet-implemented loaders
    // ---------------------------------------------------------------

    it("loadGrammarFromAgent throws not yet implemented", async () => {
        const { loadGrammarFromAgent } = await import("../src/loader.js");
        await expect(loadGrammarFromAgent("test-agent")).rejects.toThrow(
            /not yet implemented/,
        );
    });

    it("loadGrammarFromSnapshot throws not yet implemented", async () => {
        const { loadGrammarFromSnapshot } = await import("../src/loader.js");
        expect(() => loadGrammarFromSnapshot({ grammar: {} })).toThrow(
            /not yet implemented/,
        );
    });
});

describe("loadGrammarFromBuffer with FileLoader (imports)", () => {
    function getTestFileLoader(
        grammarFiles: Record<string, string>,
    ): FileLoader {
        const fileMap = new Map(
            Object.keys(grammarFiles).map((key) => [
                defaultFileLoader.resolvePath(key),
                key,
            ]),
        );
        return {
            ...defaultFileLoader,
            readContent: (fullPath: string) => {
                const fileKey = fileMap.get(fullPath);
                const content = fileKey ? grammarFiles[fileKey] : undefined;
                if (content === undefined) {
                    throw new Error(`File not found: ${fullPath}`);
                }
                return content;
            },
        };
    }

    const helperSource = `export <Greeting> = (hello | hi) -> "greeting";`;
    const mainSource = `
        import { Greeting } from "./helper.agr";
        <Start> = $(g:<Greeting>) world -> { g, target: "world" };
    `;

    it("resolves imports when FileLoader is provided", () => {
        const loader = getTestFileLoader({
            "main.agr": mainSource,
            "helper.agr": helperSource,
        });
        const result = loadGrammarFromBuffer("main.agr", mainSource, loader);
        expect(result.ok).toBe(true);
    });

    it("includes imported files in LoadedGrammar.files", () => {
        const loader = getTestFileLoader({
            "main.agr": mainSource,
            "helper.agr": helperSource,
        });
        const result = loadGrammarFromBuffer("main.agr", mainSource, loader);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const files = result.grammar.files!;
        expect(files.length).toBeGreaterThanOrEqual(2);

        // Root file should not be marked as imported
        const root = files.find((f) => !f.imported);
        expect(root).toBeDefined();

        // Imported file should be marked as imported
        const imported = files.filter((f) => f.imported);
        expect(imported.length).toBeGreaterThanOrEqual(1);
    });

    it("populates debugInfo.filePaths for multi-file grammars", () => {
        const loader = getTestFileLoader({
            "main.agr": mainSource,
            "helper.agr": helperSource,
        });
        const result = loadGrammarFromBuffer("main.agr", mainSource, loader);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const dbg = result.grammar.debugInfo;
        expect(dbg).toBeDefined();
        expect(dbg!.filePaths.size).toBeGreaterThanOrEqual(2);
    });

    it("fails gracefully without FileLoader (no import resolution)", () => {
        // Without a FileLoader, imports cannot be resolved; the grammar
        // still loads but the imported rules are unresolved (error).
        const result = loadGrammarFromBuffer("main.agr", mainSource);
        expect(result.ok).toBe(false);
    });
});
