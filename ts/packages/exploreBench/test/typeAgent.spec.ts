// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import type { TypeAgentAction } from "@typeagent/agent-sdk";
import {
    assertDirectDispatchEvidence,
    combineTypeAgentUsage,
    createTypeAgentExplorerProvider,
} from "../src/typeAgent.js";
import type {
    TypeAgentDispatchEvidence,
    TypeAgentUsage,
} from "../src/types.js";

const query =
    "Find the implementation that maps source => target incorrectly for empty cache entries.";

test("exposes one Explorer application agent with one natural-language entry action", async () => {
    const provider = createTypeAgentExplorerProvider(
        {
            explore: async () =>
                "<final_answer>\nsrc/cache.ts:10-20\n</final_answer>",
        },
        query,
    );

    assert.deepEqual(provider.getAppAgentNames(), ["explorer"]);
    const manifest = await provider.getAppAgentManifest("explorer");
    const schemaFile = manifest.schema?.schemaFile;
    const schema =
        typeof schemaFile === "string"
            ? schemaFile
            : (schemaFile?.content ?? "");
    assert.equal(manifest.defaultEnabled, true);
    assert.match(schema, /actionName: "exploreRepository"/);
    assert.match(schema, /parameters: \{\}/);
    assert.doesNotMatch(schema, /request: string/);
    assert.doesNotMatch(
        schema,
        /discoverRepository|refineRepository|submitExploration/,
    );
});

test("Explorer action executes the exact session request and reports inner usage", async () => {
    let received: unknown;
    const provider = createTypeAgentExplorerProvider(
        {
            explore: async () => {
                throw new Error("exploreDetailed must be used");
            },
            exploreDetailed: async (request) => {
                received = request;
                return {
                    text: "src/cache.ts:10-20",
                    usage: usage(2, 100, 20),
                    toolTrace: {
                        calls: [],
                        totalCalls: 0,
                        totalOutputBytes: 0,
                    },
                    result: { citationCount: 1, truncated: false },
                };
            },
        },
        query,
    );
    const agent = await provider.loadAppAgent("explorer");
    const agentContext = await agent.initializeAgentContext?.();
    const result = await agent.executeAction?.(
        {
            schemaName: "explorer",
            actionName: "exploreRepository",
            parameters: { request: "translation-model mutation" },
        } as TypeAgentAction,
        { sessionContext: { agentContext } } as never,
    );

    assert.deepEqual(received, { query, maxResults: 6 });
    assert.ok(result && !("error" in result));
    assert.equal(
        result.displayContent,
        "<final_answer>\nsrc/cache.ts:10-20\n</final_answer>",
    );
    assert.deepEqual(result.tokenUsage, {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
    });
});

test("direct-dispatch evidence fails closed on every bypass", () => {
    const valid = evidence();
    assert.doesNotThrow(() => assertDirectDispatchEvidence(valid, query));
    assert.throws(() =>
        assertDirectDispatchEvidence(
            {
                ...valid,
                submittedRequest: "first\nsecond",
            },
            "first\r\nsecond",
        ),
    );

    const invalid: TypeAgentDispatchEvidence[] = [
        { ...valid, submittedRequest: `@action explorer exploreRepository` },
        { ...valid, translationInvoked: false },
        { ...valid, translationRequestCount: 2 },
        { ...valid, activeAgentNames: ["explorer", "chat"] },
        { ...valid, activeSchemaNames: ["explorer", "chat"] },
        { ...valid, translatedActions: [] },
        {
            ...valid,
            translatedActions: [
                {
                    schemaName: "explorer",
                    actionName: "discoverRepository",
                    parameters: {},
                },
            ],
        },
        { ...valid, usedCopilot: true },
        { ...valid, usedMcp: true },
        { ...valid, executionCount: 0 },
        { ...valid, outputMatchedExecution: false },
        { ...valid, executionRequestMatchedIngress: false },
    ];
    for (const value of invalid) {
        assert.throws(() => assertDirectDispatchEvidence(value, query));
    }
});

test("counts dispatcher translation and Explorer reasoning exactly once", () => {
    const translation = usage(1, 25, 5);
    const reasoning = usage(3, 100, 20);

    assert.deepEqual(combineTypeAgentUsage(translation, reasoning), {
        inputTokens: 125,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 25,
        reasoningOutputTokens: 0,
        totalTokens: 150,
    });
});

function usage(
    requestCount: number,
    inputTokens: number,
    outputTokens: number,
): TypeAgentUsage {
    return {
        requestCount,
        usageComplete: true,
        inputTokens,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens,
        reasoningOutputTokens: 0,
        totalTokens: inputTokens + outputTokens,
    };
}

function evidence(): TypeAgentDispatchEvidence {
    return {
        ingress: "natural-language",
        submittedRequest: query,
        translationInvoked: true,
        translationRequestCount: 1,
        activeAgentNames: ["explorer"],
        activeSchemaNames: ["explorer"],
        translatedActions: [
            {
                schemaName: "explorer",
                actionName: "exploreRepository",
                parameters: {},
            },
        ],
        executionCount: 1,
        outputMatchedExecution: true,
        executionRequestMatchedIngress: true,
        usedCopilot: false,
        usedMcp: false,
    };
}
