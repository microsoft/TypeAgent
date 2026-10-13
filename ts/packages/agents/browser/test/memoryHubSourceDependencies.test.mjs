// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryHubSourceOriginalFunctions } from "../dist/agent/memoryHubSourceOriginal.mjs";
import { createMemoryHubViewUsageFunctions } from "../dist/agent/memoryHubViewUsage.mjs";
import { validateViewRequest } from "../dist/views/server/features/views/viewValidation.mjs";

const request = { corpusId: "c", sourceId: "s", revisionId: "retained" };
function originalFixture() {
    const reads = [];
    const text = "a".repeat(12_050) + "Original retained evidence";
    const service = {
        getSource: async () => ({
            corpusId: "c",
            sourceId: "s",
            title: "Original source",
            activeRevisionId: "latest",
            revisions: [{ revisionId: "retained", state: "ready" }],
        }),
        getSourceContent: async (input) => {
            reads.push(input);
            const offset = input.offset ?? 0;
            const content = text.slice(offset, offset + input.maxChars);
            const next = offset + content.length;
            return {
                revisionId: input.revisionId,
                content,
                offset,
                totalChars: text.length,
                ...(next < text.length ? { nextOffset: next } : {}),
            };
        },
    };
    return { service, text, reads };
}

test("generic original read preserves the exact retained revision and locates later document evidence", async () => {
    const { service, text, reads } = originalFixture();
    const functions = createMemoryHubSourceOriginalFunctions(() => service);
    const original = await functions.memoryHubSourceOriginal({
        ...request,
        locator: "characters:12050:12058",
    });
    assert.equal(original.available, true);
    assert.equal(original.title, "Original source");
    assert.equal(original.content, text.slice(12050));
    assert.deepEqual(original.location, {
        kind: "characters",
        start: 12050,
        end: 12058,
    });
    assert.equal(original.offset, 12050);
    assert.ok(reads.every((read) => read.revisionId === "retained"));
    assert.deepEqual(
        reads.map((read) => read.offset ?? 0),
        [0, 12050],
    );
    assert.ok(!Object.hasOwn(original, "assets"));
    assert.ok(!Object.hasOwn(original, "citation"));
    const page = await functions.memoryHubSourceOriginal({
        ...request,
        offset: 10,
    });
    assert.equal(page.offset, 10);
    assert.equal(page.nextOffset, 12010);
});

test("forgotten, deleted, substituted and invalid original evidence report availability errors explicitly", async () => {
    for (const [patch, input, message] of [
        [{ getSource: async () => undefined }, request, /forgotten/],
        [
            {
                getSource: async () => ({
                    revisions: [{ revisionId: "retained", state: "deleted" }],
                }),
            },
            request,
            /revision is unavailable/,
        ],
        [
            { getSourceContent: async () => ({ revisionId: "latest" }) },
            request,
            /different source revision/,
        ],
        [{}, { ...request, locator: "chars:0-999999" }, /outside its revision/],
        [{}, { ...request, locator: "chars:1-1" }, /outside its revision/],
        [{}, { ...request, locator: "invalid" }, /Unsupported/],
        [
            {
                getSourceContent: async () => {
                    throw new Error("Source read offline");
                },
            },
            request,
            /Source read offline/,
        ],
    ]) {
        const { service } = originalFixture();
        const functions = createMemoryHubSourceOriginalFunctions(() => ({
            ...service,
            ...patch,
        }));
        const result = await functions.memoryHubSourceOriginal(input);
        assert.equal(result.available, false);
        assert.equal(result.content, "");
        assert.match(result.error, message);
    }
});

function usageFixture() {
    function version(revisionId, selected = true) {
        return {
            viewId: "guide",
            revisionId,
            version: revisionId === "current" ? 2 : 1,
            state: "draft",
            provenance: "generated",
            definition: {
                selector: { sources: selected ? [{ sourceId: "s" }] : [] },
            },
            content: {
                kind: "troubleshootingGuide",
                title: "Guide",
                citations: [],
            },
            relationships: [
                {
                    from: { kind: "section", sectionId: "diagnosis" },
                    to: { kind: "source", sourceId: "s" },
                },
            ],
        };
    }
    const current = version("current");
    const history = [
        version("historical"),
        current,
        version("unrelated", false),
    ];
    const jobs = [
        {
            jobId: "build",
            results: [
                {
                    viewId: "guide",
                    state: "draft",
                    reason: "Built from source",
                    snapshot: {
                        definition: {
                            kind: "troubleshootingGuide",
                            selector: { sources: [{ sourceId: "s" }] },
                        },
                    },
                },
                {
                    viewId: "conflicted",
                    state: "conflict",
                    reason: "Needs review",
                    conflictId: "conflict",
                    snapshot: {
                        definition: {
                            kind: "wiki",
                            selector: { sources: [{ sourceId: "s" }] },
                        },
                    },
                },
            ],
        },
    ];
    const service = {
        getCapabilities: async () => ({ derivedViews: { history: true } }),
        getSource: async (corpusId, sourceId) => ({ corpusId, sourceId }),
        listViews: async () => ({ views: [current], head: "head" }),
        getViewHistory: async () => history.map((version) => ({ version })),
        listViewBuilds: async () => jobs,
    };
    return { service, current };
}

test("source Used by returns only new View revisions/build receipts with exact direct paging", async () => {
    const { service } = usageFixture();
    const functions = createMemoryHubViewUsageFunctions(() => service);
    const scope = { corpusId: "c", sourceId: "s", pageSize: 1 };
    const items = [];
    let continuationToken;
    do {
        const page = await functions.memoryHubViewUsedBy({
            ...scope,
            continuationToken,
        });
        assert.equal(page.total, 4);
        assert.deepEqual(
            Object.keys(page).sort(),
            page.nextContinuationToken
                ? ["items", "nextContinuationToken", "total"]
                : ["items", "total"],
        );
        items.push(...page.items);
        continuationToken = page.nextContinuationToken;
    } while (continuationToken);
    assert.deepEqual(items.map((item) => item.state).sort(), [
        "build",
        "conflict",
        "current",
        "historical",
    ]);
    assert.deepEqual(
        items.find((item) => item.state === "current").sectionIds,
        ["diagnosis"],
    );
    assert.equal(
        items.find((item) => item.state === "conflict").conflictId,
        "conflict",
    );
    assert.ok(
        items.every(
            (item) =>
                !Object.hasOwn(item, "procedure") &&
                !Object.hasOwn(item, "skills"),
        ),
    );
});

test("source View usage rejects cross-scope/stale cursors, forgotten sources and unavailable history", async () => {
    const { service, current } = usageFixture();
    const functions = createMemoryHubViewUsageFunctions(() => service);
    const scope = { corpusId: "c", sourceId: "s", pageSize: 1 };
    const first = await functions.memoryHubViewUsedBy(scope);
    await assert.rejects(
        functions.memoryHubViewUsedBy({
            ...scope,
            sourceId: "other",
            continuationToken: first.nextContinuationToken,
        }),
        /another scope/,
    );
    current.content.title = "Changed";
    await assert.rejects(
        functions.memoryHubViewUsedBy({
            ...scope,
            continuationToken: first.nextContinuationToken,
        }),
        /changed/,
    );
    await assert.rejects(
        functions.memoryHubViewUsedBy({
            ...scope,
            continuationToken: "invalid",
        }),
        /Invalid/,
    );
    await assert.rejects(
        functions.memoryHubViewUsedBy({ ...scope, pageSize: 0 }),
        /page size/,
    );
    service.getSource = async () => undefined;
    await assert.rejects(functions.memoryHubViewUsedBy(scope), /forgotten/);
    service.getCapabilities = async () => ({});
    await assert.rejects(functions.memoryHubViewUsedBy(scope), /unavailable/);
});

test("generic source original and new View usage gateway contracts are strict and source-scoped", () => {
    for (const [method, params] of [
        ["memoryHubSourceOriginal", { ...request, locator: "chars:0-10" }],
        ["memoryHubViewUsedBy", { corpusId: "c", sourceId: "s", pageSize: 20 }],
    ]) {
        assert.deepEqual(validateViewRequest({ method, params }), {
            method,
            params,
        });
        assert.throws(() =>
            validateViewRequest({
                method,
                params: { ...params, procedureId: "legacy" },
            }),
        );
        assert.throws(() =>
            validateViewRequest({
                method,
                params: { ...params, sourceId: "" },
            }),
        );
    }
    assert.throws(() =>
        validateViewRequest({
            method: "memoryHubSourceOriginal",
            params: { ...request, offset: -1 },
        }),
    );
    assert.throws(() =>
        validateViewRequest({
            method: "memoryHubViewUsedBy",
            params: { corpusId: "c", sourceId: "s", pageSize: 0 },
        }),
    );
});
