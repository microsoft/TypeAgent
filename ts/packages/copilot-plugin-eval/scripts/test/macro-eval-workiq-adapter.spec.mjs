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
    workiqJsonHash,
} from "../macro-eval-workiq-adapter.mjs";
import {
    createWorkiqPilotPrerequisites,
    reviewWorkiqDraftContract,
    createWorkiqDraftReviewer,
} from "../macro-eval-workiq-prerequisites.mjs";

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
    } = {},
) {
    const root = path.resolve(`.workiq-adapter-${randomUUID()}`);
    await mkdir(root);
    t.after(() => rm(root, { recursive: true, force: true }));
    const { admission, bytes } = generatedAdmission();
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
            const original = await adapter.call(name, args);
            const raw = wrapped
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

const mutations = [
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

function draftFor(f) {
    const trace = f.getTrace();
    const first = {
        kind: "template",
        value: workiqReadArguments(f.admission, "A", 0),
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
                          value: workiqReadArguments(
                              f.admission,
                              "A",
                              index,
                              f.results[0],
                          ),
                          bindings: [
                              {
                                  path:
                                      index === 2
                                          ? ["path"]
                                          : ["entityUrls", "0"],
                                  expression:
                                      index === 2
                                          ? recipe.argumentTemplate.path
                                          : recipe.argumentTemplate
                                                .entityUrls[0],
                              },
                          ],
                      },
        })),
    };
}

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
