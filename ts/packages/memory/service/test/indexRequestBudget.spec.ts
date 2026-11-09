// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildConfig } from "@typeagent/config";
import {
    countO200kTokens,
    getRuntimeConfig,
    openai,
    setRuntimeConfig,
    type RequestBudgetLimits,
} from "@typeagent/aiclient";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import {
    FileMemoryService,
    type FileMemoryServiceOptions,
} from "../src/fileMemoryService.js";
import { createKnowProCorpusIndex } from "../src/knowProCorpusIndex.js";
import {
    createMemoryServiceRpcFacade,
    waitForMemoryJob,
} from "../src/rpcFacade.js";

const limits: RequestBudgetLimits = {
    tokenizer: "o200k_base",
    countTokens: countO200kTokens,
    inputTokens: 131072,
    outputTokens: 128000,
    safetyTokens: 1024,
    chatAttempts: 6,
    embeddingAttempts: 1,
    reservedTokens: 1000000,
    elapsedMs: 3600000,
};

describe("native KnowPro index and extension maintenance request budgets", () => {
    const previousConfig = getRuntimeConfig();
    const previousFetch = globalThis.fetch;
    const previousEmbedding = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    let root: string;
    let service: FileMemoryService;
    let requests: number;
    let authorized: boolean;
    let rejectFullCapacity: boolean;

    function model() {
        return openai.createChatModel({
            provider: "azure",
            modelType: openai.ModelType.Chat,
            modelName: "gpt-6-luna",
            endpoint:
                "https://synthetic.invalid/openai/deployments/gpt-6-luna/chat/completions",
            apiKey: "test",
            maxRetryAttempts: 0,
            enableModelRequestLogging: false,
        });
    }

    function open(options: FileMemoryServiceOptions) {
        const chatModel = model();
        return new FileMemoryService(root, {
            viewDrafts: false,
            informationalViews: false,
            sourceSynopses: false,
            extensionBuilds: true,
            extensionDiscovery: false,
            maintenanceMode: "manual",
            sourceAuthorization: async () => authorized,
            indexFactory: (corpusId, directory) =>
                createKnowProCorpusIndex(corpusId, directory, () => {
                    const settings = createDocMemorySettings(
                        64,
                        undefined,
                        chatModel,
                    );
                    settings.conversationSettings.semanticRefIndexSettings.batchSize = 8;
                    return settings;
                }),
            ...options,
        });
    }

    beforeEach(async () => {
        root = path.resolve(".index-budget-fixtures", randomUUID());
        await mkdir(root, { recursive: true });
        requests = 0;
        authorized = true;
        rejectFullCapacity = false;
        setRuntimeConfig(buildConfig({}));
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        globalThis.fetch = async (url, options) => {
            expect(String(url)).toContain("https://synthetic.invalid/");
            requests++;
            const body = JSON.parse(String(options?.body));
            if (rejectFullCapacity && requests === 1) {
                return new Response(
                    JSON.stringify({
                        error: {
                            code: "output_token_limit_exceeded",
                            message: "Output token capacity exceeded.",
                            max_completion_tokens: 64000,
                        },
                    }),
                    { status: 400 },
                );
            }
            if (rejectFullCapacity) {
                expect(body.max_completion_tokens).toBe(64000);
            } else {
                expect(body).not.toHaveProperty("max_tokens");
                expect(body).not.toHaveProperty("max_completion_tokens");
                expect(body).not.toHaveProperty("max_output_tokens");
            }
            return new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: JSON.stringify({
                                    entities: [],
                                    topics: [],
                                    actions: [],
                                    inverseActions: [],
                                }),
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 1,
                        completion_tokens: 1,
                        total_tokens: 2,
                    },
                }),
                { status: 200 },
            );
        };
    });

    afterEach(async () => {
        try {
            await service?.close();
            if (root) await rm(root, { recursive: true, force: true });
        } finally {
            globalThis.fetch = previousFetch;
            setRuntimeConfig(previousConfig);
            if (previousEmbedding === undefined)
                delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
            else process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousEmbedding;
        }
    });

    test("legacy informational envelope rejects uncapped output, preserving the failed job but not an uncommitted source", async () => {
        service = open({
            informationalBudget: { ...limits, outputTokens: 32768 },
        });
        const rpc = createMemoryServiceRpcFacade(service);
        const corpus = await rpc.createCorpus("Synthetic failed source");
        const inspection = model().inspectRequest!(
            "The lantern test completed; independent verification remains unknown.",
        );
        expect(inspection.constraints.outputTokens).toBe(128000);
        expect(inspection.estimatedInputTokens).toBeLessThan(
            limits.inputTokens,
        );
        const accepted = await rpc.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "approved-source",
                sourceType: "text",
                title: "Approved synthetic source",
                text: "The lantern test completed; independent verification remains unknown.",
            },
        });
        const failed = await waitForMemoryJob(service, accepted.jobId);
        expect(failed.state).toBe("failed");
        expect(failed.progress.stage).toBe("chunking");
        expect(failed.error).toBe(
            "Serialized inference request exceeds configured context, output or elapsed budget",
        );
        expect(requests).toBe(0);
        expect(await rpc.getCorpus(corpus.corpusId)).toMatchObject({
            sourceCount: 0,
            revisionCount: 0,
        });
        await service.close();
        service = open({ maintenanceLimits: { requestBudget: limits } });
        await expect(
            service.reindexSource(corpus.corpusId, accepted.sourceId),
        ).rejects.toThrow("Unknown source");
        expect(await service.reindexCorpus(corpus.corpusId)).toMatchObject({
            sourceCount: 0,
        });
        expect(await service.getJob(accepted.jobId)).toEqual(failed);
        expect(requests).toBe(0);
        expect(
            await service.getSource(corpus.corpusId, accepted.sourceId),
        ).toBeUndefined();
    });

    test.each([false, true])(
        "128000 informational budget admits actual native indexing with lower-endpoint-capacity=%s",
        async (lowerCapacity) => {
            rejectFullCapacity = lowerCapacity;
            service = open({ informationalBudget: limits });
            const rpc = createMemoryServiceRpcFacade(service);
            const corpus = await rpc.createCorpus("Synthetic Luna indexing");
            const accepted = await rpc.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "approved-source",
                    sourceType: "text",
                    title: "Approved synthetic source",
                    text: "The lantern test completed; independent verification remains unknown.",
                },
            });
            const completed = await waitForMemoryJob(service, accepted.jobId);
            expect(completed.state).toBe("complete");
            expect(requests).toBeGreaterThan(0);
            expect(
                await rpc.getSource(corpus.corpusId, accepted.sourceId),
            ).toMatchObject({
                activeRevisionId: accepted.revisionId,
            });
        },
    );

    test("extension maintenance envelope does not budget original indexing or reindex, preserving exact revisions and native authorization", async () => {
        service = open({ maintenanceLimits: { requestBudget: limits } });
        const rpc = createMemoryServiceRpcFacade(service);
        const corpus = await rpc.createCorpus("Synthetic indexed source");
        const accepted = await rpc.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "approved-source",
                sourceType: "text",
                title: "Approved synthetic source",
                text: "The lantern test completed; independent verification remains unknown.",
            },
        });
        const completed = await waitForMemoryJob(service, accepted.jobId);
        expect(completed.state).toBe("complete");
        expect(requests).toBeGreaterThan(0);
        const source = await rpc.getSource(corpus.corpusId, accepted.sourceId);
        expect(source?.activeRevisionId).toBe(accepted.revisionId);
        expect(source?.revisions).toHaveLength(1);
        expect(
            await rpc.reindexSource(corpus.corpusId, accepted.sourceId),
        ).toMatchObject({ sourceCount: 1 });
        expect(await rpc.getSource(corpus.corpusId, accepted.sourceId)).toEqual(
            source,
        );
        expect(await rpc.getJob(accepted.jobId)).toEqual(completed);
        authorized = false;
        await expect(
            rpc.getSourceContent({
                corpusId: corpus.corpusId,
                sourceId: accepted.sourceId,
                revisionId: accepted.revisionId,
            }),
        ).rejects.toThrow("authorized");
    });
});
