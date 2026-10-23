// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import {
    aggregateDocParts,
    countDocTokens,
    docPartsFromMarkdown,
    splitDocPartTextForEmbedding,
} from "../src/docImport.js";
import { DocPart, DocPartMeta } from "../src/docMemory.js";

describe("exact-token document aggregation", () => {
    test.each([23_999, 24_000, 24_001])(
        "measures the actual %i-token joined input",
        (tokens) => {
            const first = " x".repeat(tokens - 2);
            const second = " y";
            expect(countDocTokens(`${first}\n\n${second}`)).toBe(tokens);
            const parts = aggregateDocParts(
                [new DocPart(first), new DocPart(second)],
                24_000,
            );
            expect(parts).toHaveLength(tokens <= 24_000 ? 1 : 2);
            expect(parts.map((part) => part.textChunks[0]).join("\n\n")).toBe(
                `${first}\n\n${second}`,
            );
        },
    );

    test("preserves oversized indivisible parts, metadata, tags and knowledge without aliasing", () => {
        const original = new DocPart(
            " x".repeat(24_001),
            new DocPartMeta("https://memory.test/source"),
            ["section"],
            "2026-10-22T00:00:00Z",
            {
                entities: [],
                actions: [],
                inverseActions: [],
                topics: ["topic"],
            },
        );
        const parts = aggregateDocParts(
            [original, new DocPart("next")],
            24_000,
        );
        expect(parts).toHaveLength(2);
        expect(parts[0]).toEqual(original);
        parts[0].tags.push("changed");
        parts[0].knowledge!.topics.push("changed");
        expect(original.tags).toEqual(["section"]);
        expect(original.knowledge!.topics).toEqual(["topic"]);
    });

    test("keeps production structural text at both targets and leaves direct callers unaggregated", () => {
        const markdown = Array.from(
            { length: 24 },
            (_, i) =>
                `## Section ${i}\n\n${"Zephyr recovery instructions remain approved. ".repeat(90)}\n\n- Checklist\n\n| Key | Value |\n| --- | --- |\n| State | ready |\n\n\`\`\`ts\nconst ready = true;\n\`\`\``,
        ).join("\n\n");
        const options = {
            collectLinkKnowledge: false,
            collectStructuralKnowledge: false,
        };
        const structural = docPartsFromMarkdown(
            markdown,
            8000,
            undefined,
            options,
        );
        const baseline = docPartsFromMarkdown(markdown, 8000, undefined, {
            ...options,
            maxTokensPerPart: 7500,
        });
        const treatment = docPartsFromMarkdown(markdown, 8000, undefined, {
            ...options,
            maxTokensPerPart: 24000,
        });
        expect(treatment.length).toBeLessThan(baseline.length);
        expect(structural.length).toBeGreaterThan(baseline.length);
        const text = (parts: DocPart[]) =>
            parts.map((part) => part.textChunks.join("\n\n")).join("\n\n");
        expect(text(treatment)).toBe(text(structural));
        expect(text(baseline)).toBe(text(structural));
        for (const part of treatment) {
            expect(part.knowledge?.entities ?? []).toEqual([]);
            expect(part.knowledge?.topics ?? []).toEqual([]);
        }
    });
});

describe("separate document embedding windows", () => {
    test.each([
        " x".repeat(24_001),
        "\u6f22\u5b57\u{1f680} recovery ".repeat(4000),
        "<|endoftext|> literals remain source text. ".repeat(3000),
    ])(
        "preserves every source character and both tokenizer budgets",
        (text) => {
            const chunks = splitDocPartTextForEmbedding(text);
            expect(chunks.length).toBeGreaterThan(1);
            expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
            let end = 0;
            for (const chunk of chunks) {
                expect(chunk.start).toBe(end);
                expect(chunk.text).toBe(text.slice(chunk.start, chunk.end));
                expect(chunk.text).not.toContain("\ufffd");
                expect(countDocTokens(chunk.text)).toBeLessThanOrEqual(7500);
                expect(
                    countTokens(chunk.text, {
                        allowedSpecial: new Set(),
                        disallowedSpecial: new Set(),
                    }),
                ).toBeLessThanOrEqual(7500);
                end = chunk.end;
            }
            expect(end).toBe(text.length);
        },
    );

    test("keeps short and empty inputs unchanged", () => {
        for (const text of ["", "Short source."])
            expect(splitDocPartTextForEmbedding(text)).toEqual([
                { text, start: 0, end: text.length },
            ]);
    });
});
