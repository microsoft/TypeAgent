// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { KnowProCorpusIndex } from "../src/knowProCorpusIndex.js";
import { createTopicSnapshot } from "../src/topicGeneration.js";
import {
    changeFamily,
    offlineConsolidationAdapter,
    originalFixtureRoot,
    settleConsolidation,
} from "./wikiConsolidationFixtures.js";

export { changeFamily, settleConsolidation };

export function sourceFollowingHost(
    root: string,
    extractionLabels?: string[],
    classes = { Service: FileMemoryService, Index: KnowProCorpusIndex },
) {
    const { adapter, calls } = offlineConsolidationAdapter();
    const indexes = new Map<string, KnowProCorpusIndex>();
    const generated = new Map<string, number>();
    let unexpectedModelCalls = 0;
    let rejectEditorial = false;
    let hold: { entered: () => void; release: Promise<void> } | undefined;
    const generate = adapter.generate.bind(adapter);
    adapter.generateTopics = async (input, signal) => {
        signal.throwIfAborted();
        return createTopicSnapshot(input, input.model);
    };
    adapter.generate = async (input, signal) => {
        generated.set(
            input.definition.viewId,
            (generated.get(input.definition.viewId) ?? 0) + 1,
        );
        return generate(input, signal);
    };
    adapter.checkEditorial = async (input, output) => {
        if (rejectEditorial) return { safe: false, failures: ["scope-state"] };
        if (hold && input.definition.wiki?.query === "overlap review") {
            hold.entered();
            await hold.release;
        }
        const fragments = input.inputs.flatMap(
            (source) => source.passages ?? [],
        );
        const original = fragments.map((item) => item.excerpt).join("\n");
        const body = output.content.sections
            .map((item) => item.body)
            .join("\n");
        const supported =
            fragments.length > 0 &&
            fragments.every((item) => body.includes(item.excerpt)) &&
            (input.definition.wiki?.query !== "overlap review" ||
                (original.includes("bare overlap label") &&
                    original.includes("Preserve navigable context")));
        return {
            safe: supported,
            failures: supported ? [] : ["scope-state", "correction-withdrawal"],
        };
    };
    const open = () =>
        new classes.Service(root, {
            sourceSynopses: false,
            indexFactory: (corpusId, directory) => {
                const index = new classes.Index(corpusId, directory, () => {
                    const settings = createDocMemorySettings(64, undefined, {
                        completionSettings: {},
                        complete: async () => {
                            unexpectedModelCalls++;
                            throw new Error(
                                "Unexpected model call in offline source following",
                            );
                        },
                    });
                    settings.embeddingSize = 0;
                    const extract = async (text: string) => ({
                        entities: [],
                        actions: [],
                        inverseActions: [],
                        topics: extractionLabels
                            ? extractionLabels.filter((term) =>
                                  text.includes(term),
                              )
                            : text.includes("Correction:")
                              ? [
                                    "Identity",
                                    "Identity token rotation",
                                    "Orders",
                                    "Orders schema migration",
                                ].filter((term) => text.includes(term))
                              : text.toLowerCase().includes("overlap")
                                ? ["overlap review"]
                                : [],
                    });
                    settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
                        {
                            settings: { maxContextLength: 100000 },
                            extract,
                            extractWithRetry: async (text: string) => ({
                                success: true as const,
                                data: await extract(text),
                            }),
                        };
                    return settings;
                });
                if (
                    path.relative(root, directory).split(path.sep)[1] ===
                    "index"
                )
                    indexes.set(corpusId, index);
                return index;
            },
            viewSynthesisAdapter: adapter,
        });
    return {
        open,
        calls,
        indexes,
        generated,
        unexpectedModelCalls: () => unexpectedModelCalls,
        rejectEditorial() {
            rejectEditorial = true;
        },
        holdCheck(entered: () => void, release: Promise<void>) {
            hold = { entered, release };
        },
    };
}

export async function replaceOriginal(
    service: FileMemoryService,
    corpusId: string,
    text: string,
) {
    const source = await service.getSource(corpusId, "handoff");
    const input = {
        sourceType: "markdown" as const,
        title: "Actual P0 overlap handoff",
        text,
    };
    const job = source
        ? await service.replaceSource({
              corpusId,
              sourceId: source.sourceId,
              expectedActiveRevisionId: source.activeRevisionId,
              source: input,
          })
        : await service.ingestDocument({
              corpusId,
              source: { ...input, sourceId: "handoff" },
          });
    for (let tick = 0; tick < 1000; tick++) {
        const current = await service.getJob(job.jobId);
        if (current?.state === "failed") throw new Error(current.error);
        if (current?.state === "complete") return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Actual P0 original indexing did not settle");
}

export async function sourceFollowingStage(
    service: FileMemoryService,
    corpusId: string,
    stage: string,
) {
    const text = await readFile(
        path.join(originalFixtureRoot(), stage, "document-022.md"),
        "utf8",
    );
    assert.ok(!text.includes("MAINTENANCE_EVALUATOR_ONLY"));
    await replaceOriginal(service, corpusId, text);
}
