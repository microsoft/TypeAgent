// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
    docPartsFromMarkdown,
    countDocTokens,
} from "@typeagent/conversation-memory";
import {
    indexedTextHash,
    parseIndexedLocator,
    selectIndexedFragments,
    type IndexedBlock,
} from "../src/indexedFragments.js";

test("bounded retrieval maps actual aggregated notebooks to measured source sections (no extraction/model)", async () => {
    const root = process.env.MEMORY_WIKI_FIXTURE_ROOT;
    if (!root)
        throw new Error(
            "Explicit MEMORY_WIKI_FIXTURE_ROOT required for converter-only fixture measurement",
        );
    const locators = JSON.parse(
        await readFile(
            path.join(root, "fixtures", "second-brain", "long-locations.json"),
            "utf8",
        ),
    ) as Record<
        string,
        {
            "content-only": Array<{
                relativeTo: string;
                section: number;
                start: number;
                end: number;
            }>;
        }
    >;
    const blocks: IndexedBlock[] = [];
    const mappings: Array<{
        sourceId: string;
        section: number;
        originalStart: number;
        originalEnd: number;
        blockOrdinal: number;
        indexedStart: number;
        indexedEnd: number;
        paragraph: string;
    }> = [];
    for (const [sourceId, variants] of Object.entries(locators)) {
        const source = await readFile(
            path.join(root, variants["content-only"][0].relativeTo),
            "utf8",
        );
        const parts = docPartsFromMarkdown(source, 8000, undefined, {
            maxTokensPerPart: 7500,
            collectLinkKnowledge: false,
            collectStructuralKnowledge: false,
        });
        const sourceBlocks = parts.map((part, blockOrdinal) => ({
            sourceId,
            revisionId: "converter-only-not-service-revision",
            blockOrdinal,
            text: part.textChunks.join("\n"),
            score: 1,
        }));
        blocks.push(...sourceBlocks);
        for (const section of variants["content-only"].filter((item) =>
            [1, 6, 12].includes(item.section),
        )) {
            const paragraph = source
                .slice(section.start, section.end)
                .split("\n\n")[0]
                .trim();
            const block = sourceBlocks.find((item) =>
                item.text.includes(paragraph),
            );
            if (
                !block ||
                block.text.indexOf(paragraph) !==
                    block.text.lastIndexOf(paragraph)
            )
                throw new Error(
                    "Measured source paragraph lacks a unique exact indexed alignment",
                );
            const indexedStart = block.text.indexOf(paragraph);
            mappings.push({
                sourceId,
                section: section.section,
                originalStart: section.start,
                originalEnd: section.end,
                blockOrdinal: block.blockOrdinal,
                indexedStart,
                indexedEnd: indexedStart + paragraph.length,
                paragraph,
            });
        }
    }
    const selected = selectIndexedFragments(blocks, {
        terms: ["acquisition", "overlap"],
        sourceIds: blocks.map((block) => block.sourceId),
    });
    const coverage = mappings.map(({ paragraph, ...mapping }) => ({
        ...mapping,
        completeFirstParagraph: selected.fragments.some(
            (fragment) =>
                fragment.sourceId === mapping.sourceId &&
                fragment.snippet.includes(paragraph),
        ),
    }));
    if (process.env.MEMORY_WIKI_LAYOUT_ROOT) {
        const output = path.resolve(process.env.MEMORY_WIKI_LAYOUT_ROOT);
        await mkdir(output);
        await writeFile(
            path.join(output, "layout.json"),
            JSON.stringify(
                {
                    kind: "converter-and-bounded-retrieval-only",
                    readChars: selected.readChars,
                    limited: selected.limited,
                    blocks: blocks.map(({ text, ...block }) => ({
                        ...block,
                        indexedChars: text.length,
                        tokens: countDocTokens(text),
                        hash: indexedTextHash(text),
                    })),
                    coverage,
                    windows: selected.fragments.map((fragment) => ({
                        sourceId: fragment.sourceId,
                        ...parseIndexedLocator(fragment.locator),
                    })),
                },
                null,
                2,
            ),
        );
    }
    expect(blocks).toHaveLength(2);
    expect(selected.readChars).toBeLessThanOrEqual(32000);
    expect(selected.fragments.length).toBeLessThanOrEqual(12);
    expect(coverage).toHaveLength(6);
    expect(coverage.every((item) => item.completeFirstParagraph)).toBe(true);
});
