// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, rm, link } from "node:fs/promises";
import { observeWorkiqToolOriginals } from "../../../copilot-plugin/dist/extension/workiq-originals.js";
import {
    publishWorkiqSessionKnown,
    publishWorkiqNativeRecord,
} from "../../../copilot-plugin/dist/extension/workiq-native-session.js";
import { setTimeout as delay } from "node:timers/promises";
import {
    restoreWorkiqSdkOriginals,
    awaitWorkiqNativeSession,
    awaitWorkiqFinalizedCapture,
} from "../macro-eval-workiq-native.mjs";

test("caller JSON cannot mint production runtime or projection authority", async () => {
    const { createWorkiqNativeController } = await import(
        "../macro-eval-workiq-controller.mjs"
    );
    const { verifyWorkiqNativeProjection } = await import(
        "../macro-eval-workiq-native.mjs"
    );
    let called = false;
    await assert.rejects(
        createWorkiqNativeController({
            admission: {},
            runtime: {
                assertPrerequisites: () => {
                    called = true;
                },
            },
        }),
        /source-owned native runtime/u,
    );
    assert.equal(called, false);
    await assert.rejects(
        verifyWorkiqNativeProjection({ verified: true }, "unused", {}, {}, []),
        (error) => error.code === "unverifiedWorkiqNativeProjection",
    );
});

async function fixture(t) {
    const root = path.resolve(`.workiq-native-${randomUUID()}`);
    t.after(() => rm(root, { recursive: true, force: true }));
    const artifactRoot = path.join(root, "artifacts"),
        dataRoot = path.join(root, "data");
    await mkdir(artifactRoot, { recursive: true });
    await mkdir(dataRoot);
    const sessionId = randomUUID(),
        traceId = randomUUID(),
        ownerId = randomUUID();
    const now = () => new Date().toISOString();
    const events = [
        {
            id: randomUUID(),
            type: "session.start",
            timestamp: now(),
            data: { sessionId },
        },
    ];
    const tools = ["retrieve", "fetch", "fetch_blob"].map((name) => ({
        advertisedName: name,
        callableName: `workiq-${name}`,
        inputSchema: { type: "object" },
    }));
    const policy = {
        schemaVersion: 1,
        kind: "workiq-sdk-originals-v1",
        owner: ownerId,
        sessionId,
        traceId,
        runId: null,
        artifactRoot,
        createdAt: now(),
        mcpServerName: "workiq",
        tools,
    };
    await writeFile(
        path.join(root, "evaluation-owner.json"),
        JSON.stringify({ owner: ownerId }),
    );
    const policyPath = path.join(
        dataRoot,
        "native-workiq-originals-policy.json",
    );
    await writeFile(policyPath, JSON.stringify(policy));
    let handler;
    const session = {
        sessionId,
        on: (callback) => {
            handler = callback;
            return () => {
                handler = undefined;
            };
        },
        rpc: {
            tools: {
                initializeAndValidate: async () => ({}),
                getCurrentMetadata: async () => ({
                    tools: tools.map((tool) => ({
                        name: tool.callableName,
                        mcpServerName: "workiq",
                        mcpToolName: tool.advertisedName,
                        description: "generated",
                        input_schema: tool.inputSchema,
                    })),
                }),
            },
        },
    };
    const control = {
        dataRoot,
        digest: "a".repeat(64),
        source: { owner: ownerId, pid: process.pid, readableOwnedConfig: true },
    };
    const observer = await observeWorkiqToolOriginals(
        control,
        session,
        policyPath,
    );
    const originals = [];
    for (const operation of ["retrieve", "fetch", "fetch_blob", "fetch"]) {
        const toolCallId = randomUUID();
        const start = {
            id: randomUUID(),
            type: "tool.execution_start",
            timestamp: now(),
            agentId: "generated-child",
            data: {
                toolCallId,
                toolName: `workiq-${operation}`,
                mcpServerName: "workiq",
                arguments: {},
            },
        };
        const result = {
            content: JSON.stringify({
                structuredContent:
                    operation === "fetch_blob"
                        ? {
                              base64Content: Buffer.alloc(1106975, 9).toString(
                                  "base64",
                              ),
                          }
                        : { generated: operation },
            }),
        };
        originals.push(result);
        const complete = {
            id: randomUUID(),
            type: "tool.execution_complete",
            timestamp: now(),
            agentId: "generated-child",
            data: { toolCallId, success: true, result },
        };
        handler(start);
        handler(complete);
        events.push(start, {
            ...complete,
            data: { ...complete.data, result: { content: "Content clipped" } },
        });
    }
    await mkdir(path.join(artifactRoot, "traces"));
    await writeFile(
        path.join(artifactRoot, "traces", `${traceId}.json`),
        JSON.stringify({
            schemaVersion: 2,
            sessionId,
            toolCalls: events
                .filter((event) => event.type === "tool.execution_start")
                .map((event) => ({
                    toolCallId: event.data.toolCallId,
                    name: event.data.toolName,
                    mcpServerName: event.data.mcpServerName,
                })),
        }),
    );
    await observer.finalize();
    return {
        root,
        artifactRoot,
        dataRoot,
        policyPath,
        events,
        originals,
        options: {
            artifactRoot,
            sdkCaptureDataRoot: dataRoot,
            scope: { ownerId },
        },
        trial: { sessionId, traceId, runId: null },
        receiptPath: path.join(
            artifactRoot,
            "workiq-sdk-originals",
            sessionId,
            "receipt.json",
        ),
    };
}

test("actual native admission builder enables source bridge with the exact supported console overlay", async (t) => {
    const f = await fixture(t);
    const { nativeWorkiqControlAdmission } = await import(
        "../native-workiq-lifecycle.mjs"
    );
    const { workiqCapturePolicyPath } = await import(
        "../../../copilot-plugin/dist/extension/workiq-originals.js"
    );
    const configPath = path.join(f.root, "plugin", "config.json");
    await writeFile(
        path.join(f.dataRoot, "native-control-admission.json"),
        JSON.stringify(
            nativeWorkiqControlAdmission(
                { owner: f.options.scope.ownerId, run: f.root },
                configPath,
            ),
        ),
    );
    const previous = process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY;
    delete process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY;
    try {
        assert.equal(
            await workiqCapturePolicyPath({
                dataRoot: f.dataRoot,
                configPath,
                source: {
                    owner: f.options.scope.ownerId,
                    pid: process.pid,
                    readableOwnedConfig: true,
                },
            }),
            f.policyPath,
        );
    } finally {
        if (previous !== undefined)
            process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY = previous;
    }
});

test("source getters load actual owned session and finalized source files, not readiness callbacks", async (t) => {
    const f = await fixture(t);
    const configPath = path.join(f.root, "plugin", "config.json");
    const source = {
        component: "native-workiq-session-v1",
        sessionId: f.trial.sessionId,
        processStartedAt: "2026-01-01T00:00:00Z",
        observedAt: new Date().toISOString(),
        control: {
            configPath,
            dataRoot: f.dataRoot,
            digest: "a".repeat(64),
            source: {
                owner: f.options.scope.ownerId,
                pid: process.pid,
                readableOwnedConfig: true,
            },
        },
    };
    const context = {
        ownedRoot: f.root,
        dataRoot: f.dataRoot,
        owner: f.options.scope.ownerId,
        configPath,
        deadlineMs: Date.now() + 1000,
    };
    await writeFile(
        path.join(f.dataRoot, "native-workiq-session.json"),
        JSON.stringify({
            schemaVersion: 1,
            phase: "session-known",
            source,
        }),
    );
    const known = await awaitWorkiqNativeSession(context);
    assert.equal(known.source.sessionId, f.trial.sessionId);
    assert.equal(Object.isFrozen(known.source.control), true);
    const tracePath = path.join(
        f.artifactRoot,
        "traces",
        `${f.trial.traceId}.json`,
    );
    const trace = JSON.parse(await readFile(tracePath, "utf8"));
    const receipt = JSON.parse(await readFile(f.receiptPath, "utf8"));
    const { workiqJsonHash } = await import("../macro-eval-workiq-adapter.mjs");
    await writeFile(
        path.join(f.dataRoot, "native-workiq-finalized.json"),
        JSON.stringify({
            schemaVersion: 1,
            source,
            summary: {
                sessionId: f.trial.sessionId,
                traceId: f.trial.traceId,
                createdAt: new Date().toISOString(),
                toolCallCount: 4,
            },
            tracePath,
            receiptPath: f.receiptPath,
            traceSha256: workiqJsonHash(trace),
            receiptSha256: workiqJsonHash(receipt),
            hashKind: "physical-sha256",
        }),
    );
    const finalized = await awaitWorkiqFinalizedCapture({
        ...context,
        sessionId: f.trial.sessionId,
        runId: null,
    });
    assert.equal(finalized.summary.traceId, f.trial.traceId);
    await assert.rejects(
        awaitWorkiqNativeSession({ ...context, owner: randomUUID() }),
    );
    await assert.rejects(
        awaitWorkiqFinalizedCapture({
            ...context,
            sessionId: f.trial.sessionId,
            runId: "not-product-run",
        }),
    );
});

function sourceContext(f, signal) {
    const configPath = path.join(f.root, "plugin", "config.json");
    return {
        ownedRoot: f.root,
        dataRoot: f.dataRoot,
        owner: f.options.scope.ownerId,
        configPath,
        deadlineMs: Date.now() + 2000,
        signal,
        control: {
            configPath,
            dataRoot: f.dataRoot,
            digest: "a".repeat(64),
            source: {
                owner: f.options.scope.ownerId,
                pid: process.pid,
                readableOwnedConfig: true,
            },
        },
    };
}

test("compiled SID publication is readable before events and observing remains deferred", async (t) => {
    const f = await fixture(t);
    const abort = new AbortController();
    t.after(() => abort.abort());
    const context = sourceContext(f, abort.signal);
    const first = awaitWorkiqNativeSession(context);
    await publishWorkiqSessionKnown(context.control, f.trial.sessionId);
    const known = await first;
    assert.equal(known.phase, "session-known");
    assert.equal(known.source.sessionId, f.trial.sessionId);
    assert.equal(known.tools, null);
    assert.equal(known.admission, false);
    let settled = false;
    const observing = awaitWorkiqNativeSession({
        ...context,
        requireInitialized: true,
    });
    void observing.then(
        () => {
            settled = true;
        },
        () => {
            settled = true;
        },
    );
    await delay(30);
    assert.equal(settled, false);
    // Generated phase fixture tests the reader; it cannot mint runtime authority.
    await publishWorkiqNativeRecord(
        context.control,
        "native-workiq-session.json",
        {
            ...known,
            phase: "observing",
            initialization: {
                method: "session.tools.initializeAndValidate",
                returnedKeys: [],
            },
            tools: { tools: [] },
            registry: { commands: [] },
            controls: [{}, {}],
            observer: { sessionId: known.source.sessionId },
        },
    );
    assert.equal((await observing).phase, "observing");
    await assert.rejects(readFile(path.join(f.dataRoot, "events.jsonl")), {
        code: "ENOENT",
    });
});

test("source wait cancellation interrupts missing-file polling and rejects pre-aborted ready records", async (t) => {
    const f = await fixture(t);
    const abort = new AbortController();
    const context = sourceContext(f, abort.signal);
    const pending = awaitWorkiqNativeSession(context);
    const rejected = assert.rejects(
        pending,
        (error) => error.name === "AbortError",
    );
    await delay(20);
    abort.abort();
    await rejected;
    await publishWorkiqSessionKnown(context.control, f.trial.sessionId);
    await assert.rejects(awaitWorkiqNativeSession(context), {
        name: "AbortError",
    });
    await assert.rejects(
        awaitWorkiqNativeSession({ ...context, signal: {} }),
        (error) => error.code === "invalidWorkiqNativeSignal",
    );
});

test("source polling honors deadline without waiting a full polling interval", async (t) => {
    const f = await fixture(t);
    const context = sourceContext(f);
    await assert.rejects(
        awaitWorkiqNativeSession({ ...context, deadlineMs: Date.now() + 25 }),
        (error) => error.code === "workiqNativeSourceTimeout",
    );
    await publishWorkiqSessionKnown(context.control, f.trial.sessionId);
    await assert.rejects(
        awaitWorkiqNativeSession({
            ...context,
            deadlineMs: Date.now() + 25,
            requireInitialized: true,
        }),
        (error) => error.code === "workiqNativeSourceTimeout",
    );
});

test("joins actual private current SDK results without replacing model input or public verdict", async (t) => {
    const f = await fixture(t);
    const events = await restoreWorkiqSdkOriginals(
        f.options,
        f.trial,
        f.events,
    );
    assert.deepEqual(
        events
            .filter((event) => event.type === "tool.execution_complete")
            .map((event) => event.data.result),
        f.originals,
    );
    assert.equal(f.events[2].data.result.content, "Content clipped");
});

for (const mutation of [
    "session",
    "trace",
    "owner",
    "policy",
    "hardlink",
    "agent",
    "id",
    "missing",
    "receiptHardlink",
    "stale",
]) {
    test(`rejects ${mutation}; no archive/model-result fallback`, async (t) => {
        const f = await fixture(t);
        if (mutation === "session") f.trial.sessionId = randomUUID();
        if (mutation === "trace") f.trial.traceId = randomUUID();
        if (mutation === "owner") f.options.scope.ownerId = randomUUID();
        if (mutation === "policy") await writeFile(f.policyPath, "{}");
        if (mutation === "agent") f.events[2].agentId = "wrong-child";
        if (mutation === "id") f.events[2].id = randomUUID();
        if (mutation === "missing") f.events.splice(2, 1);
        if (mutation === "receiptHardlink")
            await link(
                f.receiptPath,
                path.join(f.artifactRoot, "receipt-linked.json"),
            );
        if (mutation === "stale")
            f.events[0].timestamp = "2099-01-01T00:00:00Z";
        if (mutation === "hardlink") {
            const receipt = JSON.parse(await readFile(f.receiptPath, "utf8"));
            const ref = receipt.calls[2].resultArtifact;
            const filename = path.join(
                f.artifactRoot,
                "evidence",
                "run",
                f.trial.sessionId,
                `${ref.id}.json`,
            );
            await link(
                filename,
                path.join(f.artifactRoot, "original-linked.json"),
            );
        }
        await assert.rejects(
            restoreWorkiqSdkOriginals(f.options, f.trial, f.events),
        );
    });
}
