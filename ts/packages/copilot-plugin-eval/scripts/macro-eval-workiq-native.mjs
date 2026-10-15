// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PrivateResultStore } from "../../copilot-macros/dist/index.js";
import {
    readWorkiqCaptureFile,
    readWorkiqCaptureBytes,
    workiqOriginalsContract,
    workiqExperimentalOriginalsContract,
    workiqExposureOverride,
} from "../../copilot-plugin/dist/extension/workiq-originals.js";
import { WorkiqEvidenceError } from "./macro-eval-workiq-evidence.mjs";
import { workiqJsonHash } from "./macro-eval-workiq-adapter.mjs";
import { setTimeout as delay } from "node:timers/promises";

function requireSource(condition, code) {
    if (!condition) throw new WorkiqEvidenceError("blocked", code);
}

function withoutResult(event) {
    const copied = structuredClone(event);
    delete copied.data.result;
    return copied;
}

function assertWorkiqSdkCaptureIdentity(options, trial, policy, receipt) {
    const { artifactRoot, scope } = options;
    requireSource(
        receipt.schemaVersion === 1 &&
            [
                workiqOriginalsContract,
                workiqExperimentalOriginalsContract,
            ].includes(receipt.kind) &&
            receipt.kind === policy.kind &&
            (policy.kind !== workiqExperimentalOriginalsContract ||
                (policy.exposureOverride === workiqExposureOverride &&
                    receipt.exposureOverride === workiqExposureOverride)) &&
            receipt.admission === false &&
            receipt.modelInputExposure === "not-certified" &&
            receipt.source.component === workiqOriginalsContract &&
            receipt.source.owner === scope.ownerId &&
            receipt.source.sessionId === trial.sessionId &&
            receipt.source.traceId === trial.traceId &&
            receipt.source.runId === trial.runId &&
            policy.owner === scope.ownerId &&
            policy.sessionId === trial.sessionId &&
            (policy.traceId === null || policy.traceId === trial.traceId) &&
            policy.runId === trial.runId &&
            policy.artifactRoot === artifactRoot &&
            receipt.source.policySha256 === workiqJsonHash(policy),
        "foreignWorkiqSdkCapture",
    );
}

/**
 * Joins private actual SDK receipts to the current persisted event identities.
 * Neither backend archives nor model answers can supply missing originals.
 * This does not establish execution consent, whole-trial or model exposure.
 */
export async function restoreWorkiqSdkOriginals(options, trial, events) {
    try {
        const { artifactRoot, sdkCaptureDataRoot, scope } = options;
        const owner = await readWorkiqCaptureFile(
            path.dirname(sdkCaptureDataRoot),
            "evaluation-owner.json",
            4096,
        );
        requireSource(owner.owner === scope.ownerId, "foreignWorkiqSdkOwner");
        const policy = await readWorkiqCaptureFile(
            sdkCaptureDataRoot,
            "native-workiq-originals-policy.json",
            64 * 1024,
        );
        const receipt = await readWorkiqCaptureFile(
            artifactRoot,
            path.join("workiq-sdk-originals", trial.sessionId, "receipt.json"),
            256 * 1024,
        );
        assertWorkiqSdkCaptureIdentity(options, trial, policy, receipt);
        const startedAt = Date.parse(receipt.source.startedAt);
        const sessionStart = events.find(
            (event) => event.type === "session.start",
        );
        requireSource(
            sessionStart &&
                startedAt >= Date.parse(sessionStart.timestamp) &&
                startedAt >= Date.parse(policy.createdAt) &&
                startedAt - Date.parse(policy.createdAt) <= 300000 &&
                Number.isSafeInteger(receipt.source.pid) &&
                receipt.source.pid > 0 &&
                /^[a-f0-9]{64}$/u.test(receipt.source.configDigest) &&
                receipt.calls.length === 4,
            "staleWorkiqSdkCapture",
        );
        const store = new PrivateResultStore(artifactRoot);
        const restored = structuredClone(events);
        const seen = new Set();
        for (const call of receipt.calls) {
            const id = call.start.data.toolCallId;
            requireSource(!seen.has(id), "duplicateWorkiqSdkOriginal");
            seen.add(id);
            const starts = restored.filter(
                (event) =>
                    event.type === "tool.execution_start" &&
                    event.data.toolCallId === id,
            );
            const completions = restored.filter(
                (event) =>
                    event.type === "tool.execution_complete" &&
                    event.data.toolCallId === id,
            );
            requireSource(
                starts.length === 1 &&
                    completions.length === 1 &&
                    isDeepStrictEqual(starts[0], call.start) &&
                    isDeepStrictEqual(
                        withoutResult(completions[0]),
                        call.completion,
                    ) &&
                    call.start.agentId === call.completion.agentId &&
                    Date.parse(call.start.timestamp) >= startedAt &&
                    Date.parse(call.completion.timestamp) - startedAt <= 300000,
                "unboundWorkiqSdkOriginal",
            );
            const original = await store.verify(
                call.resultArtifact,
                "run",
                trial.sessionId,
                id,
                "result",
            );
            const completed = completions[0];
            completed.data.result = original;
            requireSource(
                workiqJsonHash({
                    completion: call.completion,
                    resultSha256: call.resultArtifact.sha256,
                }) === call.originalEventSha256,
                "changedWorkiqSdkOriginal",
            );
        }
        return restored;
    } catch (error) {
        if (error instanceof WorkiqEvidenceError) throw error;
        throw new WorkiqEvidenceError(
            "blocked",
            "missingOrUnsafeWorkiqSdkOriginal",
        );
    }
}

export const workiqNativeAdmissionGaps = Object.freeze([
    "source-owned native WorkIQ bootstrap and normal execution-consent lease",
    "proved pre-model binary receipt/delivery boundary",
    "independent current root/child/control route and terminal verdict",
]);

export async function verifyWorkiqNativeProjection(
    proof,
    artifactRoot,
    trace,
    trial,
    events,
) {
    const { assertNativeWorkiqProjection } = await import(
        "./native-workiq-lifecycle.mjs"
    );
    try {
        assertNativeWorkiqProjection(proof);
    } catch {
        throw new WorkiqEvidenceError(
            "blocked",
            "unverifiedWorkiqNativeProjection",
        );
    }
    const raw = await readWorkiqCaptureBytes(
        artifactRoot,
        path.join("traces", `${trial.traceId}.json`),
        1024 * 1024,
    );
    requireSource(
        proof.runIdentityKind === "controller-trial-lease" &&
            trial.runIdentityKind === proof.runIdentityKind &&
            proof.sessionId === trial.sessionId &&
            proof.traceId === trial.traceId &&
            proof.runId === trial.runId &&
            proof.handoffRunId === trial.handoffRunId &&
            createHash("sha256").update(raw).digest("hex") ===
                proof.fullTraceSha256 &&
            isDeepStrictEqual(JSON.parse(raw.toString("utf8")), trace) &&
            (trace.handoffRunId == null ||
                trace.handoffRunId === proof.handoffRunId),
        "foreignWorkiqNativeProjection",
    );
    const ids = proof.workiqToolCallIds;
    const excluded = proof.excludedToolCallIds;
    requireSource(
        Array.isArray(ids) &&
            ids.length === 4 &&
            new Set(ids).size === 4 &&
            Array.isArray(excluded) &&
            new Set(excluded).size === excluded.length &&
            excluded.every((id) => !ids.includes(id)) &&
            trace.toolCalls.length === ids.length + excluded.length &&
            trace.toolCalls.every((call) =>
                [...ids, ...excluded].includes(call.toolCallId),
            ),
        "invalidWorkiqNativePartition",
    );
    const calls = trace.toolCalls.filter((call) =>
        ids.includes(call.toolCallId),
    );
    requireSource(
        isDeepStrictEqual(
            calls.map((call) => call.toolCallId),
            ids,
        ),
        "changedWorkiqNativeCallOrder",
    );
    let projectedEvents;
    if (events) {
        const excludedIds = proof.excludedEventIds;
        const eventIds = new Set(events.map((event) => event.id));
        requireSource(
            Array.isArray(excludedIds) &&
                new Set(excludedIds).size === excludedIds.length &&
                excludedIds.every((id) => eventIds.has(id)) &&
                events
                    .filter((event) => excludedIds.includes(event.id))
                    .every(
                        (event) =>
                            [
                                "tool.execution_start",
                                "tool.execution_complete",
                            ].includes(event.type) &&
                            excluded.includes(event.data?.toolCallId),
                    ),
            "invalidWorkiqNativeControlEvents",
        );
        projectedEvents = events.filter(
            (event) => !excludedIds.includes(event.id),
        );
    }
    return { calls, events: projectedEvents };
}

function freeze(value) {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

async function sourceRecord(options, filename) {
    const { ownedRoot, dataRoot, owner, configPath } = options;
    requireSource(
        path.isAbsolute(ownedRoot) &&
            path.isAbsolute(dataRoot) &&
            path.isAbsolute(configPath) &&
            path.dirname(dataRoot) === ownedRoot,
        "invalidWorkiqNativeContext",
    );
    const marker = await readWorkiqCaptureFile(
        ownedRoot,
        "evaluation-owner.json",
        4096,
    );
    requireSource(marker.owner === owner, "foreignWorkiqNativeOwner");
    const record = await readWorkiqCaptureFile(dataRoot, filename, 1024 * 1024);
    const control = record.source?.control;
    requireSource(
        record.schemaVersion === 1 &&
            record.source.component === "native-workiq-session-v1" &&
            control?.source.owner === owner &&
            control.dataRoot === dataRoot &&
            control.configPath === configPath &&
            control.source.readableOwnedConfig &&
            /^[a-f0-9]{64}$/u.test(control.digest) &&
            Number.isSafeInteger(control.source.pid) &&
            control.source.pid > 0 &&
            Number.isFinite(Date.parse(record.source.processStartedAt)) &&
            Date.parse(record.source.processStartedAt) <=
                Date.parse(record.source.observedAt) &&
            /^[a-z0-9-]{1,128}$/iu.test(record.source.sessionId),
        "unboundWorkiqNativeSource",
    );
    return freeze(record);
}

async function awaitSource(options, filename, predicate) {
    const { deadlineMs, signal } = options;
    requireSource(
        signal === undefined || signal instanceof AbortSignal,
        "invalidWorkiqNativeSignal",
    );
    signal?.throwIfAborted();
    requireSource(
        Number.isFinite(deadlineMs) &&
            deadlineMs > Date.now() &&
            deadlineMs - Date.now() <= 300000,
        "invalidWorkiqNativeDeadline",
    );
    while (Date.now() < deadlineMs) {
        signal?.throwIfAborted();
        try {
            const record = await sourceRecord(options, filename);
            signal?.throwIfAborted();
            if (Date.now() >= deadlineMs) break;
            if (predicate(record)) return record;
        } catch (error) {
            if (!(error?.code === "ENOENT")) throw error;
        }
        await delay(
            Math.min(200, Math.max(0, deadlineMs - Date.now())),
            undefined,
            {
                signal,
            },
        );
    }
    throw new WorkiqEvidenceError("blocked", "workiqNativeSourceTimeout");
}

/**
 * Private source getter, not a readiness/consent brand. The caller must verify
 * physical process/window/service identities and the initialized inventory.
 * First get the actual SID, then bind policy, then requireInitialized.
 */
export function awaitWorkiqNativeSession(options) {
    return awaitSource(options, "native-workiq-session.json", (record) => {
        if (!options.requireInitialized) return true;
        return (
            record.phase === "observing" &&
            record.initialization?.method ===
                "session.tools.initializeAndValidate" &&
            Array.isArray(record.initialization.returnedKeys) &&
            Array.isArray(record.tools?.tools) &&
            Array.isArray(record.registry?.commands) &&
            record.controls?.length === 2 &&
            record.observer?.sessionId === record.source.sessionId
        );
    });
}

export async function awaitWorkiqFinalizedCapture(options) {
    const record = await awaitSource(
        options,
        "native-workiq-finalized.json",
        (value) => value.source.sessionId === options.sessionId,
    );
    requireSource(
        record.summary?.sessionId === options.sessionId &&
            record.summary.traceId &&
            Number.isInteger(record.summary.toolCallCount),
        "foreignWorkiqFinalizedSummary",
    );
    const policy = await readWorkiqCaptureFile(
        options.dataRoot,
        "native-workiq-originals-policy.json",
        64 * 1024,
    );
    requireSource(
        policy.sessionId === options.sessionId &&
            policy.runId === options.runId,
        "foreignWorkiqFinalizedPolicy",
    );
    const tracePath = path.join("traces", `${record.summary.traceId}.json`);
    const receiptPath = path.join(
        "workiq-sdk-originals",
        options.sessionId,
        "receipt.json",
    );
    requireSource(
        record.tracePath === path.join(policy.artifactRoot, tracePath) &&
            record.receiptPath === path.join(policy.artifactRoot, receiptPath),
        "foreignWorkiqFinalizedPaths",
    );
    const traceBytes = await readWorkiqCaptureBytes(
        policy.artifactRoot,
        tracePath,
        1024 * 1024,
    );
    const receiptBytes = await readWorkiqCaptureBytes(
        policy.artifactRoot,
        receiptPath,
        256 * 1024,
    );
    const trace = JSON.parse(traceBytes.toString("utf8"));
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    requireSource(
        record.hashKind === "physical-sha256" &&
            trace.schemaVersion === 2 &&
            trace.sessionId === options.sessionId &&
            trace.toolCalls?.length === record.summary.toolCallCount &&
            createHash("sha256").update(traceBytes).digest("hex") ===
                record.traceSha256 &&
            createHash("sha256").update(receiptBytes).digest("hex") ===
                record.receiptSha256 &&
            receipt.source.sessionId === options.sessionId &&
            receipt.source.traceId === record.summary.traceId &&
            receipt.source.runId === options.runId &&
            receipt.calls.length === 4,
        "unboundWorkiqFinalizedArtifacts",
    );
    return record;
}
