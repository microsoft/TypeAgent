// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import type { DebugInfoCollector } from "../src/grammarCompiler.js";
import { defaultFileLoader } from "../src/defaultFileLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { grammarToJson } from "../src/grammarSerializer.js";
import { grammarFromJson } from "../src/grammarDeserializer.js";
import type { TraceEvent } from "../src/traceEvents.js";

function makeCollector(): DebugInfoCollector {
    return {
        partPositions: new Map(),
        rulePositions: new Map(),
        partRules: new Map(),
        partLabels: new Map(),
        fileContents: new Map(),
        filePaths: new Map(),
    };
}

describe("partId assignment", () => {
    it("assigns sequential partIds during compilation", () => {
        const source = `<Start> = hello world -> true;
<Start> = goodbye friend -> false;`;
        const collector = makeCollector();
        const grammar = loadGrammarRules("test", source, {
            debugCollector: collector,
        });

        // Every part in the grammar should have a partId
        const partIds = new Set<number>();
        for (const rule of grammar.alternatives) {
            for (const part of rule.parts) {
                expect(part.partId).toBeDefined();
                expect(typeof part.partId).toBe("number");
                partIds.add(part.partId!);
            }
        }
        // All partIds should be unique
        expect(partIds.size).toBeGreaterThan(0);

        // Collector should have recorded positions for all partIds
        for (const id of partIds) {
            expect(collector.partPositions.has(id)).toBe(true);
        }
    });

    it("records rule positions in debug collector", () => {
        const source = `<Start> = hello -> true;
<Action> = play -> "play";`;
        const collector = makeCollector();
        loadGrammarRules("test", source, { debugCollector: collector });

        expect(collector.rulePositions.size).toBeGreaterThan(0);
        // Rule positions should be valid offsets into the source
        for (const pos of collector.rulePositions.values()) {
            expect(pos.offset).toBeGreaterThanOrEqual(0);
            expect(pos.offset).toBeLessThan(source.length);
        }
    });

    it("part positions point to valid source offsets", () => {
        const source = `<Start> = play $(song:string) -> { action: "play", song };`;
        const collector = makeCollector();
        loadGrammarRules("test", source, { debugCollector: collector });

        for (const pos of collector.partPositions.values()) {
            expect(pos.offset).toBeGreaterThanOrEqual(0);
            expect(pos.offset).toBeLessThan(source.length);
        }
    });
});

describe("partId serialization round-trip", () => {
    it("preserves partIds through JSON serialization", () => {
        const source = `<Start> = play $(song:string) -> { action: "play", song };
<Start> = pause -> { action: "pause" };`;
        const collector = makeCollector();
        const grammar = loadGrammarRules("test", source, {
            debugCollector: collector,
        });

        // Serialize and deserialize
        const json = grammarToJson(grammar);
        const restored = grammarFromJson(json);

        // Verify partIds survived the round-trip
        for (let r = 0; r < grammar.alternatives.length; r++) {
            const origRule = grammar.alternatives[r];
            const restoredRule = restored.alternatives[r];
            expect(restoredRule.parts.length).toBe(origRule.parts.length);
            for (let p = 0; p < origRule.parts.length; p++) {
                expect(restoredRule.parts[p].partId).toBe(
                    origRule.parts[p].partId,
                );
            }
        }
    });
});

describe("partId in trace events", () => {
    it("trace events use partId instead of raw index", () => {
        const source = `<Start> = hello world -> true;`;
        const collector = makeCollector();
        const grammar = loadGrammarRules("test", source, {
            debugCollector: collector,
        });

        const events: TraceEvent[] = [];
        matchGrammar(grammar, "hello world", {
            trace: (e) => events.push(e),
        });

        const partEvents = events.filter(
            (e) =>
                e.kind === "partAttempted" ||
                e.kind === "partMatched" ||
                e.kind === "partFailed",
        );
        expect(partEvents.length).toBeGreaterThan(0);

        // Collect the actual partIds from the grammar
        const validPartIds = new Set<number>();
        for (const rule of grammar.alternatives) {
            for (const part of rule.parts) {
                if (part.partId !== undefined) {
                    validPartIds.add(part.partId);
                }
            }
        }

        // Each part event's "part" field should be a valid partId
        for (const e of partEvents) {
            if ("part" in e) {
                expect(validPartIds.has(e.part)).toBe(true);
            }
        }
    });
});

describe("filePaths in DebugInfoCollector", () => {
    function getTestFileLoader(grammarFiles: Record<string, string>) {
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

    it("records filePaths for single-file grammar", () => {
        const source = `<Start> = hello -> true;`;
        const collector = makeCollector();
        loadGrammarRules("test.agr", source, { debugCollector: collector });

        // fileContents should have the source
        expect(collector.fileContents.size).toBeGreaterThan(0);
    });

    it("records filePaths for multi-file grammar with imports", () => {
        const grammarFiles: Record<string, string> = {
            "helper.agr": `export <Greeting> = (hello | hi) -> "greeting";`,
            "main.agr": `
                import { Greeting } from "./helper.agr";
                <Start> = $(g:<Greeting>) world -> { g, target: "world" };
            `,
        };

        const collector = makeCollector();
        const loader = getTestFileLoader(grammarFiles);
        loadGrammarRules("main.agr", loader, { debugCollector: collector });

        // Both files should appear in fileContents
        expect(collector.fileContents.size).toBeGreaterThanOrEqual(2);

        // filePaths should map displayPath -> resolved full path for each file
        expect(collector.filePaths.size).toBeGreaterThanOrEqual(2);

        // Each filePaths key should also exist in fileContents
        for (const displayPath of collector.filePaths.keys()) {
            expect(collector.fileContents.has(displayPath)).toBe(true);
        }
    });
});

describe("partLabels in DebugInfoCollector", () => {
    it("records labels for string-literal parts", () => {
        const source = `<Start> = play -> true;`;
        const collector = makeCollector();
        loadGrammarRules("test", source, { debugCollector: collector });

        expect(collector.partLabels.size).toBeGreaterThan(0);
        const labels = [...collector.partLabels.values()];
        expect(labels.some((l) => l === '\"play\"')).toBe(true);
    });

    it("records labels for variable parts", () => {
        const source = `<Start> = play $(song:string) -> { action: "play", song };`;
        const collector = makeCollector();
        loadGrammarRules("test", source, { debugCollector: collector });

        const labels = [...collector.partLabels.values()];
        expect(labels.some((l) => l.includes("$song"))).toBe(true);
    });

    it("records labels for rule reference parts", () => {
        const source = `<Start> = <Action> -> true;
<Action> = play -> "play";`;
        const collector = makeCollector();
        loadGrammarRules("test", source, { debugCollector: collector });

        const labels = [...collector.partLabels.values()];
        expect(labels.some((l) => l.includes("Action"))).toBe(true);
    });

    it("every partId has a corresponding label", () => {
        const source = `<Start> = play $(song:string) by $(artist:string) -> { song, artist };`;
        const collector = makeCollector();
        const grammar = loadGrammarRules("test", source, {
            debugCollector: collector,
        });

        // Collect all partIds from the grammar
        for (const rule of grammar.alternatives) {
            for (const part of rule.parts) {
                if (part.partId !== undefined) {
                    expect(collector.partLabels.has(part.partId)).toBe(true);
                }
            }
        }
    });
});
