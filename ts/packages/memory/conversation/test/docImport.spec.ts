// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    countEmbeddingTokens,
    maxEmbeddingInputTokens,
} from "@typeagent/aiclient";
import {
    aggregateDocParts,
    chunkDocParts,
    countDocTokens,
    defaultDocPartTokenLimit,
    docPartsFromHtml,
    docPartsFromMarkdown,
    docPartsFromText,
    docPartsFromVtt,
    mergeDocParts,
} from "../src/docImport.js";
import { DocPart, DocPartMeta } from "../src/docMemory.js";
import { parseVttTranscript } from "../src/transcript.js";

const sourceUrl = "typeagent-memory://sources/fixture/revisions/revision-1";
const korean = "\uC548\uB155\uD558\uC138\uC694";
const largeText = korean.repeat(2_000);

function verifyBudgets(
    parts: DocPart[],
    extractionLimit = defaultDocPartTokenLimit,
): void {
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
        expect(part.metadata.sourceUrl).toBe(sourceUrl);
        for (const text of part.textChunks) {
            expect(countDocTokens(text)).toBeLessThanOrEqual(extractionLimit);
            expect(countEmbeddingTokens(text)).toBeLessThanOrEqual(
                maxEmbeddingInputTokens,
            );
            expect(text).not.toContain("\uFFFD");
        }
    }
}

function vtt(alternating: boolean): string {
    const cues = Array.from({ length: 24 }, (_, index) => {
        const seconds = (value: number) =>
            `00:00:${String(value).padStart(2, "0")}.000`;
        const speaker = alternating && index % 2 ? "Bob" : "Alice";
        return `${seconds(index * 2)} --> ${seconds(index * 2 + 1)}\n<v ${speaker}>${"word ".repeat(500)}</v>`;
    });
    return "WEBVTT\n\n" + cues.join("\n\n") + "\n";
}

describe("shared document token budgeting (offline)", () => {
    test("splits an oversized word and Unicode without losing plain text or escaping markup", () => {
        const source =
            "  <literal>\\# heading\r\n\t" +
            "qz".repeat(25_497) +
            "\u{1F600}".repeat(60) +
            "  <|endoftext|>\r\n";
        for (const options of [undefined, { maxTokensPerPart: 7_500 }]) {
            const parts = docPartsFromText(source, 8_000, sourceUrl, options);
            verifyBudgets(parts);
            expect(parts.map((part) => part.textChunks.join("")).join("")).toBe(
                source,
            );
        }
    });

    test("enforces cl100k even when extraction's o200k count is under budget", () => {
        expect(countDocTokens(largeText)).toBeLessThan(7_500);
        expect(countEmbeddingTokens(largeText)).toBeGreaterThan(8_000);
        const parts = aggregateDocParts(
            [new DocPart(largeText, new DocPartMeta(sourceUrl))],
            7_500,
        );
        expect(parts.length).toBeGreaterThan(1);
        verifyBudgets(parts);
        expect(parts.map((part) => part.textChunks[0]).join("")).toBe(
            largeText,
        );
    });

    test.each(["markdown", "html", "html-text"])(
        "budgets %s through the same post-parser stage",
        (format) => {
            const options = {
                collectLinkKnowledge: false,
                collectStructuralKnowledge: false,
                maxTokensPerPart: 7_500,
            };
            const parts =
                format === "markdown"
                    ? docPartsFromMarkdown(
                          largeText,
                          100_000,
                          sourceUrl,
                          options,
                      )
                    : docPartsFromHtml(
                          `<html><body><p>${largeText}</p></body></html>`,
                          format === "html-text",
                          100_000,
                          sourceUrl,
                          undefined,
                          options,
                      );
            expect(parts.length).toBeGreaterThan(1);
            verifyBudgets(parts);
            expect(
                parts
                    .map((part) => part.textChunks[0])
                    .join("")
                    .trim(),
            ).toBe(largeText);
        },
    );

    test("splits a 12000-token same-speaker VTT turn and retains its timestamp", () => {
        const transcript = vtt(false);
        const [parsed] = parseVttTranscript(
            transcript,
            new Date(0),
            () => new DocPart(),
        );
        expect(parsed).toHaveLength(1);
        expect(countEmbeddingTokens(parsed[0].textChunks[0])).toBe(12_000);
        const parts = docPartsFromVtt(transcript, sourceUrl, {
            maxTokensPerPart: 7_500,
        });
        expect(parts.length).toBeGreaterThan(1);
        verifyBudgets(parts);
        expect(parts.map((part) => part.textChunks[0]).join("")).toBe(
            parsed[0].textChunks[0],
        );
        expect(new Set(parts.map((part) => part.timestamp)).size).toBe(1);
        expect(parts[0].timestamp).toBeDefined();
    });

    test("does not pack across VTT speaker turns", () => {
        const parts = docPartsFromVtt(vtt(true), sourceUrl, {
            maxTokensPerPart: 7_500,
        });
        expect(parts).toHaveLength(24);
        expect(new Set(parts.map((part) => part.timestamp)).size).toBe(24);
        verifyBudgets(parts);
    });

    test("accepts exact budgets and splits one token above them", () => {
        const exact = " word".repeat(8_000);
        const parts = chunkDocParts(
            [new DocPart(exact, new DocPartMeta(sourceUrl))],
            { maxTokensPerPart: 8_000 },
        );
        expect(parts).toHaveLength(1);
        verifyBudgets(parts, 8_000);
        const over = aggregateDocParts(
            [new DocPart(exact + " word", new DocPartMeta(sourceUrl))],
            8_000,
        );
        expect(over).toHaveLength(2);
        verifyBudgets(over, 8_000);
        expect(over.map((part) => part.textChunks[0]).join("")).toBe(
            exact + " word",
        );
        const extraction = docPartsFromText(
            " word".repeat(101),
            10_000,
            sourceUrl,
            { maxTokensPerPart: 100 },
        );
        expect(extraction).toHaveLength(2);
        verifyBudgets(extraction, 100);
    });

    test("retains metadata, tags, timestamp, deletion and pre-collected knowledge without duplicating facts", () => {
        const original = new DocPart(
            largeText,
            new DocPartMeta(sourceUrl),
            ["heading", { name: "fixture", type: ["section"] }],
            "2026-10-23T00:00:00.000Z",
            {
                entities: [{ name: "fixture", type: ["section"] }],
                actions: [],
                inverseActions: [],
                topics: ["fixture"],
            },
            { timestamp: "2026-10-23T01:00:00.000Z", reason: "fixture" },
        );
        const before = JSON.stringify(original);
        const parts = aggregateDocParts([original], 7_500);
        verifyBudgets(parts);
        expect(parts.length).toBeGreaterThan(1);
        for (const part of parts) {
            expect(part.metadata).toBe(original.metadata);
            expect(part.tags).toEqual(original.tags);
            expect(part.timestamp).toBe(original.timestamp);
            expect(part.deletionInfo).toEqual(original.deletionInfo);
        }
        expect(parts.flatMap((part) => part.knowledge?.entities ?? [])).toEqual(
            original.knowledge?.entities,
        );
        expect(parts[0].knowledge).not.toBe(original.knowledge);
        expect(JSON.stringify(original)).toBe(before);
    });

    test("packs only compatible sources and retains both parts' tags and knowledge", () => {
        const first = new DocPart("first", new DocPartMeta(sourceUrl), [
            "first",
        ]);
        const second = new DocPart(
            "second",
            new DocPartMeta(sourceUrl),
            ["second"],
            undefined,
            {
                entities: [],
                actions: [],
                inverseActions: [],
                topics: ["second"],
            },
        );
        const packed = aggregateDocParts([first, second], 100);
        expect(packed).toHaveLength(1);
        expect(packed[0].textChunks).toEqual(["first\n\nsecond"]);
        expect(packed[0].tags).toEqual(["first", "second"]);
        expect(packed[0].knowledge?.topics).toEqual(["second"]);
        expect(first.textChunks).toEqual(["first"]);
        const otherRevision = new DocPart(
            "other revision",
            new DocPartMeta(sourceUrl + "-2"),
        );
        expect(aggregateDocParts([first, otherRevision], 100)).toHaveLength(2);
        const timed = new DocPart(
            "timed",
            first.metadata,
            [],
            "2026-10-23T00:00:00.000Z",
        );
        expect(aggregateDocParts([timed, timed], 100)).toHaveLength(2);
        const deleted = new DocPart(
            "deleted",
            first.metadata,
            [],
            undefined,
            undefined,
            { timestamp: "2026-10-23T00:00:00.000Z" },
        );
        expect(aggregateDocParts([first, deleted], 100)).toHaveLength(2);
    });

    test("legacy merging is nontruncating and preserves each source", () => {
        const text = "qz".repeat(25_497);
        const parts = mergeDocParts(
            [
                new DocPart(text, new DocPartMeta(sourceUrl)),
                new DocPart("other", new DocPartMeta("other-source")),
            ],
            new DocPartMeta("obsolete-fallback"),
            8_000,
        );
        verifyBudgets(parts.slice(0, -1));
        for (const part of parts) {
            expect(Array.from(part.textChunks[0]).length).toBeLessThanOrEqual(
                8_000,
            );
        }
        expect(parts.at(-1)?.metadata.sourceUrl).toBe("other-source");
        expect(
            parts
                .slice(0, -1)
                .map((part) => part.textChunks[0])
                .join(""),
        ).toBe(text);
    });

    test("rejects invalid budgets and never splits a Unicode code point to fit", () => {
        for (const value of [0, -1, 1.5, NaN, Infinity]) {
            expect(() => aggregateDocParts([], value)).toThrow(
                "maxTokensPerPart must be a positive safe integer",
            );
        }
        expect(() => docPartsFromText("text", 0)).toThrow(
            "maxCharacters must be a positive safe integer",
        );
        expect(() => aggregateDocParts([new DocPart("\u{1F9D1}")], 1)).toThrow(
            "Cannot fit a Unicode code point",
        );
        expect(docPartsFromText("", 8_000)).toEqual([]);
        expect(aggregateDocParts([], 100)).toEqual([]);
    });
});
