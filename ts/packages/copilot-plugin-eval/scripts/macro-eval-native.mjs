// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import { createRequire, isBuiltin } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { documentFamilyId, getScenarioCases } from "./macro-eval-corpus.mjs";
import { gradeDocumentTrial } from "./macro-eval-grade.mjs";
import * as macroGradeContract from "./macro-eval-grade.mjs";
import {
    stageNativeNormalHook,
    startNativeNormalHookReader,
} from "./macro-eval-native-bridge.mjs";
import {
    validateApprovedCatalogConfig,
    verifyApprovedCatalogSource,
    ownApprovedCatalogPhase,
    verifyApprovedVersionUnchanged,
} from "./macro-eval-native-approved.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const tsRoot = path.resolve(scripts, "..", "..", "..");
const rootEvent = (event) => !event.agentId && !event.data?.parentToolCallId;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (file) =>
    JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
const writeJson = (file, value) =>
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
    });

export class NativeStop extends Error {
    constructor(message, status = "harness-invalid") {
        super(message);
        this.status = status;
    }
}

export function completeNativeRestrictionReadiness(
    state,
    diagnostic,
    controlProofs,
    sessionId,
) {
    const initialization = diagnostic.toolInitialization;
    if (
        !state ||
        state.phase !== "initializing" ||
        diagnostic.sessionId !== sessionId ||
        initialization?.method !== "session.tools.initializeAndValidate" ||
        initialization.sessionId !== sessionId ||
        !Array.isArray(initialization.returnedKeys) ||
        initialization.returnedKeys.length !== 0 ||
        !Number.isFinite(Date.parse(initialization.startedAt)) ||
        Date.parse(initialization.startedAt) < Date.parse(state.startedAt) ||
        Date.parse(initialization.completedAt) <
            Date.parse(initialization.startedAt) ||
        !Number.isFinite(Date.parse(initialization.completedAt)) ||
        Date.parse(initialization.completedAt) > Date.now() ||
        state.warnings.some(
            (warning) =>
                !Number.isFinite(Date.parse(warning.firstObservedAt)) ||
                Date.parse(warning.firstObservedAt) >
                    Date.parse(initialization.startedAt),
        ) ||
        controlProofs.length !== 4 ||
        !controlProofs.every((proof) => proof.passed === true)
    )
        throw new NativeStop(
            "Current runtime initialization/session/owned controls are unproved",
            "blocked",
        );
    if (
        diagnostic.status !== "passed-metadata-only" &&
        !(
            state.warnings.length > 0 &&
            diagnostic.status === "blocked" &&
            diagnostic.error ===
                "Read-only SDK inventory and pure controls collected; native restriction warnings remain unresolved"
        )
    )
        throw new NativeStop(
            "Native metadata diagnostic failed beyond retained startup warnings",
            "blocked",
        );
    const catalog = verifyNativeFixtureCatalogs(diagnostic);
    state.phase = "verified";
    state.proof = {
        kind: "native-effective-tools-readiness-v1",
        sessionId,
        observedAt: new Date().toISOString(),
        initialization,
        catalog,
        retainedStartupWarnings: state.warnings,
        semantics:
            "Current runtime list initialized/validated and five unfiltered source/schema inventories proved after startup. Retained earlier warning strings are not a current-policy oracle; other/new selector warnings still reject. Availability is not execution permission.",
    };
    return state.proof;
}

export function validateNativeConfig(config, corpus) {
    const allowed = new Set([
        "cliExecutable",
        "cliVersion",
        "configDirectory",
        "port",
        "rootModel",
        "runnerModel",
        "maxTargetModelTurns",
        "maxDurationMs",
        "trainingCase",
        "reuseCase",
        "restart",
        "approveSyntheticReadsOnce",
        "reviewSyntheticDraft",
        "executionPath",
        "diagnosticOnly",
        "extensionMode",
        "attributionOnly",
        "retainSyntheticLearningResponses",
        "renderingContract",
        "approvedCatalog",
    ]);
    if (!config || typeof config !== "object" || Array.isArray(config))
        throw new Error("Native configuration must be an object");
    for (const name of Object.keys(config))
        if (!allowed.has(name))
            throw new Error(`Unsupported native option: ${name}`);
    for (const name of ["cliExecutable", "configDirectory"])
        if (typeof config[name] !== "string" || !path.isAbsolute(config[name]))
            throw new Error(`${name} must be an explicit absolute path`);
    if (!/\.exe$/iu.test(config.cliExecutable))
        throw new Error(
            "Native CLI must be a pinned executable, not a shell shim",
        );
    if (!["1.0.89", "1.0.95"].includes(config.cliVersion))
        throw new NativeStop(
            "Only explicitly configured native CLI 1.0.89 or 1.0.95 is admitted",
            "blocked",
        );
    if (config.executionPath !== undefined && config.executionPath !== "direct")
        throw new NativeStop(
            "Caller/MCP scoring is blocked: the grader route schema cannot represent an explicit MCP macro invocation without a grammar hit",
            "blocked",
        );
    if (
        config.runnerModel !== "gpt-6-luna" ||
        typeof config.rootModel !== "string" ||
        !/^[a-z0-9][a-z0-9._-]*$/iu.test(config.rootModel)
    )
        throw new Error(
            "Explicit rootModel and host runnerModel gpt-6-luna required",
        );
    for (const [name, maximum] of [
        ["port", 65535],
        ["maxTargetModelTurns", 1000],
        ["maxDurationMs", 3600000],
    ])
        if (
            !Number.isInteger(config[name]) ||
            config[name] <
                (name === "maxTargetModelTurns" &&
                config.diagnosticOnly === true
                    ? 0
                    : 1) ||
            config[name] > maximum
        )
            throw new Error(
                `${name} must be an integer between 1 and ${maximum}`,
            );
    validateDiagnosticBounds(config);
    validateLearningDiagnosticBounds(config);
    validateNativeScoringConfig(config, corpus);
    validateNativeApprovedPhaseConfig(config);
    for (const name of [
        "restart",
        "approveSyntheticReadsOnce",
        "reviewSyntheticDraft",
    ])
        if (typeof config[name] !== "boolean")
            throw new Error(`Explicit boolean ${name} required`);
    return selectNativeCases(config, corpus);
}

function validateNativeScoringConfig(config, corpus) {
    nativeScoringDeclaration(config);
    if (
        config.renderingContract?.protocolVersion ===
        "synthetic-document-similarity-v5"
    )
        macroGradeContract.validateSyntheticDocumentScoringContract(
            config.renderingContract,
            corpus,
        );
}

function validateNativeApprovedPhaseConfig(config) {
    if (config.approvedCatalog === undefined) return;
    validateApprovedCatalogConfig(config.approvedCatalog);
    if (
        config.restart !== true ||
        config.diagnosticOnly ||
        config.attributionOnly ||
        config.retainSyntheticLearningResponses !== false ||
        config.renderingContract?.protocolVersion !==
            "synthetic-document-similarity-v5" ||
        config.maxTargetModelTurns > 20 ||
        config.maxDurationMs > 300000
    )
        throw new NativeStop(
            "Approved catalog phase requires normal diagnostics-off bounded v5 reuse and restart",
            "blocked",
        );
}

export function nativeScoringDeclaration(config) {
    const contract = config.renderingContract;
    if (contract === undefined)
        return { protocol: "macro-native-rehearsal-v1" };
    if (contract?.protocolVersion === "synthetic-document-similarity-v5") {
        macroGradeContract.validateSyntheticRenderingContract(contract);
        return {
            protocol: "macro-native-rehearsal-v5",
            renderingContract: structuredClone(contract),
        };
    }
    if (
        !contract ||
        typeof contract !== "object" ||
        Array.isArray(contract) ||
        !isDeepStrictEqual(Object.keys(contract).sort(), [
            "fixtureShape",
            "protocolVersion",
        ]) ||
        ![
            "synthetic-document-rendering-v2",
            "synthetic-document-rendering-v3",
            "synthetic-document-rendering-v4",
        ].includes(contract.protocolVersion) ||
        contract.fixtureShape !== "synthetic-prose-lines-v1"
    )
        throw new Error(
            "Explicit exact synthetic-document-rendering-v2, synthetic-document-rendering-v3 or synthetic-document-rendering-v4 contract and synthetic-prose-lines-v1 fixtureShape required",
        );
    return {
        protocol: {
            "synthetic-document-rendering-v2": "macro-native-rehearsal-v2",
            "synthetic-document-rendering-v3": "macro-native-rehearsal-v3",
            "synthetic-document-rendering-v4": "macro-native-rehearsal-v4",
        }[contract.protocolVersion],
        renderingContract: { ...contract },
    };
}

function validateLearningDiagnosticBounds(config) {
    if (
        config.retainSyntheticLearningResponses !== undefined &&
        typeof config.retainSyntheticLearningResponses !== "boolean"
    )
        throw new Error("retainSyntheticLearningResponses must be boolean");
    if (
        config.retainSyntheticLearningResponses &&
        (config.diagnosticOnly ||
            config.attributionOnly ||
            config.restart ||
            config.maxTargetModelTurns > 20 ||
            config.maxDurationMs > 300000)
    )
        throw new Error(
            "Private synthetic learning diagnostics require a full max20/300000ms rehearsal without restart",
        );
}

function validateDiagnosticBounds(config) {
    if (
        config.attributionOnly !== undefined &&
        (config.attributionOnly !== true ||
            config.diagnosticOnly ||
            config.restart ||
            config.maxTargetModelTurns > 20 ||
            config.maxDurationMs > 300000)
    )
        throw new Error(
            "Attribution rehearsal requires explicit max20/300000ms, no diagnostic or restart",
        );
    if (config.extensionMode !== "load_only")
        throw new Error("Only explicit extensionMode load_only is supported");
    if (
        config.diagnosticOnly !== undefined &&
        typeof config.diagnosticOnly !== "boolean"
    )
        throw new Error("diagnosticOnly must be boolean");
    if (
        config.diagnosticOnly &&
        (config.maxTargetModelTurns !== 0 ||
            config.maxDurationMs > 180000 ||
            config.restart)
    )
        throw new Error(
            "Diagnostic startup requires zero model turns, at most 180000ms and no restart",
        );
}

function selectNativeCases(config, corpus) {
    const cases = getScenarioCases(corpus);
    const training = cases.find((item) => item.id === config.trainingCase);
    const reuse = cases.find((item) => item.id === config.reuseCase);
    for (const [item, kind] of [
        [training, "training"],
        [reuse, "positive"],
    ])
        if (
            !item ||
            item.kind !== kind ||
            item.familyId !== documentFamilyId ||
            ["pending", "blocked", "blocked-not-accepted"].includes(item.status)
        )
            throw new NativeStop(
                "Native rehearsal requires implemented training and positive document cases",
                "blocked",
            );
    if (training.expectedDocument === reuse.expectedDocument)
        throw new Error("Reuse must change the training document binding");
    for (const item of [training, reuse])
        if (!/^[\x20-\x7e]{1,2000}$/u.test(item.prompt))
            throw new NativeStop(
                "Console helper supports only single-line ASCII prompts up to 2000 characters",
                "blocked",
            );
    return { training, reuse };
}

export function readNativeJsonl(file) {
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, "utf8");
    // The CLI may be writing the last record. Never parse or manufacture it.
    return text
        .slice(0, text.lastIndexOf("\n") + 1)
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function requireCapture(condition, message) {
    if (!condition)
        throw new NativeStop(
            `Finalized selected source: ${message}`,
            "blocked",
        );
}

function selectedTraceFile(layout, summary) {
    requireCapture(
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(
            summary?.traceId ?? "",
        ),
        "missing exact finalized trace identity",
    );
    requireCapture(
        readJson(path.join(layout.run, "evaluation-owner.json")).owner ===
            layout.owner,
        "owned root identity mismatch",
    );
    const file = path.join(
        layout.data,
        "profiles",
        layout.instance,
        "copilot-macros",
        "traces",
        `${summary.traceId}.json`,
    );
    requireCapture(
        fs.existsSync(file) &&
            !fs.lstatSync(file).isSymbolicLink() &&
            fs.realpathSync(file) === file &&
            fs.statSync(file).size <= 1024 * 1024,
        "trace is missing, linked, relocated or exceeds the product bound",
    );
    return file;
}

function selectedTraceNative(events, prompt) {
    const users = events.filter(
        (event) =>
            rootEvent(event) &&
            event.type === "user.message" &&
            event.data?.content === prompt,
    );
    const answers = events.filter(
        (event) =>
            rootEvent(event) &&
            event.type === "assistant.message" &&
            typeof event.data?.content === "string" &&
            !event.data?.toolRequests?.length,
    );
    requireCapture(
        users.length === 1 && answers.length === 1,
        "current root prompt/answer missing or ambiguous",
    );
    const terminals = events.filter(
        (event) =>
            rootEvent(event) &&
            event.type === "assistant.turn_end" &&
            answers[0].data.turnId !== undefined &&
            event.data?.turnId === answers[0].data.turnId,
    );
    requireCapture(terminals.length === 1, "current root terminal missing");
    const index = (event) => events.indexOf(event);
    requireCapture(
        linked(events, index(users[0]), index(answers[0])) &&
            linked(events, index(answers[0]), index(terminals[0])),
        "root completion is not causally linked",
    );
    return { user: users[0], answer: answers[0], terminal: terminals[0] };
}

function projectedSdkEvent(original, persisted) {
    const projected = structuredClone(original);
    if (projected.ephemeral === false && persisted.ephemeral === undefined)
        delete projected.ephemeral;
    if (projected.type === "tool.execution_complete") {
        for (const field of ["detailedContent", "contents"])
            if (!Object.hasOwn(persisted.data.result ?? {}, field))
                delete projected.data.result?.[field];
    }
    return projected;
}

export function mergeNativeSyntheticOriginals(events, rows, binding) {
    const calls = new Set(
        events
            .filter(
                (event) =>
                    event.type === "tool.execution_start" &&
                    rootEvent(event) &&
                    event.data?.mcpServerName === "macro-eval-docs",
            )
            .map((event) => event.data.toolCallId),
    );
    const selected = events.filter(
        (event) =>
            ["tool.execution_start", "tool.execution_complete"].includes(
                event.type,
            ) &&
            rootEvent(event) &&
            calls.has(event.data?.toolCallId),
    );
    const replacements = new Map();
    for (const persisted of selected) {
        const candidates = rows.filter((row) => row.event?.id === persisted.id);
        requireCapture(
            candidates.length === 1,
            "actual SDK original event missing/duplicated",
        );
        const original = candidates[0];
        requireCapture(
            original.schemaVersion === 1 &&
                original.owner === binding.owner &&
                original.sessionId === binding.sessionId &&
                isDeepStrictEqual(original.source, binding.source) &&
                Date.parse(original.observedAt) >=
                    Date.parse(binding.startedAt) &&
                Date.parse(original.observedAt) <= Date.now() &&
                isDeepStrictEqual(
                    projectedSdkEvent(original.event, persisted),
                    persisted,
                ),
            "SDK original actor/session/current native projection disagreement",
        );
        replacements.set(persisted.id, original.event);
    }
    return events.map((event) => replacements.get(event.id) ?? event);
}

function nativeSdkOriginalEvents(context, sessionId, events) {
    if (!context.sdkOriginalsBinding) return events;
    const file = path.join(
        context.data,
        "native-sdk-originals",
        `${sessionId}.jsonl`,
    );
    requireCapture(
        context.sdkOriginalsBinding.file === file &&
            !fs.existsSync(`${file}.failed.json`) &&
            fs.existsSync(file) &&
            fs.realpathSync(file) === file &&
            fs.lstatSync(file).isFile() &&
            fs.statSync(file).nlink === 1 &&
            fs.statSync(file).size <= 2 * 1024 * 1024,
        "owned SDK original journal unavailable/linked/failed",
    );
    return mergeNativeSyntheticOriginals(events, readNativeJsonl(file), {
        ...context.sdkOriginalsBinding,
        owner: context.owner,
        sessionId,
    });
}

function verifySelectedTraceCall(call, events, redactTraceValue) {
    const starts = events.filter(
        (event) =>
            event.type === "tool.execution_start" &&
            event.data?.toolCallId === call.toolCallId,
    );
    const ends = events.filter(
        (event) =>
            event.type === "tool.execution_complete" &&
            event.data?.toolCallId === call.toolCallId,
    );
    requireCapture(
        starts.length === 1 &&
            ends.length === 1 &&
            rootEvent(starts[0]) &&
            rootEvent(ends[0]) &&
            ends[0].data.success === true &&
            linked(events, events.indexOf(starts[0]), events.indexOf(ends[0])),
        "exact successful root tool pair missing",
    );
    const start = starts[0].data;
    requireCapture(
        call.status === "completed" &&
            call.name === start.toolName &&
            call.mcpServerName === "macro-eval-docs" &&
            start.mcpServerName === "macro-eval-docs" &&
            isDeepStrictEqual(
                call.arguments,
                redactTraceValue(start.arguments),
            ) &&
            isDeepStrictEqual(
                call.result,
                redactTraceValue(ends[0].data.result),
            ) &&
            call.resultArtifact === undefined &&
            call.modelResultArtifact === undefined,
        "tool source, arguments or full original result disagree",
    );
}

function selectedTraceIdentity(trace, summary, layout, sessionId) {
    return (
        trace.schemaVersion === 1 &&
        trace.capabilities === undefined &&
        trace.handoffRunId === undefined &&
        trace.traceId === summary.traceId &&
        trace.sessionId === sessionId &&
        summary.sessionId === sessionId &&
        trace.cwd === layout.workspace &&
        trace.createdAt === summary.createdAt
    );
}

function selectedTraceTiming(trace, native) {
    return (
        trace.startedAt === native.user.timestamp &&
        Date.parse(trace.completedAt) >= Date.parse(trace.startedAt) &&
        Date.parse(trace.completedAt) <=
            Date.parse(native.terminal.timestamp) &&
        Date.parse(trace.createdAt) >= Date.parse(trace.completedAt) &&
        Date.parse(trace.createdAt) <= Date.now()
    );
}

function stableSelectedTrace(layout, snapshot, service) {
    requireCapture(
        snapshot?.state?.status === "completed",
        "actual completed RPC snapshot missing",
    );
    const file = selectedTraceFile(layout, snapshot.state.trace);
    const handle = fs.openSync(file, "r");
    let bytes, before, after;
    try {
        before = fs.fstatSync(handle);
        bytes = fs.readFileSync(handle);
        after = fs.fstatSync(handle);
    } finally {
        fs.closeSync(handle);
    }
    const current = fs.statSync(file);
    requireCapture(
        ["ino", "dev", "size", "mtimeMs", "ctimeMs"].every(
            (key) => before[key] === after[key] && after[key] === current[key],
        ) && bytes.length === before.size,
        "trace file changed during read",
    );
    return {
        state: snapshot.state,
        stateObservedAt: snapshot.observedAt,
        observedAt: new Date().toISOString(),
        file: {
            path: file,
            sha256: hash(bytes),
            sizeBytes: before.size,
            mtimeMs: before.mtimeMs,
            ctimeMs: before.ctimeMs,
            ino: before.ino,
            dev: before.dev,
        },
        trace: JSON.parse(bytes.toString("utf8")),
        source: {
            owner: layout.owner,
            instanceDir: path.join(layout.data, "profiles", layout.instance),
            dataRoot: layout.data,
            service,
        },
    };
}

export function bindNativeFinalizedSourceReader({ sessionId, tokenId, load }) {
    requireCapture(
        typeof sessionId === "string" &&
            sessionId.length > 0 &&
            typeof tokenId === "string" &&
            tokenId.length > 0 &&
            typeof load === "function",
        "bound current lease and loader required",
    );
    const verified = load();
    return (target) => {
        requireCapture(
            target?.sessionId === sessionId &&
                target.tokenId === tokenId &&
                Object.keys(target).length === 2,
            "loader target differs from its actual selected lease",
        );
        const current = load();
        requireCapture(
            isDeepStrictEqual(current.file, verified.file) &&
                isDeepStrictEqual(current.state.trace, verified.state.trace),
            "finalized source changed after verification",
        );
        return {
            observedAt: verified.observedAt,
            state: verified.state,
            trace: verified.trace,
            storeRoot: path.join(verified.source.instanceDir, "copilot-macros"),
            file: {
                path: verified.file.path,
                sha256: verified.file.sha256,
            },
        };
    };
}

// A local source audit, not a grading receipt or a substitute for its branded callback.
export async function verifyNativeFinalizedCapture({
    layout,
    state,
    events,
    scenario,
    sessionId,
}) {
    requireCapture(state?.status === "completed", "recording is not finalized");
    const file = selectedTraceFile(layout, state.trace);
    const bytes = fs.readFileSync(file);
    const trace = JSON.parse(bytes.toString("utf8"));
    const { redactTraceValue } = await import(
        pathToFileURL(
            path.join(
                tsRoot,
                "packages",
                "copilot-macros",
                "dist",
                "redaction.js",
            ),
        )
    );
    const { ExtensionTraceAssembler } = await import(
        pathToFileURL(
            path.join(
                tsRoot,
                "packages",
                "copilot-plugin",
                "dist",
                "extension",
                "trace-assembler.js",
            ),
        )
    );
    const assembler = new ExtensionTraceAssembler(
        sessionId,
        layout.workspace,
        true,
    );
    for (const event of events) assembler.record(event);
    const assembled = assembler.finish(hash(redactTraceValue(scenario.prompt)));
    const { traceId: _traceId, createdAt: _createdAt, ...storedTrace } = trace;
    requireCapture(
        assembled !== undefined &&
            isDeepStrictEqual(storedTrace, redactTraceValue(assembled)),
        "stored source differs from the product assembler's actual current events",
    );
    const native = selectedTraceNative(events, scenario.prompt);
    requireCapture(
        selectedTraceIdentity(trace, state.trace, layout, sessionId) &&
            selectedTraceTiming(trace, native) &&
            trace.prompt === redactTraceValue(scenario.prompt) &&
            trace.response ===
                redactTraceValue(
                    events
                        .filter(
                            (event) =>
                                rootEvent(event) &&
                                event.type === "assistant.message" &&
                                typeof event.data?.content === "string",
                        )
                        .map((event) => event.data.content)
                        .join(""),
                ),
        "trace identity, workspace, full response or current timing mismatch",
    );
    requireCapture(
        Array.isArray(trace.toolCalls) &&
            trace.toolCalls.length === 2 &&
            state.trace.toolCallCount === 2 &&
            events.filter((event) => event.type === "tool.execution_start")
                .length === 2 &&
            new Set(trace.toolCalls.map((call) => call.toolCallId)).size ===
                2 &&
            isDeepStrictEqual(
                trace.toolCalls.map((call) => call.name),
                [
                    "macro-eval-docs-lookup_document",
                    "macro-eval-docs-fetch_document",
                ],
            ),
        "exact two-call selected source required",
    );
    for (const call of trace.toolCalls)
        verifySelectedTraceCall(call, events, redactTraceValue);
    return {
        kind: "native-finalized-synthetic-source-audit-v1",
        admission: false,
        traceFile: file,
        sha256: hash(bytes),
        summary: state.trace,
        native: {
            rootUserEventId: native.user.id,
            answerEventId: native.answer.id,
            terminalEventId: native.terminal.id,
            toolCallIds: trace.toolCalls.map((call) => call.toolCallId),
        },
        trace,
    };
}

function linked(events, from, to) {
    const indexes = new Map(events.map((event, index) => [event.id, index]));
    let index = to;
    while (index > from) {
        const previous = indexes.get(events[index].parentId);
        if (previous === undefined || previous >= index) return false;
        index = previous;
    }
    return index === from;
}

export function extractNativeEvidence(
    events,
    backendAudit,
    routes = [],
    mode = "direct",
) {
    const answerIndex = events.findLastIndex(
        (event) =>
            event.type === "assistant.message" &&
            rootEvent(event) &&
            typeof event.data?.content === "string" &&
            event.data.content.trim() &&
            (!event.data.toolRequests || event.data.toolRequests.length === 0),
    );
    const answerEvent = events[answerIndex];
    const answer = answerEvent?.data.content ?? "";
    const starts = events.filter(
        (event) => event.type === "tool.execution_start",
    );
    const hosts = events.filter(
        (event) =>
            event.type === "subagent.started" &&
            [
                "typeagent-macro-runner-host",
                "typeagent:typeagent-macro-runner-host",
            ].includes(event.data?.agentName),
    );
    const calls = starts.filter((event) =>
        /(?:^|-)run_macro$/u.test(event.data?.toolName ?? ""),
    );
    const matchingRoutes = routes.filter(
        (entry) =>
            entry.event === "explained" &&
            entry.data?.detail?.phrase ===
                events.findLast(
                    (event) =>
                        event.type === "user.message" && rootEvent(event),
                )?.data?.content,
    );
    const grammar = matchingRoutes.filter(
        (entry) =>
            entry.data.fromCache === "grammar" &&
            /^macros\.run_.+_v\d+$/u.test(entry.data.detail?.action ?? ""),
    );
    const unhandledHook = events.some(
        (event, index) =>
            index < answerIndex &&
            rootEvent(event) &&
            event.type === "hook.end" &&
            event.data?.hookType === "userPromptSubmitted" &&
            event.data.success === true &&
            event.data.output &&
            event.data.output.handled !== true &&
            linked(events, index, answerIndex),
    );
    const route =
        grammar.length === 1
            ? "grammar"
            : mode === "bypass"
              ? "unknown"
              : (unhandledHook && hosts.length === 0 && calls.length === 0) ||
                  (matchingRoutes.length === 1 &&
                      !matchingRoutes[0].data.fromCache)
                ? "miss"
                : "unknown";
    const reference = grammar[0]?.data.detail.action.match(
        /^macros\.run_(.+)_v(\d+)$/u,
    );
    const routeEvidence = {
        route,
        ...(mode === "bypass"
            ? {
                  bypassCandidate:
                      unhandledHook && hosts.length === 0 && calls.length === 0,
              }
            : {}),
        ...(reference
            ? { macroId: reference[1], version: Number(reference[2]) }
            : {}),
        notifications: matchingRoutes,
        mode,
    };
    const effects = starts
        .filter(
            (event) =>
                !/(?:^|-)(?:lookup_document|fetch_document|run_macro)$/u.test(
                    event.data?.toolName ?? "",
                ) && event.data?.toolName !== "task",
        )
        .map((event) => event.data.toolName ?? "unknown-tool");
    effects.push(
        ...backendAudit
            .filter(
                (entry) =>
                    !["lookup_document", "fetch_document"].includes(
                        entry.operation,
                    ),
            )
            .map((entry) => entry.operation),
    );
    const executionEvidence = {
        wholeMacroInvocations: hosts.length + calls.length,
        effects,
    };
    if (hosts.some((entry) => entry.data?.model !== "gpt-6-luna"))
        executionEvidence.effects.push("unexpected-host-runner-model");
    for (const entry of events.filter(
        (event) => event.type === "subagent.started",
    ))
        if (!hosts.includes(entry))
            executionEvidence.effects.push("unexpected-subagent");
    if (hosts.length === 1) {
        const procedure = starts.filter((entry) =>
            /(?:^|-)(?:lookup_document|fetch_document)$/u.test(
                entry.data?.toolName ?? "",
            ),
        );
        if (
            procedure.some(
                (entry) =>
                    entry.agentId !== hosts[0].agentId ||
                    entry.data?.parentToolCallId !== hosts[0].data.toolCallId,
            )
        )
            executionEvidence.effects.push("procedure-outside-host-child");
    }
    return {
        events,
        backendAudit,
        answer,
        routeEvidence,
        executionEvidence,
        ...nativeTerminalProof(events, answerIndex, answer),
        modelTurns: events.filter(
            (event) => event.type === "assistant.turn_start",
        ).length,
    };
}

function nativeTerminalProof(events, answerIndex, answer) {
    const answerEvent = events[answerIndex];
    const rootCompleted = events.some(
        (event, index) =>
            index > answerIndex &&
            rootEvent(event) &&
            event.type === "assistant.turn_end" &&
            answerEvent?.data.turnId !== undefined &&
            answerEvent?.data.turnId !== null &&
            event.data?.turnId === answerEvent.data.turnId &&
            linked(events, answerIndex, index),
    );
    // Actual handled-hook output is diagnostic proof, not a substitute grader idle.
    const literalHook = events.findLastIndex(
        (event, index) =>
            index < answerIndex &&
            rootEvent(event) &&
            event.type === "hook.end" &&
            event.data?.hookType === "userPromptSubmitted" &&
            event.data.success === true &&
            event.data.output?.handled === true &&
            event.data.output.responseContent === answer &&
            linked(events, index, answerIndex),
    );
    const user = events.findLastIndex(
        (event, index) =>
            index < answerIndex &&
            event.type === "user.message" &&
            rootEvent(event),
    );
    const literalCompleted =
        literalHook >= 0 &&
        user > literalHook &&
        !events
            .slice(literalHook + 1, user)
            .some(
                (event) =>
                    rootEvent(event) &&
                    ["user.message", "assistant.message"].includes(event.type),
            ) &&
        typeof events[user].data?.interactionId === "string" &&
        events[user].data.interactionId === answerEvent?.data.interactionId;
    return {
        terminal: rootCompleted
            ? "root-turn"
            : literalCompleted
              ? "handled-hook"
              : "pending",
        literalHookId: literalCompleted ? events[literalHook].id : undefined,
    };
}

export function classifyNativeScreen(screen, workspace, consent) {
    const compact = screen.replace(/[\s│┃]/gu, "");
    if (/Confirm folder trust/u.test(screen)) {
        if (
            compact.includes(workspace.replace(/\s/gu, "")) &&
            /\b1\.\s+Yes/u.test(screen)
        )
            return { text: "1", reason: "trust owned workspace once" };
        throw new NativeStop("Unverified folder-trust prompt", "blocked");
    }
    if (/wants elevated permissions/u.test(screen)) {
        const permissionText = screen
            .split(/\r?\n/u)
            .map((line) => line.replace(/^[\s│┃]+|[\s│┃]+$/gu, ""))
            .join("\n");
        const scope =
            /This extension wants to: ([\s\S]*?)(?:\nDenying will prevent this extension from loading\.|\n(?:❯\s*)?1\.\s+Yes\b)/u
                .exec(permissionText)?.[1]
                ?.trim();
        if (
            screen.includes('Extension "plugin:typeagent:typeagent"') &&
            scope === "register hooks." &&
            /\b1\.\s+Yes/u.test(screen)
        )
            return { text: "1", reason: "register hooks once" };
        throw new NativeStop(
            "Unexpected extension permission scope",
            "blocked",
        );
    }
    if (screen.includes("Install it now?") && screen.includes("No, thanks"))
        return { text: "n", reason: "decline optional installation" };
    if (
        screen.includes("Would you like to add this key binding") &&
        screen.includes("2. No")
    )
        return { text: "2", reason: "decline keybinding change" };
    if (/Do you want to use this tool\?/u.test(screen)) {
        const permitted = consent?.tools ?? [];
        const match = permitted.filter(
            (tool) =>
                screen.includes(tool.name) &&
                compact.includes(
                    JSON.stringify(tool.arguments).replace(/\s/gu, ""),
                ),
        );
        if (
            consent?.approve === true &&
            match.length === 1 &&
            /\b1\.\s+Yes/u.test(screen) &&
            /\b3\.\s+No/u.test(screen)
        )
            return {
                text: "1",
                reason: `approve exact synthetic ${match[0].name} once`,
            };
        throw new NativeStop(
            "Execution permission requires exact admitted synthetic arguments",
            "blocked",
        );
    }
    // The status heading can scroll away while its exact informational notice
    // remains. Remove only a complete notice line, never surrounding prompts.
    let interactionText = screen
        .replace(/[┃│]/gu, " ")
        .replace(
            /^[ \t]*Approval\s+of a saved macro does not grant tool permissions\.[ \t]*$/gmu,
            "",
        )
        .replace(/\s+/gu, " ");
    if (
        /Macro learning: (?:off|prepare|read-only|all) \(/u.test(
            interactionText,
        )
    )
        interactionText = interactionText.replaceAll(
            "Approval of a saved macro does not grant tool permissions.",
            "",
        );
    if (
        /sign in|authenticate|choose.*model|select.*model|allow all|permission|do you want|would you like|confirm|trust this|1\.\s+Yes/iu.test(
            interactionText,
        )
    )
        throw new NativeStop(
            "Unknown native interaction; no input supplied",
            "blocked",
        );
    return undefined;
}

function reviewNativeDocumentMacro(draft, validation, expectedState) {
    if (
        !validation?.valid ||
        draft?.state !== expectedState ||
        draft.inputs?.length !== 1 ||
        draft.steps?.length !== 2 ||
        !draft.learning?.requiresLivePermissions ||
        !draft.learning.grammarRules?.length
    )
        throw new NativeStop(
            "Synthetic draft validation/guards failed",
            "blocked",
        );
    const input = draft.inputs[0];
    if (!input.required || input.secret || input.valueType !== "string")
        throw new NativeStop("Unsafe learned title input", "blocked");
    const [lookup, fetch] = draft.steps;
    reviewProcedure(lookup, fetch, input);
}

export function reviewNativeDraft(draft, validation) {
    reviewNativeDocumentMacro(draft, validation, "draft");
}

export function reviewNativeApprovedMacro(macro, validation, source) {
    reviewNativeDocumentMacro(macro, validation, "approved");
    if (!isDeepStrictEqual(macro, source.macro))
        throw new NativeStop(
            "Current approved catalog version differs from pinned historical approval",
            "blocked",
        );
    verifyApprovedVersionUnchanged(source);
}

export function reviewNativePublicationBinding(
    draft,
    recording,
    sourceAudit,
    workspace,
) {
    const summary = sourceAudit.summary;
    const job = recording.learningJob;
    const reference = job?.macro;
    requireCapture(
        recording.status === "completed" &&
            recording.trace?.traceId === summary.traceId &&
            recording.trace.sessionId === summary.sessionId &&
            job?.status === "needsReview" &&
            job.traceId === summary.traceId &&
            job.sessionId === summary.sessionId &&
            job.mode === "prepare" &&
            job.cwd === path.resolve(workspace).toLowerCase() &&
            recording.trace.learningJobId === job.jobId &&
            draft.sourceTraceId === summary.traceId &&
            draft.macroId === reference?.macroId &&
            draft.version === reference?.version &&
            draft.learning?.jobId === job.jobId &&
            draft.learning.mode === "prepare" &&
            draft.learning.cwd === job.cwd &&
            isDeepStrictEqual(
                draft.steps.map((step) => step.sourceToolCallId),
                sourceAudit.native.toolCallIds,
            ),
        "reviewed draft is not the current selected source/job/immutable version",
    );
}

function reviewProcedure(lookup, fetch, input) {
    for (const [step, operation] of [
        [lookup, "lookup_document"],
        [fetch, "fetch_document"],
    ])
        if (
            step.mcpServerName !== "macro-eval-docs" ||
            step.toolName !== `macro-eval-docs-${operation}` ||
            !step.postconditions?.length ||
            step.arguments?.bindings?.length !== 1
        )
            throw new NativeStop(
                "Draft is not the admitted guarded document procedure",
                "blocked",
            );
    const title = lookup.arguments.bindings[0];
    const id = fetch.arguments.bindings[0];
    if (
        title.path.join(".") !== "title" ||
        title.expression.kind !== "input" ||
        title.expression.name !== input.name ||
        id.path.join(".") !== "id" ||
        id.expression.kind !== "stepResult" ||
        id.expression.stepId !== lookup.id ||
        id.expression.path.join(".") !== "id"
    )
        throw new NativeStop(
            "Draft does not bind a fresh lookup result to fetch",
            "blocked",
        );
}

export function createNativeBudget(config, signal, clock = Date.now) {
    const deadline = clock() + config.maxDurationMs;
    let turns = 0;
    const seen = new Set();
    const observe = (events) => {
        for (const event of events)
            if (event.type === "assistant.turn_start" && !seen.has(event.id)) {
                if (!event.id)
                    throw new NativeStop("Model turn lacks native identity");
                seen.add(event.id);
                turns++;
            }
    };
    return {
        observe,
        check(events = []) {
            observe(events);
            if (signal?.aborted)
                throw new NativeStop("Native evaluation cancelled", "blocked");
            if (clock() >= deadline)
                throw new NativeStop(
                    "Native evaluation deadline exceeded",
                    "blocked",
                );
            if (
                this.restrictionReadiness?.phase === "initializing" &&
                clock() >= this.restrictionReadiness.deadlineMs
            )
                throw new NativeStop(
                    "Native read-only tool initialization deadline exceeded",
                    "blocked",
                );
            if (turns > config.maxTargetModelTurns)
                throw new NativeStop(
                    "Native target model turn bound exceeded",
                    "blocked",
                );
        },
        remaining: () => Math.max(1, deadline - clock()),
        run: (promise) =>
            boundedNative(promise, Math.max(1, deadline - clock()), signal),
        used: () => turns,
    };
}

function ownLayout(output, config) {
    const run = path.resolve(output);
    fs.mkdirSync(run);
    const owner = randomUUID();
    writeJson(path.join(run, "evaluation-owner.json"), {
        owner,
        createdAt: new Date().toISOString(),
    });
    const layout = {
        run,
        owner,
        workspace: path.join(run, "workspace"),
        plugin: path.join(run, "plugin"),
        pluginData: path.join(run, "plugin-data"),
        data: path.join(run, "data"),
        audit: path.join(run, "backend.jsonl"),
        instance: `macro-eval-${owner.slice(0, 8)}`,
        port: config.port,
    };
    for (const dir of [layout.workspace, layout.pluginData, layout.data])
        fs.mkdirSync(dir);
    fs.writeFileSync(layout.audit, "", { flag: "wx", mode: 0o600 });
    return layout;
}

function artifactDirectory(layout) {
    return layout.approvedPhase?.artifacts ?? layout.run;
}

function nativeManifestFile(layout) {
    return path.join(artifactDirectory(layout), "manifest.json");
}

function inventory(directory) {
    const files = [];
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory())
            files.push(
                ...inventory(file).map((entry) => ({
                    ...entry,
                    file: path.join(item.name, entry.file),
                })),
            );
        else if (item.isFile())
            files.push({
                file: item.name,
                sha256: hash(fs.readFileSync(file)),
            });
        else
            throw new Error(
                `Runtime/source symlinks are not admitted: ${file}`,
            );
    }

    return files.sort((left, right) => left.file.localeCompare(right.file));
}

export function verifyNativeWorkspace(layout, expectedFiles) {
    const owner = readJson(path.join(layout.run, "evaluation-owner.json"));
    if (
        owner.owner !== layout.owner ||
        fs.lstatSync(layout.workspace).isSymbolicLink() ||
        fs.realpathSync(layout.workspace) !==
            path.join(fs.realpathSync(layout.run), "workspace") ||
        JSON.stringify(inventory(layout.workspace)) !==
            JSON.stringify(expectedFiles)
    )
        throw new NativeStop(
            "Generated synthetic workspace ownership/content changed",
            "blocked",
        );
}

export function validateNativeCliVersion(stdout, expected) {
    const observed = /^GitHub Copilot CLI (\d+\.\d+\.\d+)\.?\r?$/mu.exec(
        stdout,
    )?.[1];
    if (observed !== expected)
        throw new NativeStop(
            `Pinned CLI version mismatch: required ${expected}; observed ${observed ?? "unrecognized"}`,
            "blocked",
        );
    return observed;
}

export function verifyNativeHookRegistrationContext(
    layout,
    workspaceFiles,
    extensionHash,
    home,
) {
    verifyNativeWorkspace(layout, workspaceFiles);
    const extension = path.join(
        layout.plugin,
        "extensions",
        "typeagent",
        "extension.mjs",
    );
    if (
        path.dirname(home) !== layout.run ||
        !/^home-\d+$/u.test(path.basename(home)) ||
        fs.lstatSync(home).isSymbolicLink() ||
        fs.realpathSync(home) !==
            path.join(fs.realpathSync(layout.run), path.basename(home)) ||
        fs.realpathSync(extension) !==
            path.join(
                fs.realpathSync(layout.run),
                "plugin",
                "extensions",
                "typeagent",
                "extension.mjs",
            ) ||
        hash(fs.readFileSync(extension)) !== extensionHash
    )
        throw new NativeStop(
            "Hook registration requires the exact hashed extension and owned profile",
            "blocked",
        );
}

export function validateNativeStagedEntries(plugin) {
    const ts = createRequire(
        path.join(tsRoot, "packages", "copilot-plugin", "package.json"),
    )("typescript");
    for (const relative of ["hooks/hook-router.js", "mcp/server.js"]) {
        const file = path.join(plugin, "dist", relative);
        const ast = ts.createSourceFile(
            file,
            fs.readFileSync(file, "utf8"),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.JS,
        );
        const visit = (node) => {
            const specifier =
                ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
                    ? node.moduleSpecifier
                    : ts.isCallExpression(node) &&
                        node.expression.kind === ts.SyntaxKind.ImportKeyword
                      ? node.arguments[0]
                      : undefined;
            if (
                specifier &&
                ts.isStringLiteral(specifier) &&
                !isBuiltin(specifier.text)
            )
                throw new NativeStop(
                    `Staged ${relative} is not a self-contained bundle: ${specifier.text}. Canonical staging must bundle the complete current compiled runtime dependency closure before scheduling a rehearsal.`,
                    "blocked",
                );
            ts.forEachChild(node, visit);
        };
        visit(ast);
    }
}
export function verifyNativeStagedManifest(plugin, extensionSource) {
    const manifest = readJson(path.join(plugin, "bundle-manifest.json"));
    const extensionTarget = path.join(
        plugin,
        "extensions",
        "typeagent",
        "extension.mjs",
    );
    const expected = hash(fs.readFileSync(extensionSource));
    if (
        manifest.package !== "@typeagent/copilot-plugin" ||
        manifest.runtimeClosure?.extensionSha256 !== expected ||
        hash(fs.readFileSync(extensionTarget)) !== expected ||
        !manifest.runtimeClosure.inputs?.length
    )
        throw new NativeStop(
            "Staged runtime manifest/current extension mismatch",
            "blocked",
        );
    for (const input of manifest.runtimeClosure.inputs)
        if (
            !path.isAbsolute(input.file) ||
            hash(fs.readFileSync(input.file)) !== input.sha256
        )
            throw new NativeStop(
                "Compiled runtime dependency changed after staging",
                "blocked",
            );
}

export function validateNativeObservation(
    observation,
    { allowMetadataCatalogPending = false, restrictionReadiness } = {},
) {
    if (
        /Failed to connect to MCP server|MCP Servers reloaded:.*\bfailed\b/u.test(
            observation.screen,
        )
    )
        throw new NativeStop(
            "Native MCP catalog startup failed; no task may be submitted",
            "blocked",
        );
    if (
        /Unknown tool name in the tool (?:allowlist|excludedlist):/u.test(
            observation.screen,
        ) &&
        !retainReadinessWarnings(observation, restrictionReadiness) &&
        (!allowMetadataCatalogPending ||
            nativeCatalogReady(
                observation.screen,
                nativeConfiguredServerCount(),
            ))
    )
        throw new NativeStop(
            "Native CLI reports unresolved tool restriction names; exact tool restriction readiness is unproved",
            "blocked",
        );
    const failed = observation.events.find(
        (event) => event.type === "hook.end" && event.data?.success === false,
    );
    if (failed)
        throw new NativeStop(
            `Native hook failed: ${failed.data.error?.message ?? "unknown hook error"}`,
            "failed",
        );
}

function retainReadinessWarnings(observation, state) {
    if (!state || !["initializing", "verified"].includes(state.phase))
        return false;
    if (
        state.phase === "initializing" &&
        observation.events.some((event) =>
            [
                "assistant.turn_start",
                "model.turn_started",
                "model.model_call_started",
            ].includes(event.type),
        )
    )
        throw new NativeStop(
            "Tool readiness observed model generation before admission",
            "blocked",
        );
    const warnings = [
        ...observation.screen.matchAll(
            /Unknown tool name in the tool (allowlist|excludedlist):\s*"([^"]+)"/gu,
        ),
    ].map((match) => ({ list: match[1], selector: match[2] }));
    if (
        !warnings.length ||
        warnings.some(
            (warning) =>
                warning.list !== "allowlist" ||
                !state.selectors.includes(warning.selector),
        )
    )
        return false;
    if (
        state.phase === "verified" &&
        observation.screen.lastIndexOf("Unknown tool name") >
            observation.screen.lastIndexOf("MCP Servers reloaded:")
    )
        return false;
    for (const warning of warnings) {
        const prior = state.warnings.find(
            (entry) =>
                entry.list === warning.list &&
                entry.selector === warning.selector,
        );
        if (!prior) {
            if (state.phase === "verified") return false;
            state.warnings.push({
                ...warning,
                firstObservedAt: new Date().toISOString(),
            });
        }
    }
    return true;
}

export function nativeLoadOnlySelection(screen) {
    const choices = [
        ...screen.matchAll(
            /^\s*(?:❯\s*)?([1-3])\.\s*(Load & Augment|Load Only|Disabled)\b/gmu,
        ),
    ];
    if (
        choices.length !== 3 ||
        new Set(choices.map((choice) => choice[1])).size !== 3 ||
        new Set(choices.map((choice) => choice[2])).size !== 3
    )
        throw new NativeStop(
            "Unsupported extension mode dialog; no selection submitted",
            "blocked",
        );
    return choices.find((choice) => choice[2] === "Load Only")[1];
}

export function nativeLoadOnlyControl(screen, navigated = false) {
    const rows = screen
        .split(/\r?\n/u)
        .map((line) => line.replace(/^\s*│\s*/u, "").replace(/\s*│\s*$/u, ""));
    const choices = rows.flatMap((line) => {
        const match = line.match(
            /^\s*(❯\s*)?([●○])\s*(Load & Augment|Load Only|Disabled)\s*$/u,
        );
        return match ? [match] : [];
    });
    if (!choices.length)
        return {
            kind: "text",
            value: nativeLoadOnlySelection(screen),
            complete: true,
        };
    const active = choices.filter((choice) => choice[1]);
    if (
        choices.length !== 3 ||
        new Set(choices.map((choice) => choice[3])).size !== 3 ||
        choices.filter((choice) => choice[2] === "●").length !== 1 ||
        active.length !== 1 ||
        !/Extensions Mode/u.test(screen)
    )
        throw new NativeStop(
            "Ambiguous extension radio mode dialog",
            "blocked",
        );
    if (active[0][3] === "Load Only")
        return { kind: "key", value: "Enter", complete: true };
    if (active[0][3] !== "Load & Augment" || navigated)
        throw new NativeStop(
            "Unexpected extension radio mode focus",
            "blocked",
        );
    return { kind: "key", value: "Down", complete: false };
}

function applyNativeLoadOnlyControl(adapter, context, screen, navigated) {
    const action = nativeLoadOnlyControl(screen, navigated);
    context.decisions.push({
        at: new Date().toISOString(),
        ...(action.kind === "key"
            ? { key: action.value }
            : { text: action.value }),
        reason: "exact observed Load Only choice; no management invocation/grant",
    });
    if (action.kind === "key") {
        if (typeof adapter.pressKey !== "function")
            throw new NativeStop(
                "Owned console key transport unavailable",
                "blocked",
            );
        adapter.pressKey(action.value);
    } else adapter.submit(action.value);
    return action.complete;
}

export async function configureNativeLoadOnly(
    adapter,
    budget,
    config,
    context,
) {
    if (config.extensionMode !== "load_only") return;
    const admitted = new Set();
    let submitted = false;
    let selected = false;
    let navigated = false;
    for (;;) {
        budget.check();
        const observation = adapter.read();
        if (
            observation.events.some((event) =>
                [
                    "model.turn_started",
                    "model.model_call_started",
                    "assistant.turn_start",
                ].includes(event.type),
            )
        )
            throw new NativeStop(
                "Extension mode control observed model-start telemetry",
                "blocked",
            );
        const decision = classifyNativeScreen(
            observation.screen,
            context.workspace,
        );
        validateNativeObservation(observation, {
            restrictionReadiness: budget.restrictionReadiness,
            allowMetadataCatalogPending:
                decision?.reason === "register hooks once",
        });
        budget.check(observation.events);
        if (decision) {
            if (admitted.has(decision.reason))
                throw new NativeStop(
                    "Repeated extension mode consent",
                    "blocked",
                );
            admitted.add(decision.reason);
            context.decisions.push({
                at: new Date().toISOString(),
                ...decision,
            });
            adapter.submit(decision.text);
        } else if (!submitted && nativeReadyObservation(observation)) {
            context.decisions.push({
                at: new Date().toISOString(),
                text: "/extensions mode",
                reason: "documented owned CLI Load Only control; not a model tool",
            });
            adapter.submit("/extensions mode");
            submitted = true;
        } else if (submitted && !selected) {
            if (!/Load Only/u.test(observation.screen)) {
                if (/Unknown command|Invalid command/u.test(observation.screen))
                    throw new NativeStop(
                        "CLI extension mode command unsupported",
                        "blocked",
                    );
            } else {
                selected = applyNativeLoadOnlyControl(
                    adapter,
                    context,
                    observation.screen,
                    navigated,
                );
                navigated = true;
            }
        } else if (
            selected &&
            !/^\s*(?:❯\s*)?[1-3]\.\s*(?:Load Only|Load & Augment|Disabled)\b/mu.test(
                observation.screen,
            ) &&
            !/Extensions Mode/u.test(observation.screen) &&
            nativeReadyObservation(observation)
        ) {
            return observation;
        }
        await delay(250);
    }
}

export function verifyNativeLoadOnlyEvidence(
    layout,
    home,
    observation,
    restrictionReadiness,
) {
    const relative = path.relative(layout.run, home);
    if (!/^home-\d+$/u.test(relative))
        throw new NativeStop(
            "Load Only profile is not the exact owned home",
            "blocked",
        );
    const file = path.join(home, "settings.json");
    if (fs.realpathSync(file) !== path.resolve(file))
        throw new NativeStop(
            "Load Only settings changed physical root",
            "blocked",
        );
    const ts = createRequire(
        path.join(tsRoot, "packages", "copilot-plugin", "package.json"),
    )("typescript");
    const settings = ts.parseConfigFileTextToJson(
        file,
        fs.readFileSync(file, "utf8"),
    );
    if (settings.error || settings.config?.extensions?.mode !== "load_only")
        throw new NativeStop(
            "Actual owned CLI settings are not Load Only",
            "blocked",
        );
    if (
        !/Extensions mode changed to Load Only\b/u.test(
            observation?.screen ?? "",
        )
    )
        throw new NativeStop(
            "Load Only lacks actual owned native confirmation",
            "blocked",
        );
    if (!nativeReadyObservation(observation))
        throw new NativeStop(
            "Load Only lacks exact native session/catalog",
            "blocked",
        );
    validateNativeObservation(observation, { restrictionReadiness });
    return {
        home,
        file,
        mode: "load_only",
        settingsHash: hash(fs.readFileSync(file)),
        sessionId: observation.sessionId,
        observedAt: new Date().toISOString(),
        confirmation: "Extensions mode changed to Load Only",
        restrictionMechanism:
            "documented Load Only disables extension management; unfiltered current inventory independently checked",
    };
}

export function nativeCatalogReady(screen, expectedServers) {
    const match = screen.match(
        /MCP Servers reloaded: (\d+) servers? connected/u,
    );
    return (
        !!match &&
        Number(match[1]) === expectedServers &&
        !/\bfailed\b/u.test(match.input.slice(match.index))
    );
}

function nativeConfiguredServerCount() {
    return (
        Object.keys(
            readJson(
                path.join(tsRoot, "packages", "copilot-plugin", ".mcp.json"),
            ).mcpServers,
        ).length + 1
    );
}

export function nativeReadyObservation(observation) {
    if (
        typeof observation.sessionId !== "string" ||
        !observation.sessionId.trim() ||
        !/Session:/u.test(observation.screen) ||
        !nativeCatalogReady(observation.screen, nativeConfiguredServerCount())
    )
        return undefined;
    return observation;
}

function admitDiagnosticCatalog(layout, observation, adapter) {
    const admissionFile = path.join(
        layout.data,
        "native-control-admission.json",
    );
    writeJson(`${admissionFile}.pending`, {
        ...readJson(admissionFile),
        diagnosticCatalogReady: true,
        diagnosticCatalogSessionId: observation.sessionId,
        diagnosticActorIdentities: adapter.controlIdentities?.() ?? [],
        diagnosticRestrictionWarnings: [
            ...observation.screen.matchAll(
                /Unknown tool name in the tool (allowlist|excludedlist):\s*"([^"]+)"/gu,
            ),
        ].map((match) => ({ list: match[1], selector: match[2] })),
    });
    fs.renameSync(`${admissionFile}.pending`, admissionFile);
}

function metadataCatalogPending(observation, budget, decision) {
    return (
        (budget.metadataOnly ||
            budget.restrictionReadiness?.phase === "initializing") &&
        observation.verifiedHookRegistration === true &&
        decision?.reason === "register hooks once"
    );
}

function prepareNative(layout, config, corpus, helperDirectory) {
    const artifacts = artifactDirectory(layout);
    writeJson(path.join(layout.data, "native-control-admission.json"), {
        owner: layout.owner,
        ownedRoot: layout.run,
        configPath: path.join(layout.pluginData, "config.json"),
        expectedMode: "bypass",
        diagnosticTransitions: true,
        nativeSyntheticOriginals: !config.diagnosticOnly,
    });
    writeJson(path.join(layout.pluginData, "config.json"), {
        mode: "bypass",
        powershell: { enabled: false },
    });
    if (!layout.approvedPhase)
        execFileSync(
            "git",
            ["init", "--quiet", "--template=", "--initial-branch=macro-eval"],
            {
                cwd: layout.workspace,
                timeout: 10000,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );
    const node = process.execPath;
    const fixture = path.join(scripts, "macro-eval-fixture.mjs");
    const corpusPath = path.join(artifacts, "corpus.json");
    writeJson(corpusPath, corpus);
    const mcp = {
        mcpServers: {
            "macro-eval-docs": {
                type: "stdio",
                command: node,
                args: [
                    fixture,
                    "--corpus",
                    corpusPath,
                    "--audit",
                    layout.audit,
                    "--append-audit",
                ],
                tools: ["lookup_document", "fetch_document"],
            },
        },
    };
    writeJson(path.join(layout.workspace, ".mcp.json"), mcp);
    if (!layout.approvedPhase)
        fs.writeFileSync(
            path.join(layout.workspace, "AGENTS.md"),
            "For a document read, return the complete fetched document title and contents. " +
                "Clarify missing or vague titles. Never invent document identities. " +
                "Never approve macros or change permissions. Follow the real TypeAgent handoff when present.\n",
            { flag: "wx" },
        );
    const required = [
        config.cliExecutable,
        path.join(
            tsRoot,
            "packages",
            "agentServer",
            "server",
            "dist",
            "server.js",
        ),
        path.join(
            tsRoot,
            "packages",
            "agentServer",
            "client",
            "dist",
            "index.js",
        ),
        ...["Launch-Demo.ps1", "Control-Demo.ps1", "console-bridge.mjs"].map(
            (name) => path.join(helperDirectory, name),
        ),
        path.join(tsRoot, "tools", "scripts", "stageCopilotPlugin.mjs"),
        path.join(tsRoot, "tools", "scripts", "bundleUtils.mjs"),
        path.join(scripts, "macro-eval-native-key.ps1"),
        path.join(scripts, "macro-eval-native-pipe.ps1"),
    ];
    for (const file of required)
        if (!fs.statSync(file).isFile())
            throw new Error(`Required built runtime/helper missing: ${file}`);
    return {
        ...nativeScoringDeclaration(config),
        acceptance: "unexecuted",
        sourceCommit: execFileSync("git", ["--no-pager", "rev-parse", "HEAD"], {
            cwd: tsRoot,
            encoding: "utf8",
        }).trim(),
        dirtyFiles: execFileSync("git", ["--no-pager", "status", "--short"], {
            cwd: tsRoot,
            encoding: "utf8",
        })
            .trim()
            .split(/\r?\n/u)
            .filter(Boolean),
        config,
        configurationHash: hash(JSON.stringify(config)),
        ...(layout.approvedPhase
            ? {
                  phase: "approved-catalog-reuse-restart",
                  canonicalOwnedRoot: layout.run,
                  phaseId: layout.approvedPhase.phaseId,
                  homeOffset: layout.approvedPhase.homeOffset,
                  historicalLearning: {
                      reference: {
                          macroId: config.approvedCatalog.macroId,
                          version: config.approvedCatalog.version,
                      },
                      pins: layout.approvedSource.pins,
                      sourceResultStatus: layout.approvedSource.report.status,
                      publication: layout.approvedSource.report.operatorActions,
                  },
                  endToEndLearningAcceptance: "not exercised; remains separate",
              }
            : {}),
        workspaceFiles: inventory(layout.workspace),
        corpusHash: hash(JSON.stringify(corpus)),
        node: { executable: node, version: process.version },
        nativeKeyDriver: {
            file: path.join(scripts, "macro-eval-native-key.ps1"),
            sha256: hash(
                fs.readFileSync(
                    path.join(scripts, "macro-eval-native-key.ps1"),
                ),
            ),
        },
        runtime: required.map((file) => ({
            file,
            sha256: hash(fs.readFileSync(file)),
        })),
        source: inventory(
            path.join(tsRoot, "packages", "copilot-plugin", "src"),
        ),
        serverSource: inventory(
            path.join(tsRoot, "packages", "agentServer", "server", "src"),
        ),
        coupledProduct: Object.fromEntries(
            ["copilot-macros", "defaultAgentProvider", "copilot-plugin"].map(
                (name) => [
                    name,
                    Object.fromEntries(
                        ["src", "dist"].map((directory) => [
                            directory,
                            inventory(
                                path.join(tsRoot, "packages", name, directory),
                            ),
                        ]),
                    ),
                ],
            ),
        ),
        evaluator: fs
            .readdirSync(scripts)
            .filter((name) => /^macro-eval.*\.mjs$/u.test(name))
            .map((file) => ({
                file,
                sha256: hash(fs.readFileSync(path.join(scripts, file))),
            })),
        timingBoundary: "controller-submit-to-observed-terminal",
        usage: null,
        cost: null,
    };
}

export function freezeNativeExecutable(executable) {
    const resolvedExecutable = fs.realpathSync(executable);
    return {
        executable,
        resolvedExecutable,
        sha256: hash(fs.readFileSync(resolvedExecutable)),
    };
}

export function verifyNativeExecutable(frozen) {
    const current = freezeNativeExecutable(frozen.executable);
    if (
        current.resolvedExecutable !== frozen.resolvedExecutable ||
        current.sha256 !== frozen.sha256
    )
        throw new NativeStop(
            "Frozen native executable changed after version admission",
            "blocked",
        );
}

export function nativeFailureStatus(error) {
    return ["failed", "blocked", "harness-invalid"].includes(error?.status)
        ? error.status
        : "harness-invalid";
}

export function validateOwnedServiceListener(
    supervisor,
    tree,
    listeners,
    port,
    previousTree = tree,
) {
    if (listeners.length === 0) return false;
    if (listeners.length !== 1 || listeners[0].LocalPort !== port)
        throw new NativeStop(
            "Service readiness requires exactly one explicit-port listener",
        );
    if (
        listeners[0].LocalAddress !== "127.0.0.1" ||
        listeners[0].ListenerTable !== "TCP_TABLE_OWNER_PID_LISTENER"
    )
        throw new NativeStop(
            "Service readiness requires OS-classified exact loopback listener ownership",
        );
    const processes = new Map(tree.map((item) => [item.ProcessId, item]));
    const previous = new Map(
        previousTree.map((item) => [item.ProcessId, item]),
    );
    const root = processes.get(supervisor.ProcessId);
    if (
        !root ||
        root.StartedMs !== supervisor.StartedMs ||
        root.ExecutablePath !== supervisor.ExecutablePath
    )
        throw new NativeStop("Owned service supervisor identity changed");
    let owner = processes.get(listeners[0].OwningProcess);
    const seen = new Set();
    while (owner && !seen.has(owner.ProcessId)) {
        const frozen = previous.get(owner.ProcessId);
        if (
            !frozen ||
            !Number.isFinite(owner.StartedMs) ||
            !path.win32.isAbsolute(owner.ExecutablePath ?? "") ||
            frozen.StartedMs !== owner.StartedMs ||
            frozen.ExecutablePath !== owner.ExecutablePath ||
            frozen.ParentProcessId !== owner.ParentProcessId
        )
            throw new NativeStop(
                "Owned listener ancestry identity changed or is unverifiable",
            );
        if (owner.ProcessId === root.ProcessId) return true;
        seen.add(owner.ProcessId);
        const parent = processes.get(owner.ParentProcessId);
        if (parent && owner.StartedMs < parent.StartedMs)
            throw new NativeStop("Owned listener ancestry predates its parent");
        owner = parent;
    }
    throw new NativeStop(
        "Readiness listener is not the owned service supervisor or worker",
    );
}

export function nativeBuildResponsePolicy(layout, config, corpus, sessionId) {
    if (config.retainSyntheticLearningResponses !== true) return undefined;
    validateNativeConfig(config, corpus);
    const { training } = selectNativeCases(config, corpus);
    const document = corpus.documents.find(
        (entry) => entry.key === training.expectedDocument,
    );
    if (
        typeof sessionId !== "string" ||
        !sessionId.trim() ||
        !document?.title ||
        !document.expectedId
    )
        throw new NativeStop(
            "Private build response diagnostics require an actual selected session and exact synthetic document",
            "blocked",
        );
    return {
        schemaVersion: 1,
        kind: "native-synthetic-build-response-policy-v1",
        owner: layout.owner,
        ownedRoot: layout.run,
        dataRoot: layout.data,
        instanceName: layout.instance,
        configPath: path.join(layout.pluginData, "config.json"),
        expectedSessionId: sessionId,
        expectedPrompt: training.prompt,
        expectedToolCalls: [
            {
                name: "macro-eval-docs-lookup_document",
                mcpServerName: "macro-eval-docs",
                arguments: { title: document.title },
            },
            {
                name: "macro-eval-docs-fetch_document",
                mcpServerName: "macro-eval-docs",
                arguments: { id: document.expectedId },
            },
        ],
        maxResponseBytes: 262144,
        maxResponses: 2,
    };
}

export function cleanServiceEnvironment(inherited, layout, config) {
    const env = { ...inherited };
    for (const name of Object.keys(env))
        if (
            /^(?:TYPEAGENT_|CLAUDE_PLUGIN_DATA$|INSTANCE_NAME$|COPILOT_HOME$|COPILOT_ALLOW_ALL$|COPILOT_ASSISTED_APPROVAL$)/iu.test(
                name,
            )
        )
            delete env[name];
    return {
        ...env,
        TYPEAGENT_HOST: "127.0.0.1",
        TYPEAGENT_PORT: String(config.port),
        TYPEAGENT_USER_DATA_DIR: layout.data,
        CLAUDE_PLUGIN_DATA: layout.pluginData,
        TYPEAGENT_CONFIG_DIR: config.configDirectory,
        INSTANCE_NAME: layout.instance,
        ...(config.retainSyntheticLearningResponses === true
            ? {
                  TYPEAGENT_MACRO_BUILD_RESPONSE_DIAGNOSTIC_POLICY: path.join(
                      layout.data,
                      "native-build-response-policy.json",
                  ),
              }
            : {}),
        ...Object.fromEntries(
            ["RECORDING", "INDUCTION", "REPLAY", "AGENT_HANDOFF"].map(
                (name) => [`TYPEAGENT_MACRO_${name}_ENABLED`, "true"],
            ),
        ),
    };
}

export function nativeToolFilters() {
    return [
        "macro-eval-docs-lookup_document",
        "macro-eval-docs-fetch_document",
        "builtin:task",
    ];
}

export function verifyNativeFixtureCatalogs(diagnostic) {
    const snapshots = [
        diagnostic.initialTools,
        ...(diagnostic.transitions ?? []).map((transition) => transition.tools),
    ];
    if (
        snapshots.length !== 5 ||
        diagnostic.workflowGates?.length !== 5 ||
        !diagnostic.workflowGates.every((gate) => gate.passed === true)
    )
        throw new NativeStop(
            "Five current exact native source/schema inventories required",
            "blocked",
        );
    for (const tools of snapshots) {
        if (
            !Array.isArray(tools) ||
            tools.length !== 3 ||
            new Set(tools.map((tool) => tool.name)).size !== 3
        )
            throw new NativeStop(
                "Native unfiltered inventory is not exact docs plus task",
                "blocked",
            );
        for (const name of ["lookup_document", "fetch_document"]) {
            const tool = tools.find(
                (entry) => entry.name === `macro-eval-docs-${name}`,
            );
            if (
                !tool ||
                tool.mcpServerName !== "macro-eval-docs" ||
                tool.mcpToolName !== name ||
                tool.namespacedName !== `macro-eval-docs/${name}`
            )
                throw new NativeStop(
                    "Native document selector lacks exact actual MCP source binding",
                    "blocked",
                );
        }
        const task = tools.find((tool) => tool.name === "task");
        if (
            !task ||
            task.mcpServerName !== undefined ||
            task.mcpToolName !== undefined
        )
            throw new NativeStop(
                "Native task source binding disagrees with builtin selector",
                "blocked",
            );
    }
    return {
        passed: true,
        snapshots: 5,
        selectors: nativeToolFilters(),
        source: "actual unfiltered tools.getCurrentMetadata, exact MCP namespaced/server/tool identity and independently passed schemas",
    };
}

export function nativeControlProof(
    layout,
    expectedMode = "bypass",
    identities = [],
    snapshots,
) {
    const directory = path.join(layout.data, "native-control");
    const records =
        snapshots ??
        (fs.existsSync(directory)
            ? fs
                  .readdirSync(directory)
                  .filter((file) => file.endsWith(".json"))
                  .map((file) => readJson(path.join(directory, file)))
            : []);
    const configPath = path.join(layout.pluginData, "config.json");
    const mismatches = records.filter(
        (record) =>
            record.source?.owner !== layout.owner ||
            record.dataRoot !== layout.data ||
            record.configPath !== configPath ||
            record.effectiveMode !== expectedMode ||
            !record.source?.readableOwnedConfig ||
            !/^[a-f0-9]{64}$/u.test(record.digest ?? "") ||
            !Number.isFinite(Date.parse(record.source?.observedAt)) ||
            Date.parse(record.source.observedAt) <
                Date.parse(layout.controlStartedAt ?? "") ||
            Date.parse(record.source.observedAt) > Date.now() ||
            (record.source.component !== "native-hook" &&
                !identities.some(
                    (identity) =>
                        identity.ProcessId === record.source.pid &&
                        identity.ParentProcessId === record.source.parentPid &&
                        identity.ExecutablePath?.toLowerCase() ===
                            record.source.executable?.toLowerCase() &&
                        identity.StartedMs <=
                            Date.parse(record.source.observedAt),
                )),
    );
    const mcp = records.filter((record) =>
        record.source?.component?.startsWith("mcp-"),
    );
    const extension = records.filter(
        (record) => record.source?.component === "native-extension-status",
    );
    const hooks = records.filter(
        (record) =>
            record.source?.component === "native-hook" &&
            extension.some(
                (parent) => parent.source.pid === record.source.parentPid,
            ),
    );
    const requiredMcp = [
        "mcp-agent",
        "mcp-workspace",
        "mcp-macros",
        "mcp-skills",
    ];
    const complete =
        requiredMcp.every(
            (component) =>
                mcp.filter((record) => record.source.component === component)
                    .length === 1,
        ) &&
        mcp.length === 4 &&
        extension.length === 1 &&
        hooks.length === 1;
    const consistentDigest =
        new Set(records.map((record) => record.digest)).size === 1;
    return {
        records,
        expectedMode,
        expectedConfigPath: configPath,
        expectedDataRoot: layout.data,
        mismatches,
        complete,
        consistentDigest,
        identities,
        passed: mismatches.length === 0 && complete && consistentDigest,
        hookTransport:
            "Required: compiled --control-metadata child of registered native-extension status getter; controller IPC/startup is not that getter, a native callback, or terminal proof.",
    };
}

export function consoleConfiguration(layout, config, index) {
    const home = path.join(
        layout.run,
        `home-${index + (layout.approvedPhase?.homeOffset ?? 0)}`,
    );
    fs.mkdirSync(home);
    if (config.extensionMode !== "load_only")
        throw new NativeStop(
            "Owned launch requires explicit Load Only",
            "blocked",
        );
    writeJson(path.join(home, "settings.json"), {
        extensions: { mode: "load_only" },
    });
    return {
        command: config.cliExecutable,
        workspace: layout.workspace,
        args: [
            "--no-auto-update",
            "--experimental",
            "--no-ask-user",
            "--disable-builtin-mcps",
            "--no-remote-export",
            "--model",
            config.rootModel,
            "--plugin-dir",
            layout.plugin,
            "--additional-mcp-config",
            `@${path.join(layout.workspace, ".mcp.json")}`,
            "--available-tools",
            ...nativeToolFilters(),
            "--log-dir",
            path.join(artifactDirectory(layout), `cli-logs-${index}`),
        ],
        environment: {
            TYPEAGENT_HOST: "127.0.0.1",
            TYPEAGENT_PORT: String(config.port),
            CLAUDE_PLUGIN_DATA: layout.pluginData,
            TYPEAGENT_USER_DATA_DIR: layout.data,
            COPILOT_HOME: home,
            INSTANCE_NAME: layout.instance,
            ...Object.fromEntries(
                ["RECORDING", "INDUCTION", "REPLAY", "AGENT_HANDOFF"].map(
                    (name) => [`TYPEAGENT_MACRO_${name}_ENABLED`, "true"],
                ),
            ),
        },
    };
}

function powershell(script, args, timeout) {
    return execFileSync(
        "powershell.exe",
        ["-NoProfile", "-File", script, ...args],
        {
            encoding: "utf8",
            windowsHide: true,
            timeout,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
}

export function nativeControlTimeout(action, remaining) {
    return action === "Close" ? 30000 : Math.min(remaining, 15000);
}

export function processTree(pid, timeout = 10000) {
    if (!Number.isSafeInteger(pid) || pid < 1)
        throw new NativeStop("Owned process requires a valid explicit PID");
    const code =
        `$ErrorActionPreference='Stop'; $all=@(Get-CimInstance Win32_Process -ErrorAction Stop); $ids=@(${Number(pid)}); ` +
        `for($i=0;$i -lt $ids.Count;$i++){ foreach($id in @($all | Where-Object {$_.ParentProcessId -eq $ids[$i]} | ForEach-Object {$_.ProcessId})){ if($id -notin $ids){ $ids+= $id } } }; ` +
        `$all | Where-Object {$_.ProcessId -in $ids} | Select-Object ProcessId,ParentProcessId,@{n='StartedMs';e={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}},ExecutablePath | ConvertTo-Json -Compress`;
    try {
        const text = execFileSync(
            "powershell.exe",
            ["-NoProfile", "-Command", code],
            { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] },
        );
        if (!text.trim()) return [];
        const value = JSON.parse(text);
        return Array.isArray(value) ? value : [value];
    } catch (error) {
        throw new NativeStop(
            `OS process ownership proof unavailable: ${error.stderr?.toString().trim() || error.message}`,
            "blocked",
        );
    }
}

export function probeWindowsServiceListeners(
    port,
    scratchDirectory,
    timeout = 10000,
    execute = execFileSync,
) {
    if (process.platform !== "win32")
        throw new NativeStop(
            "Windows listener ownership proof requires Windows",
        );
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
        throw new NativeStop("Listener probe requires an explicit valid port");
    // Request the OS listener-only table. On this Windows build even CIM's raw
    // State is zero; neither a State filter nor a guessed replacement is proof.
    const source = `
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Net;
using System.Runtime.InteropServices;
public class MacroEvalListener {
    public string LocalAddress;
    public int LocalPort;
    public uint OwningProcess;
    public uint State;
    public string ListenerTable = "TCP_TABLE_OWNER_PID_LISTENER";
}
public class MacroEvalTcp {
    [DllImport("iphlpapi.dll", SetLastError=true)]
    static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);
    public static MacroEvalListener[] Read(int port) {
        var rows = new List<MacroEvalListener>();
        ReadFamily(rows, port, 2, 24);
        ReadFamily(rows, port, 23, 56);
        return rows.ToArray();
    }
    static void ReadFamily(List<MacroEvalListener> rows, int port, int family, int stride) {
        int size = 0;
        uint status = GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, 3, 0);
        if (status != 122) throw new Win32Exception((int)status, "Windows listener ownership table sizing failed");
        IntPtr buffer = IntPtr.Zero;
        try {
            for (int attempt = 0; attempt < 3; attempt++) {
                if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
                buffer = Marshal.AllocHGlobal(size);
                status = GetExtendedTcpTable(buffer, ref size, false, family, 3, 0);
                if (status != 122) break;
            }
            if (status != 0) throw new Win32Exception((int)status, "Windows listener ownership table read failed");
            int count = Marshal.ReadInt32(buffer);
            if (count < 0 || count > (size - 4) / stride) throw new InvalidOperationException("Invalid Windows listener table size");
            for (int index = 0; index < count; index++) {
                IntPtr row = IntPtr.Add(buffer, 4 + index * stride);
                int rawPort = Marshal.ReadInt32(row, family == 2 ? 8 : 20);
                int localPort = ((rawPort & 255) << 8) | ((rawPort >> 8) & 255);
                if (localPort != port) continue;
                uint state = (uint)Marshal.ReadInt32(row, family == 2 ? 0 : 48);
                if (state != 0 && state != 2) throw new InvalidOperationException("Unsupported native listener table state");
                byte[] address = new byte[family == 2 ? 4 : 16];
                Marshal.Copy(IntPtr.Add(row, family == 2 ? 4 : 0), address, 0, address.Length);
                var ip = family == 2 ? new IPAddress(address) : new IPAddress(address, (uint)Marshal.ReadInt32(row, 16));
                rows.Add(new MacroEvalListener {
                    LocalAddress = ip.ToString(), LocalPort = localPort, State = state,
                    OwningProcess = (uint)Marshal.ReadInt32(row, family == 2 ? 20 : 52)
                });
            }
        } finally {
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
        }
    }
}`;
    const command =
        `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'\n${source}\n'@; ` +
        `ConvertTo-Json -InputObject @([MacroEvalTcp]::Read(${port})) -Compress`;
    try {
        fs.mkdirSync(scratchDirectory, { recursive: true });
        return JSON.parse(
            execute("powershell.exe", ["-NoProfile", "-Command", command], {
                encoding: "utf8",
                timeout,
                windowsHide: true,
                env: {
                    ...process.env,
                    TEMP: scratchDirectory,
                    TMP: scratchDirectory,
                },
                stdio: ["ignore", "pipe", "pipe"],
            }),
        );
    } catch (error) {
        throw new NativeStop(
            `OS listener ownership proof unavailable: ${error.stderr?.toString().trim() || error.message}`,
            "blocked",
        );
    }
}

function stopIdentities(identities) {
    for (const item of identities.toReversed()) {
        const code =
            `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${Number(item.ProcessId)}"; ` +
            `if($p -and ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() -eq ${item.StartedMs} ` +
            `-and $p.ExecutablePath -eq '${item.ExecutablePath?.replaceAll("'", "''")}'){ Stop-Process -Id ${Number(item.ProcessId)} -Force -ErrorAction Stop }`;
        execFileSync("powershell.exe", ["-NoProfile", "-Command", code], {
            timeout: 10000,
            stdio: "ignore",
        });
    }
    for (const item of identities) {
        const current = processTree(item.ProcessId);
        if (
            current.some(
                (entry) =>
                    entry.ProcessId === item.ProcessId &&
                    entry.StartedMs === item.StartedMs,
            )
        )
            throw new NativeStop(
                `Owned process ${item.ProcessId} survived cleanup`,
            );
    }
}

async function makeLiveAdapter(layout, config, helperDirectory, budget) {
    const artifacts = artifactDirectory(layout);
    const { childEnvironment } = await import(
        pathToFileURL(path.join(helperDirectory, "console-bridge.mjs"))
    );
    const { stageCopilotPlugin } = await import(
        "../../../tools/scripts/stageCopilotPlugin.mjs"
    );
    const { checkPort, waitForServer, startProcess } = await import(
        "../../copilot-plugin/scripts/discovery-e2e.mjs"
    );
    const { connectAgentServer } = await import(
        pathToFileURL(
            path.join(
                tsRoot,
                "packages",
                "agentServer",
                "client",
                "dist",
                "index.js",
            ),
        )
    );
    let server,
        serviceIdentity,
        connection,
        consoleRun,
        home,
        consoleIdentity,
        admittedConsole;
    let stagedNormalHook, normalHookReader;
    const recordingSnapshots = new Map();
    const claimedRecordings = new Map();
    const consoles = [];
    const routesDirectory = path.join(
        layout.data,
        "profiles",
        layout.instance,
        "conversations",
    );
    const helper = path.join(helperDirectory, "Control-Demo.ps1");
    const expectedWorkspace = readJson(
        nativeManifestFile(layout),
    ).workspaceFiles;
    const control = (action, text) =>
        powershell(
            helper,
            [
                "-Action",
                action,
                "-RunDirectory",
                consoleRun,
                ...(text === undefined ? [] : ["-Text", text]),
            ],
            nativeControlTimeout(action, budget.remaining()),
        );
    const sessionEvents = () => {
        if (!home) return { events: [] };
        const directory = path.join(home, "session-state");
        if (!fs.existsSync(directory)) return { events: [] };
        const sessions = fs
            .readdirSync(directory)
            .filter((id) =>
                fs.existsSync(path.join(directory, id, "events.jsonl")),
            );
        if (sessions.length > 1)
            throw new NativeStop("More than one owned root native session");
        return sessions.length
            ? {
                  sessionId: sessions[0],
                  events: readNativeJsonl(
                      path.join(directory, sessions[0], "events.jsonl"),
                  ),
              }
            : { events: [] };
    };
    const routeLog = () =>
        !fs.existsSync(routesDirectory)
            ? []
            : fs.readdirSync(routesDirectory).flatMap((id) => {
                  const file = path.join(
                      routesDirectory,
                      id,
                      "displayLog.json",
                  );
                  return fs.existsSync(file)
                      ? readJson(file).map((entry) => ({
                            ...entry,
                            conversationId: id,
                        }))
                      : [];
              });
    return {
        async startService() {
            budget.check();
            await checkPort(config.port);
            stageCopilotPlugin(layout.plugin);
            validateNativeStagedEntries(layout.plugin);
            const extensionSource = path.join(
                tsRoot,
                "packages",
                "copilot-plugin",
                "dist",
                "extensions",
                "typeagent",
                "extension.mjs",
            );
            const extensionTarget = path.join(
                layout.plugin,
                "extensions",
                "typeagent",
                "extension.mjs",
            );
            if (
                hash(fs.readFileSync(extensionSource)) !==
                hash(fs.readFileSync(extensionTarget))
            )
                throw new NativeStop(
                    "Staged extension does not match the current built plugin",
                    "blocked",
                );
            verifyNativeStagedManifest(layout.plugin, extensionSource);
            if (!config.diagnosticOnly)
                stagedNormalHook = stageNativeNormalHook(
                    layout,
                    Date.now() + budget.remaining(),
                );
            writeJson(
                path.join(artifacts, `staged-runtime-${consoles.length}.json`),
                inventory(layout.plugin),
            );
            if (layout.approvedPhase)
                fs.cpSync(
                    layout.plugin,
                    path.join(artifacts, `staged-plugin-${consoles.length}`),
                    { recursive: true, errorOnExist: true, force: false },
                );
            if (config.diagnosticOnly) {
                // The control diagnostic never calls a fixture operation.
                const stdout = execFileSync(
                    process.execPath,
                    [
                        path.join(
                            layout.plugin,
                            "dist",
                            "hooks",
                            "hook-router.js",
                        ),
                    ],
                    {
                        encoding: "utf8",
                        input: JSON.stringify({
                            sessionId: layout.owner,
                            cwd: layout.workspace,
                            prompt: "@typeagent status",
                            timestamp: Date.now(),
                        }),
                        timeout: Math.min(15000, budget.remaining()),
                        env: {
                            ...cleanServiceEnvironment(
                                process.env,
                                layout,
                                config,
                            ),
                            TYPEAGENT_MODE: "bypass",
                        },
                        stdio: ["pipe", "pipe", "pipe"],
                    },
                );
                const status = JSON.parse(stdout);
                if (
                    status.handled !== true ||
                    !/TypeAgent/u.test(status.responseContent ?? "")
                )
                    throw new NativeStop(
                        "Compiled hook IPC status failed; no task may be submitted",
                        "blocked",
                    );
                writeJson(path.join(layout.run, "hook-ipc-status.json"), {
                    command: "@typeagent status",
                    output: status,
                    modelGeneration: false,
                    grammarMissProof: false,
                });
            }
            const frozen = freezeNativeExecutable(config.cliExecutable);
            const cliConfig = consoleConfiguration(
                layout,
                config,
                consoles.length,
            );
            cliConfig.command = frozen.resolvedExecutable;
            const version = execFileSync(
                frozen.resolvedExecutable,
                ["--no-auto-update", "--experimental", "--version"],
                {
                    encoding: "utf8",
                    timeout: Math.min(budget.remaining(), 10000),
                    cwd: cliConfig.workspace,
                    env: childEnvironment(
                        process.env,
                        cliConfig.environment.COPILOT_HOME,
                        cliConfig.environment,
                    ),
                },
            );
            writeJson(
                path.join(artifacts, `cli-version-${consoles.length}.json`),
                {
                    ...frozen,
                    home: cliConfig.environment.COPILOT_HOME,
                    workspace: cliConfig.workspace,
                    environmentContract:
                        "shared-helper childEnvironment with the exact real-launch owned overlay",
                    expected: config.cliVersion,
                    stdout: version,
                    observedAt: new Date().toISOString(),
                },
            );
            validateNativeCliVersion(version, config.cliVersion);
            verifyNativeExecutable(frozen);
            admittedConsole = { cliConfig, frozen };
            const out = fs.openSync(
                path.join(artifacts, `service-${consoles.length}.stdout.log`),
                "wx",
            );
            const err = fs.openSync(
                path.join(artifacts, `service-${consoles.length}.stderr.log`),
                "wx",
            );
            try {
                server = startProcess(
                    process.execPath,
                    [
                        path.join(
                            tsRoot,
                            "packages",
                            "agentServer",
                            "server",
                            "dist",
                            "server.js",
                        ),
                        "--port",
                        String(config.port),
                        "--host",
                        "127.0.0.1",
                        "--config",
                        "test",
                        "--idle-timeout",
                        "600",
                    ],
                    {
                        cwd: tsRoot,
                        env: cleanServiceEnvironment(
                            process.env,
                            layout,
                            config,
                        ),
                        stdio: ["ignore", out, err],
                    },
                );
            } finally {
                fs.closeSync(out);
                fs.closeSync(err);
            }
            serviceIdentity = processTree(
                server.child.pid,
                Math.min(10000, budget.remaining()),
            ).find((item) => item.ProcessId === server.child.pid);
            if (!serviceIdentity)
                throw new NativeStop("Owned service process identity missing");
            await waitForServer(
                server,
                config.port,
                Math.min(120, budget.remaining() / 1000),
                AbortSignal.timeout(budget.remaining()),
                path.join(artifacts, `service-${consoles.length}.stderr.log`),
            );
            const readiness = {
                supervisor: serviceIdentity,
                osProbe:
                    "iphlpapi.dll GetExtendedTcpTable/TCP_TABLE_OWNER_PID_LISTENER; IPv4 and IPv6; exact 127.0.0.1",
                observations: [],
            };
            const readinessDeadline =
                Date.now() + Math.min(30000, budget.remaining());
            let ownedListener = false;
            try {
                while (!ownedListener && Date.now() < readinessDeadline) {
                    budget.check();
                    const previousTree = processTree(
                        server.child.pid,
                        Math.min(10000, budget.remaining()),
                    );
                    const listeners = probeWindowsServiceListeners(
                        config.port,
                        path.join(artifacts, "windows-os-probe"),
                        Math.min(10000, budget.remaining()),
                    );
                    const tree = processTree(
                        server.child.pid,
                        Math.min(10000, budget.remaining()),
                    );
                    readiness.observations.push({
                        at: new Date().toISOString(),
                        tree,
                        previousTree,
                        listeners,
                    });
                    ownedListener = validateOwnedServiceListener(
                        serviceIdentity,
                        tree,
                        listeners,
                        config.port,
                        previousTree,
                    );
                    if (!ownedListener) await delay(250);
                }
                if (!ownedListener)
                    throw new NativeStop(
                        "Owned service listener readiness deadline exceeded",
                        "blocked",
                    );
            } catch (error) {
                readiness.error = error.message;
                throw error;
            } finally {
                writeJson(
                    path.join(
                        artifacts,
                        `service-readiness-${consoles.length}.json`,
                    ),
                    readiness,
                );
            }
            const connected = connectAgentServer(
                `ws://127.0.0.1:${config.port}`,
            );
            try {
                connection = await budget.run(connected);
            } catch (error) {
                void connected.then(
                    (late) => late.close(),
                    () => {},
                );
                throw error;
            }
            return budget.run(connection.listMacros({ limit: 100 }));
        },
        async openConsole() {
            budget.check();
            verifyNativeWorkspace(layout, expectedWorkspace);
            const index = consoles.length;
            consoleRun = path.join(artifacts, `console-${index}`);
            if (!admittedConsole)
                throw new NativeStop(
                    "Native console has no successful version admission",
                );
            verifyNativeExecutable(admittedConsole.frozen);
            const { cliConfig } = admittedConsole;
            home = cliConfig.environment.COPILOT_HOME;
            const file = path.join(artifacts, `console-${index}.private.json`);
            writeJson(file, cliConfig);
            consoles.push(consoleRun);
            // Launch creates its own fresh run directory.
            powershell(
                path.join(helperDirectory, "Launch-Demo.ps1"),
                [
                    "-ConfigPath",
                    file,
                    "-RunDirectory",
                    consoleRun,
                    "-NodePath",
                    process.execPath,
                    "-TimeoutSeconds",
                    String(
                        Math.max(
                            1,
                            Math.min(30, Math.floor(budget.remaining() / 1000)),
                        ),
                    ),
                ],
                Math.min(budget.remaining(), 45000),
            );
            const state = readJson(path.join(consoleRun, "console-state.json"));
            if (state.phase !== "running" || !state.cliPid)
                throw new NativeStop("CLI bridge not running");
            consoleIdentity = processTree(state.bridgePid);
            if (
                !consoleIdentity.some((item) => item.ProcessId === state.cliPid)
            )
                throw new NativeStop("CLI is not a child of the owned bridge");
            writeJson(
                path.join(consoleRun, "process-identities.json"),
                consoleIdentity,
            );
            writeJson(path.join(consoleRun, "launcher-child-provenance.json"), {
                admittedExecutable: admittedConsole.frozen,
                launcherPid: state.cliPid,
                bridgePid: state.bridgePid,
                children: consoleIdentity.map((item) => ({
                    ...item,
                    ...(item.ExecutablePath &&
                    fs.existsSync(item.ExecutablePath)
                        ? {
                              binary: freezeNativeExecutable(
                                  item.ExecutablePath,
                              ),
                          }
                        : {}),
                })),
            });
            for (const action of ["Compile", "Select", "Restore", "Verify"])
                control(action);
            if (stagedNormalHook)
                normalHookReader = await startNativeNormalHookReader({
                    layout,
                    staged: stagedNormalHook,
                    index: index + (layout.approvedPhase?.homeOffset ?? 0),
                    budget,
                    probe: (pid) =>
                        processTree(pid).find(
                            (actor) => actor.ProcessId === pid,
                        ),
                    cli: {
                        ...consoleIdentity.find(
                            (actor) => actor.ProcessId === state.cliPid,
                        ),
                        sha256: admittedConsole.frozen.sha256,
                    },
                });
        },
        async closeConsole() {
            normalHookReader?.stop();
            normalHookReader = undefined;
            if (!consoleRun) return;
            const stateFile = path.join(consoleRun, "console-state.json");
            if (!fs.existsSync(stateFile)) {
                try {
                    control("Close");
                } finally {
                    consoleRun = undefined;
                }
                return;
            }
            if (!consoleIdentity) {
                const state = readJson(stateFile);
                const owner = readJson(path.join(consoleRun, "owner.json"));
                if (state.title !== owner.title)
                    throw new NativeStop(
                        "Console ownership mismatch during cleanup",
                    );
                consoleIdentity = processTree(state.bridgePid);
            }
            // Snapshot descendants only while the original bridge identity still matches.
            const root = consoleIdentity?.find(
                (item) => item.ProcessId === readJson(stateFile).bridgePid,
            );
            const current = root ? processTree(root.ProcessId) : [];
            const same = current.some(
                (item) =>
                    item.ProcessId === root?.ProcessId &&
                    item.StartedMs === root.StartedMs,
            );
            const identities = same ? current : (consoleIdentity ?? []);
            let closeError;
            try {
                control("Close");
            } catch (error) {
                closeError = error;
            }
            stopIdentities(identities);
            consoleRun = undefined;
            consoleIdentity = undefined;
            if (closeError)
                throw new NativeStop(
                    "Owned console Close failed; exact process cleanup attempted",
                );
        },
        async stopService() {
            try {
                await boundedNative(connection?.close(), 10000);
            } finally {
                connection = undefined;
                if (
                    server &&
                    server.child.exitCode === null &&
                    server.child.signalCode === null
                ) {
                    const identities = processTree(server.child.pid);
                    if (
                        identities.some(
                            (item) =>
                                item.ProcessId === serviceIdentity?.ProcessId &&
                                item.StartedMs === serviceIdentity.StartedMs,
                        )
                    )
                        stopIdentities(identities);
                    await Promise.race([server.completion, delay(5000)]);
                    if (
                        server.child.exitCode === null &&
                        server.child.signalCode === null
                    )
                        throw new NativeStop("Owned service did not stop");
                }
                server = undefined;
                serviceIdentity = undefined;
            }
        },
        setMode(mode, routing) {
            if (routing !== undefined && routing !== "mixed")
                throw new NativeStop(
                    "Unsupported native routing policy",
                    "blocked",
                );
            const previous = readJson(
                path.join(layout.pluginData, "config.json"),
            );
            fs.writeFileSync(
                path.join(layout.pluginData, "config.json"),
                JSON.stringify({
                    ...previous,
                    mode,
                    ...(routing === undefined ? {} : { mcpRouting: routing }),
                }),
            );
            const admissionFile = path.join(
                layout.data,
                "native-control-admission.json",
            );
            writeJson(`${admissionFile}.pending`, {
                ...readJson(admissionFile),
                expectedMode: mode,
            });
            fs.renameSync(`${admissionFile}.pending`, admissionFile);
        },
        read() {
            budget.check();
            const state = readJson(path.join(consoleRun, "console-state.json"));
            if (state.phase !== "running")
                throw new NativeStop("Owned native CLI exited");
            const screen = control("Read");
            let verifiedHookRegistration = false;
            if (/Confirm folder trust/u.test(screen))
                verifyNativeWorkspace(layout, expectedWorkspace);
            if (/wants elevated permissions/u.test(screen)) {
                const expectedExtension = readJson(
                    path.join(
                        artifacts,
                        `staged-runtime-${consoles.length - 1}.json`,
                    ),
                ).find(
                    (entry) =>
                        entry.file ===
                        path.join("extensions", "typeagent", "extension.mjs"),
                );
                verifyNativeHookRegistrationContext(
                    layout,
                    expectedWorkspace,
                    expectedExtension?.sha256,
                    home,
                );
                verifiedHookRegistration = true;
            }
            return {
                ...sessionEvents(),
                backendAudit: readNativeJsonl(layout.audit),
                routes: routeLog(),
                screen,
                verifiedHookRegistration,
            };
        },
        submit: (text) => control("Type", text),
        pressKey(key) {
            if (!["Down", "Enter"].includes(key))
                throw new NativeStop("Unsupported owned key input", "blocked");
            control("Verify");
            const driver = fileURLToPath(
                new URL("./macro-eval-native-key.ps1", import.meta.url),
            );
            const expected = readJson(
                nativeManifestFile(layout),
            ).nativeKeyDriver;
            if (expected?.sha256 !== hash(fs.readFileSync(driver)))
                throw new NativeStop(
                    "Owned key driver source drift",
                    "blocked",
                );
            powershell(
                driver,
                ["-RunDirectory", consoleRun, "-Key", key],
                nativeControlTimeout("Type", budget.remaining()),
            );
        },
        async recording(sessionId) {
            const state = await budget.run(
                connection.getMacroRecordingState(sessionId),
            );
            recordingSnapshots.set(sessionId, {
                state,
                observedAt: new Date().toISOString(),
            });
            if (state.status === "claimed")
                claimedRecordings.set(sessionId, state);
            return state;
        },
        learningPreference: () =>
            budget.run(connection.getMacroLearningPreference(layout.workspace)),
        setLearningPreference: (mode) =>
            budget.run(
                connection.setMacroLearningPreference({
                    cwd: layout.workspace,
                    mode,
                }),
            ),
        async finalizedSourceReader(sessionId) {
            const admittedService = { ...serviceIdentity };
            const tokenId = claimedRecordings.get(sessionId)?.token?.id;
            requireCapture(
                tokenId !== undefined,
                "actual claimed RPC snapshot missing",
            );
            const load = () => {
                budget.check();
                requireCapture(
                    serviceIdentity?.ProcessId === admittedService.ProcessId &&
                        serviceIdentity.StartedMs ===
                            admittedService.StartedMs &&
                        connection !== undefined,
                    "admitted service generation changed",
                );
                const current = processTree(admittedService.ProcessId).find(
                    (peer) => peer.ProcessId === admittedService.ProcessId,
                );
                requireCapture(
                    current?.StartedMs === admittedService.StartedMs &&
                        current.ExecutablePath ===
                            admittedService.ExecutablePath &&
                        current.ParentProcessId ===
                            admittedService.ParentProcessId,
                    "actual owned service identity no longer current",
                );
                const snapshot = recordingSnapshots.get(sessionId);
                requireCapture(
                    snapshot?.state?.trace?.sessionId === sessionId,
                    "completed RPC session mismatch",
                );
                return stableSelectedTrace(layout, snapshot, {
                    ProcessId: current.ProcessId,
                    ParentProcessId: current.ParentProcessId,
                    StartedMs: current.StartedMs,
                    ExecutablePath: current.ExecutablePath,
                });
            };
            return bindNativeFinalizedSourceReader({
                sessionId,
                tokenId,
                load,
            });
        },
        inspect: (reference) => budget.run(connection.inspectMacro(reference)),
        validate: (reference) =>
            budget.run(connection.validateMacro(reference)),
        approve: (reference) => budget.run(connection.approveMacro(reference)),
        runtime: () => inventory(layout.plugin),
        normalHookCallback(target, events) {
            if (!normalHookReader)
                throw new NativeStop(
                    "Owned normal-hook reader unavailable",
                    "blocked",
                );
            return normalHookReader
                .bind(target.mode, target.configDigest)
                .read(target, events);
        },
        controlIdentities() {
            if (!consoleRun) return [];
            const pid = readJson(
                path.join(consoleRun, "console-state.json"),
            ).bridgePid;
            const root = consoleIdentity?.find(
                (item) => item.ProcessId === pid,
            );
            const current = processTree(pid);
            if (
                !root ||
                !current.some(
                    (item) =>
                        item.ProcessId === pid &&
                        item.StartedMs === root.StartedMs &&
                        item.ExecutablePath === root.ExecutablePath,
                )
            )
                throw new NativeStop(
                    "Native control actor ownership root changed",
                    "blocked",
                );
            return current;
        },
        finalEvents: () => sessionEvents().events,
    };
}

async function boundedNative(promise, milliseconds, signal) {
    let timer;
    let cancel;
    try {
        if (signal?.aborted)
            throw new NativeStop("Native evaluation cancelled", "blocked");
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new NativeStop(
                                "Native operation deadline exceeded",
                                "blocked",
                            ),
                        ),
                    milliseconds,
                );
                cancel = () =>
                    reject(
                        new NativeStop(
                            "Native evaluation cancelled",
                            "blocked",
                        ),
                    );
                signal?.addEventListener("abort", cancel, { once: true });
            }),
        ]);
    } finally {
        clearTimeout(timer);
        if (cancel) signal?.removeEventListener("abort", cancel);
    }
}

async function waitNative(
    adapter,
    budget,
    predicate,
    consent,
    workspace,
    decisions,
    onObservation,
) {
    const admitted = new Set();
    for (;;) {
        budget.check();
        const observation = adapter.read();
        onObservation?.(observation);
        budget.check(observation.events);
        if (
            budget.metadataOnly &&
            observation.events.some((event) =>
                [
                    "model.turn_started",
                    "model.model_call_started",
                    "assistant.turn_start",
                ].includes(event.type),
            )
        )
            throw new NativeStop(
                "Read-only initialization observed model-start telemetry; no workflows admitted",
                "blocked",
            );
        const decision = classifyNativeScreen(
            observation.screen,
            workspace,
            consent,
        );
        validateNativeObservation(observation, {
            restrictionReadiness: budget.restrictionReadiness,
            allowMetadataCatalogPending: metadataCatalogPending(
                observation,
                budget,
                decision,
            ),
        });
        if (decision) {
            if (admitted.has(decision.reason))
                throw new NativeStop(
                    "Repeated native interaction after a decision",
                    "blocked",
                );
            admitted.add(decision.reason);
            decisions.push({ at: new Date().toISOString(), ...decision });
            adapter.submit(decision.text);
        } else {
            const result = await budget.run(predicate(observation));
            if (result) return result;
        }
        await delay(250);
    }
}

async function nativeCommand(adapter, budget, text, expectation, context) {
    const before = adapter.read().events.length;
    const effect = await nativeCommandEffect(adapter, text);
    adapter.submit(text);
    return waitNative(
        adapter,
        budget,
        async (observed) => {
            if (effect) {
                const state = await effect.read(observed.sessionId);
                if (effect.accept(state)) {
                    context.commandEffects ??= [];
                    context.commandEffects.push({
                        command: text,
                        observedAt: new Date().toISOString(),
                        state,
                    });
                    return state;
                }
                return undefined;
            }
            const evidence = extractNativeEvidence(
                observed.events.slice(before),
                [],
                [],
                "direct",
            );
            return evidence.terminal === "handled-hook" &&
                expectation.test(evidence.answer)
                ? evidence
                : undefined;
        },
        undefined,
        context.workspace,
        context.decisions,
    );
}

async function nativeCommandEffect(adapter, text) {
    if (typeof adapter.learningPreference !== "function") return undefined;
    if (text === "/typeagent-macro-learning prepare") {
        const before = await adapter.learningPreference();
        requireCapture(before.mode === "off", "fresh learning must start off");
        return {
            read: () => adapter.learningPreference(),
            accept: (state) =>
                state.cwd === before.cwd &&
                state.mode === "prepare" &&
                state.revision === before.revision + 1,
        };
    }
    if (text === "/typeagent-macro-record")
        return {
            read: (sessionId) => adapter.recording(sessionId),
            accept: (state) =>
                state.status === "armed" &&
                state.token?.status === "armed" &&
                state.token.learning === true &&
                state.token.promptHash === undefined,
        };
    throw new NativeStop(
        "Unsupported live native administrative command",
        "blocked",
    );
}

async function observeSelectedCapture(adapter, observed, context) {
    const capture = context.captureState;
    if (!capture) return undefined;
    const state = await adapter.recording(observed.sessionId);
    const token = state.token;
    if (state.status === "failed")
        throw new NativeStop("Actual selected source capture failed", "failed");
    if (state.status === "claimed") {
        requireCapture(
            token?.id === capture.before.state.token.id &&
                token.sessionId === observed.sessionId &&
                token.cwd === context.workspace &&
                token.learning === true,
            "current claimed token binding mismatch",
        );
        capture.after ??= { state, observedAt: new Date().toISOString() };
    }
    if (state.status === "completed") {
        requireCapture(
            capture.after !== undefined,
            "claimed state was not observed before finalization",
        );
        capture.completed = state;
    }
    return capture.completed;
}

export async function observeTrial(
    adapter,
    budget,
    scenario,
    corpus,
    mode,
    context,
) {
    const renderingContract = context.config.renderingContract
        ? structuredClone(context.config.renderingContract)
        : undefined;
    if (
        renderingContract?.protocolVersion ===
        "synthetic-document-similarity-v5"
    )
        macroGradeContract.validateSyntheticDocumentScoringContract(
            renderingContract,
            corpus,
        );
    const before = adapter.read();
    const routes = new Set(
        before.routes.map((entry) => `${entry.conversationId}:${entry.seq}`),
    );
    const submittedAt = Date.now();
    let observedTerminalAt;
    adapter.submit(scenario.prompt);
    const document = corpus.documents.find(
        (entry) => entry.key === scenario.expectedDocument,
    );
    const consent = {
        approve: context.config.approveSyntheticReadsOnce,
        tools: [
            {
                name: "macro-eval-docs-lookup_document",
                arguments: { title: document.title },
            },
            {
                name: "macro-eval-docs-fetch_document",
                arguments: { id: document.expectedId },
            },
        ],
    };
    const evidenceFor = (observed) => {
        const events = observed.events.slice(before.events.length);
        const audit = observed.backendAudit.slice(before.backendAudit.length);
        const currentRoutes = observed.routes.filter(
            (entry) => !routes.has(`${entry.conversationId}:${entry.seq}`),
        );
        const pending = extractNativeEvidence(
            events,
            audit,
            currentRoutes,
            mode,
        );
        if (pending.terminal === "pending") return pending;
        return extractNativeEvidence(
            nativeSdkOriginalEvents(context, observed.sessionId, events),
            audit,
            currentRoutes,
            mode,
        );
    };
    const result = await waitNative(
        adapter,
        budget,
        async (observed) => {
            const evidence = evidenceFor(observed);
            if (evidence.terminal !== "pending")
                observedTerminalAt ??= Date.now();
            if (
                evidence.events.some(
                    (entry) =>
                        entry.type === "session.error" ||
                        entry.type === "subagent.failed" ||
                        (entry.type === "subagent.completed" &&
                            entry.data?.cancelled) ||
                        (entry.type === "tool.execution_complete" &&
                            entry.data?.success === false),
                )
            )
                throw new NativeStop(
                    "Native task failed or cancelled",
                    "failed",
                );
            const finalized = await observeSelectedCapture(
                adapter,
                observed,
                context,
            );
            if (evidence.terminal === "pending") return undefined;
            if (context.captureState && !finalized) return undefined;
            if (context.captureState) {
                context.captureState.sourceAudit =
                    await verifyNativeFinalizedCapture({
                        layout: context,
                        state: finalized,
                        events: evidence.events,
                        scenario,
                        sessionId: observed.sessionId,
                    });
                context.captureState.readFinalizedSource ??=
                    await adapter.finalizedSourceReader(observed.sessionId);
                evidence.readFinalizedSource =
                    context.captureState.readFinalizedSource;
            }
            if (
                ["bypass", "mcp"].includes(mode) &&
                typeof adapter.normalHookCallback === "function" &&
                evidence.terminal === "root-turn"
            )
                await admitOrdinaryCallback(
                    evidence,
                    adapter,
                    observed,
                    scenario,
                    context,
                    submittedAt,
                    budget,
                );
            const grade = gradeDocumentTrial({
                ...evidence,
                scenario,
                documents: corpus.documents,
                ...(renderingContract ? { renderingContract } : {}),
            });
            const terminalPassed = grade.checks.find(
                (check) => check.name === "terminal-native-completion",
            )?.passed;
            if (!terminalPassed && evidence.terminal === "pending")
                return undefined;
            return {
                scenarioId: scenario.id,
                sessionId: observed.sessionId,
                mode,
                evidence,
                grade,
                ...(renderingContract ? { renderingContract } : {}),
                submittedAt,
                observedTerminalAt,
                timingBoundary: "controller-submit-to-observed-terminal",
            };
        },
        consent,
        context.workspace,
        context.decisions,
        (observed) => {
            context.partialTrial = {
                scenarioId: scenario.id,
                sessionId: observed.sessionId,
                submittedAt,
                observedAt: Date.now(),
                evidence: evidenceFor(observed),
                ...(renderingContract ? { renderingContract } : {}),
            };
        },
    );
    result.elapsedMs = result.observedTerminalAt - result.submittedAt;
    if (
        result.evidence.terminal === "handled-hook" &&
        !result.grade.checks.find(
            (check) => check.name === "terminal-native-completion",
        )?.passed
    ) {
        result.status = "blocked";
        result.blockedReason =
            "Authoritative handled-hook literal response has no turnId/host phases; grader contract update required";
    } else result.status = result.grade.status;
    context.partialTrial = undefined;
    return result;
}

async function admitOrdinaryCallback(
    evidence,
    adapter,
    observed,
    scenario,
    context,
    submittedAt,
    budget,
) {
    const configPath = path.join(context.pluginData, "config.json");
    const config = readJson(configPath);
    const digest = hash(
        JSON.stringify({
            configPath,
            dataRoot: fs.realpathSync(context.data),
            effectiveMode: config.mode,
            mcpRouting: config.mcpRouting ?? "delegate",
        }),
    );
    const target = {
        sessionId: observed.sessionId,
        prompt: scenario.prompt,
        cwd: context.workspace,
        submittedAtMs: submittedAt,
        deadlineMs: Date.now() + budget.remaining(),
        mode: config.mode,
        configDigest: digest,
    };
    const sessionStarts = observed.events.filter(
        (event) =>
            event.type === "session.start" &&
            event.data?.sessionId === target.sessionId,
    );
    if (sessionStarts.length !== 1)
        throw new NativeStop(
            "Actual exact-session native session.start missing/ambiguous",
            "blocked",
        );
    evidence.events = [
        sessionStarts[0],
        ...evidence.events.filter((event) => event.type !== "session.start"),
    ];
    context.normalCallbacks ??= new Map();
    const key = `${target.sessionId}:${submittedAt}`;
    let callback = context.normalCallbacks.get(key);
    if (!callback) {
        callback = adapter.normalHookCallback(target, evidence.events);
        context.normalCallbacks.set(key, callback);
    }
    const control = readJson(
        path.join(
            context.data,
            "native-control",
            `native-hook-${callback.routerPeer.ProcessId}.json`,
        ),
    );
    const { redactTraceValue } = await import(
        pathToFileURL(
            path.join(
                tsRoot,
                "packages",
                "copilot-macros",
                "dist",
                "redaction.js",
            ),
        )
    );
    evidence.routeEvidence = {
        route: "ordinary-copilot",
        receipt: {
            schemaVersion: 1,
            origin: "trusted-native-controller",
            policy: context.captureState
                ? "mcp-mixed-source-capture"
                : "bypass-baseline",
            expected: {
                owner: context.owner,
                ownedRoot: context.run,
                sessionId: target.sessionId,
                prompt: scenario.prompt,
                promptHash: hash(redactTraceValue(scenario.prompt)),
                cwd: context.workspace,
                configPath,
                dataRoot: context.data,
                digest,
                effectiveMode: config.mode,
                routing: config.mcpRouting ?? "delegate",
                startedAt:
                    context.captureState?.before.observedAt ??
                    new Date(submittedAt).toISOString(),
                endedAt: new Date().toISOString(),
            },
            hook: {
                hookInvocationId: callback.native.hookInvocationId,
                startEventId: callback.native.hookStartEventId,
                endEventId: callback.native.hookEndEventId,
            },
            control,
            callback,
            capture: context.captureState
                ? {
                      policy: "selected-source",
                      before: context.captureState.before,
                      after: context.captureState.after,
                  }
                : { policy: "none" },
        },
    };
}

export function assertLiveAdmission(
    config,
    adapterFactory,
    contracts = macroGradeContract,
) {
    if (
        config.renderingContract &&
        !adapterFactory &&
        contracts[
            {
                "synthetic-document-rendering-v2":
                    "syntheticDocumentRenderingContract",
                "synthetic-document-rendering-v3":
                    "syntheticDocumentFenceRenderingContract",
                "synthetic-document-rendering-v4":
                    "syntheticDocumentBlockquoteRenderingContract",
                "synthetic-document-similarity-v5":
                    "syntheticDocumentSimilarityContract",
            }[config.renderingContract.protocolVersion]
        ] !== config.renderingContract.protocolVersion
    )
        throw new NativeStop(
            "Rendered-content scoring blocked before models: tested versioned synthetic renderer contract unavailable",
            "blocked",
        );
    if (
        !config.diagnosticOnly &&
        !adapterFactory &&
        (contracts.nativeOrdinaryCallbackContract !==
            "native-normal-hook-callback-v1" ||
            (!config.attributionOnly &&
                contracts.nativeSelectedSourceContract !==
                    "native-finalized-selected-source-v1"))
    )
        throw new NativeStop(
            "Task rehearsal blocked before models: original native callback and finalized selected-source grader capability must be available; lease snapshots alone do not admit capture.",
            "blocked",
        );
    if (!adapterFactory && process.platform !== "win32")
        throw new NativeStop(
            "Live native controller requires Windows",
            "blocked",
        );
}

export async function assertNativeBuildObservability(
    config,
    adapterFactory,
    load = () =>
        import(
            pathToFileURL(
                path.join(
                    tsRoot,
                    "packages",
                    "defaultAgentProvider",
                    "dist",
                    "index.js",
                ),
            ).href
        ),
) {
    if (!config.retainSyntheticLearningResponses || adapterFactory) return;
    let implementation;
    try {
        implementation = await load();
    } catch {
        throw new NativeStop(
            "Private synthetic build diagnostics blocked before boot: compiled product observer unavailable",
            "blocked",
        );
    }
    if (
        implementation.nativeSyntheticBuildResponseDiagnosticContract !==
            "native-synthetic-build-response-policy-v1" ||
        typeof implementation.createSyntheticMacroLearningDiagnostics !==
            "function"
    )
        throw new NativeStop(
            "Private synthetic build diagnostics blocked before boot: compiled product observer contract unavailable",
            "blocked",
        );
}

async function admitNormalHookBoot(adapter, budget, layout, context, ready) {
    if (typeof adapter.normalHookCallback !== "function") return;
    admitDiagnosticCatalog(layout, ready, adapter);
    const file = path.join(
        layout.data,
        "native-control-diagnostic-result.json",
    );
    const result = await waitNative(
        adapter,
        budget,
        (observed) => {
            if (!fs.existsSync(file)) return undefined;
            const value = readJson(file);
            return value.status === "running" ||
                value.sessionId !== observed.sessionId
                ? undefined
                : value;
        },
        undefined,
        layout.workspace,
        context.decisions,
    );
    const identities = adapter.controlIdentities?.() ?? [];
    const controls = (result.transitions ?? []).map((transition) =>
        nativeControlProof(
            layout,
            transition.mode,
            identities,
            transition.control,
        ),
    );
    context.fixtureCatalogProof = completeNativeRestrictionReadiness(
        budget.restrictionReadiness,
        result,
        controls,
        ready.sessionId,
    );
    context.startupControls = result;
    if (context.config.diagnosticOnly !== true) {
        const original = result.toolOriginals;
        const actor = result.transitions
            .at(-1)
            .control.find(
                (entry) => entry.source.component === "native-extension-status",
            )?.source;
        requireCapture(
            original?.file ===
                path.join(
                    layout.data,
                    "native-sdk-originals",
                    `${ready.sessionId}.jsonl`,
                ) &&
                original.source.component ===
                    "native-sdk-synthetic-tool-originals" &&
                original.source.pid === actor?.pid &&
                original.source.parentPid === actor?.parentPid &&
                original.source.executable === actor?.executable &&
                original.source.cwd === layout.workspace &&
                Number.isFinite(Date.parse(original.startedAt)) &&
                Date.parse(original.startedAt) <=
                    Date.parse(result.toolInitialization.startedAt),
            "original SDK observer is not the admitted native extension actor",
        );
        context.sdkOriginalsBinding = original;
    }
}

function requireCurrentControlProof(adapterFactory, proof) {
    if (!adapterFactory && !proof.passed)
        throw new NativeStop(
            "Authoritative native mode/data-root binding is missing or mismatched; no task admitted",
            "blocked",
        );
}

function latestStartupControl(context) {
    return context.startupControls?.transitions?.at(-1)?.control;
}

function nativeRestrictionState(layout, report, adapterFactory) {
    if (adapterFactory) return undefined;
    return {
        phase: "initializing",
        owner: layout.owner,
        startedAt: report.startedAt,
        deadlineMs: Date.parse(report.startedAt) + 180000,
        selectors: nativeToolFilters().filter(
            (name) => !name.startsWith("builtin:"),
        ),
        warnings: [],
    };
}

function metadataDiagnosticGateError(report, diagnostic) {
    if (
        report.fixtureCatalogProof ||
        diagnostic.status === "passed-metadata-only"
    )
        return report.diagnostic.remainingGate;
    return (
        diagnostic.error ??
        "Actual native control transition diagnostic blocked"
    );
}

export function nativePreparationState(state, report) {
    if (state.learningJob?.status === "failed") {
        report.learningFailure = state.learningJob;
        throw new NativeStop("Macro preparation failed", "failed");
    }
    return state.learningJob?.status === "needsReview" ? state : undefined;
}

async function acquireNativeDraft({
    adapter,
    budget,
    layout,
    context,
    selected,
    corpus,
    report,
    sessionId,
}) {
    const nativeCapture = typeof adapter.finalizedSourceReader === "function";
    if (context.config.retainSyntheticLearningResponses && !nativeCapture)
        throw new NativeStop(
            "Private build diagnostics require actual native selected capture",
            "blocked",
        );
    adapter.setMode(
        nativeCapture ? "mcp" : "direct",
        nativeCapture ? "mixed" : undefined,
    );
    await nativeCommand(
        adapter,
        budget,
        "/typeagent-macro-learning prepare",
        /prepare/iu,
        context,
    );
    const armed = await nativeCommand(
        adapter,
        budget,
        "/typeagent-macro-record",
        /Recording token:/u,
        context,
    );
    if (nativeCapture) {
        requireCapture(
            armed.token.sessionId === sessionId &&
                armed.token.cwd === layout.workspace,
            "actual armed source workspace/session mismatch",
        );
        context.captureState = {
            before: { state: armed, observedAt: new Date().toISOString() },
        };
        const policy = nativeBuildResponsePolicy(
            layout,
            context.config,
            corpus,
            sessionId,
        );
        if (policy) {
            const file = path.join(
                layout.data,
                "native-build-response-policy.json",
            );
            writeJson(file, policy);
            report.learningDiagnosticPolicy = {
                file,
                sha256: hash(fs.readFileSync(file)),
            };
        }
    }
    const training = await observeTrial(
        adapter,
        budget,
        selected.training,
        corpus,
        nativeCapture ? "mcp" : "direct",
        context,
    );
    report.trials.push({ ...training, candidate: "training" });
    if (nativeCapture) {
        report.selectedSourceAudit = context.captureState.sourceAudit;
        report.selectedSourceSnapshots = {
            before: context.captureState.before,
            after: context.captureState.after,
        };
        context.captureState = undefined;
    }
    if (training.status !== "passed")
        throw new NativeStop(
            "Training correctness/completion oracle did not pass",
            training.status,
        );
    return waitNative(
        adapter,
        budget,
        async (observed) => {
            const state = await adapter.recording(observed.sessionId);
            return nativePreparationState(state, report);
        },
        undefined,
        layout.workspace,
        report.decisions,
    );
}

function ownNativeApprovedLayout(output, config, corpus) {
    const source = verifyApprovedCatalogSource(
        config.approvedCatalog,
        corpus,
        path.resolve(scripts, ".."),
    );
    const layout = {
        run: source.root,
        owner: source.owner,
        workspace: path.join(source.root, "workspace"),
        plugin: path.join(source.root, "plugin"),
        pluginData: path.join(source.root, "plugin-data"),
        data: path.join(source.root, "data"),
        instance: source.instance,
        port: config.port,
        approvedSource: source,
    };
    verifyNativeWorkspace(layout, source.manifest.workspaceFiles);
    layout.approvedPhase = ownApprovedCatalogPhase(output, source);
    layout.audit = path.join(layout.approvedPhase.artifacts, "backend.jsonl");
    try {
        fs.writeFileSync(layout.audit, "", { flag: "wx", mode: 0o600 });
    } catch (error) {
        layout.approvedPhase.restore();
        throw error;
    }
    return layout;
}

function verifyNativeApprovedSourceReleased(layout) {
    const proof = readJson(path.join(layout.run, "cleanup-verification.json"));
    if (
        proof.slotReleased !== true ||
        !proof.allPersistedServiceControlIdentities?.length
    )
        throw new NativeStop(
            "Prior owned service/control cleanup is not established",
            "blocked",
        );
    const ids = proof.allPersistedServiceControlIdentities.map((identity) => ({
        pid: identity.pid,
        started: identity.expectedStartedMs,
    }));
    if (
        ids.some(
            (identity) =>
                !Number.isSafeInteger(identity.pid) ||
                !Number.isSafeInteger(identity.started),
        )
    )
        throw new NativeStop(
            "Prior owned process identities are incomplete",
            "blocked",
        );
    const encoded = Buffer.from(JSON.stringify(ids)).toString("base64");
    const root = Buffer.from(layout.run).toString("base64");
    const observed = execFileSync(
        "powershell.exe",
        [
            "-NoProfile",
            "-Command",
            `. $PROFILE; $ErrorActionPreference='Stop'; $all=@(Get-CimInstance Win32_Process); ` +
                `$ids=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json; ` +
                `$live=@(foreach($i in $ids){ $p=$all|Where-Object ProcessId -eq $i.pid; ` +
                `if($p -and ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() -eq $i.started){$i.pid} }); ` +
                `$root=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${root}')); ` +
                `$ours=[Collections.Generic.HashSet[int]]::new(); $pidNow=${process.pid}; ` +
                `while($pidNow -gt 0 -and $ours.Add($pidNow)){ $p=$all|Where-Object ProcessId -eq $pidNow; $pidNow=[int]$p.ParentProcessId }; ` +
                `$foreign=@($all|Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) -and !$ours.Contains([int]$_.ProcessId) }|ForEach-Object ProcessId); ` +
                `ConvertTo-Json -InputObject @{owned=$live;foreign=$foreign} -Compress`,
        ],
        { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const current = JSON.parse(observed);
    if (current.owned.length || current.foreign.length)
        throw new NativeStop("Prior owned actors are still live", "blocked");
    writeJson(
        path.join(
            artifactDirectory(layout),
            "source-release-verification.json",
        ),
        {
            checkedAt: new Date().toISOString(),
            persistedIdentitiesAbsent: ids,
            otherOwnedRootActorsAbsent: true,
            stopOperationPerformed: false,
        },
    );
}

function requireApprovedCatalogEntry(catalog, source) {
    const matching = catalog.filter(
        (entry) => entry.macroId === source.macro.macroId,
    );
    if (
        catalog.length !== 1 ||
        matching.length !== 1 ||
        matching[0].version !== source.macro.version ||
        matching[0].state !== "approved"
    )
        throw new NativeStop(
            "Exact approved catalog version is not current after owned service start",
            "blocked",
        );
    verifyApprovedVersionUnchanged(source);
}

async function admitApprovedPhaseConsole({
    adapter,
    budget,
    layout,
    context,
    report,
    config,
    previousSession,
    index,
    adapterFactory,
}) {
    await budget.run(adapter.openConsole());
    const mode = await configureNativeLoadOnly(
        adapter,
        budget,
        config,
        context,
    );
    const proof = verifyNativeLoadOnlyEvidence(
        layout,
        path.join(
            layout.run,
            `home-${layout.approvedPhase.homeOffset + index}`,
        ),
        mode,
        budget.restrictionReadiness,
    );
    const ready = await waitNative(
        adapter,
        budget,
        (observed) =>
            observed.sessionId !== previousSession &&
            nativeReadyObservation(observed),
        undefined,
        layout.workspace,
        report.decisions,
    );
    await admitNormalHookBoot(adapter, budget, layout, context, ready);
    const control = nativeControlProof(
        layout,
        "bypass",
        adapter.controlIdentities?.() ?? [],
        latestStartupControl(context),
    );
    requireCurrentControlProof(adapterFactory, control);
    report.approvedPhaseBoots ??= [];
    report.approvedPhaseBoots.push({
        sessionId: ready.sessionId,
        extensionMode: proof,
        control,
        fixtureCatalog: context.fixtureCatalogProof,
        startupControls: context.startupControls,
    });
    return ready.sessionId;
}

async function inspectApprovedPhaseMacro(adapter, layout, report) {
    layout.approvedPhase.verifyLearningUnchanged();
    const preference = await adapter.learningPreference();
    if (preference.mode !== "off")
        throw new NativeStop(
            "Pure RUN learning preference is not off",
            "blocked",
        );
    const reference = {
        macroId: layout.approvedSource.macro.macroId,
        version: layout.approvedSource.macro.version,
    };
    const macro = await adapter.inspect(reference);
    const validation = await adapter.validate(reference);
    reviewNativeApprovedMacro(macro, validation, layout.approvedSource);
    report.currentCatalogValidations ??= [];
    report.currentCatalogValidations.push({
        reference,
        validatedAt: new Date().toISOString(),
        supportedValidation: validation,
        definitionHash: hash(JSON.stringify(macro)),
        pinnedVersionUnchanged: true,
        learningPreference: preference,
    });
    return reference;
}

function requireApprovedGrammarTrial(trial, reference) {
    if (
        trial.status !== "passed" ||
        trial.evidence.routeEvidence.route !== "grammar" ||
        trial.evidence.routeEvidence.macroId !== reference.macroId ||
        trial.evidence.routeEvidence.version !== reference.version ||
        trial.evidence.executionEvidence.wholeMacroInvocations !== 1 ||
        trial.evidence.executionEvidence.effects.length !== 0
    )
        throw new NativeStop(
            "Pinned approved reuse must pass actual grammar/immutable version/execution evidence",
            trial.status === "failed" ? "failed" : "blocked",
        );
}

export function resetNativeRestartAdmission(layout) {
    const file = path.join(layout.data, "native-control-admission.json");
    const admission = readJson(file);
    const configFile = path.join(layout.pluginData, "config.json");
    const config = readJson(configFile);
    if (
        admission.owner !== layout.owner ||
        admission.ownedRoot !== layout.run ||
        admission.configPath !== path.join(layout.pluginData, "config.json") ||
        admission.expectedMode !== "bypass" ||
        config.mode !== "bypass"
    )
        throw new NativeStop(
            "Owned restart admission roots/mode changed",
            "blocked",
        );
    const {
        diagnosticCatalogReady: _ready,
        diagnosticCatalogSessionId: _session,
        diagnosticActorIdentities: _actors,
        diagnosticRestrictionWarnings: _warnings,
        ...fresh
    } = admission;
    writeJson(
        path.join(artifactDirectory(layout), "restart-admission-before.json"),
        { admission, config },
    );
    const { mcpRouting: _retiredRouting, ...initialBypass } = config;
    writeJson(`${configFile}.pending`, initialBypass);
    fs.renameSync(`${configFile}.pending`, configFile);
    writeJson(`${file}.pending`, fresh);
    fs.renameSync(`${file}.pending`, file);
}

async function runNativeApprovedCatalogTrials(options) {
    const {
        adapter,
        budget,
        layout,
        context,
        report,
        config,
        corpus,
        selected,
        catalog,
    } = options;
    const source = layout.approvedSource;
    requireApprovedCatalogEntry(catalog, source);
    const restart = getScenarioCases(corpus).find(
        (scenario) => scenario.id === config.approvedCatalog.restartCase,
    );
    if (
        !restart ||
        restart.kind !== "positive" ||
        restart.familyId !== selected.reuse.familyId ||
        restart.expectedDocument === selected.reuse.expectedDocument ||
        restart.expectedDocument === selected.training.expectedDocument ||
        !/^[\x20-\x7e]{1,2000}$/u.test(restart.prompt) ||
        ["pending", "blocked", "blocked-not-accepted"].includes(restart.status)
    )
        throw new NativeStop(
            "Approved restart requires a distinct current document in the same positive family",
            "blocked",
        );
    report.phase = "approved-catalog-reuse-restart";
    report.endToEndLearningAcceptance = "not exercised; remains separate";
    report.historicalLearning = {
        reference: {
            macroId: source.macro.macroId,
            version: source.macro.version,
        },
        pins: source.pins,
        sourceResultStatus: source.report.status,
        publication: source.report.operatorActions,
    };
    const before = await budget.run(adapter.learningPreference());
    report.learningPreferenceBefore = before;
    const off = await budget.run(adapter.setLearningPreference("off"));
    if (off.mode !== "off")
        throw new NativeStop(
            "Pure RUN phase did not disable learning",
            "blocked",
        );
    report.learningPreferenceDuring = off;
    const reference = await inspectApprovedPhaseMacro(adapter, layout, report);
    await admitApprovedPhaseConsole({ ...options, index: 0 });
    adapter.setMode("direct");
    const reuse = await observeTrial(
        adapter,
        budget,
        selected.reuse,
        corpus,
        "direct",
        context,
    );
    report.trials.push({ ...reuse, candidate: "approved-reuse" });
    requireApprovedGrammarTrial(reuse, reference);
    adapter.setMode("bypass");
    await budget.run(adapter.closeConsole());
    await budget.run(adapter.stopService());
    resetNativeRestartAdmission(layout);
    if (!options.adapterFactory)
        budget.restrictionReadiness = {
            ...nativeRestrictionState(layout, {
                startedAt: new Date().toISOString(),
            }),
            deadlineMs: Date.now() + Math.min(180000, budget.remaining()),
        };
    const persisted = await budget.run(adapter.startService());
    requireApprovedCatalogEntry(persisted, source);
    await inspectApprovedPhaseMacro(adapter, layout, report);
    await admitApprovedPhaseConsole({
        ...options,
        previousSession: reuse.sessionId,
        index: 1,
    });
    adapter.setMode("direct");
    const restarted = await observeTrial(
        adapter,
        budget,
        restart,
        corpus,
        "direct",
        context,
    );
    report.trials.push({ ...restarted, candidate: "approved-restart-reuse" });
    requireApprovedGrammarTrial(restarted, reference);
    report.runtime = adapter.runtime();
    report.status = "passed";
    report.acceptance =
        "current approved-catalog Direct reuse and actual owned restart only; no new learning/publication";
}

function validateNativeInvocation(executeLive, config, helperDirectory) {
    if (typeof executeLive !== "boolean")
        throw new Error("executeLive must be boolean");
    if (config.approvedCatalog && !executeLive)
        throw new Error(
            "Approved catalog phase requires explicit live admission",
        );
    if (!path.isAbsolute(helperDirectory ?? ""))
        throw new Error(
            "Explicit absolute --console-helper-dir required (scripts directory)",
        );
}

function createEvaluationLayout(output, config, corpus) {
    return config.approvedCatalog
        ? ownNativeApprovedLayout(output, config, corpus)
        : ownLayout(output, config);
}

function beginApprovedPhase(layout, executeLive, adapterFactory) {
    if (!layout.approvedPhase) return;
    if (executeLive && !adapterFactory)
        verifyNativeApprovedSourceReleased(layout);
    layout.approvedPhase.begin();
}

export async function runNativeEvaluation({
    corpus,
    config,
    output,
    helperDirectory,
    executeLive = false,
    signal,
    adapterFactory,
}) {
    const selected = validateNativeConfig(config, corpus);
    validateNativeInvocation(executeLive, config, helperDirectory);
    const layout = createEvaluationLayout(output, config, corpus);
    const report = {
        ...nativeScoringDeclaration(config),
        status: "unexecuted",
        trials: [],
        decisions: [],
        operatorActions: [],
        startedAt: new Date().toISOString(),
    };
    let adapter;
    const budget = createNativeBudget(config, signal);
    budget.metadataOnly = config.diagnosticOnly === true;
    budget.restrictionReadiness = nativeRestrictionState(
        layout,
        report,
        adapterFactory,
    );
    const context = { ...layout, config, decisions: report.decisions };
    layout.controlStartedAt = report.startedAt;
    let controlIdentities = [];
    try {
        budget.check();
        beginApprovedPhase(layout, executeLive, adapterFactory);
        const manifest = prepareNative(layout, config, corpus, helperDirectory);
        writeJson(nativeManifestFile(layout), manifest);
        if (!executeLive) return report;
        assertLiveAdmission(config, adapterFactory);
        await budget.run(
            assertNativeBuildObservability(config, adapterFactory),
        );
        adapter = await (adapterFactory ?? makeLiveAdapter)(
            layout,
            config,
            helperDirectory,
            budget,
        );
        const catalog = await budget.run(adapter.startService());
        if (layout.approvedPhase) {
            await runNativeApprovedCatalogTrials({
                adapter,
                budget,
                layout,
                context,
                report,
                config,
                corpus,
                selected,
                catalog,
                adapterFactory,
            });
            return report;
        }
        if (catalog.length)
            throw new NativeStop("Fresh owned catalog is not empty");
        await budget.run(adapter.openConsole());
        const modeObservation = await configureNativeLoadOnly(
            adapter,
            budget,
            config,
            context,
        );
        report.extensionModeProof = verifyNativeLoadOnlyEvidence(
            layout,
            path.join(layout.run, "home-0"),
            modeObservation,
            budget.restrictionReadiness,
        );
        const readyObservation = await waitNative(
            adapter,
            budget,
            nativeReadyObservation,
            undefined,
            layout.workspace,
            report.decisions,
        );
        if (config.diagnosticOnly) {
            admitDiagnosticCatalog(layout, readyObservation, adapter);
            const transitionFile = path.join(
                layout.data,
                "native-control-diagnostic-result.json",
            );
            const transitionDiagnostic = await waitNative(
                adapter,
                budget,
                () => {
                    if (!fs.existsSync(transitionFile)) return undefined;
                    const value = readJson(transitionFile);
                    return value.status === "running" ? undefined : value;
                },
                undefined,
                layout.workspace,
                report.decisions,
            );
            const observed = adapter.read();
            validateNativeObservation(observed, {
                restrictionReadiness: budget.restrictionReadiness,
            });
            budget.check(observed.events);
            report.diagnostic = {
                kind: "metadata-only-startup",
                toolFilters: nativeToolFilters(),
                nativeCommandSubmitted: false,
                commandContract:
                    "No user/task submitted. Native extension uses commands.list/invoke for existing local mode setters and canonical Node getter; session.tools.initializeAndValidate followed by unfiltered getCurrentMetadata, never send/tool execute.",
                observedEvents: observed.events.length,
                sessionId: observed.sessionId,
                statusViewport: observed.screen,
                restrictionMetadata:
                    "Required supported Load Only; exact unfiltered inventory and schemas; no unresolved selector warnings or execution grants",
                remainingGate:
                    "Native user-prompt callback and capture lease proof remain unavailable; ordinary-route receipt must stay proof-blocked. Tool availability metadata is not execution-permission proof.",
                transitions: transitionDiagnostic,
            };
            controlIdentities = adapter.controlIdentities?.() ?? [];
            report.controlTransitionProofs = (
                transitionDiagnostic.transitions ?? []
            ).map((transition) =>
                nativeControlProof(
                    layout,
                    transition.mode,
                    controlIdentities,
                    transition.control,
                ),
            );
            report.controlProof =
                report.controlTransitionProofs.at(-1) ??
                nativeControlProof(layout, "bypass", controlIdentities);
            if (budget.restrictionReadiness)
                report.fixtureCatalogProof = completeNativeRestrictionReadiness(
                    budget.restrictionReadiness,
                    transitionDiagnostic,
                    report.controlTransitionProofs,
                    observed.sessionId,
                );
            validateNativeObservation(observed, {
                restrictionReadiness: budget.restrictionReadiness,
            });
            writeJson(
                path.join(layout.run, "native-startup-evidence.json"),
                report.diagnostic,
            );
            report.status = "blocked";
            report.error = metadataDiagnosticGateError(
                report,
                transitionDiagnostic,
            );
            return report;
        }
        await admitNormalHookBoot(
            adapter,
            budget,
            layout,
            context,
            readyObservation,
        );
        report.startupControls = context.startupControls;
        report.fixtureCatalogProof = context.fixtureCatalogProof;
        controlIdentities = adapter.controlIdentities?.() ?? [];
        report.controlProof = nativeControlProof(
            layout,
            "bypass",
            controlIdentities,
            latestStartupControl(context),
        );
        requireCurrentControlProof(adapterFactory, report.controlProof);
        adapter.setMode("bypass");
        const baseline = await observeTrial(
            adapter,
            budget,
            selected.reuse,
            corpus,
            "bypass",
            context,
        );
        report.trials.push({ ...baseline, candidate: "baseline" });
        if (baseline.status !== "passed")
            throw new NativeStop(
                "Baseline oracle did not pass",
                baseline.status,
            );
        if (config.attributionOnly) {
            report.status = "passed-attribution-only";
            report.acceptance =
                "one ordinary synthetic baseline only; capture/reuse/restart not admitted";
            return report;
        }
        const recording = await acquireNativeDraft({
            adapter,
            budget,
            layout,
            context,
            selected,
            corpus,
            report,
            sessionId: readyObservation.sessionId,
        });
        const reference = recording.learningJob.macro;
        const draft = await budget.run(adapter.inspect(reference));
        reviewNativeDraft(draft, await budget.run(adapter.validate(reference)));
        if (report.selectedSourceAudit)
            reviewNativePublicationBinding(
                draft,
                recording,
                report.selectedSourceAudit,
                layout.workspace,
            );
        writeJson(path.join(layout.run, "reviewed-draft.json"), draft);
        if (!config.reviewSyntheticDraft)
            throw new NativeStop(
                "External bounded synthetic publication review not authorized",
                "blocked",
            );
        const approved = await budget.run(adapter.approve(reference));
        report.operatorActions.push({
            operation: "external bounded synthetic review/approve",
            reference: approved,
        });
        adapter.setMode("direct");
        const reuse = await observeTrial(
            adapter,
            budget,
            selected.reuse,
            corpus,
            "direct",
            context,
        );
        report.trials.push({ ...reuse, candidate: "reuse" });
        requireGrammarTrial(reuse);
        if (config.restart) {
            adapter.setMode("bypass");
            await budget.run(adapter.closeConsole());
            await budget.run(adapter.stopService());
            resetNativeRestartAdmission(layout);
            if (!adapterFactory)
                budget.restrictionReadiness = {
                    ...nativeRestrictionState(layout, {
                        startedAt: new Date().toISOString(),
                    }),
                    deadlineMs:
                        Date.now() + Math.min(180000, budget.remaining()),
                };
            const persisted = await budget.run(adapter.startService());
            if (
                !persisted.some(
                    (item) =>
                        item.macroId === approved.macroId &&
                        item.version === approved.version &&
                        item.state === "approved",
                )
            )
                throw new NativeStop(
                    "Approved macro missing after owned service restart",
                );
            await budget.run(adapter.openConsole());
            const restartMode = await configureNativeLoadOnly(
                adapter,
                budget,
                config,
                context,
            );
            report.restartExtensionModeProof = verifyNativeLoadOnlyEvidence(
                layout,
                path.join(layout.run, "home-1"),
                restartMode,
                budget.restrictionReadiness,
            );
            const restartReady = await waitNative(
                adapter,
                budget,
                (observation) =>
                    observation.sessionId &&
                    observation.sessionId !== reuse.sessionId &&
                    /Session:/u.test(observation.screen),
                undefined,
                layout.workspace,
                report.decisions,
            );
            if (!adapterFactory) {
                await admitNormalHookBoot(
                    adapter,
                    budget,
                    layout,
                    context,
                    restartReady,
                );
                report.restartFixtureCatalogProof = context.fixtureCatalogProof;
                report.restartStartupControls = context.startupControls;
                report.restartRestrictionReadiness =
                    budget.restrictionReadiness;
            }
            adapter.setMode("direct");
            const restarted = await observeTrial(
                adapter,
                budget,
                selected.reuse,
                corpus,
                "direct",
                context,
            );
            report.trials.push({ ...restarted, candidate: "restart-reuse" });
            requireGrammarTrial(restarted);
        }

        function requireGrammarTrial(trial) {
            if (
                trial.status !== "passed" ||
                trial.evidence.routeEvidence.route !== "grammar"
            )
                throw new NativeStop(
                    "Reuse must pass with actual grammar attribution",
                    trial.status === "passed" ? "blocked" : trial.status,
                );
        }
        report.status = "passed";
        report.runtime = adapter.runtime();
        return report;
    } catch (error) {
        report.status = nativeFailureStatus(error);
        report.error = error.message;
        return report;
    } finally {
        await finalizeNativeEvaluation({
            adapter,
            budget,
            layout,
            report,
            context,
            controlIdentities,
            config,
        });
    }
}

async function restoreApprovedPreference(adapter, layout, report) {
    if (!layout.approvedPhase || !report.learningPreferenceBefore) return;
    try {
        const restored = await boundedNative(
            adapter.setLearningPreference(report.learningPreferenceBefore.mode),
            30000,
        );
        if (restored.mode !== report.learningPreferenceBefore.mode)
            throw new Error(
                "Original owned learning preference was not restored",
            );
        report.learningPreferenceRestored = restored;
    } catch (error) {
        report.cleanupErrors.push(error.message);
    }
}

function restoreApprovedHistory(layout, report) {
    if (!layout.approvedPhase) return;
    if (report.ownedActorCleanupFailed) {
        report.scopedHistoryRestored = false;
        report.cleanupErrors.push(
            "Owned actor shutdown failed; scoped history/phase lock retained rather than mutate a potentially live runtime",
        );
        report.status = "harness-invalid";
        return;
    }
    for (const operation of [
        () => verifyApprovedVersionUnchanged(layout.approvedSource),
        () => {
            layout.approvedPhase.restore();
            verifyNativeWorkspace(
                layout,
                layout.approvedSource.manifest.workspaceFiles,
            );
            report.scopedHistoryRestored = true;
            report.learningJobsAndSuppressionUnchanged = true;
        },
    ])
        try {
            operation();
        } catch (error) {
            report.cleanupErrors.push(error.message);
            report.status = "harness-invalid";
        }
}

async function finalizeNativeEvaluation({
    adapter,
    budget,
    layout,
    report,
    context,
    controlIdentities,
    config,
}) {
    const transitionFile = path.join(
        layout.data,
        "native-control-diagnostic-result.json",
    );
    if (fs.existsSync(transitionFile))
        report.controlTransitions = readJson(transitionFile);
    try {
        controlIdentities = adapter?.controlIdentities?.() ?? controlIdentities;
    } catch (error) {
        report.controlOwnershipError = error.message;
    }
    report.shutdownControlSnapshot = nativeControlProof(
        layout,
        report.trials.at(-1)?.mode ?? "bypass",
        controlIdentities,
    );
    if (context.partialTrial) report.incompleteTrial = context.partialTrial;
    report.commandEffects = context.commandEffects ?? [];
    if (context.captureState) {
        report.selectedSourceSnapshots = {
            before: context.captureState.before,
            after: context.captureState.after,
        };
        report.selectedSourceAudit = context.captureState.sourceAudit;
    }
    report.restrictionReadiness = budget.restrictionReadiness;
    report.completedAt = new Date().toISOString();
    report.elapsedMs =
        Date.parse(report.completedAt) - Date.parse(report.startedAt);
    report.cleanupErrors = [];
    await restoreApprovedPreference(adapter, layout, report);
    for (const operation of ["closeConsole", "stopService"])
        try {
            await boundedNative(adapter?.[operation](), 30000);
        } catch (error) {
            report.cleanupErrors.push(error.message);
            report.ownedActorCleanupFailed = true;
        }
    if (report.cleanupErrors.length) report.status = "harness-invalid";
    const finalEvents = adapter?.finalEvents?.() ?? [];
    try {
        budget.observe(finalEvents);
        if (budget.used() > config.maxTargetModelTurns) {
            report.status = "blocked";
            report.error = "Native target model turn bound exceeded";
        }
    } catch (error) {
        report.status = "harness-invalid";
        report.error = error.message;
    }
    report.targetModelTurns = budget.used();
    report.nativeModelTelemetry = {
        countsScope:
            "Latest native session only; targetModelTurns reconciles unique persisted turn identities across observed sessions",
        accounting:
            "Unique persisted assistant.turn_start identities, root and child, reconciled after cleanup; model-start/call telemetry is reported separately, not service usage",
        counts: Object.fromEntries(
            [
                "assistant.turn_start",
                "model.turn_started",
                "model.model_call_started",
            ].map((type) => [
                type,
                finalEvents.filter((event) => event.type === type).length,
            ]),
        ),
        modelStarts: finalEvents.filter((event) =>
            ["model.turn_started", "model.model_call_started"].includes(
                event.type,
            ),
        ),
        serviceModelUsage:
            "unknown: no complete service model-start telemetry contract",
    };
    if (
        config.diagnosticOnly &&
        Object.values(report.nativeModelTelemetry.counts).some(
            (count) => count > 0,
        )
    ) {
        report.status = "harness-invalid";
        report.error =
            "Metadata-only diagnostic observed native model generation telemetry";
    }
    restoreApprovedHistory(layout, report);
    writeJson(path.join(artifactDirectory(layout), "result.json"), report);
}
