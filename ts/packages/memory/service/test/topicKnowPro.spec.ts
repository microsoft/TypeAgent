// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { KnowProCorpusIndex } from "../src/knowProCorpusIndex.js";
import { parseIndexedLocator } from "../src/indexedFragments.js";
import type { IndexedDocument } from "../src/types.js";

function settings(
    labels = ["command versus held lease", "resource", "failure"],
) {
    const settings = createDocMemorySettings(64, undefined, {
        completionSettings: {},
        complete: async () => ({ success: true as const, data: "{}" }),
    });
    settings.embeddingSize = 0;
    const knowledge = {
        entities: [],
        actions: [],
        inverseActions: [],
        topics: labels,
    };
    settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
        {
            settings: { maxContextLength: 1000 },
            extract: async () => knowledge,
            extractWithRetry: async () => ({
                success: true as const,
                data: knowledge,
            }),
        };
    return settings;
}

function document(
    sourceId: string,
    revisionId: string,
    content: string,
): IndexedDocument {
    return {
        source: {
            sourceId,
            corpusId: "test",
            sourceType: "markdown",
            title: sourceId,
            activeRevisionId: revisionId,
        },
        revision: {
            sourceId,
            revisionId,
            contentHash: createHash("sha256").update(content).digest("hex"),
            mimeType: "text/markdown",
            pipelineVersion: "offline",
            state: "ready",
        },
        content,
        pipeline: { mode: "content" },
    };
}

describe("complete real KnowPro topic incidence with offline extraction", () => {
    let directory: string;
    let previousProvider: string | undefined;
    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "topic-knowpro-"));
        previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
    });
    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
        if (previousProvider === undefined)
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        else process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
    });
    test("all occurrences survive reload and source filtering; original citations resolve exactly", async () => {
        const index = new KnowProCorpusIndex("test", directory, settings);
        await index.rebuild(
            [
                document(
                    "one",
                    "r1",
                    "# Timing\n\nCommands are short but leases are held.\n",
                ),
                document(
                    "two",
                    "r1",
                    "# Scope\n\nResource and failure are not equivalent.\n",
                ),
            ],
            new AbortController().signal,
            async () => {},
        );
        const before = await index.getTopicOccurrences(new Set(["one", "two"]));
        expect(before).toHaveLength(6);
        const restored = new KnowProCorpusIndex("test", directory, settings);
        await restored.initialize();
        expect(
            await restored.getTopicOccurrences(new Set(["one", "two"])),
        ).toEqual(before);
        const selected = await restored.getTopicOccurrences(new Set(["one"]));
        expect(selected.every((entry) => entry.sourceId === "one")).toBe(true);
        expect(selected.map((entry) => entry.label)).toEqual(
            expect.arrayContaining(["resource", "failure"]),
        );
        for (const occurrence of before)
            for (const citation of occurrence.citations)
                expect(
                    await restored.resolveIndexedLocator(
                        citation.sourceId,
                        citation.revisionId,
                        citation.locator,
                    ),
                ).toBe(citation.excerpt);
    });
    test("case-variant nominations retain separate local ordinals in the real index", async () => {
        const index = new KnowProCorpusIndex("test", directory, () =>
            settings(["resource", "Resource"]),
        );
        await index.rebuild(
            [document("one", "r1", "Two unrelated resource nominations.")],
            new AbortController().signal,
            async () => {},
        );
        const occurrences = await index.getTopicOccurrences(new Set(["one"]));
        expect(occurrences.map((entry) => entry.label)).toEqual([
            "resource",
            "Resource",
        ]);
        expect(occurrences.map((entry) => entry.ordinal)).toEqual([0, 1]);
    });
    const fixtureRoot = process.env.TYPEAGENT_TOPIC_FIXTURES;
    if (fixtureRoot) {
        test("actual P0 worksheet revisions retain complete indexed tail citations after reload", async () => {
            const receipts = [];
            for (const [offset, stage] of ["initial", "t1", "t2"].entries()) {
                const revisionId = `r${offset + 1}`;
                const content = await readFile(
                    path.join(
                        fixtureRoot,
                        "memory-import-second-brain-maintenance",
                        "content-only",
                        stage,
                        "document-020.md",
                    ),
                    "utf8",
                );
                const index = new KnowProCorpusIndex(
                    "test",
                    directory,
                    settings,
                );
                await index.rebuild(
                    [document("worksheet", revisionId, content)],
                    new AbortController().signal,
                    async () => {},
                );
                const restored = new KnowProCorpusIndex(
                    "test",
                    directory,
                    settings,
                );
                await restored.initialize();
                const occurrences = await restored.getTopicOccurrences(
                    new Set(["worksheet"]),
                );
                expect(occurrences.map((entry) => entry.label).sort()).toEqual([
                    "command versus held lease",
                    "failure",
                    "resource",
                ]);
                const tailStart = [10742, 10828, 10447][offset];
                const tail = content.slice(tailStart, tailStart + 822);
                const evidence = occurrences
                    .filter(
                        (entry) => entry.label === "command versus held lease",
                    )
                    .flatMap((entry) => entry.citations)
                    .map((citation) => citation.excerpt)
                    .join("");
                expect(evidence).toContain(tail);
                expect(
                    createHash("sha256").update(evidence).digest("hex"),
                ).toBe(
                    parseIndexedLocator(occurrences[0].citations[0].locator)
                        .hash,
                );
                expect(
                    occurrences.every(
                        (entry) => entry.revisionId === revisionId,
                    ),
                ).toBe(true);
                for (const citation of occurrences.flatMap(
                    (entry) => entry.citations,
                ))
                    expect(
                        await restored.resolveIndexedLocator(
                            "worksheet",
                            revisionId,
                            citation.locator,
                        ),
                    ).toBe(citation.excerpt);
                receipts.push({
                    revisionId,
                    originalSourceUtf16: content.length,
                    occurrences: occurrences.length,
                    citationCount: occurrences.flatMap(
                        (entry) => entry.citations,
                    ).length,
                    indexedEvidenceUtf16: evidence.length,
                    exactTailUtf16: tail.length,
                });
            }
            process.stdout.write(
                `P4 real indexed P0 receipts ${JSON.stringify(receipts)}\n`,
            );
        });
    }
});
