// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { getConfiguredMemoryViewOptions } from "../src/viewHostOptions.js";
import { runMemoryViewsCli } from "../src/memoryViewsCli.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

test("shared host options ignore rehearsal variables and preserve explicit YAML/environment disablement", () => {
    expect(getConfiguredMemoryViewOptions({})).toEqual({
        viewDrafts: true,
        informationalViews: true,
    });
    expect(
        getConfiguredMemoryViewOptions({
            MEMORY_WIKI_CONTEXT_TOKENS: "invalid",
            MEMORY_WIKI_OUTPUT_TOKENS: "0",
            MEMORY_WIKI_TOKENIZER: "unsupported",
        }),
    ).toEqual({ viewDrafts: true, informationalViews: true });
    expect(
        getConfiguredMemoryViewOptions({ TYPEAGENT_MEMORY_VIEW_DRAFTS: "0" })
            .viewDrafts,
    ).toBe(false);
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS: "false",
        }).informationalViews,
    ).toBe(false);
    expect(() =>
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS: "invalid",
        }),
    ).toThrow("TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS must be true or false");
});

test.each([{ viewDrafts: false }, { informationalViews: false }])(
    "explicit host disablement is independent of a supplied rehearsal budget: %j",
    async (disable) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "enablement-disabled-"),
        );
        const service = new FileMemoryService(root, {
            ...disable,
            informationalBudget: {
                inputTokens: 10000,
                outputTokens: 4000,
                safetyTokens: 1000,
                chatAttempts: 2,
                reservedTokens: 160000,
                embeddingAttempts: 128,
                elapsedMs: 60000,
                tokenizer: "synthetic",
                countTokens: (text) => text.length,
            },
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
        });
        try {
            expect(
                (await service.getCapabilities()).derivedViews
                    ?.informationalWiki,
            ).toBeUndefined();
            const { corpusId } = await service.createCorpus("Disabled");
            await expect(
                service.maintainViews({
                    corpusId,
                    expectedHead: null,
                    family: "wiki",
                    operation: "resume",
                }),
            ).rejects.toThrow("disabled by this host");
            if (disable.informationalViews === false) {
                const snapshot = await service.listViews(corpusId);
                expect(snapshot.wikiFamily).toBeUndefined();
                await expect(
                    service.buildViews({
                        corpusId,
                        expectedHead: snapshot.head,
                        targets: [
                            {
                                expectedVersion: 0,
                                definition: {
                                    kind: "projectBrief",
                                    viewId: "disabled-project",
                                    selector: {
                                        kind: "sources",
                                        sources: [
                                            {
                                                sourceId: "source",
                                                revisionId: "revision",
                                            },
                                        ],
                                    },
                                    projectSummary: {
                                        construction:
                                            "informational-project-summary-v1",
                                        query: "bounded",
                                        aliases: [],
                                        excludedSourceIds: [],
                                    },
                                },
                            },
                        ],
                    }),
                ).rejects.toThrow("disabled by this host");
            }
        } finally {
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
);

test("CLI initialization uses the same explicit whole-host disablement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "enablement-cli-"));
    const previous = process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS;
    process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS = "false";
    try {
        const capabilities = await runMemoryViewsCli([
            "--store",
            root,
            "capabilities",
        ]);
        expect(capabilities).not.toHaveProperty("derivedViews");
    } finally {
        if (previous === undefined)
            delete process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS;
        else process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS = previous;
        await rm(root, { recursive: true, force: true });
    }
});
