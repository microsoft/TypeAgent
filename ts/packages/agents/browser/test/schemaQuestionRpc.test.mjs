// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { InProcessMemoryServiceClient } from "@typeagent/memory-client";
import { viewMethods } from "@typeagent/browser-control-rpc/viewRpc";
import { validateViewRequest } from "../dist/views/server/features/views/viewValidation.mjs";
import { createMemoryViewFunctions } from "../dist/agent/memoryViews.mjs";
import {
    acquisitionProgress,
    acquisitionOperation,
} from "../dist/agent/memoryAcquisitionProgress.mjs";

const base = {
    corpusId: "corpus",
    viewId: "view",
    expectedHead: "head",
    expectedVersion: 2,
};

test("browser acquisition RPC reaches sanitized typed clients without host authority", async () => {
    const request = {
        corpusId: "corpus",
        requestId: "request",
        sourceId: "source",
        state: "ingested",
        createdAt: "now",
        updatedAt: "now",
        calls: 1,
        retries: 0,
        consumers: [],
        principalId: "PRIVATE",
        authorizedArguments: { query: "PRIVATE" },
        staged: { text: "PRIVATE" },
    };
    const service = {
        marker: "bound",
        async listAcquisitions(corpusId) {
            assert.equal(this.marker, "bound");
            assert.equal(corpusId, "corpus");
            return [request];
        },
        async runAcquisitions(corpusId) {
            return this.listAcquisitions(corpusId);
        },
        async cancelAcquisition(input) {
            assert.equal(input.requestId, "request");
            return { ...request, state: "cancelled" };
        },
    };
    const client = new InProcessMemoryServiceClient(service);
    const rpc = createMemoryViewFunctions(() => client);
    const progress = await client.listAcquisitionProgress("corpus");
    assert.deepEqual(
        await rpc.memoryListAcquisitions({ corpusId: "corpus" }),
        progress,
    );
    assert.deepEqual(
        await rpc.memoryRunAcquisitions({ corpusId: "corpus" }),
        progress,
    );
    assert.equal(
        (
            await rpc.memoryCancelAcquisition({
                corpusId: "corpus",
                requestId: "request",
            })
        ).state,
        "cancelled",
    );
    assert.equal(JSON.stringify(progress).includes("PRIVATE"), false);
});

test("discovery edits admit only explicit finite lifetime bounds", () => {
    for (const maxProposals of [0, 8]) {
        const request = {
            method: "memoryEditQuestion",
            params: {
                ...base,
                slotId: "slot",
                edit: { kind: "discovery", enabled: true, maxProposals },
            },
        };
        assert.deepEqual(validateViewRequest(request), request);
    }
    for (const maxProposals of [-1, 9, 1.5, Infinity])
        assert.throws(() =>
            validateViewRequest({
                method: "memoryEditQuestion",
                params: {
                    ...base,
                    slotId: "slot",
                    edit: { kind: "discovery", enabled: true, maxProposals },
                },
            }),
        );
});

test("question RPC admits only explicit typed edits and exact page selectors", () => {
    const request = {
        method: "memoryEditQuestion",
        params: {
            ...base,
            slotId: "name",
            edit: { kind: "assert", value: { name: "Ada", active: true } },
        },
    };
    assert.deepEqual(
        validateViewRequest(JSON.parse(JSON.stringify(request))),
        request,
    );
    for (const edit of [
        { kind: "execute", tool: "fetch" },
        { kind: "review", candidateId: "c", review: "accepted" },
        { kind: "assert", value: "Ada", citations: [] },
    ])
        assert.throws(() =>
            validateViewRequest({
                ...request,
                params: { ...base, slotId: "name", edit },
            }),
        );
    const page = {
        method: "memoryGetViewPage",
        params: {
            corpusId: "corpus",
            viewId: "view",
            revisionId: "revision",
            slotId: "addresses",
            itemKey: "home",
        },
    };
    assert.deepEqual(validateViewRequest(page), page);
    assert.throws(() =>
        validateViewRequest({
            ...page,
            params: { ...page.params, tool: "fetch" },
        }),
    );
});

test("schema proposals require an explicit validated maintenance scope", () => {
    const proposal = {
        method: "memoryProposeSchemaView",
        params: {
            ...base,
            expectedVersion: 0,
            specification: "Propose a name form",
            maintenance: {
                schemaVersion: 1,
                scope: { mode: "scopedSources", tags: ["profile"] },
            },
        },
    };
    assert.deepEqual(validateViewRequest(proposal), proposal);
    assert.throws(() =>
        validateViewRequest({
            ...proposal,
            params: { ...proposal.params, maintenance: undefined },
        }),
    );
    assert.throws(() =>
        validateViewRequest({
            ...proposal,
            params: {
                ...proposal.params,
                maintenance: {
                    schemaVersion: 1,
                    scope: { mode: "externalTools" },
                },
            },
        }),
    );
});

test("optional schema service methods retain receiver and fail explicitly when unavailable", async () => {
    const service = {
        marker: "bound",
        async listQuestions(corpusId) {
            return { head: this.marker, items: [], corpusId };
        },
        async editQuestion(request) {
            return request;
        },
        async getViewPage(request) {
            return {
                uri: `memory-view://${request.corpusId}/${request.viewId}`,
                revisionId: "r",
                markdown: "# Name",
            };
        },
        async proposeSchemaView(request) {
            return request;
        },
        async discoverSchemaQuestions(request) {
            return request;
        },
    };
    const rpc = createMemoryViewFunctions(() => service);
    assert.equal(
        (await rpc.memoryListQuestions({ corpusId: "corpus" })).head,
        "bound",
    );
    assert.deepEqual(
        await rpc.memoryEditQuestion({
            ...base,
            slotId: "name",
            edit: { kind: "approval", approval: "approved" },
        }),
        {
            ...base,
            slotId: "name",
            edit: { kind: "approval", approval: "approved" },
        },
    );
    assert.equal(
        (await rpc.memoryGetViewPage({ corpusId: "corpus", viewId: "view" }))
            .uri,
        "memory-view://corpus/view",
    );
    assert.deepEqual(await rpc.memoryDiscoverSchemaQuestions(base), base);
    const missing = createMemoryViewFunctions(() => ({}));
    assert.throws(
        () => missing.memoryListQuestions({ corpusId: "corpus" }),
        /capability unavailable/,
    );
});

test("acquisition progress serialization excludes staged content and outbound authority", async () => {
    const sensitive = {
        corpusId: "corpus",
        requestId: "request",
        sourceId: "source",
        state: "ingesting",
        createdAt: "created",
        updatedAt: "updated",
        calls: 1,
        retries: 0,
        consumers: [
            {
                viewId: "view",
                slotId: "slot",
                definitionRevision: "definition",
                secret: "PRIVATE",
            },
        ],
        principalId: "PRIVATE",
        policyId: "PRIVATE",
        toolId: "PRIVATE",
        authorizedArguments: { query: "PRIVATE" },
        staged: { content: "PRIVATE" },
        resourceIdentity: "PRIVATE",
        error: "PRIVATE",
        receipt: {
            jobId: "job",
            revisionId: "revision",
            state: "indexing",
            statusUri: "PRIVATE",
        },
    };
    const progress = acquisitionProgress(sensitive);
    assert.equal(JSON.stringify(progress).includes("PRIVATE"), false);
    assert.equal(progress.hasError, true);
    assert.deepEqual(progress.receipt, {
        jobId: "job",
        revisionId: "revision",
        state: "indexing",
    });
    const rpc = createMemoryViewFunctions(() => ({
        async listAcquisitions() {
            return [sensitive];
        },
        async runAcquisitions() {
            return [sensitive];
        },
        async cancelAcquisition() {
            return sensitive;
        },
    }));
    assert.deepEqual(await rpc.memoryListAcquisitions({ corpusId: "corpus" }), [
        progress,
    ]);
    assert.deepEqual(await rpc.memoryRunAcquisitions({ corpusId: "corpus" }), [
        progress,
    ]);
    assert.deepEqual(
        await rpc.memoryCancelAcquisition({
            corpusId: "corpus",
            requestId: "request",
        }),
        progress,
    );
    await assert.rejects(
        () =>
            acquisitionOperation(async () => {
                throw new Error("PRIVATE authorized query");
            }),
        (error) => !error.message.includes("PRIVATE"),
    );
    await assert.rejects(
        () =>
            createMemoryViewFunctions(() => ({})).memoryListAcquisitions({
                corpusId: "corpus",
            }),
        /capability is unavailable/,
    );
});

test("acquisition browser controls cannot admit requests or enable tools or periodic work", () => {
    for (const method of ["memoryListAcquisitions", "memoryRunAcquisitions"])
        assert.deepEqual(
            validateViewRequest({ method, params: { corpusId: "corpus" } }),
            { method, params: { corpusId: "corpus" } },
        );
    assert.deepEqual(
        validateViewRequest({
            method: "memoryCancelAcquisition",
            params: { corpusId: "corpus", requestId: "request" },
        }).params,
        { corpusId: "corpus", requestId: "request" },
    );
    assert.throws(() =>
        validateViewRequest({
            method: "memoryRunAcquisitions",
            params: { corpusId: "corpus", authorizedArguments: {} },
        }),
    );
    for (const method of [
        "memoryRequestAcquisition",
        "memoryStartAcquisitionPeriodic",
    ])
        assert.throws(
            () =>
                validateViewRequest({ method, params: { corpusId: "corpus" } }),
            /Unknown view method/,
        );
});

test("question and acquisition operations are registered in view IPC and the extension forwarding transport", () => {
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
    const agent = createMemoryViewFunctions(() => ({}));
    for (const method of [
        "memoryListQuestions",
        "memoryEditQuestion",
        "memoryGetViewPage",
        "memoryProposeSchemaView",
        "memoryDiscoverSchemaQuestions",
        "memoryListAcquisitions",
        "memoryRunAcquisitions",
        "memoryCancelAcquisition",
    ]) {
        assert.ok(
            viewMethods.includes(method),
            `${method} missing from view IPC allowlist`,
        );
        assert.equal(
            typeof agent[method],
            "function",
            `${method} missing agent handler`,
        );
        const property = returned.properties.find(
            (property) => property.name?.getText(source) === method,
        );
        assert.ok(
            property && ts.isArrowFunction(property.initializer),
            `${method} missing extension handler`,
        );
        const call = property.initializer.body;
        assert.equal(call.expression.getText(source), "forward");
        assert.equal(call.arguments[0].text, method);
        assert.equal(call.arguments[1].getText(source), "params");
    }
});
