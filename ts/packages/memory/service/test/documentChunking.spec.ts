// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    DocMemory,
    countDocTokens,
    docPartsFromHtml,
    docPartsFromMarkdown,
    docPartsFromText,
    docPartsFromVtt,
    type DocMemorySettings,
} from "@typeagent/conversation-memory";
import type { EmbeddingRole, TextEmbeddingModel } from "@typeagent/aiclient";
import { createEmbeddingCache } from "@typeagent/knowledge-processor";
import * as kp from "@typeagent/knowpro";
import { KnowProCorpusIndex } from "../src/knowProCorpusIndex.js";
import { projectRetainedIndex } from "../src/retainedIndex.js";
import { indexedQueryTerms } from "../src/indexedFragments.js";
import type { IndexedDocument, SourceType } from "../src/types.js";

const markdown = Array.from(
    { length: 24 },
    (_, i) =>
        `## Section ${i}\n\n${"Zephyr recovery instructions remain approved. ".repeat(90)}`,
).join("\n\n");
const options = {
    collectLinkKnowledge: false,
    collectStructuralKnowledge: false,
    maxTokensPerPart: 24000,
};

describe("durable extraction and message embedding windows", () => {
    let root: string;
    let forbidden: boolean;
    let queryTranslation: object | undefined;
    const extracted: string[] = [];
    const embedded: string[] = [];
    const languagePrompts: string[] = [];

    function model(role: EmbeddingRole = "document"): TextEmbeddingModel {
        const embed = (text: string) => {
            if (forbidden) throw new Error("Unexpected provider call");
            embedded.push(text);
            expect(countDocTokens(text)).toBeLessThanOrEqual(7500);
            return [1, 0, 0];
        };
        return {
            maxBatchSize: 16,
            embeddingIdentity: {
                schemaVersion: 1,
                provider: "offline",
                model: "document-chunking",
                revision: "1",
                dimensions: 3,
                task: role,
                prompt: role,
                pooling: "mean",
                normalization: "l2",
                preprocessing: "fixture",
                artifactHash: "c".repeat(64),
            },
            forRole: model,
            generateEmbedding: async (text) => ({
                success: true,
                data: embed(text),
            }),
            generateEmbeddingBatch: async (texts) => ({
                success: true,
                data: texts.map(embed),
            }),
        };
    }

    function settings(): DocMemorySettings {
        const embeddingModel = createEmbeddingCache(model(), 32);
        const conversationSettings = kp.createConversationSettings(
            embeddingModel,
            3,
        );
        const extract = (text: string) => {
            if (forbidden) throw new Error("Unexpected extraction");
            extracted.push(text);
            return {
                entities: [{ name: "Zephyr", type: ["service"] }],
                topics: ["recovery"],
                actions: [],
                inverseActions: [],
            };
        };
        conversationSettings.semanticRefIndexSettings.knowledgeExtractor = {
            settings: { maxContextLength: 1000 },
            extract: async (text) => extract(text),
            extractWithRetry: async (text) => ({
                success: true,
                data: extract(text),
            }),
        };
        return {
            useScopedSearch: true,
            embeddingModel,
            embeddingSize: 3,
            conversationSettings,
            languageModel: {
                completionSettings: {},
                complete: async (prompt) => {
                    languagePrompts.push(JSON.stringify(prompt));
                    if (queryTranslation)
                        return {
                            success: true,
                            data: JSON.stringify(queryTranslation),
                        };
                    throw new Error("Unexpected chat");
                },
            },
        };
    }

    function document(
        sourceType: SourceType,
        content = markdown,
        id = "source",
    ): IndexedDocument {
        return {
            source: {
                corpusId: "test",
                sourceId: id,
                sourceType,
                title: id,
                activeRevisionId: "r1",
            },
            revision: {
                sourceId: id,
                revisionId: "r1",
                contentHash: "hash",
                mimeType: "text/plain",
                pipelineVersion: "1",
                state: "ready",
            },
            content,
            indexTags: ["scope:fixture"],
            pipeline: { mode: "content" },
        };
    }

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "document-chunking-"));
        forbidden = false;
        queryTranslation = undefined;
        extracted.length = 0;
        embedded.length = 0;
        languagePrompts.length = 0;
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test("zero-hit rescue scopes before its eight-message limit even with twelve foreign matches ranked first", async () => {
        queryTranslation = {
            searchExpressions: [
                {
                    rewrittenQuery: "billing instructions",
                    filters: [
                        {
                            entitySearchTerms: [
                                { name: "Unextracted", isNamePronoun: false },
                            ],
                        },
                    ],
                },
            ],
        };
        const index = new KnowProCorpusIndex("test", root, settings);
        await index.rebuild(
            [
                ...Array.from({ length: 12 }, (_, i) =>
                    document(
                        "text",
                        "Foreign private billing instructions.",
                        `foreign-${i}`,
                    ),
                ),
                document("text", "Allowed billing instructions.", "allowed"),
            ],
            new AbortController().signal,
            async () => {},
        );
        const selection = await index.readFragments({
            query: "billing instructions",
            terms: ["billing"],
            sourceIds: ["allowed"],
            temporalContext: { referenceTime: "2026-10-22T12:00:00Z" },
        });
        expect(selection.fragments.length).toBeGreaterThan(0);
        expect(
            selection.fragments.every(
                (fragment) => fragment.sourceId === "allowed",
            ),
        ).toBe(true);
        expect(
            selection.fragments.map((item) => item.snippet).join(" "),
        ).toContain("Allowed");
        expect(languagePrompts.join(" ")).toContain("2026-10-22");
        expect(selection.readChars).toBeLessThanOrEqual(32000);
        expect(selection.fragments.length).toBeLessThanOrEqual(12);
    });

    test("query scoring keeps relevant price operands without type-wide boosts and scopes language search before ranking", async () => {
        const configured = settings();
        const extract = (text: string) => ({
            entities: [
                {
                    name: text,
                    type: [text.includes("initial") ? "reservation" : "trip"],
                },
            ],
            topics: [],
            actions: [],
            inverseActions: [],
        });
        configured.conversationSettings!.semanticRefIndexSettings.knowledgeExtractor =
            {
                settings: { maxContextLength: 1000 },
                extract: async (text) => extract(text),
                extractWithRetry: async (text) => ({
                    success: true,
                    data: extract(text),
                }),
            };
        const index = new KnowProCorpusIndex("test", root, () => configured);
        const documents = [
            document(
                "text",
                "Sakura trip corrected price $2,800.",
                "corrected",
            ),
            document("text", "Sakura trip initial quote $2,500.", "initial"),
            ...Array.from({ length: 16 }, (_, i) =>
                document("text", `Unrelated gardening ${i}.`, `other-${i}`),
            ),
        ];
        await index.rebuild(
            documents,
            new AbortController().signal,
            async () => {},
        );
        const clock = (import.meta as ImportMeta & { jest: typeof jest }).jest;
        const language = clock
            .spyOn(DocMemory.prototype, "searchWithLanguage")
            .mockResolvedValue({ success: true, data: [] });
        try {
            const request = {
                query: "How much more was the Sakura trip corrected price after the initial quote?",
                terms: indexedQueryTerms(
                    "Sakura trip corrected price after initial quote",
                ),
                sourceIds: documents.map((doc) => doc.source.sourceId),
            };
            const ordinary = await index.readFragments(request);
            const observed = await index.readFragments({
                ...request,
                includeDiagnostics: true,
            });
            expect(observed.fragments).toEqual(ordinary.fragments);
            expect(
                observed.fragments.map((fragment) => fragment.sourceId),
            ).toEqual(expect.arrayContaining(["corrected", "initial"]));
            expect(
                observed.diagnostics?.blocks.every(
                    (block) =>
                        block.preferenceBoost === 0 &&
                        block.languageScore === 0,
                ),
            ).toBe(true);
            expect(
                observed.diagnostics?.blocks.find(
                    (block) => block.sourceId === "initial",
                )?.postingScore,
            ).toBeGreaterThan(0);
            const scoped = await index.readFragments({
                ...request,
                sourceIds: ["initial"],
                includeDiagnostics: true,
            });
            expect(
                scoped.fragments.map((fragment) => fragment.sourceId),
            ).toEqual(["initial"]);
            const ranges =
                language.mock.calls.at(-1)?.[1]?.messageRangesInScope ?? [];
            expect(ranges).toHaveLength(1);
            const calls = language.mock.calls.length;
            expect(
                (await index.readFragments({ ...request, sourceIds: [] }))
                    .fragments,
            ).toEqual([]);
            expect(language.mock.calls).toHaveLength(calls);
        } finally {
            language.mockRestore();
        }
    });

    test("indexed fragments preserve source-owned dates across restart and receive the separate question reference", async () => {
        const doc = document("text", "Zephyr recovery happened yesterday.");
        doc.revision.temporalContext = kp.normalizeTemporalContext(
            {
                version: 1,
                scopes: [
                    {
                        ownerId: "message",
                        start: 0,
                        end: doc.content.length,
                        messageTime: "2024/02/02 12:00",
                        role: "user",
                    },
                ],
            },
            doc.content.length,
        );
        const index = new KnowProCorpusIndex("test", root, settings);
        await index.rebuild(
            [doc],
            new AbortController().signal,
            async () => {},
        );
        const reopened = new KnowProCorpusIndex("test", root, settings);
        await reopened.initialize();
        const selection = await reopened.readFragments({
            terms: ["Zephyr"],
            sourceIds: ["source"],
            temporalContext: { referenceTime: "2024/02/01 12:00" },
        });
        expect(selection.fragments.length).toBeGreaterThan(0);
        for (const fragment of selection.fragments) {
            expect(fragment.temporalContext?.messageTime).toEqual(
                kp.parseTemporalValue("2024/02/02 12:00"),
            );
            expect(fragment.temporalContext?.ownerId).toBe("message");
            expect(fragment.temporalContext?.role).toBe("user");
            expect(
                await reopened.resolveIndexedLocator(
                    fragment.sourceId,
                    fragment.revisionId,
                    fragment.locator,
                ),
            ).toBe(fragment.snippet);
        }
        await expect(
            reopened.readFragments({
                terms: ["Zephyr"],
                sourceIds: ["source"],
                query: "When was recovery?",
                temporalContext: { referenceTime: "2024/02/01 12:00" },
            }),
        ).rejects.toThrow("Unexpected chat");
        expect(languagePrompts).toHaveLength(1);
        expect(languagePrompts[0]).toContain("Question temporal metadata");
        expect(languagePrompts[0]).toContain("2024/02/01 12:00");
        await expect(
            reopened.readFragments({
                terms: ["Zephyr"],
                sourceIds: ["source"],
                temporalContext: { availabilityPolicy: "as-of" },
            }),
        ).rejects.toThrow("Strict as-of");
    });

    test.each(["markdown", "web", "html", "text", "vtt"] as const)(
        "%s dispatches through the intended converter without losing canonical text",
        async (type) => {
            const content =
                type === "html"
                    ? `<html><body>${Array.from(
                          { length: 24 },
                          (_, i) =>
                              `<h2>Section ${i}</h2><p>${"Zephyr recovery instructions remain approved. ".repeat(90)}</p>`,
                      ).join("")}</body></html>`
                    : type === "vtt"
                      ? "WEBVTT\n\n00:00.000 --> 00:01.000\n<v Alice>Zephyr recovery.\n"
                      : markdown;
            const doc = document(type, content);
            const uri = "typeagent-memory://sources/source/revisions/r1";
            const expected =
                type === "html"
                    ? docPartsFromHtml(
                          content,
                          false,
                          8000,
                          uri,
                          undefined,
                          options,
                      )
                    : type === "text"
                      ? docPartsFromText(content, 8000, uri)
                      : type === "vtt"
                        ? docPartsFromVtt(content, uri)
                        : docPartsFromMarkdown(content, 8000, uri, options);
            const index = new KnowProCorpusIndex("test", root, settings);
            await index.rebuild(
                [doc],
                new AbortController().signal,
                async () => {},
            );
            expect(extracted).toEqual(
                expected.flatMap((part) =>
                    part.textChunks.map((text) => text.trim()),
                ),
            );
            const memory = await DocMemory.readFromFile(
                root,
                "corpus",
                settings(),
            );
            expect(memory!.hasCompleteIndex).toBe(true);
            for (const part of memory!.messages)
                expect(part.tags).toContain("scope:fixture");
            if (type === "markdown" || type === "web" || type === "html") {
                expect(
                    extracted.some((text) => countDocTokens(text) > 7500),
                ).toBe(true);
                expect(
                    extracted.every((text) => countDocTokens(text) <= 24000),
                ).toBe(true);
                expect(
                    embedded.every((text) => countDocTokens(text) <= 7500),
                ).toBe(true);
            }
        },
    );

    test("append, restart and forget retain all window vectors without model work", async () => {
        const docs = [
            document("markdown"),
            document("markdown", markdown, "second"),
            document("markdown", markdown, "third"),
        ];
        const index = new KnowProCorpusIndex(
            "test",
            path.join(root, "old"),
            settings,
        );
        await index.rebuild(
            [docs[0]],
            new AbortController().signal,
            async () => {},
        );
        await index.append(
            docs.slice(1),
            new AbortController().signal,
            async () => {},
        );
        const previous = new KnowProCorpusIndex(
            "test",
            path.join(root, "old"),
            settings,
        );
        await previous.initialize();
        forbidden = true;
        const retained = new KnowProCorpusIndex(
            "test",
            path.join(root, "new"),
            settings,
        );
        expect(
            await retained.rebuildRetained(
                previous,
                [docs[1]],
                new AbortController().signal,
                async () => {},
            ),
        ).toBe(true);
        const memory = await DocMemory.readFromFile(
            path.join(root, "new"),
            "corpus",
            settings(),
        );
        const data = await memory!.serialize();
        const locations = data.messageIndexData!.indexData!.textLocations;
        expect(data.messages).toHaveLength(1);
        expect(locations.length).toBeGreaterThan(1);
        expect(
            locations.every((location) => location.messageOrdinal === 0),
        ).toBe(true);
        expect(locations[0].textRange!.start).toBe(0);
        expect(locations.at(-1)!.textRange!.end).toBe(
            data.messages[0].textChunks[0].length,
        );
        expect(memory!.hasCompleteIndex).toBe(true);
    });

    test("legacy layout stays unchanged on load and requires explicit reindex rather than unsafe retained projection", async () => {
        const doc = document("markdown");
        const uri = "typeagent-memory://sources/source/revisions/r1";
        const legacyParts = docPartsFromMarkdown(markdown, 8000, uri, {
            ...options,
            maxTokensPerPart: 7500,
        });
        const currentParts = docPartsFromMarkdown(markdown, 8000, uri, options);
        for (const part of [...legacyParts, ...currentParts])
            part.tags.push("scope:fixture");
        expect(legacyParts.length).toBeGreaterThan(currentParts.length);
        const legacy = new DocMemory("test", legacyParts, settings());
        await legacy.buildIndex();
        await legacy.writeToFile(root, "corpus");
        forbidden = true;
        const index = new KnowProCorpusIndex("test", root, settings);
        await index.initialize();
        const persisted = await DocMemory.readFromFile(
            root,
            "corpus",
            settings(),
        );
        const data = await persisted!.serialize();
        expect(data.messages).toHaveLength(legacyParts.length);
        expect(
            projectRetainedIndex(data, currentParts, {
                related: true,
                message: true,
            }).reason,
        ).toBeDefined();
        const oldSelection = await index.readFragments({
            terms: ["Zephyr"],
            sourceIds: ["source"],
        });
        const oldAnchor = oldSelection.fragments[0];
        expect(oldAnchor).toBeDefined();
        expect(
            await index.resolveIndexedLocator(
                "source",
                "r1",
                oldAnchor.locator,
            ),
        ).toBe(oldAnchor.snippet);
        forbidden = false;
        extracted.length = 0;
        await index.rebuild(
            [doc],
            new AbortController().signal,
            async () => {},
        );
        expect(extracted).toEqual(
            currentParts.flatMap((part) =>
                part.textChunks.map((text) => text.trim()),
            ),
        );
        await expect(
            index.resolveIndexedLocator("source", "r1", oldAnchor.locator),
        ).rejects.toThrow();
        const selection = await index.readFragments({
            terms: ["Zephyr"],
            sourceIds: ["source"],
        });
        expect(selection.fragments.length).toBeGreaterThan(0);
        expect(selection.fragments.length).toBeLessThanOrEqual(12);
        expect(selection.readChars).toBeLessThanOrEqual(32000);
        for (const fragment of selection.fragments)
            expect(
                await index.resolveIndexedLocator(
                    fragment.sourceId,
                    fragment.revisionId,
                    fragment.locator,
                ),
            ).toBe(fragment.snippet);
    });

    test("replacement honors a caller-supplied structural character budget", async () => {
        const doc = document("markdown");
        doc.pipeline.maxCharsPerChunk = 400;
        const index = new KnowProCorpusIndex("test", root, settings);
        await index.rebuild(
            [doc],
            new AbortController().signal,
            async () => {},
        );
        extracted.length = 0;
        doc.content += "\n\nReplacement qualification remains applicable.";
        doc.source.activeRevisionId = "r2";
        doc.revision.revisionId = "r2";
        doc.revision.contentHash = "hash-r2";
        await index.replace(doc, new AbortController().signal, async () => {});
        const expected = docPartsFromMarkdown(
            doc.content,
            400,
            "typeagent-memory://sources/source/revisions/r2",
            options,
        );
        expect(extracted).toEqual(
            expected.flatMap((part) =>
                part.textChunks.map((text) => text.trim()),
            ),
        );
    });
});
