// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildConfig, flatten } from "@typeagent/config";
import {
    getRuntimeConfig,
    setRuntimeConfig,
    getActiveModelProvider,
    setActiveModelProvider,
} from "@typeagent/aiclient";
import { waitForMemoryJob } from "@typeagent/memory-service";
import { createDurableMemoryService } from "../src/durableMemoryService.js";

test("ordinary configured host ingests and automatically builds/answers without wiki rehearsal variables (mock REST)", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "host-product-enablement-"),
    );
    const originalConfig = getRuntimeConfig();
    const originalMode = getActiveModelProvider();
    const originalFetch = globalThis.fetch;
    const keys = [
        "TYPEAGENT_MEMORY_VIEW_DRAFTS",
        "TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS",
        "TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT",
        ...Object.keys(process.env).filter((key) => /^MEMORY.*WIKI/.test(key)),
    ];
    const environment = new Map(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    const calls: Array<{
        endpoint: string;
        kind: string;
        outputTokens: number | undefined;
    }> = [];
    setRuntimeConfig(
        buildConfig(
            flatten({
                modelProvider: "azure",
                azureOpenAI: {
                    responseFormat: true,
                    defaultChat: {
                        endpoint: "https://synthetic.invalid/product-view",
                        auth: "synthetic-key",
                    },
                    deployments: {
                        gpt_6_luna: [
                            {
                                endpoint:
                                    "https://synthetic.invalid/product-extraction",
                                region: "eastus",
                                auth: "synthetic-key",
                            },
                        ],
                    },
                },
                embedding: { provider: "none" },
                modelRequestConstraints: {
                    "azure:chat:": {
                        contextTokens: 128000,
                        outputTokens: 2000,
                    },
                    "azure:chat:gpt_6_luna": {
                        contextTokens: 128000,
                        outputTokens: 8000,
                    },
                },
            }),
        ),
    );
    globalThis.fetch = async (endpoint, options) => {
        const body = JSON.parse(String(options?.body)) as {
            messages: unknown[];
            max_completion_tokens?: number;
            response_format?: { json_schema?: { name?: string } };
        };
        const kind =
            body.response_format?.json_schema?.name ??
            (JSON.stringify(body.messages).includes("searchExpressions")
                ? "search"
                : "knowledge");
        calls.push({
            endpoint: String(endpoint),
            kind,
            outputTokens: body.max_completion_tokens,
        });
        const result =
            kind === "informational_wiki"
                ? {
                      title: "Acquisition",
                      prose: "Acquisition remains conditional until the owner review.",
                      limits: "Only one indexed source; owner outcome is unknown.",
                      citationIds: ["f0"],
                  }
                : kind === "indexed_answer"
                  ? {
                        status: "answered",
                        answer: "Acquisition remains conditional until the owner review.",
                        citationIds: ["f0"],
                    }
                  : kind === "search"
                    ? {
                          searchExpressions: [
                              {
                                  rewrittenQuery: "Acquisition",
                                  filters: [
                                      {
                                          entitySearchTerms: [
                                              {
                                                  name: "Acquisition",
                                                  isNamePronoun: false,
                                              },
                                          ],
                                      },
                                  ],
                              },
                          ],
                      }
                    : {
                          entities: [
                              { name: "Acquisition", type: ["concept"] },
                          ],
                          topics: ["Acquisition"],
                          actions: [],
                          inverseActions: [],
                      };
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: JSON.stringify(result),
                        },
                        finish_reason: "stop",
                    },
                ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
        );
    };
    const service = createDurableMemoryService(root);
    try {
        expect(
            (await service.getCapabilities()).derivedViews?.informationalWiki,
        ).toBe(true);
        const { corpusId } = await service.createCorpus("Normal product host");
        expect((await service.listViews(corpusId)).views).toEqual([]);
        const ingested = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "synthetic-source",
                sourceType: "text",
                title: "Acquisition context",
                text: "Acquisition remains conditional until the owner review.",
            },
        });
        expect((await waitForMemoryJob(service, ingested.jobId)).state).toBe(
            "complete",
        );
        let snapshot = await service.listViews(corpusId);
        for (
            let attempt = 0;
            !snapshot.views.length && attempt < 300;
            attempt++
        ) {
            if (snapshot.wikiFamily?.error)
                throw new Error(snapshot.wikiFamily.error);
            await new Promise((resolve) => setTimeout(resolve, 25));
            snapshot = await service.listViews(corpusId);
        }
        if (!snapshot.views.length) {
            const jobs = await service.listViewBuilds(corpusId);
            throw new Error(
                JSON.stringify({
                    family: snapshot.wikiFamily,
                    jobs: jobs.map((job) => ({
                        state: job.state,
                        reasons: job.results.map((result) => result.reason),
                    })),
                    calls,
                }),
            );
        }
        expect(snapshot.views).toHaveLength(1);
        expect(snapshot.views[0].generation?.input?.pipeline).toBe(
            "informational-wiki-v1",
        );
        const answer = await service.answer({
            corpusId,
            question: "Acquisition",
        });
        expect(answer.mode).toBe("synthesized");
        expect(answer.answer).toContain("conditional");
        expect(answer.citations[0]).toMatchObject({
            sourceId: ingested.sourceId,
            revisionId: ingested.revisionId,
        });
        expect(answer.citations[0].locator).toMatch(/^indexed:/);
        expect(calls).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    endpoint: "https://synthetic.invalid/product-extraction",
                    kind: "knowledge",
                    outputTokens: 8000,
                }),
                expect.objectContaining({
                    endpoint: "https://synthetic.invalid/product-view",
                    kind: "informational_wiki",
                    outputTokens: 2000,
                }),
                expect.objectContaining({
                    endpoint: "https://synthetic.invalid/product-view",
                    kind: "indexed_answer",
                    outputTokens: 2000,
                }),
            ]),
        );
    } finally {
        await service.close();
        globalThis.fetch = originalFetch;
        setRuntimeConfig(originalConfig);
        setActiveModelProvider(originalMode);
        for (const [key, value] of environment)
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        await rm(root, { recursive: true, force: true });
    }
}, 30000);
