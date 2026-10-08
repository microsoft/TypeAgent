// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
} from "../dist/memoryClient.js";
import { memoryToolNames } from "../dist/protocol.js";

test("in-process search forwarding preserves trace IDs and disabled knowledge-read arity", async () => {
    const calls = [];
    const service = {
        search: async (request) => calls.push(["search", request]),
        searchEvents: async (request) => calls.push(["events", request]),
        searchProcedures: async (request) =>
            calls.push(["procedures", request]),
        getSourceKnowledge: async (...args) =>
            calls.push(["knowledge", ...args]),
    };
    const client = new InProcessMemoryServiceClient(service);
    const request = { corpusId: "corpus", query: "query", traceId: "trace" };
    await client.search(request);
    await client.searchEvents(request);
    await client.searchProcedures(request);
    await client.getSourceKnowledge("corpus", "source");
    await client.getSourceKnowledge("corpus", "source", "trace");
    assert.deepEqual(calls, [
        ["search", request],
        ["events", request],
        ["procedures", request],
        ["knowledge", "corpus", "source"],
        ["knowledge", "corpus", "source", "trace"],
    ]);
    assert.ok(
        calls.slice(0, 3).every(([, forwarded]) => forwarded === request),
    );
});

test("MCP forwarding does not add trace IDs to the tool contract", async () => {
    const calls = [];
    const search = {
        query: "query",
        matches: [],
        warnings: [],
        capabilitiesUsed: [],
        indexVersion: "version",
    };
    const client = new McpMemoryServiceClient({
        callTool: async (call) => {
            calls.push(call);
            const result =
                call.name === memoryToolNames.search
                    ? search
                    : call.name === memoryToolNames.eventSearch
                      ? { query: "query", matches: [] }
                      : call.name === memoryToolNames.procedureSearch
                        ? []
                        : { entities: [], topics: [], relationships: [] };
            return { content: [], structuredContent: { result } };
        },
    });
    const request = { corpusId: "corpus", query: "query", traceId: "trace" };
    await client.search(request);
    await client.searchEvents(request);
    await client.searchProcedures(request);
    await client.getSourceKnowledge("corpus", "source", "trace");
    assert.deepEqual(
        calls.map((call) => call.arguments),
        [
            { corpusId: "corpus", query: "query" },
            { corpusId: "corpus", query: "query" },
            { corpusId: "corpus", query: "query" },
            { corpusId: "corpus", sourceId: "source" },
        ],
    );
    assert.equal(request.traceId, "trace");
});
