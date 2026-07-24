// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { TypeAgentAction } from "@typeagent/agent-sdk";
import { awaitCommand } from "agent-dispatcher";
import {
    assertDirectDispatchEvidence,
    combineTypeAgentUsage,
    createTypeAgentExplorerDispatcher,
    createTypeAgentExplorerProvider,
} from "../src/typeAgent.js";
import type {
    TypeAgentDispatchEvidence,
    TypeAgentUsage,
} from "../src/types.js";

const query =
    "Find the implementation that maps source => target incorrectly for empty cache entries.";

test("exposes one Explorer application agent with one natural-language entry action", async () => {
    const provider = createTypeAgentExplorerProvider({
        explore: async () =>
            "<final_answer>\nsrc/cache.ts:10-20\n</final_answer>",
    });

    assert.deepEqual(provider.getAppAgentNames(), ["explorer"]);
    const manifest = await provider.getAppAgentManifest("explorer");
    const schemaFile = manifest.schema?.schemaFile;
    const grammarFile = manifest.schema?.grammarFile;
    const schema =
        typeof schemaFile === "string"
            ? schemaFile
            : (schemaFile?.content ?? "");
    const grammar =
        typeof grammarFile === "string"
            ? grammarFile
            : (grammarFile?.content ?? "");
    assert.equal(manifest.defaultEnabled, true);
    assert.match(schema, /actionName: "exploreRepository"/);
    assert.match(schema, /parameters:\s*\{[^}]*request: string/s);
    assert.doesNotMatch(schema, /parameters: \{\}/);
    assert.doesNotMatch(
        schema,
        /discoverRepository|refineRepository|submitExploration/,
    );
    assert.match(grammar, /\[spacing=none\]/);
    assert.match(grammar, /parameters:\s*\{\s*request:\s*request\s*\}/);
});

test("dispatcher grammar carries arbitrary natural-language ingress byte-for-byte", async () => {
    const received: string[] = [];
    const dispatchMethods: Array<"construction" | "grammar" | false> = [];
    const provider = createTypeAgentExplorerProvider({
        explore: async () => {
            throw new Error("exploreDetailed must be used");
        },
        exploreDetailed: async ({ query }) => {
            received.push(query);
            return {
                text: "src/cache.ts:10-20",
                usage: usage(0, 0, 0),
                toolTrace: {
                    calls: [],
                    totalCalls: 0,
                    totalOutputBytes: 0,
                },
                result: { citationCount: 1, truncated: false },
            };
        },
    });
    const dispatcher = await createTypeAgentExplorerDispatcher(
        provider,
        "unused-model",
        (_requestId, method) => dispatchMethods.push(method),
    );
    const request =
        "Explore the repository exactly.\r\n" +
        "\t```ts\nconst edge = 'source => target';\n```\r" +
        "<query>Unicode π repeated repeated</query>";
    try {
        const commandResult = await awaitCommand(
            dispatcher,
            request,
            undefined,
            { noReasoning: true },
            undefined,
            randomUUID(),
        );

        assert.equal(commandResult?.lastError, undefined);
        assert.deepEqual(commandResult?.tokenUsage, {
            requestCount: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        });
        assert.equal(commandResult?.actions?.length, 1);
        assert.equal(commandResult?.actions?.[0].parameters?.request, request);
        assert.deepEqual(received, [request]);
        assert.deepEqual(dispatchMethods, ["grammar"]);
    } finally {
        await dispatcher.close();
    }
});

test("Explorer action executes its typed request parameter and reports inner usage", async () => {
    let received: unknown;
    const provider = createTypeAgentExplorerProvider({
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
    });
    const agent = await provider.loadAppAgent("explorer");
    const agentContext = await agent.initializeAgentContext?.();
    const result = await agent.executeAction?.(
        {
            schemaName: "explorer",
            actionName: "exploreRepository",
            parameters: { request: query },
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

test("Explorer action rejects a missing or empty typed request", async () => {
    const provider = createTypeAgentExplorerProvider({
        explore: async () => {
            throw new Error("exploreDetailed must be used");
        },
        exploreDetailed: async () => {
            throw new Error("invalid request reached Explorer");
        },
    });
    const agent = await provider.loadAppAgent("explorer");
    const agentContext = await agent.initializeAgentContext?.();

    for (const parameters of [{}, { request: "   " }]) {
        await assert.rejects(
            async () =>
                await agent.executeAction?.(
                    {
                        schemaName: "explorer",
                        actionName: "exploreRepository",
                        parameters,
                    } as TypeAgentAction,
                    { sessionContext: { agentContext } } as never,
                ),
            /request/i,
        );
    }
});

test("direct-dispatch evidence fails closed on every bypass", () => {
    const valid = evidence();
    assert.doesNotThrow(() => assertDirectDispatchEvidence(valid, query));
    const crlfRequest = "first\r\nsecond";
    assert.doesNotThrow(() =>
        assertDirectDispatchEvidence(
            {
                ...valid,
                submittedRequest: crlfRequest,
                translatedActions: [
                    {
                        schemaName: "explorer",
                        actionName: "exploreRepository",
                        parameters: { request: "first\nsecond" },
                    },
                ],
            },
            crlfRequest,
        ),
    );

    const invalid: TypeAgentDispatchEvidence[] = [
        { ...valid, submittedRequest: `@action explorer exploreRepository` },
        { ...valid, dispatchMethod: false },
        { ...valid, dispatchMethod: "construction" },
        { ...valid, translationInvoked: true },
        { ...valid, translationRequestCount: 1 },
        { ...valid, activeAgentNames: ["explorer", "chat"] },
        { ...valid, activeSchemaNames: ["explorer", "chat"] },
        { ...valid, translatedActions: [] },
        {
            ...valid,
            translatedActions: [
                {
                    schemaName: "explorer",
                    actionName: "exploreRepository",
                    parameters: {},
                },
            ],
        },
        {
            ...valid,
            translatedActions: [
                {
                    schemaName: "explorer",
                    actionName: "exploreRepository",
                    parameters: { request: "translation-model mutation" },
                },
            ],
        },
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
        dispatchMethod: "grammar",
        translationInvoked: false,
        translationRequestCount: 0,
        activeAgentNames: ["explorer"],
        activeSchemaNames: ["explorer"],
        translatedActions: [
            {
                schemaName: "explorer",
                actionName: "exploreRepository",
                parameters: { request: query },
            },
        ],
        executionCount: 1,
        outputMatchedExecution: true,
        executionRequestMatchedIngress: true,
        usedCopilot: false,
        usedMcp: false,
    };
}
