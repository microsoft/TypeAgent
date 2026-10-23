// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    markdownTableContinuations,
    markdownToTextAndKnowledgeBlocks,
    markdownToTextBlocks,
    markdownTokenize,
} from "../src/markdown.js";
import { htmlToMarkdown, htmlToText } from "../src/html.js";
import type { Tokens } from "marked";

function tableToken(markdown: string): Tokens.Table {
    const token = markdownTokenize(markdown).find(
        (token) => token.type === "table",
    );
    if (token?.type !== "table") {
        throw new Error("Test input must contain a table");
    }
    return token as Tokens.Table;
}

function expectValidBoundaries(text: string): void {
    expect(text).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(text).not.toMatch(/^[\uDC00-\uDFFF]/);
    expect(text).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
}

describe("bounded loss-preserving Markdown tables", () => {
    const tail =
        "EXCEPTION: short commands do not imply short held leases; exclude the stalled cohort.";
    const cell =
        Array.from(
            { length: 700 },
            (_, i) =>
                `Observation ${i}: command 😀 and held lease remain distinct. `,
        ).join("") + tail;
    const markdown = `# Capacity\n\n| Cohort | Qualification |\n| --- | --- |\n| pool-A | ${cell} |\n\nAfter the worksheet.\n`;

    test.each([128, 511, 8_000])(
        "covers exact source and semantic tail at a %i UTF-16 bound",
        (bound) => {
            const table = tableToken(markdown);
            const original = structuredClone(table);
            const continuations = markdownTableContinuations(table, bound);
            const recovered = continuations
                .map((chunk) => {
                    expect(chunk.text.length).toBeLessThanOrEqual(bound);
                    expectValidBoundaries(chunk.text);
                    expectValidBoundaries(
                        table.raw.slice(chunk.sourceStart, chunk.sourceEnd),
                    );
                    expect(chunk.text.slice(chunk.contentStart)).toBe(
                        table.raw.slice(chunk.sourceStart, chunk.sourceEnd),
                    );
                    return chunk.text.slice(chunk.contentStart);
                })
                .join("");
            expect(recovered).toBe(table.raw);
            expect(
                continuations.reduce(
                    (length, chunk) =>
                        length + chunk.sourceEnd - chunk.sourceStart,
                    0,
                ),
            ).toBe(table.raw.length);
            for (let i = 1; i < continuations.length; ++i) {
                expect(continuations[i].sourceStart).toBe(
                    continuations[i - 1].sourceEnd,
                );
            }
            expect(recovered).toContain(tail);
            expect(table).toEqual(original);

            const [blocks, knowledge] = markdownToTextAndKnowledgeBlocks(
                markdown,
                bound,
            );
            expect(blocks.every((block) => block.length <= bound)).toBe(true);
            expect(blocks).toHaveLength(knowledge.length);
            blocks.forEach(expectValidBoundaries);
            expect(blocks.join("")).toContain("After the worksheet.");
            if (bound === 8_000) {
                expect(blocks.some((block) => block.includes(tail))).toBe(true);
            }
            expect(
                blocks.filter((block) => block.includes("continuation")).length,
            ).toBeGreaterThan(1);
            expect(table).toEqual(original);
        },
    );

    test("does not lose multiple cells, oversized headers or escaped pipes", () => {
        const header = "Header 😀 ".repeat(50);
        const source = `| ${header} | Other |\n| --- | --- |\n| ${"first\\|😀 ".repeat(80)} | ${"second 😀 ".repeat(80)} |\n| ordinary | last |\n`;
        const table = tableToken(source);
        for (const bound of [2, 3, 31, 127]) {
            const continuations = markdownTableContinuations(table, bound);
            expect(
                continuations
                    .map((chunk) => chunk.text.slice(chunk.contentStart))
                    .join(""),
            ).toBe(table.raw);
            for (const chunk of continuations) {
                expect(chunk.text.length).toBeLessThanOrEqual(bound);
                expectValidBoundaries(chunk.text);
            }
            const blocks = markdownToTextBlocks(source, undefined, bound);
            expect(blocks.every((block) => block.length <= bound)).toBe(true);
        }
    });

    test("preserves original HTML cells and existing HTML-to-Markdown semantics", () => {
        const html = `<table><tr><th>Pool</th><th>Condition</th></tr><tr><td>A</td><td><b>${cell}</b></td></tr></table>`;
        const converted = htmlToMarkdown(html);
        expect(
            markdownToTextBlocks(converted, undefined, 8_000).join(""),
        ).toContain(tail.slice(0, -1));
        const table = tableToken(
            `| Pool | Condition |\n| --- | --- |\n| A | <span data-note="kept"><b>${cell}</b></span> |\n`,
        );
        const chunks = markdownTableContinuations(table, 8_000);
        const recovered = chunks
            .map((chunk) => chunk.text.slice(chunk.contentStart))
            .join("");
        expect(recovered).toBe(table.raw);
        expect(htmlToText(recovered)).toContain(tail);
        expect(recovered).toContain('data-note="kept"');
    });

    test("preserves ordinary text and small tables verbatim", () => {
        const source =
            "# Heading\n\nOrdinary **text** and [link](https://example.com).\n\n| A | B |\n| --- | --- |\n| one | two |\n";
        expect(markdownToTextBlocks(source, undefined, 8_000)).toEqual([
            "# Heading\n\nOrdinary **text** and [link](https://example.com).\n| A | B |\n| --- | --- |\n| one | two |\n",
        ]);
    });

    test("counts repeated headers and table syntax in ordinary multirow bounds", () => {
        const source = `| A | B |\n| --- | --- |\n${"| one | two |\n".repeat(40)}`;
        const blocks = markdownToTextBlocks(source, undefined, 80);
        expect(blocks.length).toBeGreaterThan(1);
        expect(blocks.every((block) => block.length <= 80)).toBe(true);
        expect(blocks.join("").match(/\|one\|two\|/g)).toHaveLength(40);
    });

    test("maps retained raw CRLF content without parser newline normalization", () => {
        const raw = `| Key | Condition |\r\n| --- | --- |\r\n| A | ${"raw 😀 ".repeat(100)} |\r\n`;
        const chunks = markdownTableContinuations({ raw }, 127);
        expect(
            chunks
                .map((chunk) => chunk.text.slice(chunk.contentStart))
                .join(""),
        ).toBe(raw);
        for (const chunk of chunks) {
            expect(chunk.text.slice(chunk.contentStart)).toBe(
                raw.slice(chunk.sourceStart, chunk.sourceEnd),
            );
        }
    });

    test.each([0, 1, -1, 2.5, NaN, Infinity])(
        "rejects a nonrepresentable bound %s explicitly",
        (bound) => {
            expect(() =>
                markdownTableContinuations(
                    tableToken("| A |\n| --- |\n| B |\n"),
                    bound,
                ),
            ).toThrow("maxCharsPerChunk must be a safe integer of at least 2");
        },
    );
});
