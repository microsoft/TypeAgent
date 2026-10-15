// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
    createNativeWorkiqRuntime,
    createNativeWorkiqEvidenceBoundary,
    resolveNativeWorkiqSignal,
    readNativeWorkiqSessionEvents,
} from "./native-workiq-lifecycle.mjs";
import { createWorkiqNativeController } from "./macro-eval-workiq-controller.mjs";
import { reviewWorkiqDraftContract } from "./macro-eval-workiq-prerequisites.mjs";
import { validateWorkiqAdmission } from "./macro-eval-workiq-evidence.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const persist = (file, value) =>
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
    });
function requirePilot(value, message) {
    if (!value) throw Object.assign(new Error(message), { status: "blocked" });
}

export async function awaitNativeWorkiqWithUi(runtime, controller, promise) {
    let settled = false,
        result,
        failure;
    void promise.then(
        (value) => {
            result = value;
            settled = true;
        },
        (error) => {
            failure = error;
            settled = true;
        },
    );
    while (!settled) {
        runtime.budget.check();
        runtime.budget.check(runtime.events());
        await runtime.handleInteraction(controller);
        await delay(200);
    }
    if (failure) throw failure;
    return result;
}

const withUi = awaitNativeWorkiqWithUi;

export function nativeWorkiqLookupOutcome(events, toolName) {
    const starts = events.filter(
        (event) => event.type === "tool.execution_start",
    );
    requirePilot(
        starts.every((event) => event.data?.toolName === toolName) &&
            starts.length <= 1 &&
            !events.some((event) => /^subagent\./u.test(event.type)),
        "Lookup diagnostic observed additional or delegated SDK dispatch",
    );
    if (!starts.length) {
        requirePilot(
            !events.some((event) => event.type === "tool.execution_complete"),
            "Lookup diagnostic completion has no actual SDK start",
        );
        return undefined;
    }
    const start = starts[0];
    const completions = events.filter(
        (event) =>
            event.type === "tool.execution_complete" &&
            event.data?.toolCallId === start.data?.toolCallId,
    );
    requirePilot(
        completions.length <= 1 &&
            events
                .filter((event) => event.type === "tool.execution_complete")
                .every(
                    (event) =>
                        event.data?.toolCallId === start.data?.toolCallId,
                ) &&
            typeof start.data?.toolCallId === "string" &&
            start.data.toolCallId.length > 0,
        "Lookup diagnostic SDK start/completion identity is ambiguous",
    );
    if (!completions.length) return undefined;
    requirePilot(
        events.indexOf(start) < events.indexOf(completions[0]) &&
            typeof completions[0].data?.success === "boolean",
        "Lookup diagnostic completion precedes its actual SDK start",
    );
    return { start, completion: completions[0] };
}

export async function awaitNativeWorkiqLookupOutcome(
    runtime,
    toolName,
    eventOffset,
    signal,
) {
    while (true) {
        signal.throwIfAborted();
        const outcome = nativeWorkiqLookupOutcome(
            runtime.events().slice(eventOffset),
            toolName,
        );
        if (outcome) return outcome;
        await delay(100, undefined, { signal });
    }
}

export function verifyNativeWorkiqLookupDiagnosticEvidence(
    root,
    scope,
    evidence,
) {
    requirePilot(
        evidence.kind ===
            "workiq-identical-frozen-lookup-diagnostic-evidence-v1" &&
            evidence.admission === false &&
            evidence.nativeAuthority === false &&
            isDeepStrictEqual(evidence.scope, scope) &&
            evidence.maxUpstreamReads === 1 &&
            Array.isArray(evidence.rejections) &&
            Number.isInteger(evidence.upstreamReadsStarted) &&
            evidence.upstreamReadsStarted >= 0 &&
            evidence.upstreamReadsStarted <= 1 &&
            (evidence.upstreamReadsStarted === 0 || evidence.firstRead),
        "Lookup diagnostic source scope/quota/evidence is inconsistent",
    );
    for (const record of [
        ...(evidence.firstRead ? [evidence.firstRead] : []),
        ...evidence.rejections,
    ]) {
        const relative = path.relative(
            fs.realpathSync(root),
            fs.realpathSync(record.auditPath),
        );
        requirePilot(
            relative !== "" &&
                !relative.startsWith("..") &&
                !path.isAbsolute(relative) &&
                sha(fs.readFileSync(record.auditPath)) === record.auditSha256,
            "Lookup diagnostic audit is outside its owned root or changed",
        );
    }
}

function scopeFor(runtime, lease, phase) {
    return {
        ownerId: runtime.layout.owner,
        sessionId: lease.sessionId,
        runId: lease.trialLeaseId,
        phase,
    };
}

async function bindSession(runtime, controller, admission, entityKey, phase) {
    const gateway = await runtime.budget.run(
        controller.startGateway(entityKey),
    );
    const server = admission.runtime.mcpServer;
    const discovery = {
        tools: admission.runtime.advertisedToolSchemas.map((tool) => ({
            advertisedName: tool.advertisedName,
            callableName: `${server}-${tool.advertisedName}`,
            mcpServerName: server,
            inputSchema: tool.inputSchema,
        })),
    };
    const policyPath = path.join(
        runtime.layout.data,
        "native-workiq-originals-policy.json",
    );
    await runtime.openConsole({
        discovery,
        mcpConfiguration: { mcpServers: { [server]: gateway } },
        policyPath,
    });
    const source = await withUi(runtime, controller, runtime.sessionSource());
    const lease = runtime.claimTrial(source, entityKey);
    const scope = scopeFor(runtime, lease, phase);
    persist(policyPath, {
        schemaVersion: 1,
        kind: "workiq-sdk-originals-experimental-v1",
        owner: runtime.layout.owner,
        sessionId: lease.sessionId,
        traceId: null,
        runId: lease.trialLeaseId,
        artifactRoot: path.join(
            runtime.layout.data,
            "profiles",
            runtime.layout.instance,
            "copilot-macros",
        ),
        createdAt: new Date().toISOString(),
        mcpServerName: server,
        tools: discovery.tools.map(
            ({ advertisedName, callableName, inputSchema }) => ({
                advertisedName,
                callableName,
                inputSchema,
            }),
        ),
        exposureOverride: "user-authorized-unverified-model-exposure",
    });
    await runtime.budget.run(
        controller.bindTrial(
            scope,
            entityKey,
            path.join(runtime.layout.run, `agency-${lease.trialLeaseId}`),
        ),
    );
    const initialized = await withUi(
        runtime,
        controller,
        runtime.sessionSource(true),
    );
    runtime.verifyInventory(initialized.tools.tools, discovery);
    await withUi(runtime, controller, controller.assertModelGuidance());
    await withUi(runtime, controller, runtime.sessionEvents());
    return scope;
}

async function documentTrial(runtime, controller, admission, entityKey, phase) {
    const scope = await bindSession(
        runtime,
        controller,
        admission,
        entityKey,
        phase,
    );
    const entity = admission.entities.find((item) => item.key === entityKey);
    requirePilot(entity, "Exact frozen WorkIQ entity missing");
    const arm = await runtime.armRecording(
        entityKey === "A" ? "prepare" : "off",
    );
    requirePilot(
        arm.sessionId === scope.sessionId && arm.status === "armed",
        "Actual recording lease did not arm",
    );
    const startedAt = new Date().toISOString();
    runtime.submit(entity.prompt);
    const finalized = await withUi(
        runtime,
        controller,
        runtime.finalizedCapture(),
    );
    const trial = {
        ...scope,
        traceId: finalized.source.summary.traceId,
        startedAt,
        endedAt: new Date().toISOString(),
    };
    const verdict = await runtime.budget.run(
        controller.verifyCompletedTrial(trial),
    );
    requirePilot(
        verdict.status === "passed",
        "Actual frozen WorkIQ content/identity/originals oracle failed",
    );
    persist(
        path.join(runtime.layout.run, `${phase}-verdict.private.json`),
        verdict,
    );
    return { trial, verdict, finalized };
}

async function reviewPublication(runtime, captured, admission) {
    let state = await runtime.invokeRecordingState();
    while (state.learningJob?.status !== "needsReview") {
        requirePilot(
            !["failed", "cancelled"].includes(state.learningJob?.status),
            "Actual current WorkIQ Prepare failed; no prompt rescue or retry",
        );
        runtime.budget.check(runtime.events());
        await delay(300);
        state = await runtime.invokeRecordingState();
    }
    const job = state.learningJob;
    requirePilot(
        job.traceId === captured.trial.traceId &&
            job.sessionId === captured.trial.sessionId &&
            job.mode === "prepare" &&
            state.trace.traceId === captured.trial.traceId &&
            job.cwd === path.resolve(runtime.layout.workspace).toLowerCase(),
        "WorkIQ draft does not belong to actual current A Prepare",
    );
    const draft = await runtime.inspect(job.macro);
    const validation = await runtime.validate(job.macro);
    requirePilot(
        validation.valid,
        "Actual WorkIQ product draft validation failed",
    );
    const boundary = await createNativeWorkiqEvidenceBoundary(
        runtime,
        captured.trial,
    );
    const review = reviewWorkiqDraftContract({
        draft,
        trace: read(captured.finalized.source.tracePath),
        discovery: await boundary.readNativeDiscovery(),
        admission,
    });
    requirePilot(
        draft.learning?.jobId === job.jobId &&
            draft.sourceTraceId === captured.trial.traceId,
        "Current WorkIQ draft source/job binding changed",
    );
    persist(path.join(runtime.layout.run, "reviewed-draft.private.json"), {
        draft,
        validation,
        review,
    });
    const approved = await runtime.approve(job.macro);
    requirePilot(
        approved.version === 2,
        "Expected actual first immutable version2 publication",
    );
    persist(path.join(runtime.layout.run, "publication.json"), approved);
    return approved;
}

/** User-authorized unrecorded experiment; no general permission or assurance override. */
export async function runNativeWorkiqPilot({
    output,
    config,
    admissionFile,
    admissionSha256,
    signal = resolveNativeWorkiqSignal(),
}) {
    const startedAtMs = Date.now();
    const bytes = fs.readFileSync(admissionFile);
    requirePilot(
        sha(bytes) === admissionSha256,
        "Frozen WorkIQ admission bytes changed",
    );
    const admission = JSON.parse(bytes);
    validateWorkiqAdmission(admission);
    const runtime = await createNativeWorkiqRuntime({ output, config, signal });
    const report = {
        kind: "native-workiq-functional-experiment-v1",
        exposureAssurance: "unverified-user-authorized",
        status: "blocked",
        stages: [],
        cleanupErrors: [],
        admissionSha256,
        evaluationContract: structuredClone(
            admission.evaluationContract ?? null,
        ),
    };
    let controller;
    try {
        persist(
            path.join(runtime.layout.run, "evaluation-contract-manifest.json"),
            {
                kind: "native-workiq-evaluation-contract-lineage-v1",
                admissionSha256,
                evaluationContract: report.evaluationContract,
                budgetAuthorization: config.budgetAuthorization ?? null,
            },
        );
        await runtime.startService();
        await runtime.learningPreference("prepare");
        controller = await createWorkiqNativeController({
            runtime,
            admission,
            signal,
        });
        const captured = await documentTrial(
            runtime,
            controller,
            admission,
            "A",
            "capture-a",
        );
        report.stages.push({
            phase: "capture-a",
            trial: captured.trial,
            verdict: captured.verdict,
        });
        report.publication = await reviewPublication(
            runtime,
            captured,
            admission,
        );
        await controller.close();
        controller = undefined;
        await runtime.closeConsole();
        await runtime.learningPreference("off");
        controller = await createWorkiqNativeController({
            runtime,
            admission,
            signal,
        });
        const reused = await documentTrial(
            runtime,
            controller,
            admission,
            "B",
            "reuse-b",
        );
        report.stages.push({
            phase: "reuse-b",
            trial: reused.trial,
            verdict: reused.verdict,
        });
        report.status = "passed";
        report.restart = "budget-not-ready";
        if (
            runtime.budget.remaining() >= 60000 &&
            runtime.budget.used() <= 15
        ) {
            const before = await runtime.inspect(report.publication);
            await controller.close();
            controller = undefined;
            await runtime.closeConsole();
            await runtime.stopService();
            await runtime.startService();
            runtime.verifyPinnedMacro(
                await runtime.inspect(report.publication),
                before,
            );
            controller = await createWorkiqNativeController({
                runtime,
                admission,
                signal,
            });
            const restarted = await documentTrial(
                runtime,
                controller,
                admission,
                "B",
                "restart-b",
            );
            report.stages.push({
                phase: "restart-b",
                trial: restarted.trial,
                verdict: restarted.verdict,
            });
            report.restart = "accepted-actual-owned-service-restart";
        }
    } catch (error) {
        report.status = "blocked";
        report.failure = {
            name: error.name,
            message: error.message,
            status: error.status ?? "blocked",
            observedAt: new Date().toISOString(),
            sdkToolName: error.sdkToolName,
            sdkErrorCode: error.sdkErrorCode,
            sdkReasonCode: error.sdkReasonCode,
            sdkEventId: error.sdkEventId,
        };
    } finally {
        for (const cleanup of [
            () => controller?.close(),
            () => runtime.closeConsole(),
            () => runtime.stopService(),
            () => {
                report.cleanup = runtime.verifyCleanup();
            },
        ])
            try {
                await cleanup();
            } catch (error) {
                report.cleanupErrors.push(error.message);
            }
        report.targetModelTurns = runtime.budget.used();
        report.elapsedMs = Date.now() - startedAtMs;
        report.slotReleased = report.cleanupErrors.length === 0;
        if (report.cleanupErrors.length) report.status = "blocked";
        persist(path.join(runtime.layout.run, "result.private.json"), report);
    }
    return report;
}

export function assertNativeWorkiqLookupRecordingArm(
    token,
    sessionId,
    now = Date.now(),
) {
    requirePilot(
        typeof token?.id === "string" &&
            token.id.length > 0 &&
            token.sessionId === sessionId &&
            token.status === "armed" &&
            (token.learning === undefined || token.learning === false) &&
            Number.isFinite(Date.parse(token.expiresAt)) &&
            Date.parse(token.expiresAt) > now,
        "Lookup diagnostic requires its actual current non-learning recording arm",
    );
}

export async function runNativeWorkiqLookupDiagnostic({
    output,
    config,
    admissionFile,
    admissionSha256,
    signal = resolveNativeWorkiqSignal(),
}) {
    const startedAtMs = Date.now();
    const bytes = fs.readFileSync(admissionFile);
    requirePilot(
        sha(bytes) === admissionSha256,
        "Frozen WorkIQ admission bytes changed",
    );
    const admission = JSON.parse(bytes);
    validateWorkiqAdmission(admission);
    const entity = admission.entities.find((item) => item.key === "A");
    const retrieve = admission.runtime.advertisedToolSchemas.find(
        (tool) => tool.advertisedName === "retrieve",
    );
    requirePilot(
        entity && retrieve,
        "Frozen A lookup diagnostic source missing",
    );
    const runtime = await createNativeWorkiqRuntime({ output, config, signal });
    const observationAbort = new AbortController();
    const report = {
        kind: "native-workiq-identical-frozen-lookup-diagnostic-v1",
        modelRoles: {
            configuredRoot: config.rootModel,
            observed: "unknown; event labels are not role certification",
        },
        status: "blocked",
        admission: false,
        fullTrialAccepted: false,
        maxUpstreamReads: 1,
        admissionSha256,
        evaluationContract: structuredClone(
            admission.evaluationContract ?? null,
        ),
        sdkResultSourceDeliveryVerified: false,
        cleanupErrors: [],
        evidenceErrors: [],
    };
    let controller, scope;
    try {
        persist(
            path.join(runtime.layout.run, "evaluation-contract-manifest.json"),
            {
                kind: report.kind,
                admissionSha256,
                evaluationContract: report.evaluationContract,
                maxUpstreamReads: 1,
                budgetAuthorization: config.budgetAuthorization ?? null,
            },
        );
        await runtime.startService();
        await runtime.learningPreference("off");
        controller = await createWorkiqNativeController({
            runtime,
            admission,
            signal,
            lookupOnlyDiagnostic: true,
        });
        scope = await bindSession(
            runtime,
            controller,
            admission,
            "A",
            "capture-a",
        );
        report.scope = scope;
        report.recordingArm = await runtime.armRecording("off");
        assertNativeWorkiqLookupRecordingArm(
            report.recordingArm,
            scope.sessionId,
        );
        const eventOffset = runtime.events().length;
        runtime.budget.check();
        runtime.submit(entity.prompt);
        const outcome = await withUi(
            runtime,
            controller,
            awaitNativeWorkiqLookupOutcome(
                runtime,
                `${admission.runtime.mcpServer}-${retrieve.advertisedName}`,
                eventOffset,
                AbortSignal.any([signal, observationAbort.signal]),
            ),
        );
        await runtime.sessionSource(true);
        report.sdkOutcome = outcome;
        report.status = "observed-first-sdk-lookup-outcome";
    } catch (error) {
        report.failure = {
            name: error.name,
            message: error.message,
            observedAt: new Date().toISOString(),
            sdkToolName: error.sdkToolName,
            sdkErrorCode: error.sdkErrorCode,
            sdkReasonCode: error.sdkReasonCode,
            sdkEventId: error.sdkEventId,
        };
    } finally {
        observationAbort.abort();
        for (const cleanup of [
            () => controller?.close(),
            async () => {
                if (scope)
                    report.recordingRelease = await runtime.cancelRecording();
            },
            () => runtime.closeConsole(),
            () => runtime.stopService(),
            () => {
                report.cleanup = runtime.verifyCleanup();
            },
        ])
            try {
                await cleanup();
            } catch (error) {
                report.cleanupErrors.push(error.message);
            }
        for (const collect of [
            async () => {
                if (controller)
                    report.sourceEvidence =
                        await controller.lookupDiagnosticEvidence();
                if (scope && report.sourceEvidence) {
                    verifyNativeWorkiqLookupDiagnosticEvidence(
                        runtime.layout.run,
                        scope,
                        report.sourceEvidence,
                    );
                    report.sourceAuditVerified = true;
                }
                const token = report.recordingRelease?.before?.token;
                if (token && report.recordingArm)
                    requirePilot(
                        token.id === report.recordingArm.id &&
                            token.sessionId === scope.sessionId &&
                            (token.learning === undefined ||
                                token.learning === false),
                        "Lookup diagnostic recording release has a foreign or learning-enabled token",
                    );
            },
            () => {
                if (!scope) return;
                const eventsFile = path.join(
                    runtime.layout.run,
                    "home-0",
                    "session-state",
                    scope.sessionId,
                    "events.jsonl",
                );
                const events = readNativeWorkiqSessionEvents(
                    path.join(runtime.layout.run, "home-0"),
                    { sessionId: scope.sessionId, required: true },
                );
                report.sdkEvents = {
                    path: eventsFile,
                    sha256: sha(fs.readFileSync(eventsFile)),
                    assistantTurnStarts: events.filter(
                        (event) => event.type === "assistant.turn_start",
                    ).length,
                    modelApiStarts: events.filter(
                        (event) => event.type === "model.model_call_started",
                    ).length,
                    hostUserMessages: events.filter(
                        (event) => event.type === "user.message",
                    ).length,
                    toolStarts: events.filter(
                        (event) => event.type === "tool.execution_start",
                    ),
                    toolCompletions: events.filter(
                        (event) => event.type === "tool.execution_complete",
                    ),
                    subagentEvents: events.filter((event) =>
                        /^subagent\./u.test(event.type),
                    ),
                };
                const first = report.sdkEvents.toolStarts.find(
                    (event) =>
                        event.data?.toolName ===
                        `${admission.runtime.mcpServer}-${retrieve.advertisedName}`,
                );
                report.sdkRequestMatchesProvider =
                    Boolean(first && report.sourceEvidence?.firstRead) &&
                    isDeepStrictEqual(
                        first.data.arguments,
                        report.sourceEvidence.firstRead.call.arguments,
                    );
                if (report.sourceEvidence?.upstreamReadsStarted === 1)
                    requirePilot(
                        report.sdkRequestMatchesProvider,
                        "Lookup diagnostic provider request has no exact actual SDK source join",
                    );
            },
        ])
            try {
                await collect();
            } catch (error) {
                report.evidenceErrors.push(error.message);
            }
        report.targetModelTurns = runtime.budget.used();
        report.elapsedMs = Date.now() - startedAtMs;
        report.slotReleased = Boolean(report.cleanup);
        if (report.cleanupErrors.length || report.evidenceErrors.length)
            report.status = "blocked";
        persist(path.join(runtime.layout.run, "result.private.json"), report);
    }
    return report;
}
