// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentInvokeHandlers } from "../dist/agent/agentServiceHandlers.mjs";

test("PDF-derived Markdown uses the ordinary content memory pipeline", async () => {
    const calls = [];
    const result = { jobId: "job", sourceId: "source", revisionId: "revision" };
    const handlers = createAgentInvokeHandlers({
        agentContext: {
            memoryServiceClient: {
                async ingestDocument(request) {
                    calls.push(request);
                    return result;
                },
            },
        },
    });
    assert.equal(
        await handlers.memoryImportDocument({
            corpusId: "corpus",
            title: "Paper",
            markdown: "# Paper\n\nExtracted text",
            canonicalUri: "https://example.org/paper.pdf",
            tags: ["research"],
        }),
        result,
    );
    assert.deepEqual(calls, [
        {
            corpusId: "corpus",
            source: {
                sourceType: "markdown",
                title: "Paper",
                markdown: "# Paper\n\nExtracted text",
                canonicalUri: "https://example.org/paper.pdf",
                tags: ["research"],
            },
            pipeline: {
                mode: "content",
                updatePolicy: "retainRevisionHistory",
            },
        },
    ]);
    assert.equal(
        Object.keys(handlers).some((name) => name.startsWith("pdf")),
        false,
    );
});

test("Markdown import omits unspecified metadata and propagates failures", async () => {
    const failure = new Error("ingest failed");
    const handlers = createAgentInvokeHandlers({
        agentContext: {
            memoryServiceClient: {
                async ingestDocument(request) {
                    assert.deepEqual(request.source, {
                        sourceType: "markdown",
                        title: "Paper",
                        markdown: "text",
                    });
                    throw failure;
                },
            },
        },
    });
    await assert.rejects(
        handlers.memoryImportDocument({
            corpusId: "corpus",
            title: "Paper",
            markdown: "text",
        }),
        (error) => error === failure,
    );
});

test("forget delegates directly without reading PDF metadata or session storage", async () => {
    const request = {
        corpusId: "corpus",
        sourceId: "source",
        confirmationToken: "confirmed",
    };
    const result = { sourceId: "source", forgotten: true };
    const handlers = createAgentInvokeHandlers({
        agentContext: {
            memoryServiceClient: {
                async getSource() {
                    throw new Error("Must not inspect capture metadata");
                },
                async forgetSource(params) {
                    assert.deepEqual(params, request);
                    return result;
                },
            },
        },
        get sessionStorage() {
            throw new Error("Must not access PDF storage");
        },
    });
    assert.equal(await handlers.memoryForgetSource(request), result);
});

test("ordinary import requires the memory service, not a PDF capability", () => {
    const handlers = createAgentInvokeHandlers({ agentContext: {} });
    assert.throws(
        () =>
            handlers.memoryImportDocument({
                corpusId: "corpus",
                title: "Paper",
                markdown: "text",
            }),
        /Durable memory service is not available/,
    );
});
