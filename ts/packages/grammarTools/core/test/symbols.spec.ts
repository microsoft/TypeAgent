// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    loadGrammarFromBuffer,
    getSymbolIndex,
    symbolAtPosition,
    type FileLoader,
} from "../src/index.js";
import { defaultFileLoader } from "action-grammar";

describe("symbols", () => {
    const source = [
        "<Start> = play $(song:<Song>);",
        "<Start> = pause;",
        "<Song> = $(name:string);",
    ].join("\n");

    it("collects rule definitions", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        expect(index.byId.has("Start")).toBe(true);
        expect(index.byId.has("Song")).toBe(true);
    });

    it("returns signature with rule name", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        const start = index.byId.get("Start");
        expect(start).toBeDefined();
        expect(start!.signature).toContain("<Start>");

        const song = index.byId.get("Song");
        expect(song).toBeDefined();
        expect(song!.signature).toContain("<Song>");
    });

    it("collects references to rules", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        const songRefs = index.references("Song");
        // <Song> is referenced in the first rule via $(song:<Song>)
        expect(songRefs.length).toBeGreaterThan(0);
    });

    it("has location info for definitions", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        const song = index.byId.get("Song");
        expect(song).toBeDefined();
        expect(song!.location.fileId).toBe("test.agr");
        expect(song!.location.range.start.line).toBe(2); // third line, 0-based
    });
});

describe("symbolAtPosition", () => {
    const source = [
        '<Start> = play $(song:<Song>) -> { action: "play", song };',
        "<Song> = $(name:string);",
    ].join("\n");

    it("returns rule ID when cursor is on a definition", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        // <Start> definition is at line 0, starting at character 0
        const id = symbolAtPosition(index, "test.agr", 0, 1);
        expect(id).toBe("Start");
    });

    it("returns rule ID when cursor is on a reference", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        // <Song> reference is inside $(song:<Song>) on line 0
        // Find where the reference actually is by checking refs
        const refs = index.references("Song");
        expect(refs.length).toBeGreaterThan(0);
        const ref = refs[0];
        const id = symbolAtPosition(
            index,
            ref.fileId,
            ref.range.start.line,
            ref.range.start.character + 1,
        );
        expect(id).toBe("Song");
    });

    it("returns null when cursor is not on a symbol", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        // Line 1 far past the end of content
        const id = symbolAtPosition(index, "test.agr", 1, 50);
        expect(id).toBeNull();
    });

    it("returns null for non-existent file", () => {
        const result = loadGrammarFromBuffer("test.agr", source);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        const id = symbolAtPosition(index, "other.agr", 0, 1);
        expect(id).toBeNull();
    });
});

describe("cross-file symbols", () => {
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
    const mainSource = `import { Greeting } from "./helper.agr";\n<Start> = <Greeting> world -> true;`;

    it("indexes definitions from imported files", () => {
        const loader = getTestFileLoader({
            "main.agr": mainSource,
            "helper.agr": helperSource,
        });
        const result = loadGrammarFromBuffer("main.agr", mainSource, loader);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        expect(index.byId.has("Start")).toBe(true);
        expect(index.byId.has("Greeting")).toBe(true);
    });

    it("imported definition has correct fileId", () => {
        const loader = getTestFileLoader({
            "main.agr": mainSource,
            "helper.agr": helperSource,
        });
        const result = loadGrammarFromBuffer("main.agr", mainSource, loader);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        const greeting = index.byId.get("Greeting");
        expect(greeting).toBeDefined();
        // The imported rule's fileId should differ from the main file
        const start = index.byId.get("Start");
        expect(start).toBeDefined();
        expect(greeting!.location.fileId).not.toBe(start!.location.fileId);
    });

    it("collects cross-file references", () => {
        const loader = getTestFileLoader({
            "main.agr": mainSource,
            "helper.agr": helperSource,
        });
        const result = loadGrammarFromBuffer("main.agr", mainSource, loader);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const index = getSymbolIndex(result.grammar);
        const refs = index.references("Greeting");
        // <Greeting> is referenced in main.agr (import + rule body)
        expect(refs.length).toBeGreaterThan(0);
    });
});
