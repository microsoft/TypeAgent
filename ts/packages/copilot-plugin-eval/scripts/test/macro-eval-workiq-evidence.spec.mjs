// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
    PrivateResultStore,
    redactTraceValue,
} from "../../../copilot-macros/dist/index.js";
import {
    createWorkiqEvidenceVerifier,
    WorkiqEvidenceError,
} from "../macro-eval-workiq-evidence.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => structuredClone(value);
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
const suffix = "?$select=" + fields.join(",");
const ts = (milliseconds) =>
    new Date(Date.UTC(2026, 0, 1) + milliseconds).toISOString();
const key = "application/vnd.ms-workiq.retrieval";

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function generatedDocx() {
    const entries = [
        [
            "word/document.xml",
            Buffer.from("<document>synthetic auxiliary text</document>"),
        ],
        ...Array.from({ length: 17 }, (_, index) => [
            `word/media/image-${index}.bin`,
            Buffer.alloc(70_000, index + 1),
        ]),
    ];
    const locals = [];
    const central = [];
    let offset = 0;
    for (const [name, bytes] of entries) {
        const filename = Buffer.from(name);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50);
        header.writeUInt16LE(20, 4);
        header.writeUInt32LE(crc32(bytes), 14);
        header.writeUInt32LE(bytes.length, 18);
        header.writeUInt32LE(bytes.length, 22);
        header.writeUInt16LE(filename.length, 26);
        locals.push(header, filename, bytes);
        const directory = Buffer.alloc(46);
        directory.writeUInt32LE(0x02014b50);
        directory.writeUInt16LE(20, 4);
        directory.writeUInt16LE(20, 6);
        directory.writeUInt32LE(crc32(bytes), 16);
        directory.writeUInt32LE(bytes.length, 20);
        directory.writeUInt32LE(bytes.length, 24);
        directory.writeUInt16LE(filename.length, 28);
        directory.writeUInt32LE(offset, 42);
        central.push(directory, filename);
        offset += header.length + filename.length + bytes.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

const binary = generatedDocx();
const markdown = Buffer.from(
    "# Generated original\n" + "complete synthetic UTF-8 data\n".repeat(1800),
);

async function fixture(
    t,
    { binaryFile = true, wrapped = false, runId = "run-current" } = {},
) {
    const root = path.resolve(`.workiq-oracle-${randomUUID()}`);
    await mkdir(root);
    t.after(() => rm(root, { recursive: true, force: true }));
    const bytes = binaryFile ? binary : markdown;
    const item = binaryFile ? "item-binary" : "item-text";
    const name = binaryFile ? "generated.docx" : "generated.md";
    const canonical = `https://example.invalid/teams/test/Shared%20Documents/${name}`;
    const viewer = binaryFile
        ? `https://example.invalid/teams/test/_layouts/15/Doc.aspx?sourcedoc=synthetic-guid&file=${name}`
        : canonical;
    const driveId = "drive-generated";
    const entityPath = `/drives/${driveId}/items/${item}`;
    const mime = binaryFile
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "text/markdown";
    const frozenVersion = {
        size: bytes.length,
        eTag: "etag-1",
        cTag: "ctag-1",
        lastModifiedDateTime: ts(0),
    };
    const metadata = {
        id: item,
        name,
        ...frozenVersion,
        file: { mimeType: mime },
        parentReference: {
            driveId,
            driveType: "documentLibrary",
            path: `/drives/${driveId}/root:`,
            sharepointIds: { siteUrl: "https://example.invalid/teams/test" },
        },
        sharepointIds: { siteId: "site-generated", listId: "list-generated" },
        webUrl: viewer,
    };
    const expected = {
        key: binaryFile ? "B" : "A",
        title: name,
        itemId: item,
        driveId,
        canonicalWebUrl: canonical,
        canonicalPath: decodeURIComponent(new URL(canonical).pathname),
        actualMetadataWebUrl: viewer,
        entityPath,
        metadataMimeType: mime,
        transportContentType: binaryFile ? mime : "application/octet-stream",
        blobName: name,
        inputs: {
            documentQuery: "Exact generated document",
            documentUrl: canonical,
        },
        frozenEvidence: {
            path: path.join(root, "never-read-frozen-document.json"),
        },
        oracle: {
            sha256: sha(bytes),
            sizeBytes: bytes.length,
            frozenVersion,
            libraryGuard: {
                driveId,
                driveType: "documentLibrary",
                parentPath: `/drives/${driveId}/root:`,
                siteId: "site-generated",
                listId: "list-generated",
                canonicalLookupWebUrl: canonical,
                siteUrl: "https://example.invalid/teams/test",
            },
        },
    };
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
        stepId: "step-1",
        path: ["structuredContent", key, "retrievalHits", "0", "entityUrl"],
        suffix,
    };
    const admission = {
        schemaVersion: 1,
        entities: [expected],
        library: {
            driveId,
            canonicalWebUrl:
                "https://example.invalid/teams/test/Shared%20Documents",
        },
        runtime: { mcpServer: "workiq", advertisedToolSchemas: schemas },
        sourceSchemaRequirements: {
            trace: {
                schemaVersion: 2,
                capabilities: ["private-result-evidence-v1"],
            },
            macro: { schemaVersion: 2, capabilities: ["result-path-v1"] },
        },
        workflow: {
            recipe: [
                { step: "step-1", advertisedTool: "retrieve" },
                {
                    step: "step-2",
                    advertisedTool: "fetch",
                    argumentTemplate: { entityUrls: [expression] },
                },
                {
                    step: "step-3",
                    advertisedTool: "fetch_blob",
                    argumentTemplate: {
                        path: { ...expression, suffix: "/content" },
                    },
                },
                {
                    step: "step-4",
                    advertisedTool: "fetch",
                    argumentTemplate: { entityUrls: [expression] },
                },
            ],
        },
    };
    const envelopes = [
        {
            content: [],
            isError: false,
            structuredContent: {
                [key]: {
                    markdown: "Generated metadata",
                    resultCount: 1,
                    stoppedReason: "completed",
                    retrievalHits: [
                        {
                            itemId: item,
                            driveId,
                            entityUrl: entityPath,
                            webUrl: canonical,
                            resourceMetadata: {},
                        },
                    ],
                },
            },
        },
        {
            content: [],
            isError: false,
            structuredContent: {
                results: [{ data: metadata, statusCode: 200 }],
            },
        },
        {
            content: [],
            isError: false,
            structuredContent: {
                base64Content: bytes.toString("base64"),
                sizeBytes: bytes.length,
                blobName: name,
                contentType: expected.transportContentType,
                statusCode: 200,
            },
        },
        {
            content: [],
            isError: false,
            structuredContent: {
                results: [{ data: clone(metadata), statusCode: 200 }],
            },
        },
    ];
    const args = [
        {
            query: expected.inputs.documentQuery,
            strategy: "grounding",
            capabilities: [
                {
                    name: "OneDriveAndSharePoint",
                    items_by_url: [{ url: canonical }],
                },
            ],
        },
        { entityUrls: [entityPath + suffix] },
        { path: entityPath + "/content" },
        { entityUrls: [entityPath + suffix] },
    ];
    const trial = {
        sessionId: "session-current",
        traceId: "trace-current",
        runId,
        startedAt: ts(0),
        endedAt: ts(100),
    };
    const store = new PrivateResultStore(root);
    const current = {
        origin: "owned-native-session-events",
        trace: {
            schemaVersion: 2,
            capabilities: ["private-result-evidence-v1"],
            traceId: trial.traceId,
            sessionId: trial.sessionId,
            cwd: ".",
            prompt: "Read generated original",
            response: "Receipt",
            startedAt: ts(0),
            completedAt: ts(10),
            createdAt: ts(11),
            toolCalls: [],
            ...(runId === null ? {} : { handoffRunId: runId }),
        },
        calls: [],
        discovery: {
            origin: "native-tool-discovery",
            sessionId: trial.sessionId,
            tools: schemas.map((tool) => ({
                ...clone(tool),
                callableName: `explicit_${tool.advertisedName}`,
                mcpServerName: "workiq",
            })),
        },
    };
    for (const [index, envelope] of envelopes.entries()) {
        const operation = ["retrieve", "fetch", "fetch_blob", "fetch"][index];
        const raw =
            wrapped && index === 2
                ? {
                      content: JSON.stringify(envelope),
                      detailedContent: "UI-only",
                      contents: [],
                  }
                : envelope;
        const call = {
            ...trial,
            toolCallId: `call-${index}`,
            name: `explicit_${operation}`,
            mcpServerName: "workiq",
            arguments: args[index],
            status: "completed",
            startedAt: ts(index * 2 + 1),
            completedAt: ts(index * 2 + 2),
            result: raw,
        };
        delete call.endedAt;
        const ref = await store.retain(
            "trace",
            trial.traceId,
            call.toolCallId,
            "result",
            raw,
        );
        const recorded = {
            toolCallId: call.toolCallId,
            name: call.name,
            mcpServerName: "workiq",
            arguments: clone(args[index]),
            status: "completed",
            result: ref ? ref.view : redactTraceValue(raw),
            ...(ref ? { resultArtifact: ref } : {}),
        };
        if (wrapped && index === 2) {
            const modelRef = await store.retain(
                "trace",
                trial.traceId,
                call.toolCallId,
                "modelResult",
                envelope,
            );
            recorded.modelResultArtifact = modelRef;
            recorded.modelResult = modelRef.view;
        }
        current.calls.push(call);
        current.trace.toolCalls.push(recorded);
    }
    const options = {
        artifactRoot: root,
        admission,
        trial,
        readCurrent: async () => current,
    };
    return {
        root,
        bytes,
        admission,
        current,
        trial,
        store,
        expected,
        options,
        verifier: () => createWorkiqEvidenceVerifier(options),
        async refresh(index) {
            const call = current.calls[index];
            const ref = await store.retain(
                "trace",
                trial.traceId,
                call.toolCallId,
                "result",
                call.result,
            );
            current.trace.toolCalls[index].result = ref
                ? ref.view
                : redactTraceValue(call.result);
            if (ref) current.trace.toolCalls[index].resultArtifact = ref;
            else delete current.trace.toolCalls[index].resultArtifact;
        },
        filename(ref) {
            return path.join(
                root,
                "evidence",
                ref.owner,
                ref.ownerId,
                `${ref.id}.json`,
            );
        },
    };
}

async function verdict(f) {
    return f.verifier().verify({ entityKey: f.expected.key });
}

test("whole generated Markdown original is independently verified, without trial or model claims", async (t) => {
    const f = await fixture(t, { binaryFile: false, runId: null });
    const result = await verdict(f);
    assert.equal(result.status, "passed");
    assert.equal(result.receipt.sha256, sha(f.bytes));
    assert.equal(result.receipt.sizeBytes, f.bytes.length);
    assert.equal(result.fullTrialAccepted, false);
    assert.equal(result.nativeTerminalVerified, false);
    assert.equal(result.modelConsumptionVerified, false);
    assert.equal(result.runId, null);
});

test(">1MiB generated DOCX including 17 media parts survives bounded artifact views", async (t) => {
    const f = await fixture(t);
    assert.ok(f.bytes.length > 1024 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(f.current.trace)) < 256 * 1024);
    assert.equal(f.current.trace.toolCalls[2].resultArtifact.source, "result");
    const result = await verdict(f);
    assert.equal(result.status, "passed");
    assert.equal(result.receipt.sha256, sha(f.bytes));
    assert.equal(result.originalBytesVerified, true);
    assert.equal(
        JSON.stringify(result).includes(f.bytes.toString("base64")),
        false,
    );
});

test("an observed full SDK content wrapper requires independently verified matching parsed receipt", async (t) => {
    const f = await fixture(t, { wrapped: true });
    assert.equal((await verdict(f)).status, "passed");
    delete f.current.trace.toolCalls[2].modelResultArtifact;
    assert.equal((await verdict(f)).code, "missingOriginalBlobReceipt");
});

const mutations = [
    ["reordered calls", (f) => f.current.calls.reverse(), "foreignToolCall"],
    [
        "extra calls",
        (f) => {
            f.current.calls.push(clone(f.current.calls[3]));
        },
        "extraCalls",
    ],
    [
        "missing calls",
        (f) => {
            f.current.calls.pop();
        },
        "missingCurrentCalls",
    ],
    [
        "failed call",
        (f) => {
            f.current.calls[2].status = "failed";
        },
        "toolFailed",
    ],
    [
        "denied call",
        (f) => {
            f.current.calls[2].status = "denied";
        },
        "permissionStopped",
    ],
    [
        "overlapping speculative call",
        (f) => {
            f.current.calls[2].startedAt = ts(1);
        },
        "nonserialCalls",
    ],
    [
        "foreign session",
        (f) => {
            f.current.calls[2].sessionId = "foreign";
        },
        "foreignToolCall",
    ],
    [
        "foreign run",
        (f) => {
            f.current.calls[2].runId = "foreign";
        },
        "foreignToolCall",
    ],
    [
        "foreign trace",
        (f) => {
            f.current.trace.traceId = "foreign";
        },
        "foreignTrace",
    ],
    [
        "stale trace",
        (f) => {
            f.current.trace.startedAt = ts(-1000);
        },
        "foreignTraceWindow",
    ],
    [
        "frozen source origin",
        (f) => {
            f.current.origin = "frozen-service-receipt";
        },
        "unverifiedNativeOrigin",
    ],
    [
        "frozen catalog",
        (f) => {
            f.current.discovery.origin = "frozen-catalog";
        },
        "unverifiedCatalog",
    ],
    [
        "catalog schema drift",
        (f) => {
            f.current.discovery.tools[0].inputSchema.properties.extra = {};
        },
        "catalogSchemaDrift",
    ],
    [
        "unknown callable alias",
        (f) => {
            f.current.calls[0].name = "functions.explicit_retrieve";
        },
        "unexpectedTool",
    ],
    [
        "wrong backend",
        (f) => {
            f.current.calls[0].mcpServerName = "foreign";
        },
        "unexpectedTool",
    ],
    [
        "model-only original",
        (f) => {
            const call = f.current.trace.toolCalls[2];
            call.modelResultArtifact = call.resultArtifact;
            delete call.resultArtifact;
        },
        "modelOnlyEvidence",
    ],
    [
        "missing original",
        (f) => {
            delete f.current.trace.toolCalls[2].resultArtifact;
        },
        "missingOriginalArtifact",
    ],
    [
        "forged projection",
        (f) => {
            f.current.trace.toolCalls[2].result = {};
        },
        "forgedResultView",
    ],
    [
        "wrong artifact source",
        (f) => {
            f.current.trace.toolCalls[2].resultArtifact.source = "modelResult";
        },
        "wrongArtifactSource",
    ],
    [
        "foreign artifact owner",
        (f) => {
            f.current.trace.toolCalls[2].resultArtifact.ownerId = "foreign";
        },
        "invalidArtifactOrHostEvidence",
    ],
    [
        "foreign artifact call",
        (f) => {
            f.current.trace.toolCalls[2].resultArtifact.toolCallId = "foreign";
        },
        "invalidArtifactOrHostEvidence",
    ],
    [
        "frozen-file fallback ref",
        (f) => {
            f.current.trace.toolCalls[2].resultArtifact.path =
                f.expected.frozenEvidence.path;
        },
        "invalidArtifactReference",
    ],
    [
        "wrong actual original event",
        (f) => {
            f.current.calls[2].result = {};
        },
        "artifactEventMismatch",
    ],
    [
        "invalid artifact encoding",
        (f) => {
            f.current.trace.toolCalls[2].resultArtifact.encoding = "base64";
        },
        "invalidArtifactOrHostEvidence",
    ],
    [
        "unsafe artifact path",
        (f) => {
            f.current.trace.toolCalls[2].resultArtifact.id = "../foreign";
        },
        "invalidArtifactOrHostEvidence",
    ],
    [
        "foreign model-result source",
        (f) => {
            const call = f.current.trace.toolCalls[2];
            call.modelResult = clone(call.result);
            call.modelResultArtifact = clone(call.resultArtifact);
        },
        "invalidArtifactOrHostEvidence",
    ],
    [
        "invented trace-tool timestamp field",
        (f) => {
            f.current.trace.toolCalls[2].startedAt = ts(-1000);
        },
        "invalidTraceToolCallShape",
    ],
    [
        "missing current tool-call identity",
        (f) => {
            f.current.calls[0].toolCallId = "";
            f.current.trace.toolCalls[0].toolCallId = "";
        },
        "foreignToolCall",
    ],
    [
        "write-advertised discovery",
        (f) => {
            f.current.discovery.tools[0].annotations.readOnlyHint = false;
        },
        "catalogSchemaDrift",
    ],
    [
        "frozen sourceArtifact substitution",
        (f) => {
            f.current.calls[2].sourceArtifact = f.expected.frozenEvidence.path;
        },
        "invalidEvidenceShape",
    ],
    [
        "source argument divergence",
        (f) => {
            f.current.trace.toolCalls[0].arguments.query = "old source";
        },
        "sourceArgumentMismatch",
    ],
    [
        "duplicate current tool-call identity",
        (f) => {
            f.current.calls[1].toolCallId = f.current.calls[0].toolCallId;
            f.current.trace.toolCalls[1].toolCallId =
                f.current.calls[0].toolCallId;
        },
        "duplicateToolCall",
    ],
    [
        "unsupported legacy trace for full artifact proof",
        (f) => {
            f.current.trace.schemaVersion = 1;
        },
        "unsupportedTrace",
    ],
    [
        "unknown current trace capability",
        (f) => {
            f.current.trace.capabilities.push("unsupported");
        },
        "unsupportedTrace",
    ],
    [
        "run-only artifact without actual SDK correlation",
        (f) => {
            f.current.trace.toolCalls[2].resultArtifact.owner = "run";
            f.current.trace.toolCalls[2].resultArtifact.ownerId = f.trial.runId;
        },
        "invalidArtifactOrHostEvidence",
    ],
];
for (const [name, mutate, code] of mutations) {
    test(name + " cannot manufacture success", async (t) => {
        const f = await fixture(t, { binaryFile: false });
        mutate(f);
        const result = await verdict(f);
        assert.equal(result.code, code);
        assert.notEqual(result.status, "passed");
        assert.equal(result.originalBytesVerified, false);
    });
}

const outputMutations = [
    [
        "nonunique lookup",
        0,
        (r) => {
            r.structuredContent[key].resultCount = 2;
        },
        "nonuniqueLookup",
        "failed",
    ],
    [
        "wrong lookup item",
        0,
        (r) => {
            r.structuredContent[key].retrievalHits[0].itemId = "wrong";
        },
        "wrongDocument",
        "failed",
    ],
    [
        "wrong lookup library",
        0,
        (r) => {
            r.structuredContent[key].retrievalHits[0].driveId = "wrong";
        },
        "wrongLibrary",
        "failed",
    ],
    [
        "unknown lookup shape",
        0,
        (r) => {
            r.structuredContent[key].invented = true;
        },
        "unsupportedLookupOutput",
        "harness-invalid",
    ],
    [
        "metadata library mismatch",
        1,
        (r) => {
            r.structuredContent.results[0].data.parentReference.driveId =
                "wrong";
        },
        "wrongLibrary",
        "failed",
    ],
    [
        "metadata identity mismatch",
        1,
        (r) => {
            r.structuredContent.results[0].data.id = "wrong";
        },
        "wrongDocument",
        "failed",
    ],
    [
        "frozen version drift",
        1,
        (r) => {
            r.structuredContent.results[0].data.eTag = "new";
        },
        "versionDrift",
        "blocked",
    ],
    [
        "post-read version drift",
        3,
        (r) => {
            r.structuredContent.results[0].data.cTag = "new";
        },
        "versionDrift",
        "blocked",
    ],
    [
        "unknown blob output",
        2,
        (r) => {
            r.structuredContent.localFile = "invented";
        },
        "unsupportedBlobOutput",
        "harness-invalid",
    ],
    [
        "provider error",
        1,
        (r) => {
            r.isError = true;
        },
        "providerError",
        "failed",
    ],
];
for (const [name, index, mutate, code, status] of outputMutations) {
    test(name + " returns an explicit non-success verdict", async (t) => {
        const f = await fixture(t, { binaryFile: false });
        mutate(f.current.calls[index].result);
        await f.refresh(index);
        const result = await verdict(f);
        assert.equal(result.code, code);
        assert.equal(result.status, status);
    });
}

test("changing a media byte with unchanged version metadata fails the whole-original digest", async (t) => {
    const f = await fixture(t);
    const changed = Buffer.from(f.bytes);
    changed[Math.floor(changed.length * 0.92)] ^= 1;
    f.current.calls[2].result.structuredContent.base64Content =
        changed.toString("base64");
    await f.refresh(2);
    const result = await verdict(f);
    assert.equal(result.code, "originalDigestMismatch");
    assert.equal(result.status, "failed");
});

test("captured stale document IDs and extra query fragments fail before any content acceptance", async (t) => {
    const f = await fixture(t, { binaryFile: false });
    f.current.calls[2].arguments.path =
        "/drives/drive-generated/items/stale/content";
    f.current.trace.toolCalls[2].arguments = clone(
        f.current.calls[2].arguments,
    );
    assert.equal((await verdict(f)).code, "bindingMismatch");
    f.current.calls[2].arguments.path =
        f.expected.entityPath + "/content?extra=1";
    f.current.trace.toolCalls[2].arguments = clone(
        f.current.calls[2].arguments,
    );
    assert.equal((await verdict(f)).code, "bindingMismatch");
});

test("configured suffix tampering is an invalid contract, not a supported transform", async (t) => {
    const f = await fixture(t, { binaryFile: false });
    f.admission.workflow.recipe[2].argumentTemplate.path.suffix =
        "?$select=token";
    assert.throws(
        () => f.verifier(),
        (error) => error.code === "invalidBindingContract",
    );
});

test("missing and tampered private evidence produce standard invalid verdicts without fallback", async (t) => {
    const f = await fixture(t, { binaryFile: false });
    const ref = f.current.trace.toolCalls[2].resultArtifact;
    const original = await readFile(f.filename(ref));
    await writeFile(f.filename(ref), "{}");
    let result = await verdict(f);
    assert.equal(result.status, "harness-invalid");
    assert.equal(result.artifactError, "evidenceIntegrity");
    await writeFile(f.filename(ref), original);
    await rm(f.filename(ref));
    result = await verdict(f);
    assert.equal(result.status, "harness-invalid");
    assert.equal(result.artifactError, "missingEvidence");
});

test("clipped original SDK content blocks even when complete model/frozen data exists", async (t) => {
    const f = await fixture(t, { binaryFile: false, wrapped: true });
    f.current.calls[2].result.content =
        '{"structuredContent":' + " ".repeat(5000);
    await f.refresh(2);
    const result = await verdict(f);
    assert.equal(result.status, "blocked");
    assert.equal(result.code, "incompleteSDKResult");
});

test("explicit discovery mappings allow an alias, with no automatic prefix normalization", async (t) => {
    const f = await fixture(t, { binaryFile: false });
    const alias = "functions.fully_discovered_read";
    f.current.discovery.tools[0].callableName = alias;
    f.current.calls[0].name = alias;
    f.current.trace.toolCalls[0].name = alias;
    assert.equal((await verdict(f)).status, "passed");
});

test("Doc.aspx metadata viewer is not silently equated to canonical file URL", async (t) => {
    const f = await fixture(t);
    assert.notEqual(
        f.expected.actualMetadataWebUrl,
        f.expected.canonicalWebUrl,
    );
    assert.equal((await verdict(f)).status, "passed");
    f.current.calls[1].result.structuredContent.results[0].data.webUrl =
        f.expected.canonicalWebUrl;
    await f.refresh(1);
    assert.equal((await verdict(f)).code, "wrongDocument");
});

test("public capture payload cannot provide current host results or fallback bodies", async (t) => {
    const f = await fixture(t, { binaryFile: false });
    const result = await f.verifier().verify({
        entityKey: f.expected.key,
        trace: f.current.trace,
        frozenPayload: f.bytes.toString("base64"),
    });
    assert.equal(result.code, "invalidVerifierRequest");
    assert.equal(result.status, "harness-invalid");
    assert.throws(() =>
        createWorkiqEvidenceVerifier({ ...f.options, readCurrent: {} }),
    );
});

test("malformed factory context and public selectors have explicit invalid contracts", async (t) => {
    const f = await fixture(t, { binaryFile: false });
    for (const options of [
        null,
        { ...f.options, artifactRoot: 42 },
        { ...f.options, trial: null },
        {
            ...f.options,
            admission: {
                ...f.admission,
                workflow: { recipe: [null, null, null, null] },
            },
        },
        { ...f.options, admission: { ...f.admission, entities: null } },
    ]) {
        assert.throws(
            () => createWorkiqEvidenceVerifier(options),
            (error) =>
                error.name === "WorkiqEvidenceError" &&
                error.status === "harness-invalid" &&
                typeof error.code === "string",
        );
    }
    for (const request of [null, {}, { entityKey: "unknown" }]) {
        const result = await f.verifier().verify(request);
        assert.equal(result.status, "harness-invalid");
        assert.equal(result.originalBytesVerified, false);
    }
});

test("missing frozen library/version facts remain invalid, never inferred", async (t) => {
    const f = await fixture(t, { binaryFile: false });
    delete f.expected.oracle.libraryGuard.listId;
    assert.equal((await verdict(f)).code, "invalidExpectedLibrary");
    f.expected.oracle.libraryGuard.listId = "list-generated";
    delete f.expected.oracle.frozenVersion.eTag;
    assert.equal((await verdict(f)).code, "invalidExpectedVersion");
});

test("a parsed model receipt must match the independently retained full SDK original", async (t) => {
    const f = await fixture(t, { binaryFile: false, wrapped: true });
    const parsed = JSON.parse(f.current.calls[2].result.content);
    parsed.structuredContent.blobName = "different";
    const ref = await f.store.retain(
        "trace",
        f.trial.traceId,
        "call-2",
        "modelResult",
        parsed,
    );
    f.current.trace.toolCalls[2].modelResultArtifact = ref;
    f.current.trace.toolCalls[2].modelResult = ref.view;
    const result = await verdict(f);
    assert.equal(result.code, "modelOriginalMismatch");
    assert.equal(result.originalBytesVerified, false);
});

test("host exceptions cannot create success-shaped or data-bearing verdicts", async (t) => {
    const f = await fixture(t, { binaryFile: false });
    const verifier = createWorkiqEvidenceVerifier({
        ...f.options,
        readCurrent: async () => {
            throw new WorkiqEvidenceError("passed", "not/a/control/code");
        },
    });
    const result = await verifier.verify({ entityKey: f.expected.key });
    assert.equal(result.status, "harness-invalid");
    assert.equal(result.code, "invalidEvidenceError");
    assert.equal(result.originalBytesVerified, false);
});
