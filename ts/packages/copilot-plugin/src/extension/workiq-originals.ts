// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CopilotSession,
    SessionEvent,
    SessionEventHandler,
    CurrentToolMetadata,
} from "@github/copilot-sdk";
import {
    PrivateResultStore,
    type PrivateResultReference,
} from "@typeagent/copilot-macros";
import { createHash } from "node:crypto";
import { lstat, open, realpath, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import type { ControlMetadata } from "../shared/control-metadata.js";

export const workiqOriginalsContract = "workiq-sdk-originals-v1";
export const workiqExperimentalOriginalsContract =
    "workiq-sdk-originals-experimental-v1";
export const workiqExposureOverride =
    "user-authorized-unverified-model-exposure";
export const workiqNativeCaptureOptIn = "workiq-native-capture-opt-in-v1";
const operations = ["retrieve", "fetch", "fetch_blob", "fetch"];
const maximumResultBytes = 16 * 1024 * 1024;
const maximumReceiptBytes = 256 * 1024;
type ToolStart = Extract<SessionEvent, { type: "tool.execution_start" }>;
interface OriginalCall {
    start: ToolStart;
    completion: object;
    resultArtifact: PrivateResultReference;
    originalEventSha256: string;
}
interface OriginalSession {
    sessionId: string;
    on: (handler: SessionEventHandler) => () => void;
    rpc: {
        tools: Pick<
            CopilotSession["rpc"]["tools"],
            "getCurrentMetadata" | "initializeAndValidate"
        >;
    };
}

function assert(value: unknown, code: string): asserts value {
    if (!value) throw new Error(`WorkIQ original capture: ${code}`);
}

function hash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function readWorkiqCaptureBytes(
    root: string,
    relative: string,
    maximum: number,
): Promise<Buffer> {
    const filename = path.resolve(root, relative);
    assert(
        !path.isAbsolute(relative) &&
            !path.relative(root, filename).startsWith(".."),
        "unsafePath",
    );
    let current = filename;
    while (true) {
        const info = await lstat(current);
        assert(
            !info.isSymbolicLink() &&
                (current === filename
                    ? info.isFile() && info.nlink === 1 && info.size <= maximum
                    : info.isDirectory()),
            "unsafePath",
        );
        assert(
            path.resolve(await realpath(current)).toLowerCase() ===
                current.toLowerCase(),
            "unsafePath",
        );
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    const before = await lstat(filename);
    const handle = await open(filename, "r");
    let bytes;
    try {
        const opened = await handle.stat();
        assert(
            opened.ino === before.ino &&
                opened.dev === before.dev &&
                opened.nlink === 1 &&
                opened.size === before.size,
            "changedSource",
        );
        bytes = await handle.readFile();
    } finally {
        await handle.close();
    }
    const after = await lstat(filename);
    assert(
        before.ino === after.ino &&
            before.dev === after.dev &&
            before.size === bytes.length &&
            after.size === bytes.length &&
            after.nlink === 1 &&
            bytes.length <= maximum,
        "changedSource",
    );
    return bytes;
}

export async function readWorkiqCaptureFile(
    root: string,
    relative: string,
    maximum: number,
): Promise<unknown> {
    return JSON.parse(
        (await readWorkiqCaptureBytes(root, relative, maximum)).toString(
            "utf8",
        ),
    );
}

function safeId(value: unknown): value is string {
    return typeof value === "string" && /^[a-z0-9-]{1,128}$/iu.test(value);
}

function validatePolicyScope(
    value: Record<string, unknown>,
    control: ControlMetadata,
    sessionId: string,
) {
    assert(
        value.schemaVersion === 1 &&
            [
                workiqOriginalsContract,
                workiqExperimentalOriginalsContract,
            ].includes(String(value.kind)) &&
            value.owner === control.source.owner &&
            value.sessionId === sessionId &&
            (value.traceId === null || safeId(value.traceId)) &&
            (value.runId === null || safeId(value.runId)) &&
            safeId(value.mcpServerName),
        "policyBinding",
    );
    assert(
        typeof value.createdAt === "string" &&
            Date.now() >= Date.parse(value.createdAt) &&
            Date.now() - Date.parse(value.createdAt) <= 300000,
        "policyFreshness",
    );
}

export async function workiqCapturePolicyPath(control?: ControlMetadata) {
    const supplied = process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY;
    if (!control) {
        if (supplied !== undefined)
            throw new Error(
                "WorkIQ SDK capture requires an owned native control context.",
            );
        return undefined;
    }
    const expected = path.join(
        control.dataRoot,
        "native-workiq-originals-policy.json",
    );
    if (supplied !== undefined) {
        assert(supplied === expected, "policyLocation");
        return expected;
    }
    const admission = await readWorkiqCaptureFile(
        control.dataRoot,
        "native-control-admission.json",
        256 * 1024,
    );
    assert(admission && typeof admission === "object", "nativeOptInAdmission");
    if (!("workiqOriginals" in admission)) return undefined;
    const value = admission.workiqOriginals;
    assert(
        value &&
            typeof value === "object" &&
            Object.keys(value).length === 3 &&
            "schemaVersion" in value &&
            value.schemaVersion === 1 &&
            "kind" in value &&
            value.kind === workiqNativeCaptureOptIn &&
            "exposureOverride" in value &&
            value.exposureOverride === workiqExposureOverride &&
            "owner" in admission &&
            admission.owner === control.source.owner &&
            "ownedRoot" in admission &&
            admission.ownedRoot === path.dirname(control.dataRoot) &&
            "configPath" in admission &&
            admission.configPath === control.configPath &&
            control.source.pid === process.pid &&
            control.source.readableOwnedConfig,
        "nativeOptInBinding",
    );
    const marker = await readWorkiqCaptureFile(
        path.dirname(control.dataRoot),
        "evaluation-owner.json",
        4096,
    );
    assert(
        marker &&
            typeof marker === "object" &&
            "owner" in marker &&
            marker.owner === control.source.owner,
        "nativeOptInOwner",
    );
    return expected;
}

export async function waitForWorkiqCapturePolicy(
    control: ControlMetadata,
    sessionId: string,
) {
    const started = Date.now();
    while (Date.now() - started <= 300000) {
        try {
            const policy = await readWorkiqCaptureFile(
                control.dataRoot,
                "native-workiq-originals-policy.json",
                64 * 1024,
            );
            assert(
                policy &&
                    typeof policy === "object" &&
                    "sessionId" in policy &&
                    policy.sessionId === sessionId,
                "policySession",
            );
            return;
        } catch (error) {
            if (
                !(
                    error &&
                    typeof error === "object" &&
                    "code" in error &&
                    error.code === "ENOENT"
                )
            )
                throw error;
            await delay(200);
        }
    }
    throw new Error("WorkIQ original capture: policyTimeout");
}

function validateArtifactRoot(
    value: unknown,
    control: ControlMetadata,
): asserts value is string {
    assert(typeof value === "string" && path.isAbsolute(value), "artifactRoot");
    const relative = path.relative(path.dirname(control.dataRoot), value);
    assert(
        relative !== "" &&
            !path.isAbsolute(relative) &&
            !relative.startsWith(".."),
        "artifactRoot",
    );
}

function validateNativeTools(
    metadata: CurrentToolMetadata[] | null,
    tools: Record<string, unknown>[],
    server: unknown,
) {
    assert(
        metadata?.filter((item) => item.mcpServerName === server).length === 3,
        "nativeToolSet",
    );
    for (const tool of tools) {
        const actual = metadata?.filter(
            (item) =>
                item.name === tool.callableName &&
                item.mcpServerName === server &&
                item.mcpToolName === tool.advertisedName,
        );
        assert(
            actual?.length === 1 &&
                isDeepStrictEqual(actual[0].input_schema, tool.inputSchema),
            "nativeSchemaDrift",
        );
    }
}

/**
 * Diagnostic retention, not tenant consent or model-delivery admission. The
 * current native SDK has no proved pre-model binary receipt boundary; its
 * default opt-in guard denies WorkIQ execution. A separately versioned,
 * run/session-bound user experiment may waive only that assurance denial.
 */
export async function observeWorkiqToolOriginals(
    control: ControlMetadata,
    session: OriginalSession,
    policyPath = process.env.TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY,
) {
    if (policyPath === undefined) return undefined;
    assert(
        control.source.pid === process.pid &&
            control.source.readableOwnedConfig &&
            typeof control.digest === "string" &&
            /^[a-f0-9]{64}$/u.test(control.digest) &&
            /^[a-z0-9-]{1,128}$/iu.test(session.sessionId) &&
            policyPath ===
                path.join(
                    control.dataRoot,
                    "native-workiq-originals-policy.json",
                ),
        "policyLocation",
    );
    const policy = await readWorkiqCaptureFile(
        control.dataRoot,
        "native-workiq-originals-policy.json",
        64 * 1024,
    );
    assert(policy && typeof policy === "object", "policyShape");
    const value = policy as Record<string, unknown>;
    const keys = [
        "schemaVersion",
        "kind",
        "owner",
        "sessionId",
        "traceId",
        "runId",
        "artifactRoot",
        "createdAt",
        "mcpServerName",
        "tools",
    ];
    const experimental = value.kind === workiqExperimentalOriginalsContract;
    if (experimental) keys.push("exposureOverride");
    assert(
        Object.keys(value).length === keys.length &&
            Object.keys(value).every((key) => keys.includes(key)) &&
            Array.isArray(value.tools) &&
            value.tools.length === 3,
        "policyBinding",
    );
    assert(
        !experimental || value.exposureOverride === workiqExposureOverride,
        "exposureOverride",
    );
    validatePolicyScope(value, control, session.sessionId);
    validateArtifactRoot(value.artifactRoot, control);
    const artifactRoot = value.artifactRoot;
    const tools = value.tools;
    for (const operation of new Set(operations)) {
        const matches = tools.filter(
            (tool) => tool.advertisedName === operation,
        );
        assert(matches.length === 1, "toolSet");
        const tool = matches[0];
        assert(
            Object.keys(tool).length === 3 &&
                typeof tool.callableName === "string" &&
                tool.callableName &&
                tool.inputSchema &&
                typeof tool.inputSchema === "object",
            "toolShape",
        );
    }
    assert(
        new Set(tools.map((tool) => tool.callableName)).size === 3,
        "toolAliases",
    );
    const owner = await readWorkiqCaptureFile(
        path.dirname(control.dataRoot),
        "evaluation-owner.json",
        4096,
    );
    assert(
        owner &&
            typeof owner === "object" &&
            (owner as Record<string, unknown>).owner === value.owner,
        "ownerMismatch",
    );
    await session.rpc.tools.initializeAndValidate();
    const metadata = await session.rpc.tools.getCurrentMetadata();
    validateNativeTools(metadata.tools, tools, value.mcpServerName);
    const traceId = value.traceId;
    const directory = path.join(
        artifactRoot,
        "workiq-sdk-originals",
        session.sessionId,
    );
    // The private result store checks every ancestor before creating evidence.
    const store = new PrivateResultStore(artifactRoot);
    const source = {
        component: workiqOriginalsContract,
        owner: value.owner,
        sessionId: session.sessionId,
        traceId,
        runId: value.runId,
        runIdentityKind: "controller-trial-lease",
        pid: process.pid,
        parentPid: process.ppid,
        executable: process.execPath,
        configDigest: control.digest,
        policySha256: hash(policy),
        startedAt: new Date().toISOString(),
    };
    const calls: OriginalCall[] = [];
    let active: ToolStart | undefined;
    let pending = Promise.resolve();
    let failed = false;
    let totalBytes = 0;
    const ids = new Set<string>();
    const processEvent = async (event: SessionEvent) => {
        assert(
            !failed && Date.now() - Date.parse(source.startedAt) <= 300000,
            "captureStopped",
        );
        if (event.type === "tool.execution_start") {
            if (event.data.mcpServerName !== value.mcpServerName) return;
            assert(
                !active && calls.length < 4 && !ids.has(event.data.toolCallId),
                "extraOrConcurrentRead",
            );
            const expected = tools.find(
                (tool) => tool.advertisedName === operations[calls.length],
            );
            assert(expected?.callableName === event.data.toolName, "readOrder");
            ids.add(event.data.toolCallId);
            active = event;
        } else if (event.type === "tool.execution_complete" && active) {
            if (event.data.toolCallId !== active.data.toolCallId) return;
            assert(
                event.agentId === active.agentId &&
                    event.data.success === true &&
                    event.data.result !== undefined &&
                    Date.parse(event.timestamp) >= Date.parse(active.timestamp),
                "completionBinding",
            );
            const resultBytes = Buffer.byteLength(
                JSON.stringify(event.data.result),
            );
            totalBytes += resultBytes;
            assert(
                resultBytes <= maximumResultBytes &&
                    totalBytes <= 4 * maximumResultBytes,
                "resultCap",
            );
            const resultArtifact = await store.retain(
                "run",
                session.sessionId,
                event.data.toolCallId,
                "result",
                event.data.result,
                { forceFull: true },
            );
            assert(resultArtifact, "missingOriginal");
            const completion = {
                ...event,
                data: { ...event.data, result: undefined },
            };
            calls.push({
                start: active,
                completion,
                resultArtifact,
                originalEventSha256: hash({
                    completion,
                    resultSha256: resultArtifact.sha256,
                }),
            });
            active = undefined;
        }
    };
    const selected = new Set<string>();
    let starts = 0;
    const unsubscribe = session.on((event) => {
        if (event.type === "tool.execution_start") {
            if (event.data.mcpServerName !== value.mcpServerName) return;
            selected.add(event.data.toolCallId);
            starts++;
        } else if (event.type === "tool.execution_complete") {
            if (!selected.delete(event.data.toolCallId)) return;
        } else return;
        if (
            starts > 4 ||
            Buffer.byteLength(JSON.stringify(event)) >
                (event.type === "tool.execution_start"
                    ? 65536
                    : maximumResultBytes + 65536)
        ) {
            failed = true;
            return;
        }
        const captured = structuredClone(event);
        pending = pending
            .then(() => processEvent(captured))
            .catch(() => {
                failed = true;
            });
    });
    return {
        source,
        guard(toolName: string) {
            if (
                (!experimental ||
                    failed ||
                    Date.now() - Date.parse(source.startedAt) > 300000) &&
                tools.some((tool) => tool.callableName === toolName)
            ) {
                return {
                    permissionDecision: "deny" as const,
                    permissionDecisionReason:
                        "WorkIQ native binary/model-input exposure boundary is not admitted.",
                };
            }
            return undefined;
        },
        async finalize(finalizedTraceId?: string) {
            unsubscribe();
            await pending;
            assert(
                !failed && !active && calls.length === 4,
                "incompleteCapture",
            );
            const actualTraceId = traceId ?? finalizedTraceId;
            assert(safeId(actualTraceId), "missingFinalizedTrace");
            const trace = await readWorkiqCaptureFile(
                artifactRoot,
                path.join("traces", `${actualTraceId}.json`),
                1024 * 1024,
            );
            assert(
                trace &&
                    typeof trace === "object" &&
                    "schemaVersion" in trace &&
                    trace.schemaVersion === 2 &&
                    "sessionId" in trace &&
                    trace.sessionId === session.sessionId &&
                    "toolCalls" in trace &&
                    Array.isArray(trace.toolCalls),
                "foreignFinalizedTrace",
            );
            for (const call of calls) {
                const matches = trace.toolCalls.filter(
                    (tool) =>
                        tool.toolCallId === call.start.data.toolCallId &&
                        tool.name === call.start.data.toolName &&
                        tool.mcpServerName === value.mcpServerName,
                );
                assert(matches.length === 1, "unboundFinalizedTrace");
            }
            const receipt = {
                schemaVersion: 1,
                kind: value.kind,
                admission: false,
                modelInputExposure: "not-certified",
                exposureOverride: experimental ? workiqExposureOverride : null,
                runIdentityKind: "controller-trial-lease",
                unresolvedAssumptions: [
                    "pre-model full binary completeness and model exposure ordering unverified",
                ],
                source: { ...source, traceId: actualTraceId },
                discovery: {
                    tools: metadata.tools?.filter(
                        (tool) => tool.mcpServerName === value.mcpServerName,
                    ),
                },
                calls,
            };
            assert(
                Buffer.byteLength(JSON.stringify(receipt)) <=
                    maximumReceiptBytes,
                "receiptCap",
            );
            // Receipts are private too: their bounded schema/argument projections
            // must not be exposed as a public execution or consent assertion.
            await store.verify(
                calls[0].resultArtifact,
                "run",
                session.sessionId,
                calls[0].resultArtifact.toolCallId,
                "result",
            );
            for (const folder of [path.dirname(directory), directory]) {
                try {
                    await mkdir(folder, { mode: 0o700 });
                } catch (error) {
                    if (
                        !(
                            error &&
                            typeof error === "object" &&
                            "code" in error &&
                            error.code === "EEXIST"
                        )
                    )
                        throw error;
                }
                const info = await lstat(folder);
                assert(
                    info.isDirectory() &&
                        !info.isSymbolicLink() &&
                        path.resolve(await realpath(folder)).toLowerCase() ===
                            folder.toLowerCase(),
                    "unsafeReceiptPath",
                );
            }
            await writeFile(
                path.join(directory, "receipt.json"),
                JSON.stringify(receipt),
                { flag: "wx", mode: 0o600 },
            );
            return {
                source: receipt.source,
                calls: calls.length,
                admission: false,
            };
        },
        close: unsubscribe,
    };
}
