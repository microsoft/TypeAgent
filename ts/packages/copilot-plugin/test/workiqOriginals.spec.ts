// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import { mkdir, writeFile, readFile, rm, link } from "node:fs/promises";
import path from "node:path";
import type { SessionEvent, SessionEventHandler } from "@github/copilot-sdk";
import { PrivateResultStore } from "@typeagent/copilot-macros";
import { publishControlMetadata } from "../src/shared/control-metadata.js";
import {
    observeWorkiqToolOriginals,
    workiqOriginalsContract,
    workiqCapturePolicyPath,
    workiqNativeCaptureOptIn,
    workiqExposureOverride,
} from "../src/extension/workiq-originals.js";

async function fixture(initialTraceId: string | null = randomUUID()) {
    const root = path.resolve(`.workiq-sdk-${randomUUID()}`);
    const dataRoot = path.join(root, "data");
    const artifactRoot = path.join(root, "artifacts");
    await mkdir(dataRoot, { recursive: true });
    await mkdir(artifactRoot);
    const owner = randomUUID();
    const sessionId = randomUUID();
    const configPath = path.join(root, "plugin", "config.json");
    await mkdir(path.dirname(configPath));
    await writeFile(configPath, JSON.stringify({ mode: "mcp" }));
    await writeFile(
        path.join(root, "evaluation-owner.json"),
        JSON.stringify({ owner }),
    );
    await writeFile(
        path.join(dataRoot, "native-control-admission.json"),
        JSON.stringify({
            owner,
            ownedRoot: root,
            configPath,
            expectedMode: "mcp",
        }),
    );
    const previous = {
        TYPEAGENT_PLUGIN_DATA: process.env.TYPEAGENT_PLUGIN_DATA,
        TYPEAGENT_USER_DATA_DIR: process.env.TYPEAGENT_USER_DATA_DIR,
    };
    process.env.TYPEAGENT_PLUGIN_DATA = path.dirname(configPath);
    process.env.TYPEAGENT_USER_DATA_DIR = dataRoot;
    const control = publishControlMetadata("native-extension-startup");
    for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    if (!control) throw new Error("Missing fixture control");
    const tools = ["retrieve", "fetch", "fetch_blob"].map((name) => ({
        advertisedName: name,
        callableName: `workiq-${name}`,
        inputSchema: { type: "object" },
    }));
    const policy = {
        schemaVersion: 1,
        kind: workiqOriginalsContract,
        owner,
        sessionId,
        traceId: initialTraceId,
        runId: null,
        artifactRoot,
        createdAt: new Date().toISOString(),
        mcpServerName: "workiq",
        tools,
    };
    const policyPath = path.join(
        dataRoot,
        "native-workiq-originals-policy.json",
    );
    await writeFile(policyPath, JSON.stringify(policy));
    let handler: SessionEventHandler | undefined;
    const metadata = {
        tools: tools.map((tool) => ({
            name: tool.callableName,
            mcpServerName: "workiq",
            mcpToolName: tool.advertisedName,
            description: "generated",
            input_schema: tool.inputSchema,
        })),
    };
    const session = {
        sessionId,
        rpc: {
            tools: {
                getCurrentMetadata: async () => metadata,
                initializeAndValidate: async () => ({}),
            },
        },
        on: (listener: SessionEventHandler) => {
            handler = listener;
            return () => {
                handler = undefined;
            };
        },
    };
    const emit = (event: SessionEvent) => handler?.(event);
    const recordedTools: object[] = [];
    const base = () => ({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        parentId: null,
    });
    const read = (
        operation: string,
        result: { content: string },
        agentId = "child-generated",
        completionAgentId = agentId,
    ) => {
        const toolCallId = randomUUID();
        recordedTools.push({
            toolCallId,
            name: `workiq-${operation}`,
            mcpServerName: "workiq",
        });
        emit({
            ...base(),
            agentId,
            type: "tool.execution_start",
            data: {
                toolCallId,
                toolName: `workiq-${operation}`,
                mcpServerName: "workiq",
                arguments: {},
            },
        });
        emit({
            ...base(),
            agentId: completionAgentId,
            type: "tool.execution_complete",
            data: { toolCallId, success: true, result },
        });
    };
    return {
        root,
        control,
        session,
        policy,
        policyPath,
        metadata,
        read,
        persistTrace: async (actualTraceId = policy.traceId) => {
            await mkdir(path.join(artifactRoot, "traces"));
            await writeFile(
                path.join(artifactRoot, "traces", `${actualTraceId}.json`),
                JSON.stringify({
                    schemaVersion: 2,
                    sessionId,
                    toolCalls: recordedTools,
                }),
            );
        },
        cleanup: () => rm(root, { recursive: true, force: true }),
    };
}

describe("separate WorkIQ SDK original capture", () => {
    it("uses an exact owned control admission opt-in without extending console environment", async () => {
        const f = await fixture(null);
        const previous = process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY;
        delete process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY;
        try {
            expect(await workiqCapturePolicyPath(f.control)).toBeUndefined();
            const admissionFile = path.join(
                f.control.dataRoot,
                "native-control-admission.json",
            );
            const admission = JSON.parse(await readFile(admissionFile, "utf8"));
            await writeFile(
                admissionFile,
                JSON.stringify({
                    ...admission,
                    workiqOriginals: {
                        schemaVersion: 1,
                        kind: workiqNativeCaptureOptIn,
                        exposureOverride: workiqExposureOverride,
                    },
                }),
            );
            expect(await workiqCapturePolicyPath(f.control)).toBe(f.policyPath);
            const observer = await observeWorkiqToolOriginals(
                f.control,
                f.session,
                f.policyPath,
            );
            expect(observer?.guard("workiq-retrieve")?.permissionDecision).toBe(
                "deny",
            );
            observer?.close();
        } finally {
            if (previous !== undefined)
                process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY = previous;
            await f.cleanup();
        }
    });

    for (const invalid of [
        "boolean",
        "extra",
        "override",
        "owner",
        "config",
        "hardlink",
        "pid",
    ]) {
        it(`rejects private native capture opt-in ${invalid}`, async () => {
            const f = await fixture(null);
            const previous = process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY;
            delete process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY;
            try {
                const filename = path.join(
                    f.control.dataRoot,
                    "native-control-admission.json",
                );
                const admission = JSON.parse(await readFile(filename, "utf8"));
                const optIn: Record<string, unknown> = {
                    schemaVersion: 1,
                    kind: workiqNativeCaptureOptIn,
                    exposureOverride: workiqExposureOverride,
                };
                if (invalid === "extra") optIn.allow = true;
                if (invalid === "override") optIn.exposureOverride = "verified";
                admission.workiqOriginals =
                    invalid === "boolean" ? true : optIn;
                if (invalid === "owner") admission.owner = randomUUID();
                if (invalid === "config")
                    admission.configPath = path.join(
                        f.control.dataRoot,
                        "other.json",
                    );
                if (invalid === "pid") f.control.source.pid++;
                await writeFile(filename, JSON.stringify(admission));
                if (invalid === "hardlink")
                    await link(filename, `${filename}.link`);
                await expect(
                    workiqCapturePolicyPath(f.control),
                ).rejects.toThrow();
            } finally {
                if (previous !== undefined)
                    process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY =
                        previous;
                await f.cleanup();
            }
        });
    }

    it("waives only the assurance denial for an exact fresh owned experimental session", async () => {
        const f = await fixture(null);
        try {
            await writeFile(
                f.policyPath,
                JSON.stringify({
                    ...f.policy,
                    kind: "workiq-sdk-originals-experimental-v1",
                    exposureOverride:
                        "user-authorized-unverified-model-exposure",
                }),
            );
            const observer = await observeWorkiqToolOriginals(
                f.control,
                f.session,
                f.policyPath,
            );
            expect(observer?.guard("workiq-fetch_blob")).toBeUndefined();
            for (const operation of [
                "retrieve",
                "fetch",
                "fetch_blob",
                "fetch",
            ])
                f.read(operation, { content: "{}" });
            const traceId = randomUUID();
            await f.persistTrace(traceId);
            await observer?.finalize(traceId);
            const receipt = JSON.parse(
                await readFile(
                    path.join(
                        f.policy.artifactRoot,
                        "workiq-sdk-originals",
                        f.session.sessionId,
                        "receipt.json",
                    ),
                    "utf8",
                ),
            );
            expect(receipt).toMatchObject({
                admission: false,
                modelInputExposure: "not-certified",
                exposureOverride: "user-authorized-unverified-model-exposure",
                unresolvedAssumptions: [
                    "pre-model full binary completeness and model exposure ordering unverified",
                ],
            });
        } finally {
            await f.cleanup();
        }
    });
    it.each(["wrongOverride", "wrongSession", "extraField"])(
        "rejects experimental %s, never granting tool permission",
        async (mutation) => {
            const f = await fixture();
            try {
                await writeFile(
                    f.policyPath,
                    JSON.stringify({
                        ...f.policy,
                        kind: "workiq-sdk-originals-experimental-v1",
                        exposureOverride:
                            mutation === "wrongOverride"
                                ? "allow-all"
                                : "user-authorized-unverified-model-exposure",
                        ...(mutation === "wrongSession"
                            ? { sessionId: randomUUID() }
                            : {}),
                        ...(mutation === "extraField"
                            ? { backendPermission: "allow" }
                            : {}),
                    }),
                );
                await expect(
                    observeWorkiqToolOriginals(
                        f.control,
                        f.session,
                        f.policyPath,
                    ),
                ).rejects.toThrow();
            } finally {
                await f.cleanup();
            }
        },
    );
    it("defaults off without reading policy or discovering tools", async () => {
        const f = await fixture();
        try {
            delete process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY;
            const spy = jest.spyOn(f.session.rpc.tools, "getCurrentMetadata");
            expect(
                await observeWorkiqToolOriginals(f.control, f.session),
            ).toBeUndefined();
            expect(spy).not.toHaveBeenCalled();
        } finally {
            await f.cleanup();
        }
    });
    it("retains full current child SDK originals, including small values and >1MiB generated binary", async () => {
        const f = await fixture();
        try {
            const observer = await observeWorkiqToolOriginals(
                f.control,
                f.session,
                f.policyPath,
            );
            const binary = Buffer.alloc(1106975, 7).toString("base64");
            const original = {
                content: JSON.stringify({
                    structuredContent: { base64Content: binary },
                }),
            };
            f.read("retrieve", { content: "{}" });
            f.read("fetch", { content: "{}" });
            f.read("fetch_blob", original);
            f.read("fetch", { content: "{}" });
            await f.persistTrace();
            expect(await observer?.finalize()).toMatchObject({
                calls: 4,
                admission: false,
            });
            const receipt = JSON.parse(
                await readFile(
                    path.join(
                        f.policy.artifactRoot,
                        "workiq-sdk-originals",
                        f.session.sessionId,
                        "receipt.json",
                    ),
                    "utf8",
                ),
            );
            expect(receipt.modelInputExposure).toBe("not-certified");
            const call = receipt.calls[2];
            expect(call.resultArtifact.view.content).not.toContain(binary);
            expect(
                await new PrivateResultStore(f.policy.artifactRoot).verify(
                    call.resultArtifact,
                    "run",
                    f.session.sessionId,
                    call.resultArtifact.toolCallId,
                    "result",
                ),
            ).toEqual(original);
            expect(observer?.guard("workiq-fetch_blob")).toMatchObject({
                permissionDecision: "deny",
            });
            expect(observer?.guard("builtin-task")).toBeUndefined();
            await expect(observer?.finalize()).rejects.toThrow();
        } finally {
            await f.cleanup();
        }
    });
    it("defers an unknown trace ID until the actual finalized owned trace exists", async () => {
        const f = await fixture(null);
        try {
            const observer = await observeWorkiqToolOriginals(
                f.control,
                f.session,
                f.policyPath,
            );
            for (const operation of [
                "retrieve",
                "fetch",
                "fetch_blob",
                "fetch",
            ])
                f.read(operation, { content: "{}" });
            const actualTraceId = randomUUID();
            await f.persistTrace(actualTraceId);
            expect(await observer?.finalize(actualTraceId)).toMatchObject({
                source: {
                    sessionId: f.session.sessionId,
                    traceId: actualTraceId,
                },
                admission: false,
            });
        } finally {
            await f.cleanup();
        }
    });
    it.each([
        "stale",
        "owner",
        "session",
        "schema",
        "hardlink",
        "extraPolicy",
        "outsideRoot",
    ])("fails closed for %s without a receipt", async (mutation) => {
        const f = await fixture();
        try {
            if (mutation === "stale")
                f.policy.createdAt = "2000-01-01T00:00:00Z";
            if (mutation === "owner") f.policy.owner = randomUUID();
            if (mutation === "session") f.policy.sessionId = randomUUID();
            if (mutation === "outsideRoot")
                f.policy.artifactRoot = path.dirname(f.root);
            if (mutation === "schema")
                f.metadata.tools[0].input_schema = { type: "string" };
            await writeFile(
                f.policyPath,
                JSON.stringify(
                    mutation === "extraPolicy"
                        ? { ...f.policy, consent: true }
                        : f.policy,
                ),
            );
            if (mutation === "hardlink")
                await link(
                    f.policyPath,
                    path.join(f.control.dataRoot, "linked-policy.json"),
                );
            await expect(
                observeWorkiqToolOriginals(f.control, f.session, f.policyPath),
            ).rejects.toThrow();
        } finally {
            await f.cleanup();
        }
    });
    it.each([
        "order",
        "extra",
        "resultCap",
        "missing",
        "crossActor",
        "receiptCap",
    ])("retains no accepted receipt for %s", async (mutation) => {
        const f = await fixture();
        try {
            if (mutation === "receiptCap")
                f.metadata.tools[0].description = "x".repeat(256 * 1024);
            const observer = await observeWorkiqToolOriginals(
                f.control,
                f.session,
                f.policyPath,
            );
            if (mutation === "order") f.read("fetch", { content: "{}" });
            else {
                f.read(
                    "retrieve",
                    { content: "{}" },
                    "child-generated",
                    mutation === "crossActor"
                        ? "foreign-child"
                        : "child-generated",
                );
                f.read("fetch", { content: "{}" });
                if (mutation !== "missing") {
                    f.read("fetch_blob", {
                        content:
                            mutation === "resultCap"
                                ? "x".repeat(16 * 1024 * 1024)
                                : "{}",
                    });
                    f.read("fetch", { content: "{}" });
                    if (mutation === "extra")
                        f.read("retrieve", { content: "{}" });
                }
            }
            await f.persistTrace();
            await expect(observer?.finalize()).rejects.toThrow();
        } finally {
            await f.cleanup();
        }
    });
});
