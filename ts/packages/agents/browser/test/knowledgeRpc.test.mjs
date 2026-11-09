// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { validateViewRequest } from "../dist/views/server/features/views/viewValidation.mjs";
import { createMemoryViewFunctions } from "../dist/agent/memoryViews.mjs";
import { tryMemoryHubIntegratedAnswer } from "../dist/agent/memoryHubIntegratedAnswer.mjs";
import { viewMethods } from "@typeagent/browser-control-rpc/viewRpc";

test("browser knowledge RPC is allowlisted, strict and forwards exact checkpoint identities", async () => {
    const calls = [];
    const service = {
        async getKnowledgeStatus(corpusId) {
            calls.push(corpusId);
            return { discovery: { policy: "off" }, checkpoints: [] };
        },
        async updateKnowledgeDiscovery(request) {
            calls.push(request);
            return {};
        },
        async createKnowledgeCheckpoint(request) {
            calls.push(request);
            return {};
        },
        async getKnowledgeCheckpoint(request) {
            calls.push(request);
            return {};
        },
        async waitForKnowledgeCheckpoint(request) {
            calls.push(request);
            return {};
        },
    };
    const rpc = createMemoryViewFunctions(() => service);
    for (const [method, params] of [
        ["memoryGetKnowledgeStatus", { corpusId: "corpus" }],
        [
            "memoryUpdateKnowledgeDiscovery",
            { corpusId: "corpus", policy: "suggest", retryFailed: true },
        ],
        [
            "memoryCreateKnowledgeCheckpoint",
            { corpusId: "corpus", producerComplete: false },
        ],
        [
            "memoryGetKnowledgeCheckpoint",
            { corpusId: "corpus", checkpointId: "checkpoint" },
        ],
        [
            "memoryWaitForKnowledgeCheckpoint",
            {
                corpusId: "corpus",
                checkpointId: "checkpoint",
                timeoutMs: 600000,
            },
        ],
    ]) {
        assert.ok(viewMethods.includes(method));
        assert.deepEqual(validateViewRequest({ method, params }), {
            method,
            params,
        });
        await rpc[method](params);
        assert.throws(() =>
            validateViewRequest({
                method,
                params: { ...params, externalTool: "fetch" },
            }),
        );
    }
    assert.equal(calls.length, 5);
    assert.deepEqual(calls.at(-1), {
        corpusId: "corpus",
        checkpointId: "checkpoint",
        timeoutMs: 600000,
    });
    assert.throws(() =>
        validateViewRequest({
            method: "memoryWaitForKnowledgeCheckpoint",
            params: { corpusId: "c", checkpointId: "k", timeoutMs: Infinity },
        }),
    );
});
test("knowledge operations are explicitly forwarded by the browser extension", () => {
    const source = ts.createSourceFile(
        "handlers.ts",
        readFileSync(
            new URL(
                "../../browserExtension/src/extension/serviceWorker/serviceWorkerRpcHandlers.ts",
                import.meta.url,
            ),
            "utf8",
        ),
        ts.ScriptTarget.Latest,
        true,
    );
    const factory = source.statements.find(
        (statement) =>
            ts.isFunctionDeclaration(statement) &&
            statement.name?.text === "createAllHandlers",
    );
    const returned = factory.body.statements.find((statement) =>
        ts.isReturnStatement(statement),
    ).expression;
    for (const method of [
        "memoryGetKnowledgeStatus",
        "memoryUpdateKnowledgeDiscovery",
        "memoryCreateKnowledgeCheckpoint",
        "memoryGetKnowledgeCheckpoint",
        "memoryWaitForKnowledgeCheckpoint",
    ]) {
        const property = returned.properties.find(
            (value) => value.name?.getText(source) === method,
        );
        assert.equal(
            property.initializer.body.expression.getText(source),
            "forward",
        );
        assert.equal(property.initializer.body.arguments[0].text, method);
    }
});
test("browser adapters omit absent optional fields instead of forwarding explicit undefined", async () => {
    const calls = [];
    const rpc = createMemoryViewFunctions(() => ({
        async updateKnowledgeDiscovery(request) {
            calls.push(request);
            return {};
        },
        async createKnowledgeCheckpoint(request) {
            calls.push(request);
            return {};
        },
        async waitForKnowledgeCheckpoint(request) {
            calls.push(request);
            return {};
        },
    }));
    await rpc.memoryUpdateKnowledgeDiscovery({
        corpusId: "corpus",
        policy: "off",
        retryFailed: undefined,
    });
    await rpc.memoryCreateKnowledgeCheckpoint({
        corpusId: "corpus",
        timeoutMs: undefined,
        sourceIds: undefined,
        families: undefined,
        producerComplete: undefined,
    });
    await rpc.memoryWaitForKnowledgeCheckpoint({
        corpusId: "corpus",
        checkpointId: "checkpoint",
        timeoutMs: undefined,
    });
    assert.deepEqual(calls, [
        { corpusId: "corpus", policy: "off" },
        { corpusId: "corpus" },
        { corpusId: "corpus", checkpointId: "checkpoint" },
    ]);
    const result = { query: "Name?", matches: [], warnings: [], errors: [] };
    await tryMemoryHubIntegratedAnswer(
        {
            async getCapabilities() {
                return { derivedViews: { integratedAnswering: true } };
            },
            async answer(request) {
                assert.equal(Object.hasOwn(request, "retrievalPolicy"), false);
                assert.equal(
                    Object.hasOwn(request, "knowledgeCheckpointId"),
                    false,
                );
                return {
                    answer: "Ada",
                    mode: "synthesized",
                    warnings: [],
                    citations: [
                        {
                            evidenceId: "e",
                            sourceId: "s",
                            revisionId: "r",
                            title: "Source",
                            snippet: "Ada",
                            score: 1,
                            sourceType: "text",
                        },
                    ],
                };
            },
        },
        [{ corpusId: "corpus", name: "Corpus" }],
        { corpusId: "corpus", query: "Name?", generateAnswer: true },
        result,
    );
    for (const property of ["locator", "canonicalUri", "synopsis", "eventTime"])
        assert.equal(Object.hasOwn(result.matches[0], property), false);
    assert.equal(Object.hasOwn(result.answer, "derivedReferences"), false);
    assert.equal(Object.hasOwn(result.answer, "assertionReferences"), false);
});
test("scoped Hub Ask uses service integrated answer and retains exact view/assertion provenance", async () => {
    const calls = [];
    const reference = {
        viewId: "view",
        revisionId: "revision",
        sectionId: "slot",
        state: "selected",
    };
    const service = {
        async getCapabilities() {
            return { derivedViews: { integratedAnswering: true } };
        },
        async answer(request) {
            calls.push(request);
            return {
                question: request.question,
                answer: "You stated Ada.",
                mode: "synthesized",
                citations: [
                    {
                        evidenceId: "evidence",
                        sourceId: "source",
                        revisionId: "revision",
                        title: "Retained source",
                        snippet: "Ada",
                        score: 1,
                        sourceType: "text",
                        locator: "chars:0-3",
                    },
                ],
                derivedReferences: [reference],
                assertionReferences: [
                    {
                        ...reference,
                        candidateId: "candidate",
                        assertionOrigin: "user",
                    },
                ],
                warnings: ["Partial coverage"],
            };
        },
    };
    const corpus = { corpusId: "corpus", name: "Corpus" };
    const result = { query: "Name?", matches: [], warnings: [], errors: [] };
    assert.equal(
        await tryMemoryHubIntegratedAnswer(
            service,
            [corpus],
            {
                corpusId: "corpus",
                query: "Name?",
                generateAnswer: true,
                retrievalPolicy: "sourcesAndViews",
                knowledgeCheckpointId: "checkpoint",
            },
            result,
        ),
        true,
    );
    assert.equal(calls[0].retrievalPolicy, "sourcesAndViews");
    assert.equal(calls[0].knowledgeCheckpointId, "checkpoint");
    assert.equal(result.answer.derivedReferences[0].revisionId, "revision");
    assert.equal(result.answer.assertionReferences[0].assertionOrigin, "user");
    assert.equal(result.answer.derivedReferences[0].corpusId, "corpus");
    assert.deepEqual(result.answer.citationIds, ["evidence"]);
    assert.ok(result.warnings.includes("Partial coverage"));
});
test("strict integrated mode rejects unsupported mixed scope rather than silently falling back", async () => {
    const service = {
        async getCapabilities() {
            return { derivedViews: { integratedAnswering: true } };
        },
    };
    const result = { query: "Name?", matches: [], warnings: [], errors: [] };
    await assert.rejects(
        tryMemoryHubIntegratedAnswer(
            service,
            [],
            {
                query: "Name?",
                generateAnswer: true,
                retrievalPolicy: "sourcesAndViews",
            },
            result,
        ),
        /one selected document collection/,
    );
    assert.equal(
        await tryMemoryHubIntegratedAnswer(
            service,
            [],
            { query: "Name?", generateAnswer: true },
            result,
        ),
        false,
    );
    assert.match(result.warnings[0], /coverage is not qualified/);
});
