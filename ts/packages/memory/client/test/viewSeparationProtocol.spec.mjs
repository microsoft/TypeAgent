// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
} from "../dist/memoryClient.js";
import {
    viewSeparationRequestSchema,
    viewSeparationResultSchema,
    viewSeparationToolName,
} from "../dist/viewSeparationProtocol.js";

const request = {
    operation: "confirm",
    corpusId: "corpus",
    receiptId: "split-proposal",
    expectedHead: "a".repeat(40),
    confirmationToken: "b".repeat(64),
};

test("separation requires an exact proposal token and guards, never extra automatic-execution instructions", () => {
    assert.deepEqual(viewSeparationRequestSchema.parse(request), request);
    for (const invalid of [
        { ...request, automatic: true },
        { ...request, confirmationToken: undefined },
        { ...request, confirmationToken: "" },
        { ...request, expectedHead: undefined },
        { ...request, operation: "execute" },
        {
            operation: "read",
            corpusId: "corpus",
            viewId: "article",
            confirmationToken: request.confirmationToken,
        },
    ])
        assert.equal(
            viewSeparationRequestSchema.safeParse(invalid).success,
            false,
        );
    assert.equal(
        viewSeparationResultSchema.safeParse({
            head: null,
            proposal: null,
            active: true,
        }).success,
        false,
    );
});

test("both clients reject malformed confirmation and MCP rejects malformed responses", async () => {
    let calls = 0;
    const inProcess = new InProcessMemoryServiceClient({
        separateView: async () => {
            calls++;
            return { head: null, proposal: null };
        },
    });
    assert.deepEqual(await inProcess.separateView(request), {
        head: null,
        proposal: null,
    });
    assert.throws(() =>
        inProcess.separateView({ ...request, automatic: true }),
    );
    const client = new McpMemoryServiceClient({
        callTool: async ({ name, arguments: args }) => {
            calls++;
            assert.equal(name, viewSeparationToolName);
            assert.deepEqual(args, request);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            head: null,
                            proposal: { state: "active" },
                        }),
                    },
                ],
            };
        },
    });
    await assert.rejects(() => client.separateView(request));
    assert.throws(() =>
        client.separateView({ ...request, confirmationToken: "" }),
    );
    assert.equal(calls, 2);
});
