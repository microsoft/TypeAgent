// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MacroManager } from "../../../copilot-macros/dist/index.js";
import { WorkiqEvidenceError } from "../macro-eval-workiq-evidence.mjs";
import {
    createWorkiqAgencyAdapter,
    createWorkiqMcpServer,
    createWorkiqCurrentOracle,
    workiqReadArguments,
    workiqLookupBindingGuidance,
    workiqModelVisibleTools,
    verifyWorkiqModelVisibleMetadata,
    workiqJsonHash,
} from "../macro-eval-workiq-adapter.mjs";
import {
    createWorkiqPilotPrerequisites,
    reviewWorkiqDraftContract,
    createWorkiqDraftReviewer,
} from "../macro-eval-workiq-prerequisites.mjs";
import { workiqPendingConsentArguments } from "../macro-eval-workiq-controller.mjs";

const key = "application/vnd.ms-workiq.retrieval";
const fields = [
    "id",
    "name",
    "size",
    "eTag",
    "cTag",
    "lastModifiedDateTime",
    "file",
    "parentReference",
    "webUrl",
    "sharepointIds",
];
const metadataSuffix = "?$select=" + fields.join(",");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const iso = () => new Date().toISOString();
const clone = (value) => structuredClone(value);

function generatedAdmission() {
    const root = "https://example.invalid/teams/example/Shared%20Documents";
    const entities = ["A", "B"].map((letter, index) => {
        const bytes = index
            ? Buffer.alloc(1_200_000, 0x51)
            : Buffer.from("# Generated Markdown\n" + "complete\n".repeat(5000));
        if (index)
            bytes.write(
                "PK\u0003\u0004generated DOCX-like original with media-sensitive bytes",
            );
        const title = index ? "generated.docx" : "generated.md";
        const url = `${root}/${title}`;
        const mime = index
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "text/markdown";
        return {
            key: letter,
            title,
            itemId: `item-${letter}`,
            driveId: "drive-generated",
            canonicalWebUrl: url,
            canonicalPath: decodeURIComponent(new URL(url).pathname),
            actualMetadataWebUrl: index
                ? `https://example.invalid/teams/example/_layouts/15/Doc.aspx?file=${title}&sourcedoc=generated`
                : url,
            entityPath: `/drives/drive-generated/items/item-${letter}`,
            metadataMimeType: mime,
            transportContentType: index ? mime : "application/octet-stream",
            blobName: title,
            inputs: {
                documentQuery: `Exact generated ${letter}`,
                documentUrl: url,
            },
            oracle: {
                sizeBytes: bytes.length,
                sha256: digest(bytes),
                frozenVersion: {
                    size: bytes.length,
                    eTag: "etag-generated",
                    cTag: "ctag-generated",
                    lastModifiedDateTime: "2026-01-01T00:00:00Z",
                },
                libraryGuard: {
                    driveId: "drive-generated",
                    driveType: "documentLibrary",
                    parentPath: "/drives/drive-generated/root:",
                    siteId: "site-generated",
                    listId: "list-generated",
                    canonicalLookupWebUrl: url,
                },
            },
            generatedBytes: bytes,
        };
    });
    const schemas = ["retrieve", "fetch", "fetch_blob"].map((name) => ({
        advertisedName: name,
        inputSchema: {
            type: "object",
            properties:
                name === "retrieve"
                    ? {
                          query: { type: "string" },
                          strategy: { type: "string" },
                          capabilities: { type: "array" },
                          includeDeveloperCard: {
                              type: "boolean",
                              default: false,
                          },
                      }
                    : name === "fetch"
                      ? { entityUrls: { type: "array" } }
                      : { path: { type: "string" } },
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
    }));
    const expression = {
        kind: "resultPath",
        stepId: "lookup",
        path: ["structuredContent", key, "retrievalHits", "0", "entityUrl"],
    };
    const admission = {
        schemaVersion: 1,
        entities: entities.map(
            ({ generatedBytes: _generatedBytes, ...entity }) => entity,
        ),
        library: { driveId: "drive-generated", canonicalWebUrl: root },
        runtime: {
            mcpServer: "workiq",
            knownLocalExecutable: path.resolve("agency.exe"),
            knownStdioArguments: ["mcp", "workiq"],
            advertisedToolSchemas: schemas,
        },
        sourceSchemaRequirements: {
            trace: {
                schemaVersion: 2,
                capabilities: ["private-result-evidence-v1"],
            },
            macro: { schemaVersion: 2, capabilities: ["result-path-v1"] },
        },
        workflow: {
            recipe: [
                { step: "lookup", advertisedTool: "retrieve" },
                {
                    step: "before",
                    advertisedTool: "fetch",
                    argumentTemplate: {
                        entityUrls: [{ ...expression, suffix: metadataSuffix }],
                    },
                },
                {
                    step: "original",
                    advertisedTool: "fetch_blob",
                    argumentTemplate: {
                        path: { ...expression, suffix: "/content" },
                    },
                },
                {
                    step: "after",
                    advertisedTool: "fetch",
                    argumentTemplate: {
                        entityUrls: [{ ...expression, suffix: metadataSuffix }],
                    },
                },
            ],
        },
    };
    return {
        admission,
        bytes: entities.map((entity) => entity.generatedBytes),
    };
}

function replies(entity, bytes) {
    const metadata = {
        id: entity.itemId,
        name: entity.title,
        ...entity.oracle.frozenVersion,
        file: { mimeType: entity.metadataMimeType },
        parentReference: {
            driveId: entity.driveId,
            driveType: "documentLibrary",
            path: entity.oracle.libraryGuard.parentPath,
        },
        sharepointIds: { siteId: "site-generated", listId: "list-generated" },
        webUrl: entity.actualMetadataWebUrl,
    };
    const envelope = (structuredContent) => ({
        content: [],
        isError: false,
        structuredContent,
    });
    return [
        envelope({
            [key]: {
                markdown: "Generated lookup only",
                resultCount: 1,
                stoppedReason: "completed",
                retrievalHits: [
                    {
                        itemId: entity.itemId,
                        driveId: entity.driveId,
                        entityUrl: entity.entityPath,
                        webUrl: entity.canonicalWebUrl,
                        resourceMetadata: {},
                    },
                ],
            },
        }),
        envelope({ results: [{ data: metadata, statusCode: 200 }] }),
        envelope({
            base64Content: bytes.toString("base64"),
            blobName: entity.blobName,
            contentType: entity.transportContentType,
            sizeBytes: bytes.length,
            statusCode: 200,
        }),
        envelope({ results: [{ data: clone(metadata), statusCode: 200 }] }),
    ];
}

async function fixture(
    t,
    {
        entityKey = "A",
        wrapped = false,
        denied = false,
        schemaDrift = false,
        contractV2 = false,
        diagnostic,
        throughMcp = false,
        reverseMetadataSelection = false,
        sdkStructured = false,
        lookupOnlyDiagnostic,
    } = {},
) {
    const root = path.resolve(`.workiq-adapter-${randomUUID()}`);
    await mkdir(root);
    t.after(() => rm(root, { recursive: true, force: true }));
    const { admission, bytes } = generatedAdmission();
    if (contractV2)
        admission.evaluationContract = {
            schemaVersion: 2,
            kind: "workiq-macro-correctness-v2",
        };
    const entityIndex = entityKey === "A" ? 0 : 1;
    const entity = admission.entities[entityIndex];
    const results = replies(entity, bytes[entityIndex]);
    const scope = {
        ownerId: "owner-generated",
        sessionId: "session-generated",
        runId: null,
        phase: entityKey === "A" ? "capture-a" : "reuse-b",
    };
    const stats = {
        connections: 0,
        lists: 0,
        calls: [],
        closed: 0,
        authorized: [],
    };
    const catalog = admission.runtime.advertisedToolSchemas.map((tool) => ({
        name: tool.advertisedName,
        inputSchema: clone(tool.inputSchema),
        annotations: clone(tool.annotations),
    }));
    if (schemaDrift) catalog[0].inputSchema.properties.extra = {};
    const auditRoot = path.join(root, "audit");
    const sessionRoot = path.join(root, "native");
    await mkdir(path.join(sessionRoot, scope.sessionId), { recursive: true });
    const events = [
        {
            id: randomUUID(),
            type: "session.start",
            timestamp: iso(),
            data: { sessionId: scope.sessionId },
        },
    ];
    const options = {
        admission,
        scope,
        entityKey,
        auditRoot,
        lookupOnlyDiagnostic,
        host: {
            assertPrerequisites: async () => {
                if (denied)
                    throw new WorkiqEvidenceError(
                        "blocked",
                        "nativePrerequisitesPending",
                    );
            },
            authorizeRead: async (value) => {
                stats.authorized.push(value);
            },
        },
        connect: async () => {
            stats.connections++;
            return {
                listTools: async () => {
                    stats.lists++;
                    return { tools: catalog };
                },
                callTool: async (request) => {
                    stats.calls.push(clone(request));
                    return clone(results[stats.calls.length - 1]);
                },
                close: async () => {
                    stats.closed++;
                },
            };
        },
    };
    const adapter = createWorkiqAgencyAdapter(options);
    const nativeDiscovery = {
        origin: "native-tool-discovery",
        sessionId: scope.sessionId,
        tools: catalog.map((tool) => ({
            advertisedName: tool.name,
            callableName: `explicit_workiq_${tool.name}`,
            mcpServerName: "workiq",
            inputSchema: clone(tool.inputSchema),
            annotations: clone(tool.annotations),
        })),
    };
    let summary, trace, trial;
    async function execute() {
        await adapter.start();
        let mcpClient;
        if (throughMcp) {
            const server = createWorkiqMcpServer(adapter);
            mcpClient = new Client({ name: "contract-v2-test", version: "1" });
            const [left, right] = InMemoryTransport.createLinkedPair();
            await Promise.all([mcpClient.connect(left), server.connect(right)]);
            t.after(async () => {
                await mcpClient.close();
                await server.close();
            });
        }
        const startedAt = iso();
        const calls = [];
        for (let index = 0; index < 4; index++) {
            const name = ["retrieve", "fetch", "fetch_blob", "fetch"][index];
            const args = workiqReadArguments(
                admission,
                entityKey,
                index,
                results[0],
            );
            if (index === 0 && diagnostic !== undefined)
                args.includeDeveloperCard = diagnostic;
            if (reverseMetadataSelection && (index === 1 || index === 3)) {
                const [base, query] = args.entityUrls[0].split("?");
                const fields = new URLSearchParams(query)
                    .get("$select")
                    .split(",");
                args.entityUrls[0] =
                    base + "?$select=" + fields.reverse().join(",");
            }
            const toolCallId = `native-call-${index}`;
            events.push({
                id: randomUUID(),
                type: "tool.execution_start",
                timestamp: iso(),
                data: {
                    toolCallId,
                    toolName: `explicit_workiq_${name}`,
                    mcpServerName: "workiq",
                    arguments: args,
                },
            });
            const original = mcpClient
                ? await mcpClient.callTool({ name, arguments: args })
                : await adapter.call(name, args);
            const raw = sdkStructured
                ? {
                      content:
                          index === 2
                              ? "SDK binary summary, not original bytes"
                              : JSON.stringify(original.structuredContent),
                      detailedContent: "SDK display rendering",
                      structuredContent: clone(original.structuredContent),
                  }
                : wrapped
                  ? {
                        content: JSON.stringify(original),
                        detailedContent: "",
                        contents: [],
                    }
                  : original;
            events.push({
                id: randomUUID(),
                type: "tool.execution_complete",
                timestamp: iso(),
                data: { toolCallId, success: true, result: raw },
            });
            calls.push({
                toolCallId,
                name: `explicit_workiq_${name}`,
                mcpServerName: "workiq",
                arguments: args,
                status: "completed",
                result: raw,
                ...(wrapped ? { modelResult: original } : {}),
            });
        }
        const completedAt = iso();
        const manager = new MacroManager(root);
        manager.armRecording({ sessionId: scope.sessionId, learning: false });
        const token = manager.claimRecording({
            sessionId: scope.sessionId,
            cwd: root,
            promptHash: digest(Buffer.from("Generated full original")),
        });
        summary = await manager.finalizeRecording({
            tokenId: token.id,
            trace: {
                schemaVersion: 1,
                sessionId: scope.sessionId,
                cwd: root,
                prompt: "Generated full original",
                response: "Only a generated receipt, never used as oracle",
                startedAt,
                completedAt,
                toolCalls: calls,
            },
        });
        trace = JSON.parse(
            await readFile(
                path.join(
                    root,
                    "copilot-macros",
                    "traces",
                    `${summary.traceId}.json`,
                ),
            ),
        );
        trial = {
            sessionId: scope.sessionId,
            traceId: summary.traceId,
            runId: null,
            startedAt,
            endedAt: new Date(Date.now() + 60_000).toISOString(),
        };
        await writeEvents();
        return trace;
    }
    async function writeEvents() {
        await writeFile(
            path.join(sessionRoot, scope.sessionId, "events.jsonl"),
            events.map((value) => JSON.stringify(value)).join("\n") + "\n",
        );
    }
    const oracleOptions = () => ({
        admission,
        scope,
        entityKey,
        auditRoot,
        nativeSessionRoot: sessionRoot,
        artifactRoot: path.join(root, "copilot-macros"),
        trial,
        readNativeDiscovery: async () => clone(nativeDiscovery),
    });
    return {
        root,
        admission,
        entity,
        results,
        scope,
        stats,
        adapter,
        options,
        events,
        nativeDiscovery,
        execute,
        writeEvents,
        oracleOptions,
        getTrace: () => trace,
        getTrial: () => trial,
        verdict: () =>
            createWorkiqCurrentOracle(oracleOptions()).verify({ entityKey }),
    };
}

for (const entityKey of ["A", "B"])
    for (const wrapped of [false, true]) {
        test(`Agency ${entityKey} original with ${wrapped ? "SDK JSON wrapper" : "MCP envelope"} joins actual generated v2 trace and SDK file`, async (t) => {
            const f = await fixture(t, { entityKey, wrapped });
            await f.execute();
            assert.equal(f.getTrace().schemaVersion, 2);
            assert.ok(
                Buffer.byteLength(JSON.stringify(f.getTrace())) < 1024 * 1024,
            );
            const verdict = await f.verdict();
            assert.equal(verdict.status, "passed", JSON.stringify(verdict));
            assert.equal(verdict.receipt.sha256, f.entity.oracle.sha256);
            assert.equal(verdict.originalBytesVerified, true);
            assert.equal(verdict.fullTrialAccepted, false);
            assert.equal(verdict.modelConsumptionVerified, false);
            assert.equal(f.stats.connections, 1);
            assert.equal(f.stats.lists, 1);
            assert.equal(f.stats.calls.length, 4);
            assert.equal(f.stats.authorized.length, 4);
            await f.adapter.close();
            assert.equal(f.adapter.complete(), true);
            assert.equal((await f.verdict()).status, "passed");
        });
    }

test("common native/slot/consent gate denies before any connection or metadata", async (t) => {
    const f = await fixture(t, { denied: true });
    await assert.rejects(
        f.adapter.start(),
        (error) => error.code === "nativePrerequisitesPending",
    );
    assert.equal(f.stats.connections, 0);
    assert.equal(f.stats.lists, 0);
});

test("catalog drift closes the owned client without any tenant document call", async (t) => {
    const f = await fixture(t, { schemaDrift: true });
    await assert.rejects(
        f.adapter.start(),
        (error) => error.code === "agencySchemaDrift",
    );
    assert.equal(f.stats.calls.length, 0);
    assert.equal(f.stats.closed, 1);
    assert.equal(f.stats.authorized.length, 0);
});

test("next consent read is exact scoped data, not a permission grant", async (t) => {
    const f = await fixture(t);
    assert.equal(f.adapter.nextRead(), null);
    await f.adapter.start();
    const expected = workiqReadArguments(f.admission, "A", 0);
    const next = f.adapter.nextRead();
    assert.deepEqual(next, { name: "retrieve", arguments: expected });
    next.arguments.query = "not the selected document";
    assert.deepEqual(f.adapter.nextRead().arguments, expected);
    await f.adapter.call("retrieve", expected);
    assert.deepEqual(f.adapter.nextRead(), {
        name: "fetch",
        arguments: workiqReadArguments(f.admission, "A", 1, f.results[0]),
    });

    await t.test(
        "larger real backend catalog exposes only the three frozen read tools",
        async (t) => {
            const f = await fixture(t);
            const connect = f.options.connect;
            const excluded = [
                "ask",
                "list_agents",
                "delete_entity",
                "do_action",
                "create_entity",
                "get_schema",
                "search_paths",
                "call_function",
                "update_entity",
            ];
            const adapter = createWorkiqAgencyAdapter({
                ...f.options,
                connect: async (...args) => {
                    const client = await connect(...args);
                    return {
                        ...client,
                        listTools: async () => {
                            const result = await client.listTools();
                            return {
                                tools: [
                                    ...result.tools,
                                    ...excluded.map((name) => ({
                                        name,
                                        inputSchema: { type: "object" },
                                    })),
                                ],
                            };
                        },
                    };
                },
            });
            const exposed = await adapter.start();
            assert.deepEqual(exposed.map((tool) => tool.name).sort(), [
                "fetch",
                "fetch_blob",
                "retrieve",
            ]);
            const facts = adapter.catalogObservation();
            assert.equal(facts.toolCount, 12);
            assert.deepEqual(facts.excludedNames, excluded);
            assert.match(facts.sha256, /^[a-f0-9]{64}$/u);
            await assert.rejects(
                adapter.call("update_entity", {}),
                (error) => error.code === "unexpectedWorkiqOperation",
            );
            assert.equal(f.stats.calls.length, 0);
            assert.equal(f.stats.authorized.length, 0);
        },
    );
    await f.adapter.close();
    assert.equal(f.adapter.nextRead(), null);
});

for (const [name, args] of [
    ["ask", { query: "not permitted" }],
    ["retrieve", { query: "unscoped" }],
    ["fetch_blob", { path: "/drives/drive-generated/items/item-A/content" }],
]) {
    test(`${name} outside serial grounded contract is stopped with no service read`, async (t) => {
        const f = await fixture(t);
        await f.adapter.start();
        await assert.rejects(f.adapter.call(name, args), WorkiqEvidenceError);
        assert.equal(f.stats.calls.length, 0);
        await assert.rejects(
            f.adapter.call(
                "retrieve",
                workiqReadArguments(f.admission, "A", 0),
            ),
            WorkiqEvidenceError,
        );
    });
}

test("MCP facade advertises only actual read schemas and returns exact original payload", async (t) => {
    const f = await fixture(t);
    await f.adapter.start();
    const server = createWorkiqMcpServer(f.adapter);
    const client = new Client({
        name: "generated-adapter-test",
        version: "1.0.0",
    });
    const [left, right] = InMemoryTransport.createLinkedPair();
    t.after(async () => {
        await client.close();
        await server.close();
        await f.adapter.close();
    });
    await Promise.all([client.connect(left), server.connect(right)]);
    assert.match(
        client.getInstructions(),
        /omit includeDeveloperCard entirely/u,
    );
    assert.match(client.getInstructions(), /Do not add optional fields/u);
    assert.deepEqual(
        (await client.listTools()).tools,
        workiqModelVisibleTools(
            f.adapter.tools(),
            f.adapter.lookupBindingGuidance(),
        ),
    );
    assert.deepEqual(
        (await client.listTools()).tools.map((tool) => tool.name),
        ["retrieve", "fetch", "fetch_blob"],
    );
    const response = await client.callTool({
        name: "retrieve",
        arguments: workiqReadArguments(f.admission, "A", 0),
    });
    assert.deepEqual(response, f.results[0]);
    await assert.rejects(
        client.callTool({ name: "ask", arguments: { query: "forbidden" } }),
    );
});

for (const entityKey of ["A", "B"]) {
    test(`actual MCP initialization supplies selected ${entityKey} scalar binding used by the exact four-read recipe`, async (t) => {
        const f = await fixture(t, { entityKey });
        await f.adapter.start();
        const before = f.adapter.tools();
        const server = createWorkiqMcpServer(f.adapter);
        const client = new Client({ name: "generated-binding", version: "1" });
        const [left, right] = InMemoryTransport.createLinkedPair();
        t.after(async () => {
            await client.close();
            await server.close();
        });
        await Promise.all([client.connect(left), server.connect(right)]);
        const instructions = client.getInstructions();
        const binding = JSON.parse(
            instructions.match(
                /Frozen lookup scalar binding JSON: ([^\n]+)/u,
            )[1],
        );
        const entity = f.admission.entities.find(
            (entry) => entry.key === entityKey,
        );
        assert.deepEqual(binding, {
            query: entity.inputs.documentQuery,
            strategy: "grounding",
        });
        assert.equal(instructions.includes(entity.canonicalWebUrl), false);
        const other = f.admission.entities.find(
            (entry) => entry.key !== entityKey,
        );
        assert.equal(instructions.includes(other.inputs.documentQuery), false);
        const request = {
            ...binding,
            capabilities: [
                {
                    name: "OneDriveAndSharePoint",
                    items_by_url: [{ url: entity.inputs.documentUrl }],
                },
            ],
        };
        assert.deepEqual(
            request,
            workiqReadArguments(f.admission, entityKey, 0),
        );
        const lookup = await client.callTool({
            name: "retrieve",
            arguments: request,
        });
        for (let index = 1; index < 4; index++) {
            await client.callTool({
                name: ["retrieve", "fetch", "fetch_blob", "fetch"][index],
                arguments: workiqReadArguments(
                    f.admission,
                    entityKey,
                    index,
                    lookup,
                ),
            });
        }
        assert.equal(f.adapter.complete(), true);
        const visible = workiqModelVisibleTools(
            before,
            f.adapter.lookupBindingGuidance(),
        );
        const listed = (await client.listTools()).tools;
        assert.deepEqual(listed, visible);
        assert.deepEqual(f.adapter.tools(), before);
        for (let index = 0; index < before.length; index++) {
            assert.deepEqual(
                listed[index].inputSchema,
                before[index].inputSchema,
            );
            assert.deepEqual(
                listed[index].annotations,
                before[index].annotations,
            );
            assert.equal(
                listed[index].description !== before[index].description,
                before[index].name === "retrieve",
            );
        }
        const metadata = {
            tools: listed.map((tool) => ({
                mcpServerName: f.admission.runtime.mcpServer,
                mcpToolName: tool.name,
                input_schema: tool.inputSchema,
                description: tool.description,
            })),
        };
        assert.equal(
            verifyWorkiqModelVisibleMetadata(
                metadata,
                f.admission.runtime.mcpServer,
                visible,
            ),
            undefined,
        );
        const stale = structuredClone(metadata);
        stale.tools.find(
            (tool) => tool.mcpToolName === "retrieve",
        ).description = before.find(
            (tool) => tool.name === "retrieve",
        ).description;
        assert.throws(
            () =>
                verifyWorkiqModelVisibleMetadata(
                    stale,
                    f.admission.runtime.mcpServer,
                    visible,
                ),
            (error) => error.code === "workiqModelGuidanceDescriptionMismatch",
        );
        const mixed = structuredClone(metadata);
        mixed.tools.find(
            (tool) => tool.mcpToolName === "retrieve",
        ).description = workiqModelVisibleTools(
            before,
            workiqLookupBindingGuidance(f.admission, other.key),
        ).find((tool) => tool.name === "retrieve").description;
        assert.throws(
            () =>
                verifyWorkiqModelVisibleMetadata(
                    mixed,
                    f.admission.runtime.mcpServer,
                    visible,
                ),
            (error) => error.code === "workiqModelGuidanceDescriptionMismatch",
        );
        assert.equal(f.stats.calls.length, 4);
        assert.deepEqual(f.stats.calls[0].arguments, request);
    });
}

test("lookup guidance cannot expose URL or credential-shaped query values", () => {
    for (const query of [
        "https://example.invalid/generated",
        "Bearer generated-not-a-real-token",
    ]) {
        const { admission } = generatedAdmission();
        admission.entities[0].inputs.documentQuery = query;
        assert.throws(
            () => workiqLookupBindingGuidance(admission, "A"),
            (error) => error.code === "unsafeWorkiqLookupGuidance",
        );
    }
});

test("legacy MCP facade without selected binding preserves schemas and generic instructions", async (t) => {
    const f = await fixture(t);
    await f.adapter.start();
    const server = createWorkiqMcpServer({
        tools: f.adapter.tools,
        call: f.adapter.call,
    });
    const client = new Client({
        name: "generated-legacy-facade",
        version: "1",
    });
    const [left, right] = InMemoryTransport.createLinkedPair();
    t.after(async () => {
        await client.close();
        await server.close();
    });
    await Promise.all([client.connect(left), server.connect(right)]);
    assert.equal(
        client.getInstructions().includes("Frozen lookup scalar binding JSON:"),
        false,
    );
    assert.deepEqual((await client.listTools()).tools, f.adapter.tools());
    assert.deepEqual(
        await client.callTool({
            name: "retrieve",
            arguments: workiqReadArguments(f.admission, "A", 0),
        }),
        f.results[0],
    );
});

test("wrong entity and mixed lookup bindings cannot become an accepted request", async (t) => {
    const f = await fixture(t);
    assert.throws(() => workiqLookupBindingGuidance(f.admission, "C"));
    for (const mixedField of ["query", "capabilities"]) {
        const current = await fixture(t);
        await current.adapter.start();
        const a = workiqReadArguments(current.admission, "A", 0);
        const b = workiqReadArguments(current.admission, "B", 0);
        await assert.rejects(
            current.adapter.call("retrieve", {
                ...a,
                [mixedField]: b[mixedField],
            }),
            (error) => error.code === "workiqScopeMismatch",
        );
        assert.equal(current.stats.calls.length, 0);
        assert.equal(current.stats.authorized.length, 0);
    }
});

test("URL-decorated semantic lookup still rejects without rewriting or provider invocation", async (t) => {
    const f = await fixture(t);
    await f.adapter.start();
    const expected = workiqReadArguments(f.admission, "A", 0);
    await assert.rejects(
        f.adapter.call("retrieve", {
            ...expected,
            query:
                expected.query + " " + f.admission.entities[0].canonicalWebUrl,
        }),
        (error) => error.code === "workiqScopeMismatch",
    );
    assert.equal(f.stats.calls.length, 0);
    assert.equal(f.stats.authorized.length, 0);
});

for (const entityKey of ["A", "B"]) {
    for (const diagnostic of [undefined, true, false]) {
        test(`v2 actual MCP and native-original ${entityKey} flow retains diagnostic ${diagnostic} and additive service output`, async (t) => {
            const f = await fixture(t, {
                entityKey,
                contractV2: true,
                diagnostic,
                throughMcp: true,
            });
            const hit = f.results[0].structuredContent[key].retrievalHits[0];
            const protectionMetadata =
                diagnostic === true
                    ? "restricted"
                    : diagnostic === false
                      ? { unknownFutureEnum: true }
                      : "allowed";
            hit.contentProtection = protectionMetadata;
            hit.webUrl =
                "https://example.invalid/_layouts/15/Doc.aspx?service=upgraded";
            hit.resourceId = "new-opaque-resource";
            hit.resourceMetadata = {
                web: { title: "service display title" },
                featureFlag: true,
            };
            f.results[0].newEnvelopeMetadata = { upgraded: true };
            f.results[0].structuredContent[key].diagnosticCard = { version: 2 };
            for (const index of [1, 3]) {
                const data = f.results[index].structuredContent.results[0].data;
                data.webUrl = hit.webUrl;
                data.name = "service display name";
                data.futureMetadata = { version: 3 };
                f.results[index].structuredContent.futureField = true;
            }
            f.results[2].structuredContent.futureBlobMetadata = { version: 4 };
            await f.execute();
            const report = await f.verdict();
            assert.equal(report.status, "passed");
            assert.equal(report.originalBytesVerified, true);
            assert.deepEqual(
                f.events[1].data.arguments,
                f.stats.calls[0].arguments,
            );
            assert.equal(
                Object.hasOwn(
                    f.stats.calls[0].arguments,
                    "includeDeveloperCard",
                ),
                diagnostic !== undefined,
            );
            if (diagnostic !== undefined)
                assert.equal(
                    f.stats.calls[0].arguments.includeDeveloperCard,
                    diagnostic,
                );
            const call = JSON.parse(
                await readFile(path.join(f.root, "audit", "call-0.json")),
            );
            assert.deepEqual(call.arguments, f.events[1].data.arguments);
            assert.deepEqual(
                call.result.structuredContent[key].retrievalHits[0]
                    .contentProtection,
                protectionMetadata,
            );
            assert.equal(
                call.result.structuredContent[key].retrievalHits[0].webUrl,
                hit.webUrl,
            );
            assert.match(
                f.adapter.lookupBindingGuidance(),
                /includeDeveloperCard may be absent, true or false/u,
            );
            const exposed = workiqModelVisibleTools(
                f.adapter.tools(),
                f.adapter.lookupBindingGuidance(),
            );
            assert.doesNotMatch(
                exposed[0].description,
                /omit includeDeveloperCard/u,
            );
            await f.adapter.close();
        });
    }
}

for (const entityKey of ["A", "B"]) {
    test(`v2 ${entityKey} full SDK structured representation preserves raw evidence and provider correlation`, async (t) => {
        const f = await fixture(t, {
            entityKey,
            contractV2: true,
            sdkStructured: true,
            throughMcp: true,
            diagnostic: true,
            reverseMetadataSelection: true,
        });
        await f.execute();
        const report = await f.verdict();
        assert.equal(report.status, "passed");
        assert.equal(report.originalBytesVerified, true);
        assert.equal(Object.hasOwn(f.events[2].data.result, "isError"), false);
        assert.equal(typeof f.events[2].data.result.content, "string");
        assert.deepEqual(
            f.events[6].data.result.structuredContent,
            f.results[2].structuredContent,
        );
        assert.equal(
            f.events[6].data.result.content,
            "SDK binary summary, not original bytes",
        );
        await f.adapter.close();
    });
}

for (const [name, mutate] of [
    [
        "absent SDK structured data",
        (f) => {
            delete f.events[6].data.result.structuredContent;
        },
    ],
    [
        "clipped SDK structured blob",
        (f) => {
            f.events[6].data.result.structuredContent.base64Content =
                f.events[6].data.result.structuredContent.base64Content.slice(
                    0,
                    20,
                );
        },
    ],
    [
        "mismatched SDK structured metadata",
        (f) => {
            f.events[4].data.result.structuredContent.results[0].data.id =
                "another-document";
        },
    ],
    [
        "failed SDK completion",
        (f) => {
            f.events[6].data.success = false;
        },
    ],
    [
        "explicit SDK denial",
        (f) => {
            f.events[6].data.result.isError = true;
        },
    ],
    [
        "flipped SDK blob byte",
        (f) => {
            const b = Buffer.from(
                f.events[6].data.result.structuredContent.base64Content,
                "base64",
            );
            b[0] ^= 1;
            f.events[6].data.result.structuredContent.base64Content =
                b.toString("base64");
        },
    ],
    [
        "foreign SDK session",
        (f) => {
            f.events[0].data.sessionId = "foreign";
        },
    ],
]) {
    test(`v2 cannot use intact provider data to repair ${name}`, async (t) => {
        const f = await fixture(t, { contractV2: true, sdkStructured: true });
        await f.execute();
        mutate(f);
        await f.writeEvents();
        const report = await f.verdict();
        assert.notEqual(report.status, "passed");
        assert.equal(report.originalBytesVerified, false);
        await f.adapter.close();
    });
}

test("v2 capture guidance qualifies every actual MCP description while leaving B approved-handoff guidance unchanged", async (t) => {
    const f = await fixture(t, { contractV2: true });
    await f.adapter.start();
    const raw = f.adapter.tools();
    const exposed = workiqModelVisibleTools(
        raw,
        workiqLookupBindingGuidance(f.admission, "A"),
    );
    for (const [index, tool] of exposed.entries()) {
        assert.match(tool.description, /Capture completion policy v1/u);
        assert.match(tool.description, /four serial WorkIQ reads/u);
        assert.match(tool.description, /Do not start task\/subagents/u);
        assert.match(tool.description, /host independently verifies/u);
        assert.match(tool.description, /Metadata binding policy v1/u);
        assert.match(tool.description, /including lastModifiedDateTime/u);
        const suffix =
            f.admission.workflow.recipe[1].argumentTemplate.entityUrls[0]
                .suffix;
        assert.ok(tool.description.includes(JSON.stringify(suffix)));
        assert.match(
            tool.description,
            /no field may be omitted, duplicated or added/u,
        );
        assert.deepEqual(tool.inputSchema, raw[index].inputSchema);
        assert.deepEqual(tool.annotations, raw[index].annotations);
        assert.equal(raw[index].description, undefined);
    }
    const b = workiqModelVisibleTools(
        raw,
        workiqLookupBindingGuidance(f.admission, "B"),
    );
    assert.doesNotMatch(b[0].description, /Capture completion policy v1/u);
    assert.doesNotMatch(b[0].description, /Metadata binding policy v1/u);
    assert.equal(b[1].description, raw[1].description);
    assert.equal(b[2].description, raw[2].description);
    const stale = {
        tools: raw.map((t) => ({
            mcpServerName: "workiq",
            mcpToolName: t.name,
            input_schema: t.inputSchema,
            description: t.description,
        })),
    };
    assert.throws(
        () => verifyWorkiqModelVisibleMetadata(stale, "workiq", exposed),
        WorkiqEvidenceError,
    );
    await f.adapter.close();
});

test("v2 SDK structured data does not bypass the retained raw artifact digest", async (t) => {
    const f = await fixture(t, { contractV2: true, sdkStructured: true });
    await f.execute();
    const trace = f.getTrace();
    assert.ok(trace.toolCalls[2].resultArtifact);
    trace.toolCalls[2].resultArtifact.sha256 = "0".repeat(64);
    await writeFile(
        path.join(f.root, "copilot-macros", "traces", `${trace.traceId}.json`),
        JSON.stringify(trace),
    );
    const report = await f.verdict();
    assert.notEqual(report.status, "passed");
    assert.equal(report.originalBytesVerified, false);
    await f.adapter.close();
});

for (const diagnostic of [null, 0, 1, "true", {}, []]) {
    test(`v2 rejects invalid diagnostic ${JSON.stringify(diagnostic)} before MCP provider read`, async (t) => {
        const f = await fixture(t, { contractV2: true });
        await f.adapter.start();
        await assert.rejects(
            f.adapter.call("retrieve", {
                ...workiqReadArguments(f.admission, "A", 0),
                includeDeveloperCard: diagnostic,
            }),
            (e) => e.code === "workiqScopeMismatch",
        );
        assert.equal(f.stats.calls.length, 0);
        assert.equal(f.stats.authorized.length, 0);
    });
}

for (const [name, mutate] of [
    [
        "unknown argument",
        (args) => {
            args.unapproved = true;
        },
    ],
    [
        "wrong entity scope",
        (args) => {
            args.capabilities[0].items_by_url[0].url =
                "https://example.invalid/other";
        },
    ],
    [
        "missing strategy",
        (args) => {
            delete args.strategy;
        },
    ],
]) {
    test(`v2 diagnostic does not excuse ${name}`, async (t) => {
        const f = await fixture(t, { contractV2: true });
        await f.adapter.start();
        const args = {
            ...workiqReadArguments(f.admission, "A", 0),
            includeDeveloperCard: true,
        };
        mutate(args);
        await assert.rejects(
            f.adapter.call("retrieve", args),
            (e) => e.code === "workiqScopeMismatch",
        );
        assert.equal(f.stats.calls.length, 0);
    });
}

for (const field of fields) {
    test(`v2 omitting required metadata ${field} remains rejected by consent and adapter before upstream fetch`, async (t) => {
        const f = await fixture(t, { contractV2: true });
        await f.adapter.start();
        await f.adapter.call(
            "retrieve",
            workiqReadArguments(f.admission, "A", 0),
        );
        const expected = workiqReadArguments(f.admission, "A", 1, f.results[0]);
        const actual = {
            entityUrls: [
                f.entity.entityPath +
                    "?$select=" +
                    fields
                        .filter((value) => value !== field)
                        .reverse()
                        .join(","),
            ],
        };
        const tool = { name: "fetch", namespacedName: "workiq-fetch" };
        const events = [
            {
                type: "tool.execution_start",
                data: {
                    toolCallId: "synthetic-pending-fetch",
                    toolName: tool.namespacedName,
                    mcpServerName: f.admission.runtime.mcpServer,
                    arguments: actual,
                },
            },
        ];
        assert.throws(
            () =>
                workiqPendingConsentArguments(
                    events,
                    tool,
                    { name: "fetch", arguments: expected },
                    f.admission,
                ),
            (e) => e.code === "workiqConsentRequestMismatch",
        );
        assert.deepEqual(events[0].data.arguments, actual);
        await assert.rejects(
            f.adapter.call("fetch", actual),
            (e) => e.code === "workiqScopeMismatch",
        );
        assert.equal(f.stats.calls.length, 1);
        assert.equal(f.stats.authorized.length, 1);
    });

    test(`v2 external draft review cannot approve metadata suffix missing ${field}`, async (t) => {
        const f = await fixture(t, { contractV2: true });
        await f.execute();
        const draft = draftFor(f, true);
        draft.steps[1].arguments.bindings[0].expression.suffix =
            "?$select=" + fields.filter((value) => value !== field).join(",");
        assert.throws(
            () =>
                reviewWorkiqDraftContract({
                    draft,
                    trace: f.getTrace(),
                    discovery: f.nativeDiscovery,
                    admission: f.admission,
                }),
            WorkiqEvidenceError,
        );
    });
}

for (const [name, mutate] of [
    [
        "wrong item",
        (hit) => {
            hit.itemId = "item-B";
        },
    ],
    [
        "wrong namespace",
        (hit) => {
            hit.driveId = "another-drive";
        },
    ],
    [
        "mixed path",
        (hit) => {
            hit.entityUrl = "/drives/drive-generated/items/item-B";
        },
    ],
    [
        "missing identity",
        (hit) => {
            delete hit.itemId;
        },
    ],
    [
        "invalid display URL type",
        (hit) => {
            hit.webUrl = 42;
        },
    ],
    [
        "explicit denial",
        (hit) => {
            hit.permissionDenied = true;
        },
    ],
]) {
    test(`v2 additive service metadata cannot admit ${name}`, async (t) => {
        const f = await fixture(t, { contractV2: true });
        await f.adapter.start();
        const hit = f.results[0].structuredContent[key].retrievalHits[0];
        hit.contentProtection = "allowed";
        hit.webUrl = "https://example.invalid/new";
        mutate(hit);
        await assert.rejects(
            f.adapter.call(
                "retrieve",
                workiqReadArguments(f.admission, "A", 0),
            ),
            WorkiqEvidenceError,
        );
        assert.equal(f.adapter.complete(), false);
    });
}

for (const [name, mutate] of [
    [
        "missing MIME type",
        (r) => {
            delete r.structuredContent.results[0].data.file.mimeType;
        },
    ],
    [
        "wrong metadata identity",
        (r) => {
            r.structuredContent.results[0].data.id = "item-B";
        },
    ],
    [
        "explicit backend denial",
        (r) => {
            r.isError = true;
        },
    ],
    [
        "version drift",
        (r) => {
            r.structuredContent.results[0].data.eTag = "changed";
        },
    ],
]) {
    test(`v2 rejects ${name} despite additive output`, async (t) => {
        const f = await fixture(t, { contractV2: true });
        await f.adapter.start();
        await f.adapter.call(
            "retrieve",
            workiqReadArguments(f.admission, "A", 0),
        );
        mutate(f.results[1]);
        await assert.rejects(
            f.adapter.call(
                "fetch",
                workiqReadArguments(f.admission, "A", 1, f.results[0]),
            ),
            WorkiqEvidenceError,
        );
    });
}

test("v2 diagnostic raw SDK/provider mismatch is not normalized into accepted provenance", async (t) => {
    const f = await fixture(t, { contractV2: true, diagnostic: true });
    await f.execute();
    f.events[1].data.arguments.includeDeveloperCard = false;
    await f.writeEvents();
    assert.notEqual((await f.verdict()).status, "passed");
    await f.adapter.close();
});

for (const [name, mutate] of [
    [
        "duplicate display URL substitution",
        (lookup) =>
            (lookup.retrievalHits[1].webUrl =
                "https://example.invalid/replaced"),
    ],
    [
        "duplicate alias substitution",
        (lookup) => (lookup.retrievalHits[1].resourceId = "replaced"),
    ],
    ["duplicate omission", (lookup) => lookup.retrievalHits.pop()],
    ["duplicate reordering", (lookup) => lookup.retrievalHits.reverse()],
]) {
    test(`v2 ${name} cannot replace raw SDK/provider duplicate evidence`, async (t) => {
        const f = await fixture(t, {
            contractV2: true,
            sdkStructured: true,
        });
        const lookup = f.results[0].structuredContent[key];
        const duplicate = clone(lookup.retrievalHits[0]);
        duplicate.webUrl = "https://example.invalid/original-alias";
        duplicate.resourceId = "original-alias";
        lookup.resultCount = 2;
        lookup.retrievalHits.push(duplicate);
        await f.execute();
        assert.equal((await f.verdict()).status, "passed");
        mutate(f.events[2].data.result.structuredContent[key]);
        await f.writeEvents();
        const report = await f.verdict();
        assert.notEqual(report.status, "passed");
        assert.equal(report.originalBytesVerified, false);
    });
}

for (const diagnostic of [undefined, true, false]) {
    test(`v2 consent matches exactly one actual pending SDK raw diagnostic ${diagnostic}`, async (t) => {
        const f = await fixture(t, { contractV2: true });
        const next = {
            name: "retrieve",
            arguments: workiqReadArguments(f.admission, "A", 0),
        };
        const args = clone(next.arguments);
        if (diagnostic !== undefined) args.includeDeveloperCard = diagnostic;
        const tool = {
            name: "actual_retrieve",
            namespacedName: "workiq.actual_retrieve",
        };
        const event = {
            type: "tool.execution_start",
            data: {
                toolCallId: "actual-call",
                toolName: tool.name,
                mcpServerName: "workiq",
                arguments: args,
            },
        };
        assert.deepEqual(
            workiqPendingConsentArguments([event], tool, next, f.admission),
            args,
        );
        assert.equal(
            workiqPendingConsentArguments([], tool, next, f.admission),
            undefined,
        );
        assert.throws(
            () =>
                workiqPendingConsentArguments(
                    [event, event],
                    tool,
                    next,
                    f.admission,
                ),
            WorkiqEvidenceError,
        );
        const invalid = clone(event);
        invalid.data.arguments.includeDeveloperCard = "true";
        assert.throws(
            () =>
                workiqPendingConsentArguments(
                    [invalid],
                    tool,
                    next,
                    f.admission,
                ),
            WorkiqEvidenceError,
        );
    });
}

for (const includeDeveloperCard of [true, false]) {
    test(`schema-supported includeDeveloperCard:${includeDeveloperCard} remains outside the exact frozen request`, async (t) => {
        const f = await fixture(t);
        await f.adapter.start();
        assert.deepEqual(
            f.adapter.tools()[0].inputSchema.properties.includeDeveloperCard,
            { type: "boolean", default: false },
        );
        const expected = workiqReadArguments(f.admission, "A", 0);
        assert.equal(Object.hasOwn(expected, "includeDeveloperCard"), false);
        await assert.rejects(
            f.adapter.call("retrieve", { ...expected, includeDeveloperCard }),
            (error) => error.code === "workiqScopeMismatch",
        );
        assert.equal(f.stats.calls.length, 0);
        assert.equal(f.stats.authorized.length, 0);
    });
}

const mutations = [
    ...[true, false].map((includeDeveloperCard) => [
        `extra native includeDeveloperCard:${includeDeveloperCard}`,
        (f) => {
            f.events[1].data.arguments.includeDeveloperCard =
                includeDeveloperCard;
        },
    ]),
    [
        "missing current completion",
        (f) => {
            f.events.pop();
        },
    ],
    [
        "wrong current SDK original",
        (f) => {
            f.events[6].data.result = { content: "", contents: [] };
        },
    ],
    [
        "foreign native tool",
        (f) => {
            f.events[1].data.toolName = "unknown_alias";
        },
    ],
    [
        "native permission denied",
        (f) => {
            f.events.splice(2, 0, {
                type: "permission.completed",
                timestamp: f.events[1].timestamp,
                data: { toolCallId: "native-call-0", result: "denied" },
            });
        },
    ],
    [
        "model answer instead of result",
        (f) => {
            delete f.events[6].data.result;
            f.events[6].data.answer = f.results[2];
        },
    ],
    [
        "duplicated extra current call",
        (f) => {
            f.events.push(clone(f.events[1]));
        },
    ],
];
for (const [name, mutate] of mutations) {
    test(`${name} cannot use the intact provider/frozen copy as native fallback`, async (t) => {
        const f = await fixture(t);
        await f.execute();
        mutate(f);
        await f.writeEvents();
        const verdict = await f.verdict();
        assert.notEqual(verdict.status, "passed");
        assert.equal(verdict.originalBytesVerified, false);
        await f.adapter.close();
    });
}

test("foreign/missing/tampered provider sidecar is rejected independently of full native copy", async (t) => {
    const f = await fixture(t, { entityKey: "B" });
    await f.execute();
    const recordPath = path.join(f.root, "audit", "call-2.json");
    const record = JSON.parse(await readFile(recordPath));
    const ref = record.resultArtifact;
    const filename = path.join(
        f.root,
        "audit",
        "evidence",
        ref.owner,
        ref.ownerId,
        `${ref.id}.json`,
    );
    await writeFile(filename, "{}");
    assert.notEqual((await f.verdict()).status, "passed");
    await f.adapter.close();
});

test("safe original content/metadata paths are result-derived, never captured IDs or queries", async (t) => {
    const f = await fixture(t);
    const args = workiqReadArguments(f.admission, "A", 2, f.results[0]);
    assert.equal(args.path, f.entity.entityPath + "/content");
    f.results[0].structuredContent[key].retrievalHits[0].entityUrl =
        "/drives/drive-generated/items/old";
    assert.throws(
        () => workiqReadArguments(f.admission, "A", 2, f.results[0]),
        WorkiqEvidenceError,
    );
});

function draftFor(f, metadataSuffixesFromTrace = false) {
    const trace = f.getTrace();
    const first = {
        kind: "template",
        value: clone(trace.toolCalls[0].arguments),
        bindings: [
            {
                path: ["query"],
                expression: { kind: "input", name: "documentQuery" },
            },
            {
                path: ["capabilities", "0", "items_by_url", "0", "url"],
                expression: { kind: "input", name: "documentUrl" },
            },
        ],
    };
    return {
        schemaVersion: 2,
        capabilities: ["result-path-v1"],
        macroId: "macro-generated",
        version: 1,
        name: "Read full original",
        description: "Generated review contract",
        state: "draft",
        executionClass: "agentRequired",
        sourceTraceId: trace.traceId,
        createdAt: iso(),
        warnings: [],
        inputs: ["documentQuery", "documentUrl"].map((name) => ({
            name,
            description: name,
            required: true,
            secret: false,
            valueType: "string",
        })),
        steps: f.admission.workflow.recipe.map((recipe, index) => ({
            id: recipe.step,
            toolName: `explicit_workiq_${recipe.advertisedTool}`,
            mcpServerName: "workiq",
            executionClass: "agentRequired",
            sourceToolCallId: trace.toolCalls[index].toolCallId,
            arguments:
                index === 0
                    ? first
                    : {
                          kind: "template",
                          value: clone(trace.toolCalls[index].arguments),
                          bindings: [
                              {
                                  path:
                                      index === 2
                                          ? ["path"]
                                          : ["entityUrls", "0"],
                                  expression:
                                      index === 2
                                          ? recipe.argumentTemplate.path
                                          : {
                                                ...recipe.argumentTemplate
                                                    .entityUrls[0],
                                                ...(metadataSuffixesFromTrace
                                                    ? {
                                                          suffix: trace.toolCalls[
                                                              index
                                                          ].arguments.entityUrls[0].slice(
                                                              f.admission
                                                                  .entities[0]
                                                                  .entityPath
                                                                  .length,
                                                          ),
                                                      }
                                                    : {}),
                                            },
                              },
                          ],
                      },
        })),
    };
}

for (const diagnostic of [undefined, true, false]) {
    test(`v2 external review preserves diagnostic ${diagnostic} while generalizing A/B dynamic bindings`, async (t) => {
        const f = await fixture(t, { contractV2: true, diagnostic });
        await f.execute();
        const draft = draftFor(f);
        const options = {
            draft,
            trace: f.getTrace(),
            discovery: f.nativeDiscovery,
            admission: f.admission,
        };
        assert.equal(
            reviewWorkiqDraftContract(options).publicationApproved,
            false,
        );
        assert.deepEqual(
            draft.steps[0].arguments.value,
            f.getTrace().toolCalls[0].arguments,
        );
        draft.steps[0].arguments.value.includeDeveloperCard = "true";
        assert.throws(
            () => reviewWorkiqDraftContract(options),
            WorkiqEvidenceError,
        );
        await f.adapter.close();
    });
}

for (const entityKey of ["A", "B"]) {
    test(`v2 actual MCP/native ${entityKey} metadata selection order is semantic without raw rewriting`, async (t) => {
        const f = await fixture(t, {
            entityKey,
            contractV2: true,
            throughMcp: true,
            reverseMetadataSelection: true,
            diagnostic: true,
        });
        await f.execute();
        assert.equal((await f.verdict()).status, "passed");
        for (const index of [1, 3]) {
            const raw = f.stats.calls[index].arguments;
            assert.deepEqual(raw, f.events[index * 2 + 1].data.arguments);
            assert.notDeepEqual(
                raw,
                workiqReadArguments(
                    f.admission,
                    entityKey,
                    index,
                    f.results[0],
                ),
            );
            const next = {
                name: "fetch",
                arguments: workiqReadArguments(
                    f.admission,
                    entityKey,
                    index,
                    f.results[0],
                ),
            };
            const tool = {
                name: "explicit_workiq_fetch",
                namespacedName: "workiq.explicit_workiq_fetch",
            };
            assert.deepEqual(
                workiqPendingConsentArguments(
                    [f.events[index * 2 + 1]],
                    tool,
                    next,
                    f.admission,
                ),
                raw,
            );
        }
        const index = 2,
            next = {
                name: "fetch_blob",
                arguments: workiqReadArguments(
                    f.admission,
                    entityKey,
                    index,
                    f.results[0],
                ),
            };
        const tool = {
            name: "explicit_workiq_fetch_blob",
            namespacedName: "workiq.explicit_workiq_fetch_blob",
        };
        assert.deepEqual(
            workiqPendingConsentArguments(
                [f.events[5]],
                tool,
                next,
                f.admission,
            ),
            f.stats.calls[2].arguments,
        );
        await f.adapter.close();
    });
}

test("v2 external review accepts reordered typed metadata suffix while retaining actual source", async (t) => {
    const f = await fixture(t, {
        contractV2: true,
        reverseMetadataSelection: true,
    });
    await f.execute();
    const draft = draftFor(f, true);
    const options = {
        draft,
        trace: f.getTrace(),
        discovery: f.nativeDiscovery,
        admission: f.admission,
    };
    assert.equal(reviewWorkiqDraftContract(options).publicationApproved, false);
    assert.deepEqual(
        draft.steps[1].arguments.value,
        f.getTrace().toolCalls[1].arguments,
    );
    draft.steps[1].arguments.bindings[0].expression.suffix +=
        "&$expand=permissions";
    assert.throws(
        () => reviewWorkiqDraftContract(options),
        WorkiqEvidenceError,
    );
    await f.adapter.close();
});

for (const [name, mutate] of [
    ["extra selection field", (url) => url + ",permissions"],
    ["missing selection field", (url) => url.replace("id,", "")],
    ["duplicate selection field", (url) => url + ",id"],
    ["duplicate select parameter", (url) => url + "&$select=id"],
    ["extra expansion query", (url) => url + "&$expand=permissions"],
    ["wrong document locator", (url) => url.replace("item-A", "item-B")],
    ["fragment", (url) => url + "#id"],
]) {
    test(`v2 metadata request rejects ${name} before provider read`, async (t) => {
        const f = await fixture(t, { contractV2: true });
        await f.adapter.start();
        await f.adapter.call(
            "retrieve",
            workiqReadArguments(f.admission, "A", 0),
        );
        const args = workiqReadArguments(f.admission, "A", 1, f.results[0]);
        args.entityUrls[0] = mutate(args.entityUrls[0]);
        await assert.rejects(
            f.adapter.call("fetch", args),
            (e) => e.code === "workiqScopeMismatch",
        );
        assert.equal(f.stats.calls.length, 1);
    });
}

test("v2 metadata order-equivalent SDK copy cannot replace actual raw provider provenance", async (t) => {
    const f = await fixture(t, {
        contractV2: true,
        reverseMetadataSelection: true,
    });
    await f.execute();
    f.events[3].data.arguments = workiqReadArguments(
        f.admission,
        "A",
        1,
        f.results[0],
    );
    await f.writeEvents();
    assert.notEqual((await f.verdict()).status, "passed");
    await f.adapter.close();
});

test("external draft review checks both input bindings and every typed suffix, never publishes", async (t) => {
    const f = await fixture(t);
    await f.execute();
    const draft = draftFor(f);
    const options = {
        draft,
        trace: f.getTrace(),
        discovery: f.nativeDiscovery,
        admission: f.admission,
    };
    const report = reviewWorkiqDraftContract(options);
    assert.equal(report.publicationApproved, false);
    assert.equal(report.draftSha256, workiqJsonHash(draft));
    draft.steps[2].arguments.bindings[0].expression.suffix = "?$select=id";
    assert.throws(
        () => reviewWorkiqDraftContract(options),
        WorkiqEvidenceError,
    );
    await f.adapter.close();
});

test("Prepare/current execution consent and external immutable publication are separate prerequisites", async (t) => {
    const f = await fixture(t);
    const seen = [];
    const host = {
        assertNativeReadinessAndExclusiveSlot: async () => {
            seen.push("native");
        },
        assertCurrentExecutionConsent: async () => {
            seen.push("consent");
        },
        readLearningPreference: async (cwd) => ({
            cwd,
            mode: "prepare",
            revision: 1,
        }),
    };
    const gate = createWorkiqPilotPrerequisites({
        host,
        admission: f.admission,
        workspace: f.root,
        storeRoot: path.join(f.root, "copilot-macros"),
    });
    await gate.assertPrerequisites(f.scope);
    assert.deepEqual(seen, ["native", "consent"]);
    await assert.rejects(
        gate.assertPrerequisites({
            ...f.scope,
            phase: "reuse-b",
            runId: "run-current",
        }),
        WorkiqEvidenceError,
    );
    host.readLearningPreference = async (cwd) => ({
        cwd,
        mode: "all",
        revision: 1,
    });
    await assert.rejects(
        gate.assertPrerequisites(f.scope),
        (error) => error.code === "workiqPrepareModeUnproved",
    );
});

test("restart requires real controller proof and unchanged same-store approved version/catalog", async (t) => {
    const f = await fixture(t);
    await f.execute();
    const draft = draftFor(f),
        approved = {
            ...clone(draft),
            version: 2,
            state: "approved",
            createdAt: iso(),
        };
    const storeRoot = path.join(f.root, "copilot-macros");
    const directory = path.join(storeRoot, "macros", draft.macroId, "versions");
    await mkdir(directory, { recursive: true });
    const catalog = [{ macroId: draft.macroId, version: 2, state: "approved" }];
    await writeFile(path.join(directory, "1.json"), JSON.stringify(draft));
    await writeFile(path.join(directory, "2.json"), JSON.stringify(approved));
    await writeFile(
        path.join(storeRoot, "index.json"),
        JSON.stringify(catalog),
    );
    const pin = {
        macroId: draft.macroId,
        draftVersion: 1,
        approvedVersion: 2,
        draftSha256: workiqJsonHash(draft),
        approvedSha256: workiqJsonHash(approved),
        catalogSha256: workiqJsonHash(catalog),
    };
    const host = {
        assertNativeReadinessAndExclusiveSlot: async () => {},
        assertCurrentExecutionConsent: async () => {},
        readLearningPreference: async (cwd) => ({
            cwd,
            mode: "prepare",
            revision: 1,
        }),
        readPublicationPin: async () => pin,
        assertExternalReviewAndPublication: async () => {},
    };
    const gate = createWorkiqPilotPrerequisites({
        host,
        admission: f.admission,
        storeRoot,
        workspace: f.root,
    });

    const scope = { ...f.scope, phase: "restart-b", runId: "run-restart" };
    await assert.rejects(
        gate.assertPrerequisites(scope),
        (error) => error.code === "workiqSameStoreRestartUnproved",
    );
    let verified = false;
    host.assertPhysicalRestart = async (value) => {
        verified = value.storeRoot === storeRoot;
    };
    await gate.assertPrerequisites(scope);
    assert.equal(verified, true);
    approved.steps[2].toolName = "unreviewed";
    await writeFile(path.join(directory, "2.json"), JSON.stringify(approved));
    await assert.rejects(
        gate.assertPrerequisites(scope),
        (error) => error.code === "workiqApprovedVersionDrift",
    );
    await f.adapter.close();
});

test("simultaneous requests cannot race the serial contract or read after a stop", async (t) => {
    const f = await fixture(t);
    let release, entered;
    const started = new Promise((resolve) => {
        entered = resolve;
    });
    f.options.host.authorizeRead = async () => {
        entered();
        await new Promise((resolve) => {
            release = resolve;
        });
    };
    await f.adapter.start();
    const args = workiqReadArguments(f.admission, "A", 0);
    const first = f.adapter.call("retrieve", args);
    const firstFailure = assert.rejects(
        first,
        (error) => error.code === "workiqStopped",
    );
    await started;
    await assert.rejects(
        f.adapter.call("retrieve", args),
        (error) => error.code === "adapterNotReady",
    );
    release();
    await firstFailure;
    assert.equal(f.stats.calls.length, 0);
    assert.equal(f.stats.closed, 1);
    assert.equal(f.adapter.complete(), false);
});

test("current per-read consent denial stops after discovery with no content call", async (t) => {
    const f = await fixture(t);
    f.options.host.authorizeRead = async () => {
        throw new WorkiqEvidenceError("blocked", "currentConsentDenied");
    };
    await f.adapter.start();
    await assert.rejects(
        f.adapter.call("retrieve", workiqReadArguments(f.admission, "A", 0)),
        (error) => error.code === "currentConsentDenied",
    );
    assert.equal(f.stats.calls.length, 0);
    assert.equal(f.stats.closed, 1);
});

for (const lookupOnlyDiagnostic of [false, "true", 1, {}]) {
    test(`invalid lookup diagnostic opt-in ${JSON.stringify(lookupOnlyDiagnostic)} cannot alter dispatch`, async (t) => {
        const f = await fixture(t);
        assert.throws(
            () =>
                createWorkiqAgencyAdapter({
                    ...f.options,
                    lookupOnlyDiagnostic,
                }),
            (error) => error.code === "invalidLookupDiagnostic",
        );
        assert.equal(f.stats.connections, 0);
    });
}

test("lookup diagnostic cannot bind B or a changed capture phase", async (t) => {
    const f = await fixture(t, { entityKey: "B" });
    assert.throws(
        () =>
            createWorkiqAgencyAdapter({
                ...f.options,
                lookupOnlyDiagnostic: true,
            }),
        (error) => error.code === "foreignLookupDiagnostic",
    );
    assert.equal(f.stats.connections, 0);
});

for (const name of ["retrieve", "fetch", "fetch_blob"]) {
    test(`lookup diagnostic retains ${name} rejection before a second upstream read`, async (t) => {
        const f = await fixture(t, {
            contractV2: true,
            lookupOnlyDiagnostic: true,
        });
        await f.adapter.start();
        const catalog = f.adapter.tools();
        await f.adapter.call(
            "retrieve",
            workiqReadArguments(f.admission, "A", 0),
        );
        assert.deepEqual(f.adapter.tools(), catalog);
        assert.equal(f.adapter.nextRead(), null);
        assert.equal(f.adapter.complete(), false);
        const args = workiqReadArguments(
            f.admission,
            "A",
            name === "retrieve" ? 0 : name === "fetch" ? 1 : 2,
            f.results[0],
        );
        await assert.rejects(
            f.adapter.call(name, args),
            (error) => error.code === "lookupDiagnosticReadLimit",
        );
        await f.adapter.close();
        const evidence = f.adapter.lookupDiagnosticEvidence();
        assert.equal(f.stats.calls.length, 1);
        assert.equal(f.stats.authorized.length, 1);
        assert.equal(evidence.upstreamReadsStarted, 1);
        assert.equal(evidence.firstRead.call.status, "completed");
        assert.deepEqual(
            evidence.firstRead.originalProviderResult,
            f.results[0],
        );
        assert.equal(evidence.rejections.length, 1);
        assert.deepEqual(evidence.rejections[0].arguments, args);
        assert.equal(evidence.admission, false);
        assert.equal(evidence.nativeAuthority, false);
        const audit = await readFile(evidence.firstRead.auditPath);
        assert.equal(digest(audit), evidence.firstRead.auditSha256);
        const rejection = await readFile(evidence.rejections[0].auditPath);
        assert.equal(digest(rejection), evidence.rejections[0].auditSha256);
    });
}

for (const changed of ["query", "diagnostic", "extra"]) {
    test(`lookup diagnostic refuses nonidentical ${changed} before authorization/upstream`, async (t) => {
        const f = await fixture(t, {
            contractV2: true,
            lookupOnlyDiagnostic: true,
        });
        await f.adapter.start();
        const args = workiqReadArguments(f.admission, "A", 0);
        if (changed === "query") args.query += " modified";
        if (changed === "diagnostic") args.includeDeveloperCard = false;
        if (changed === "extra") args.extra = true;
        await assert.rejects(
            f.adapter.call("retrieve", args),
            (error) => error.code === "lookupDiagnosticRequestMismatch",
        );
        assert.equal(f.stats.calls.length, 0);
        assert.equal(f.stats.authorized.length, 0);
        const evidence = f.adapter.lookupDiagnosticEvidence();
        assert.equal(evidence.firstRead, undefined);
        assert.equal(evidence.rejections.length, 1);
        assert.deepEqual(evidence.rejections[0].arguments, args);
    });
}

test("lookup diagnostic preserves empty lookup failure without permitting a same-owner retry", async (t) => {
    const f = await fixture(t, {
        contractV2: true,
        lookupOnlyDiagnostic: true,
    });
    f.results[0].structuredContent[key].resultCount = 0;
    f.results[0].structuredContent[key].retrievalHits = [];
    await f.adapter.start();
    const args = workiqReadArguments(f.admission, "A", 0);
    await assert.rejects(
        f.adapter.call("retrieve", args),
        (error) => error.code === "emptyLookup",
    );
    await assert.rejects(f.adapter.call("retrieve", args), WorkiqEvidenceError);
    const evidence = f.adapter.lookupDiagnosticEvidence();
    assert.equal(f.stats.calls.length, 1);
    assert.equal(evidence.firstRead.call.errorCode, "emptyLookup");
    assert.equal(evidence.firstRead.originalProviderResult.isError, false);
    assert.equal(
        evidence.firstRead.originalProviderResult.structuredContent[key]
            .retrievalHits.length,
        0,
    );
    assert.equal(evidence.nativeAuthority, false);
});

test("lookup diagnostic cannot bypass normal host consent or label it as an upstream read", async (t) => {
    const f = await fixture(t, { lookupOnlyDiagnostic: true });
    const adapter = createWorkiqAgencyAdapter({
        ...f.options,
        host: {
            ...f.options.host,
            authorizeRead: async () => {
                throw new WorkiqEvidenceError(
                    "blocked",
                    "currentConsentDenied",
                );
            },
        },
    });
    t.after(() => adapter.close());
    await adapter.start();
    await assert.rejects(
        adapter.call("retrieve", workiqReadArguments(f.admission, "A", 0)),
        (error) => error.code === "currentConsentDenied",
    );
    const evidence = adapter.lookupDiagnosticEvidence();
    assert.equal(f.stats.calls.length, 0);
    assert.equal(evidence.upstreamReadsStarted, 0);
    assert.equal(evidence.firstRead.call.errorCode, "currentConsentDenied");
    assert.equal(evidence.firstRead.originalProviderResult, undefined);
    assert.equal(evidence.nativeAuthority, false);
});

test("lookup diagnostic rejects racing metadata before any second upstream dispatch", async (t) => {
    const f = await fixture(t, { lookupOnlyDiagnostic: true });
    let finish;
    const adapter = createWorkiqAgencyAdapter({
        ...f.options,
        connect: async (...args) => {
            const client = await f.options.connect(...args);
            return {
                ...client,
                callTool: async (request) => {
                    f.stats.calls.push(clone(request));
                    return new Promise((resolve) => {
                        finish = resolve;
                    });
                },
            };
        },
    });
    t.after(() => adapter.close());
    await adapter.start();
    const first = adapter.call(
        "retrieve",
        workiqReadArguments(f.admission, "A", 0),
    );
    const failure = assert.rejects(first, WorkiqEvidenceError);
    while (!finish) await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
        adapter.call("fetch", {
            entityUrls: [f.entity.entityPath + metadataSuffix],
        }),
        WorkiqEvidenceError,
    );
    finish(clone(f.results[0]));
    await failure;
    const evidence = adapter.lookupDiagnosticEvidence();
    assert.equal(f.stats.calls.length, 1);
    assert.equal(evidence.upstreamReadsStarted, 1);
    assert.equal(evidence.rejections.length, 1);
    assert.equal(evidence.firstRead.call.status, "failed");
    assert.equal(adapter.complete(), false);
});

for (const contractV2 of [false, true]) {
    for (const hitCount of [0, 2]) {
        test(`${contractV2 ? "v2" : "legacy"} ${hitCount} lookup hits retain distinct failed evidence and latch without fetch`, async (t) => {
            const f = await fixture(t, { contractV2 });
            const lookup = f.results[0].structuredContent[key];
            const hit = clone(lookup.retrievalHits[0]);
            lookup.resultCount = hitCount;
            lookup.retrievalHits = Array.from({ length: hitCount }, () =>
                clone(hit),
            );
            if (contractV2 && hitCount === 2)
                lookup.retrievalHits[1].itemId = "foreign";
            await f.adapter.start();
            const code =
                hitCount === 0
                    ? "emptyLookup"
                    : contractV2
                      ? "wrongDocument"
                      : "nonuniqueLookup";
            await assert.rejects(
                f.adapter.call(
                    "retrieve",
                    workiqReadArguments(f.admission, "A", 0),
                ),
                (error) => error.code === code && error.status === "failed",
            );
            const record = JSON.parse(
                await readFile(path.join(f.root, "audit", "call-0.json")),
            );
            assert.equal(record.status, "failed");
            assert.equal(record.errorCode, code);
            assert.deepEqual(record.result, f.results[0]);
            assert.equal(record.result.isError, false);
            assert.equal(f.stats.calls.length, 1);
            assert.equal(f.adapter.complete(), false);
            await assert.rejects(
                f.adapter.call("fetch", {
                    entityUrls: [f.entity.entityPath + metadataSuffix],
                }),
                WorkiqEvidenceError,
            );
            assert.equal(f.stats.calls.length, 1);
        });
    }
}

for (const entityKey of ["A", "B"]) {
    for (const sdkStructured of [false, true]) {
        test(`v2 ${entityKey} semantic duplicate hits preserve ${sdkStructured ? "structured SDK" : "MCP envelope"} originals and one dynamic binding through MCP/SDK/full bytes`, async (t) => {
            const f = await fixture(t, {
                entityKey,
                contractV2: true,
                throughMcp: true,
                sdkStructured,
            });
            const lookup = f.results[0].structuredContent[key];
            const duplicate = clone(lookup.retrievalHits[0]);
            duplicate.id = "service-alias";
            duplicate.resourceId = "service-resource-alias";
            duplicate.webUrl = "https://example.invalid/service-display-url";
            duplicate.resourceMetadata = {
                web: { title: "different display title" },
                ...clone(f.entity.oracle.frozenVersion),
                parentReference: { driveId: f.entity.driveId },
                sharepointIds: {
                    siteId: f.entity.oracle.libraryGuard.siteId,
                    listId: f.entity.oracle.libraryGuard.listId,
                },
            };
            duplicate.contentProtection = "unknown-opaque-service-value";
            lookup.resultCount = sdkStructured ? 1 : 2;
            lookup.retrievalHits.push(duplicate);
            const original = clone(f.results[0]);
            await f.execute();
            const report = await f.verdict();
            assert.equal(report.status, "passed");
            assert.equal(report.originalBytesVerified, true);
            const audit = JSON.parse(
                await readFile(path.join(f.root, "audit", "call-0.json")),
            );
            assert.deepEqual(audit.result, original);
            assert.equal(
                audit.result.structuredContent[key].resultCount,
                original.structuredContent[key].resultCount,
            );
            assert.equal(
                audit.result.structuredContent[key].retrievalHits.length,
                2,
            );
            assert.equal(f.stats.calls.length, 4);
            assert.deepEqual(
                f.stats.calls[1].arguments,
                workiqReadArguments(f.admission, entityKey, 1, original),
            );
        });
    }
}

for (const [name, mutate, code, status = "failed"] of [
    ["foreign drive", (h) => (h.driveId = "foreign"), "wrongLibrary"],
    ["foreign item", (h) => (h.itemId = "foreign"), "wrongDocument"],
    [
        "conflicting binding",
        (h) => (h.entityUrl += "/foreign"),
        "wrongDocument",
    ],
    ["missing binding", (h) => delete h.entityUrl, "wrongDocument"],
    ["empty display URL", (h) => (h.webUrl = ""), "wrongDocument"],
    ["missing metadata", (h) => delete h.resourceMetadata, "wrongDocument"],
    [
        "explicit hit denial",
        (h) => (h.permissionDenied = true),
        "providerError",
    ],
    [
        "explicit metadata denial",
        (h) => (h.resourceMetadata.accessDenied = true),
        "providerError",
    ],
    [
        "explicit web denial",
        (h) => (h.resourceMetadata.web.denied = true),
        "providerError",
    ],
    [
        "frozen version conflict",
        (h) => (h.resourceMetadata.eTag = "changed"),
        "versionDrift",
        "blocked",
    ],
    [
        "nested web version conflict",
        (h) => (h.resourceMetadata.web.size = -1),
        "versionDrift",
        "blocked",
    ],
    [
        "library conflict",
        (h) => (h.resourceMetadata.parentReference = { driveId: "foreign" }),
        "wrongLibrary",
    ],
    [
        "site conflict",
        (h) => (h.resourceMetadata.sharepointIds = { siteId: "foreign" }),
        "wrongLibrary",
    ],
    [
        "list conflict",
        (h) => (h.resourceMetadata.sharepointIds = { listId: "foreign" }),
        "wrongLibrary",
    ],
    [
        "metadata item conflict",
        (h) => (h.resourceMetadata.itemId = "foreign"),
        "wrongDocument",
    ],
    [
        "metadata binding conflict",
        (h) => (h.resourceMetadata.entityUrl = "foreign"),
        "wrongDocument",
    ],
]) {
    for (const index of [0, 1]) {
        test(`v2 duplicate hit${index} ${name} rejects all hits without filtering, fetching or binding rescue`, async (t) => {
            const f = await fixture(t, { contractV2: true });
            const lookup = f.results[0].structuredContent[key];
            lookup.resultCount = 2;
            lookup.retrievalHits.push(clone(lookup.retrievalHits[0]));
            for (const hit of lookup.retrievalHits)
                hit.resourceMetadata.web = {};
            mutate(lookup.retrievalHits[index]);
            await f.adapter.start();
            await assert.rejects(
                f.adapter.call(
                    "retrieve",
                    workiqReadArguments(f.admission, "A", 0),
                ),
                (error) => error.code === code && error.status === status,
            );
            const audit = JSON.parse(
                await readFile(path.join(f.root, "audit", "call-0.json")),
            );
            assert.deepEqual(audit.result, f.results[0]);
            assert.equal(audit.errorCode, code);
            await assert.rejects(
                f.adapter.call("fetch", {
                    entityUrls: [f.entity.entityPath + metadataSuffix],
                }),
                WorkiqEvidenceError,
            );
            assert.equal(f.stats.calls.length, 1);
        });
    }
}

test("wrong scoped lookup is preserved as failed audit, never followed by speculative fetch", async (t) => {
    const f = await fixture(t);
    f.results[0].structuredContent[key].retrievalHits[0].driveId = "foreign";
    await f.adapter.start();
    await assert.rejects(
        f.adapter.call("retrieve", workiqReadArguments(f.admission, "A", 0)),
        WorkiqEvidenceError,
    );
    const record = JSON.parse(
        await readFile(path.join(f.root, "audit", "call-0.json")),
    );
    assert.equal(record.status, "failed");
    assert.equal(
        record.result.structuredContent[key].retrievalHits[0].driveId,
        "foreign",
    );
    assert.equal(f.stats.calls.length, 1);
    await assert.rejects(
        f.adapter.call("fetch", {
            entityUrls: [f.entity.entityPath + metadataSuffix],
        }),
        WorkiqEvidenceError,
    );
});

test("real MCP transport facade preserves a full generated >1MiB original without truncation", async (t) => {
    const f = await fixture(t, { entityKey: "B" });
    await f.adapter.start();
    const server = createWorkiqMcpServer(f.adapter);
    const client = new Client({
        name: "binary-mcp-test",
        version: "1.0.0",
    });
    const [left, right] = InMemoryTransport.createLinkedPair();
    t.after(async () => {
        await client.close();
        await server.close();
        await f.adapter.close();
    });
    await Promise.all([client.connect(left), server.connect(right)]);
    const responses = [];
    for (const [index, name] of [
        "retrieve",
        "fetch",
        "fetch_blob",
        "fetch",
    ].entries()) {
        responses.push(
            await client.callTool({
                name,
                arguments: workiqReadArguments(
                    f.admission,
                    "B",
                    index,
                    f.results[0],
                ),
            }),
        );
    }
    assert.equal(
        digest(
            Buffer.from(responses[2].structuredContent.base64Content, "base64"),
        ),
        f.entity.oracle.sha256,
    );
    assert.equal(responses[2].structuredContent.sizeBytes, 1_200_000);
    assert.equal(f.adapter.complete(), true);
});

for (const [name, mutate] of [
    [
        "foreign native session header",
        (f) => {
            f.events[0].data.sessionId = "foreign";
        },
    ],
    [
        "missing backend metadata",
        (f) => {
            delete f.events[1].data.mcpServerName;
        },
    ],
    [
        "clipped current SDK JSON",
        (f) => {
            f.events[6].data.result = {
                content: '{"structuredContent":',
                detailedContent: "",
                contents: [],
            };
        },
    ],
]) {
    test(`${name} blocks despite intact complete backend original`, async (t) => {
        const f = await fixture(t);
        await f.execute();
        mutate(f);
        await f.writeEvents();
        assert.notEqual((await f.verdict()).status, "passed");
        await f.adapter.close();
    });
}

test("provider sourceArtifact substitution and forged extra reference paths fail closed", async (t) => {
    const f = await fixture(t, { entityKey: "B" });
    await f.execute();
    const file = path.join(f.root, "audit", "call-2.json");
    const record = JSON.parse(await readFile(file));
    record.sourceArtifact = "never-read-frozen-file.json";
    await writeFile(file, JSON.stringify(record));
    assert.notEqual((await f.verdict()).status, "passed");
    delete record.sourceArtifact;
    record.resultArtifact.path = "never-read-frozen-file.json";
    await writeFile(file, JSON.stringify(record));
    assert.notEqual((await f.verdict()).status, "passed");
    await f.adapter.close();
});

test("draft reviewer internally verifies current original evidence before reviewing actual persisted draft", async (t) => {
    const f = await fixture(t);
    await f.execute();
    const draft = draftFor(f);
    const directory = path.join(
        f.root,
        "copilot-macros",
        "macros",
        draft.macroId,
        "versions",
    );
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "1.json"), JSON.stringify(draft));
    const reviewer = createWorkiqDraftReviewer(f.oracleOptions());
    const report = await reviewer.review({
        macroId: draft.macroId,
        version: 1,
    });
    assert.equal(report.originalReceipt.sha256, f.entity.oracle.sha256);
    assert.equal(report.publicationApproved, false);
    f.events[6].data.result = {};
    await f.writeEvents();
    await assert.rejects(
        reviewer.review({ macroId: draft.macroId, version: 1 }),
        WorkiqEvidenceError,
    );
    await f.adapter.close();
});

test("positive/negative boolean labels cannot substitute for a trusted assertion contract", async (t) => {
    const f = await fixture(t);
    f.options.host.assertPrerequisites = async () => ({
        callback: null,
        accepted: true,
    });
    await assert.rejects(
        f.adapter.start(),
        (error) => error.code === "workiqHostAssertionContract",
    );
    assert.equal(f.stats.connections, 0);
});

test("native MCP request cancellation is enforced before provider invocation", async (t) => {
    const f = await fixture(t);
    await f.adapter.start();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        f.adapter.call("retrieve", workiqReadArguments(f.admission, "A", 0), {
            signal: controller.signal,
        }),
        (error) => error.code === "workiqStopped",
    );
    assert.equal(f.stats.calls.length, 0);
    assert.equal(f.stats.closed, 1);
});

test(
    "real MCP request cancellation stops a read waiting for consent",
    { timeout: 5000 },
    async (t) => {
        const f = await fixture(t);
        let release, entered, closed;
        const waiting = new Promise((resolve) => {
            entered = resolve;
        });
        const finished = new Promise((resolve) => {
            closed = resolve;
        });
        f.options.host.authorizeRead = async () => {
            entered();
            await new Promise((resolve) => {
                release = resolve;
            });
        };
        await f.adapter.start();
        const server = createWorkiqMcpServer({
            ...f.adapter,
            call: async (...args) => {
                try {
                    return await f.adapter.call(...args);
                } finally {
                    closed();
                }
            },
        });
        const client = new Client({
            name: "cancelled-mcp-test",
            version: "1.0.0",
        });
        const [left, right] = InMemoryTransport.createLinkedPair();
        t.after(async () => {
            await client.close();
            await server.close();
            await f.adapter.close();
        });
        await Promise.all([client.connect(left), server.connect(right)]);
        const controller = new AbortController();
        const pending = client.callTool(
            {
                name: "retrieve",
                arguments: workiqReadArguments(f.admission, "A", 0),
            },
            undefined,
            { signal: controller.signal },
        );
        const rejection = assert.rejects(pending);
        await waiting;
        controller.abort();
        await rejection;
        release();
        await finished;
        assert.equal(f.stats.calls.length, 0);
        assert.equal(f.adapter.complete(), false);
    },
);
