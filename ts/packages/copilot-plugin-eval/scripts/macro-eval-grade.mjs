// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { documentFamilyId } from "./macro-eval-corpus.mjs";
import { createHash } from "node:crypto";
import path from "node:path";

const supportedBehaviors = new Set([
    "clarify-without-guessed-title",
    "clarify-without-task-calls",
]);
const effectName = (name) => name.toLowerCase().replaceAll("_", "-");
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const isTurnId = (value) =>
    isText(value) || (Number.isInteger(value) && value >= 0);
const isRecord = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isDigest = (value) =>
    typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

function exactKeys(value, required, optional = []) {
    return (
        isRecord(value) &&
        required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) =>
            [...required, ...optional].includes(key),
        )
    );
}

function ordinaryControlShape(control) {
    if (control === null) return true;
    const sourceKeys = [
        "component",
        "pid",
        "parentPid",
        "executable",
        "cwd",
        "owner",
        "instance",
        "server",
        "observedAt",
        "config",
        "mode",
        "routing",
        "expectedConfigPath",
        "expectedMode",
        "readableOwnedConfig",
    ];
    if (
        !exactKeys(control, [
            "effectiveMode",
            "configPath",
            "dataRoot",
            "source",
            "digest",
        ]) ||
        !exactKeys(control.source, sourceKeys, ["request"])
    )
        return false;
    const request = control.source.request;
    return (
        request === undefined ||
        request === null ||
        exactKeys(request, ["sessionId", "timestamp", "cwd"])
    );
}

function recordingSnapshotShape(snapshot) {
    return (
        exactKeys(snapshot, ["observedAt", "state"]) &&
        exactKeys(snapshot.state, ["status", "token"]) &&
        exactKeys(
            snapshot.state.token,
            ["id", "sessionId", "status", "expiresAt"],
            ["cwd", "promptHash", "learning"],
        )
    );
}

function ordinaryReceiptErrors(routeEvidence) {
    if (routeEvidence?.route !== "ordinary-copilot") return [];
    if (!exactKeys(routeEvidence, ["route"], ["receipt"]))
        return [
            "Ordinary route evidence permits only route and the typed receipt",
        ];
    if (routeEvidence.receipt === undefined || routeEvidence.receipt === null)
        return [];
    const receipt = routeEvidence.receipt;
    const expectedKeys = [
        "owner",
        "ownedRoot",
        "sessionId",
        "prompt",
        "promptHash",
        "cwd",
        "configPath",
        "dataRoot",
        "digest",
        "effectiveMode",
        "routing",
        "startedAt",
        "endedAt",
    ];
    if (
        !exactKeys(receipt, [
            "schemaVersion",
            "origin",
            "policy",
            "expected",
            "hook",
            "control",
            "callback",
            "capture",
        ]) ||
        receipt.schemaVersion !== 1 ||
        receipt.origin !== "trusted-native-controller" ||
        !["bypass-baseline", "mcp-mixed-source-capture"].includes(
            receipt.policy,
        ) ||
        !exactKeys(receipt.expected, expectedKeys) ||
        !exactKeys(receipt.hook, [
            "hookInvocationId",
            "startEventId",
            "endEventId",
        ]) ||
        !ordinaryControlShape(receipt.control)
    )
        return ["Malformed ordinary-copilot v1 candidate receipt"];
    if (receipt.callback !== null)
        return [
            "No non-null ordinary callback proof contract is admitted; origin labels or guessed callback objects cannot authenticate native execution",
        ];
    const capture = receipt.capture;
    if (exactKeys(capture, ["policy"]) && capture.policy === "none") return [];
    if (
        exactKeys(capture, ["policy", "before", "after"]) &&
        capture.policy === "selected-source" &&
        recordingSnapshotShape(capture.before) &&
        recordingSnapshotShape(capture.after)
    )
        return [];
    return [
        "Malformed ordinary capture policy; use none or actual armed/claimed token snapshots",
    ];
}

function validAuditEntry(entry) {
    if (
        !isText(entry?.operation) ||
        !isText(entry.timestamp) ||
        !Number.isFinite(Date.parse(entry.timestamp))
    )
        return false;
    if (entry.operation === "lookup_document")
        return (
            isText(entry.title) &&
            (entry.returnedId === null || isText(entry.returnedId))
        );
    if (entry.operation === "fetch_document") return isText(entry.id);
    return true;
}

function validDocuments(documents) {
    if (!Array.isArray(documents) || documents.length === 0) return false;
    const seen = { key: new Set(), title: new Set(), expectedId: new Set() };
    for (const document of documents) {
        if (
            !["key", "title", "expectedId", "content"].every((field) =>
                isText(document?.[field]),
            )
        )
            return false;
        for (const field of Object.keys(seen)) {
            if (seen[field].has(document[field])) return false;
            seen[field].add(document[field]);
        }
    }
    return true;
}

function scenarioInputErrors(scenario) {
    if (
        !scenario ||
        typeof scenario !== "object" ||
        Array.isArray(scenario) ||
        !isText(scenario.id) ||
        !isText(scenario.familyId)
    )
        return [
            "A normalized scenario with an explicit id and familyId is required",
        ];
    if (
        scenario.forbiddenEffects !== undefined &&
        (!Array.isArray(scenario.forbiddenEffects) ||
            scenario.forbiddenEffects.some((effect) => !isText(effect)))
    )
        return ["Scenario forbiddenEffects must be an array of effect names"];
    if (
        scenario.status !== undefined &&
        ![
            "ready-for-rehearsal-unexecuted",
            "pending",
            "blocked",
            "blocked-not-accepted",
        ].includes(scenario.status)
    )
        return ["Scenario status must not claim acceptance or freezing"];
    return [];
}

function evidenceErrors({
    events,
    backendAudit,
    answer,
    routeEvidence,
    executionEvidence,
}) {
    const errors = [];
    if (
        !Array.isArray(events) ||
        events.length === 0 ||
        events.some((entry) => !isText(entry?.type))
    )
        errors.push("Native events with a type field are required");
    if (
        !Array.isArray(backendAudit) ||
        backendAudit.some((entry) => !validAuditEntry(entry))
    )
        errors.push("Explicit timestamped backend audit array is required");
    if (!isText(answer)) errors.push("Actual root answer is required");
    if (
        !["grammar", "miss", "unknown", "ordinary-copilot"].includes(
            routeEvidence?.route,
        )
    )
        errors.push(
            "Explicit routeEvidence.route grammar, miss, unknown, or ordinary-copilot is required",
        );
    errors.push(...ordinaryReceiptErrors(routeEvidence));
    if (
        !Number.isInteger(executionEvidence?.wholeMacroInvocations) ||
        executionEvidence.wholeMacroInvocations < 0 ||
        !Array.isArray(executionEvidence.effects) ||
        executionEvidence.effects.some((entry) => !isText(entry))
    )
        errors.push(
            "Explicit execution invocation count and effects array are required",
        );
    return errors;
}

function isRootEvent(entry) {
    return !entry.agentId && !entry.data?.parentToolCallId;
}

function hasNoPendingTools(entry) {
    const requests = entry.data?.toolRequests;
    return (
        requests === undefined ||
        (Array.isArray(requests) && requests.length === 0)
    );
}

function causallyLinked(events, ancestorIndex, descendantIndex) {
    const ancestor = events[ancestorIndex];
    const descendant = events[descendantIndex];
    if (!isText(ancestor?.id) || !isText(descendant?.id)) return false;
    const indexes = new Map(
        events
            .slice(0, descendantIndex)
            .map((entry, index) => [entry.id, index]),
    );
    let index = descendantIndex;
    while (index > ancestorIndex) {
        const previous = indexes.get(events[index].parentId);
        if (previous === undefined || previous >= index) return false;
        index = previous;
    }
    return index === ancestorIndex;
}

function rootTurnCompleted(events, answerIndex, allowSdkIdle = true) {
    const message = events[answerIndex];
    if (!message) return false;
    for (let index = answerIndex + 1; index < events.length; index++) {
        const entry = events[index];
        if (!isRootEvent(entry)) continue;
        if (["assistant.message", "user.message"].includes(entry.type))
            return false;
        if (entry.type === "session.idle" && allowSdkIdle) return true;
        if (
            entry.type === "assistant.turn_end" &&
            isTurnId(message.data?.turnId) &&
            entry.data?.turnId === message.data.turnId &&
            causallyLinked(events, answerIndex, index)
        )
            return true;
    }
    return false;
}

function hostPhaseReport(entry) {
    if (entry.type !== "session.info" || !isRootEvent(entry)) return undefined;
    try {
        const report = JSON.parse(entry.data?.message);
        return report.kind === "typeagent-macro-phases" ? report : undefined;
    } catch {
        return undefined;
    }
}

function validHostPhases(report, routeEvidence) {
    if (
        !isText(report.catalogValidation?.macroId) ||
        !Number.isInteger(report.catalogValidation.version) ||
        report.catalogValidation.version < 1 ||
        !Array.isArray(report.phases) ||
        !Number.isFinite(report.elapsedMs)
    )
        return false;
    const expected = [
        "host.dispatch",
        "host.catalog-validated",
        "subagent.started",
        "procedure-tool.started",
        "procedure-tool.completed",
        "runner.turn.completed",
        "subagent.completed",
    ];
    let previousElapsed = -1;
    let expectedIndex = 0;
    for (const entry of report.phases) {
        if (
            !entry ||
            !isText(entry.phase) ||
            !Number.isFinite(entry.elapsedMs) ||
            entry.elapsedMs < 0 ||
            entry.elapsedMs < previousElapsed ||
            entry.elapsedMs > report.elapsedMs ||
            entry.phase === "subagent.failed"
        )
            return false;
        previousElapsed = entry.elapsedMs;
        if (entry.phase === expected[expectedIndex]) expectedIndex++;
    }
    if (
        routeEvidence.macroId !== undefined &&
        routeEvidence.macroId !== report.catalogValidation.macroId
    )
        return false;
    if (
        routeEvidence.version !== undefined &&
        routeEvidence.version !== report.catalogValidation.version
    )
        return false;
    return (
        expectedIndex === expected.length &&
        report.phases.filter((entry) => entry.phase === "subagent.started")
            .length === 1 &&
        report.phases.filter((entry) => entry.phase === "subagent.completed")
            .length === 1
    );
}

function isHostRunner(entry) {
    return [
        "typeagent-macro-runner-host",
        "typeagent:typeagent-macro-runner-host",
    ].includes(entry.data?.agentName);
}

function hostChildAnswerCompleted(events, answerIndex, completionIndex) {
    const answer = events[answerIndex];
    if (!isTurnId(answer?.data?.turnId) || !hasNoPendingTools(answer))
        return false;
    return events.some(
        (entry, index) =>
            index > answerIndex &&
            index < completionIndex &&
            entry.type === "assistant.turn_end" &&
            entry.agentId === answer.agentId &&
            entry.data?.parentToolCallId === answer.data.parentToolCallId &&
            entry.data?.turnId === answer.data.turnId &&
            causallyLinked(events, answerIndex, index),
    );
}

function completedHostChild(events, reportIndex, answer) {
    const completionIndex = events.findLastIndex(
        (entry, index) =>
            index < reportIndex &&
            entry.type === "subagent.completed" &&
            isHostRunner(entry) &&
            causallyLinked(events, index, reportIndex),
    );
    const completion = events[completionIndex];
    if (
        !isText(completion?.agentId) ||
        !isText(completion.data?.toolCallId) ||
        completion.data.cancelled === true
    )
        return false;
    const starts = events.filter(
        (entry, index) =>
            index < completionIndex &&
            entry.type === "subagent.started" &&
            entry.agentId === completion.agentId &&
            entry.data?.toolCallId === completion.data.toolCallId &&
            isHostRunner(entry),
    );
    const childAnswerIndex = events.findLastIndex(
        (entry, index) =>
            index < completionIndex &&
            entry.type === "assistant.message" &&
            entry.agentId === completion.agentId &&
            entry.data?.parentToolCallId === completion.data.toolCallId,
    );
    return (
        starts.length === 1 &&
        events[childAnswerIndex]?.data?.content === answer &&
        causallyLinked(events, childAnswerIndex, completionIndex) &&
        hostChildAnswerCompleted(events, childAnswerIndex, completionIndex)
    );
}

function hostReportMatchesRootTurn(events, reportIndex, answerIndex) {
    const messages = events
        .slice(reportIndex + 1, answerIndex)
        .filter(
            (entry) =>
                isRootEvent(entry) &&
                ["user.message", "assistant.message"].includes(entry.type),
        );
    return (
        messages.length === 1 &&
        messages[0].type === "user.message" &&
        isText(messages[0].data?.interactionId) &&
        messages[0].data.interactionId ===
            events[answerIndex].data?.interactionId
    );
}

function nativeHostCompleted(events, answerIndex, answer, routeEvidence) {
    return events.some((entry, index) => {
        const report = hostPhaseReport(entry);
        return (
            index < answerIndex &&
            report !== undefined &&
            validHostPhases(report, routeEvidence) &&
            completedHostChild(events, index, answer) &&
            hostReportMatchesRootTurn(events, index, answerIndex) &&
            causallyLinked(events, index, answerIndex)
        );
    });
}

function hasExecutionError(events) {
    return events.some(
        (entry) =>
            ["session.error", "subagent.failed"].includes(entry.type) ||
            (entry.type === "subagent.completed" &&
                entry.data?.cancelled === true) ||
            (entry.type === "tool.execution_complete" &&
                entry.data?.success === false),
    );
}

function gradeCompletion(events, answer, routeEvidence, check) {
    const answerIndex = events.findLastIndex(
        (entry) =>
            entry.type === "assistant.message" &&
            isRootEvent(entry) &&
            entry.data?.content === answer,
    );
    check(
        "recorded-root-answer",
        answerIndex >= 0,
        "Answer must match a native root assistant.message",
    );
    check(
        "root-answer-without-pending-tools",
        answerIndex >= 0 && hasNoPendingTools(events[answerIndex]),
    );
    const hasHost = events.some(
        (entry) =>
            isHostRunner(entry) ||
            (entry.type === "session.info" &&
                isText(entry.data?.message) &&
                entry.data.message.includes("typeagent-macro-phases")),
    );
    check(
        "terminal-native-completion",
        hasHost
            ? nativeHostCompleted(events, answerIndex, answer, routeEvidence)
            : rootTurnCompleted(events, answerIndex),
        "Requires root turn completion or a successful causally correlated host child and phase report",
    );
    check("no-session-error", !hasExecutionError(events));
}

function insideOwnedRoot(root, value) {
    if (
        !path.win32.isAbsolute(root ?? "") ||
        !path.win32.isAbsolute(value ?? "")
    )
        return false;
    const relative = path.win32.relative(root, value);
    return (
        relative !== ".." &&
        !relative.startsWith("..\\") &&
        !path.win32.isAbsolute(relative)
    );
}

function ordinaryExpectedValid(expected, scenario) {
    const strings = [
        "owner",
        "ownedRoot",
        "sessionId",
        "prompt",
        "cwd",
        "configPath",
        "dataRoot",
    ];
    return (
        strings.every((key) => isText(expected[key])) &&
        scenario.prompt === expected.prompt &&
        ["cwd", "configPath", "dataRoot"].every((key) =>
            insideOwnedRoot(expected.ownedRoot, expected[key]),
        ) &&
        isDigest(expected.digest) &&
        isDigest(expected.promptHash) &&
        Number.isFinite(Date.parse(expected.startedAt)) &&
        Date.parse(expected.endedAt) >= Date.parse(expected.startedAt)
    );
}

function ordinaryPromptStartMatches(start, hook, expected) {
    if (start?.type !== "hook.start" || !isRootEvent(start)) return false;
    const data = start.data;
    const input = data?.input;
    return (
        data?.hookType === "userPromptSubmitted" &&
        isText(data.hookInvocationId) &&
        data.hookInvocationId === hook.hookInvocationId &&
        input?.sessionId === expected.sessionId &&
        input?.prompt === expected.prompt &&
        input?.cwd === expected.cwd &&
        Number.isFinite(input?.timestamp)
    );
}

function ordinaryPromptEndMatches(end, hook) {
    return (
        end?.type === "hook.end" &&
        isRootEvent(end) &&
        end.data?.hookType === "userPromptSubmitted" &&
        end.data?.hookInvocationId === hook.hookInvocationId
    );
}

function ordinaryUnhandledOutput(end) {
    const output = end?.data?.output;
    return (
        end?.data?.success === true &&
        exactKeys(output, [], ["handled"]) &&
        (output.handled === undefined || output.handled === false)
    );
}

function ordinaryRootChainMatches(
    events,
    expected,
    startIndex,
    endIndex,
    users,
    answerIndex,
) {
    if (users.length !== 1) return false;
    const user = users[0].entry;
    return (
        user.data?.content === expected.prompt &&
        isText(user.data?.interactionId) &&
        user.data.interactionId === events[answerIndex]?.data?.interactionId &&
        causallyLinked(events, startIndex, endIndex) &&
        causallyLinked(events, endIndex, users[0].index) &&
        causallyLinked(events, users[0].index, answerIndex)
    );
}

function ordinaryHookEvidence(events, answer, receipt, check) {
    const { expected, hook } = receipt;
    const startIndex = events.findIndex(
        (entry) => entry.id === hook.startEventId,
    );
    const endIndex = events.findIndex((entry) => entry.id === hook.endEventId);
    const start = events[startIndex];
    const end = events[endIndex];
    const users = events
        .map((entry, index) => ({ entry, index }))
        .filter(
            ({ entry, index }) =>
                index > endIndex &&
                entry.type === "user.message" &&
                isRootEvent(entry),
        );
    const answerIndex = events.findLastIndex(
        (entry) =>
            entry.type === "assistant.message" &&
            isRootEvent(entry) &&
            entry.data?.content === answer,
    );
    check(
        "ordinary-native-event-identities",
        events.every((entry) => isText(entry.id)) &&
            new Set(events.map((entry) => entry.id)).size === events.length,
    );
    check(
        "ordinary-user-prompt-hook",
        ordinaryPromptStartMatches(start, hook, expected) &&
            ordinaryPromptEndMatches(end, hook),
    );
    check(
        "ordinary-successful-unhandled-hook",
        ordinaryUnhandledOutput(end),
        "Actual userPromptSubmitted must be successful and unhandled; TypeAgent handling or guidance is not a capture-pass-through proof",
    );
    check(
        "ordinary-hook-root-causal-chain",
        ordinaryRootChainMatches(
            events,
            expected,
            startIndex,
            endIndex,
            users,
            answerIndex,
        ),
    );
    check(
        "ordinary-native-root-turn-end",
        rootTurnCompleted(events, answerIndex, false),
        "Ordinary Copilot requires a correlated native root assistant.turn_end, not SDK idle or a model success claim",
    );
    return { start, end, userIndex: users[0]?.index, answerIndex };
}

function ordinarySessionBinding(events, expected, check) {
    const sessions = events.filter(
        (entry) => entry.type === "session.start" && isRootEvent(entry),
    );
    check(
        "ordinary-owned-native-session",
        sessions.length === 1 &&
            sessions[0].data?.sessionId === expected.sessionId &&
            sessions[0].data?.context?.cwd === expected.cwd,
    );
    check(
        "ordinary-current-native-trial-window",
        events
            .filter((entry) => entry.type !== "session.start")
            .every(
                (entry) =>
                    Date.parse(expected.startedAt) <=
                        Date.parse(entry.timestamp) &&
                    Date.parse(entry.timestamp) <= Date.parse(expected.endedAt),
            ),
    );
}

function ordinaryControlSourceValid(source) {
    return (
        Number.isInteger(source?.pid) &&
        source.pid > 0 &&
        Number.isInteger(source.parentPid) &&
        source.parentPid > 0 &&
        isText(source.executable) &&
        path.win32.isAbsolute(source.executable) &&
        ["TYPEAGENT_PLUGIN_DATA", "CLAUDE_PLUGIN_DATA", "default"].includes(
            source.config,
        ) &&
        ["TYPEAGENT_MODE", "config", "default"].includes(source.mode) &&
        (source.instance === null || isText(source.instance)) &&
        (source.server === null || isText(source.server))
    );
}

function ordinaryCurrentControlMatches(control, expected) {
    const source = control?.source;
    return (
        ordinaryControlSourceValid(source) &&
        control?.effectiveMode === expected.effectiveMode &&
        control?.configPath === expected.configPath &&
        control?.dataRoot === expected.dataRoot &&
        source?.owner === expected.owner &&
        source?.component === "native-hook" &&
        source?.expectedMode === expected.effectiveMode &&
        source?.expectedConfigPath === expected.configPath &&
        source?.readableOwnedConfig === true &&
        source?.cwd === expected.cwd &&
        source?.routing === expected.routing
    );
}

function ordinaryPublicDigestMatches(control, expected) {
    if (control === null) return false;
    return (
        isDigest(control.digest) &&
        control.digest === expected.digest &&
        control.digest ===
            sha256(
                JSON.stringify({
                    configPath: control.configPath,
                    dataRoot: control.dataRoot,
                    effectiveMode: control.effectiveMode,
                    mcpRouting: control.source.routing,
                }),
            )
    );
}

function ordinaryRequestMatches(control, start, expected) {
    const request = control?.source?.request;
    return (
        isRecord(request) &&
        request.sessionId === expected.sessionId &&
        request.cwd === expected.cwd &&
        request.timestamp === start?.data?.input?.timestamp
    );
}

function ordinaryControlWindowMatches(control, start, end, expected) {
    const observed = Date.parse(control?.source?.observedAt);
    const started = Date.parse(start?.timestamp);
    const ended = Date.parse(end?.timestamp);
    return (
        Number.isFinite(observed) &&
        Date.parse(expected.startedAt) <= started &&
        started <= observed &&
        observed <= ended &&
        ended <= Date.parse(expected.endedAt)
    );
}

function ordinaryControlBinding(receipt, start, end, check) {
    const { control, expected } = receipt;
    check(
        "ordinary-current-control-binding",
        ordinaryCurrentControlMatches(control, expected),
    );
    check(
        "ordinary-public-control-digest",
        ordinaryPublicDigestMatches(control, expected),
    );
    check(
        "ordinary-actual-parsed-hook-request",
        ordinaryRequestMatches(control, start, expected),
        "Startup/status receipts with missing or null source.request do not prove an actual userPromptSubmitted callback",
    );
    check(
        "ordinary-current-hook-observation-window",
        ordinaryControlWindowMatches(control, start, end, expected),
    );
}

function ordinaryCaptureBinding(receipt, start, end, check) {
    const { expected, capture, policy } = receipt;
    const bypass = policy === "bypass-baseline";
    check(
        "ordinary-mode-capture-policy",
        bypass
            ? expected.effectiveMode === "bypass" &&
                  ["delegate", "mixed"].includes(expected.routing) &&
                  capture.policy === "none"
            : expected.effectiveMode === "mcp" &&
                  expected.routing === "mixed" &&
                  capture.policy === "selected-source",
    );
    if (capture.policy !== "selected-source") return;
    const before = capture.before.state;
    const after = capture.after.state;
    const tokens = [before.token, after.token];
    check(
        "ordinary-selected-source-lease",
        before.status === "armed" &&
            before.token.status === "armed" &&
            after.status === "claimed" &&
            after.token.status === "claimed" &&
            isText(before.token.id) &&
            before.token.id === after.token.id &&
            tokens.every(
                (token) =>
                    token.sessionId === expected.sessionId &&
                    token.cwd === expected.cwd &&
                    token.learning === true,
            ) &&
            before.token.expiresAt === after.token.expiresAt &&
            Date.parse(after.token.expiresAt) >
                Date.parse(capture.after.observedAt) &&
            before.token.promptHash === undefined &&
            after.token.promptHash === expected.promptHash,
    );
    check(
        "ordinary-selected-source-snapshot-window",
        Date.parse(expected.startedAt) <=
            Date.parse(capture.before.observedAt) &&
            Date.parse(capture.before.observedAt) <=
                Date.parse(start?.timestamp) &&
            Date.parse(end?.timestamp) <=
                Date.parse(capture.after.observedAt) &&
            Date.parse(capture.after.observedAt) <=
                Date.parse(expected.endedAt),
    );
}

function ordinaryToolOperation(entry) {
    if (entry.data?.mcpServerName !== "macro-eval-docs") return undefined;
    const name = entry.data?.mcpToolName ?? entry.data?.toolName;
    if (typeof name !== "string") return undefined;
    return name.match(/(?:^|-)(lookup_document|fetch_document)$/u)?.[1];
}

function ordinaryToolPairValid(events, start, audit, userIndex, answerIndex) {
    const operation = ordinaryToolOperation(start);
    const matched = events.filter(
        (entry) =>
            entry.type === "tool.execution_complete" &&
            entry.data?.toolCallId === start.data?.toolCallId,
    );
    if (matched.length !== 1) return false;
    const complete = matched[0];
    const argument = operation === "lookup_document" ? "title" : "id";
    return (
        isText(start.data?.toolCallId) &&
        operation === audit.operation &&
        start.data?.arguments?.[argument] === audit[argument] &&
        complete.data?.success === true &&
        Date.parse(start.timestamp) <= Date.parse(audit.timestamp) &&
        Date.parse(audit.timestamp) <= Date.parse(complete.timestamp) &&
        causallyLinked(events, userIndex, events.indexOf(start)) &&
        causallyLinked(
            events,
            events.indexOf(start),
            events.indexOf(complete),
        ) &&
        causallyLinked(events, events.indexOf(complete), answerIndex)
    );
}

function ordinaryToolsSettled(
    events,
    backendAudit,
    userIndex,
    answerIndex,
    check,
) {
    const starts = events.filter(
        (entry) => entry.type === "tool.execution_start",
    );
    const completes = events.filter(
        (entry) => entry.type === "tool.execution_complete",
    );
    check(
        "ordinary-fixture-tool-lifecycle",
        starts.length === backendAudit.length &&
            starts.length === completes.length &&
            starts.every((entry, index) =>
                ordinaryToolPairValid(
                    events,
                    entry,
                    backendAudit[index],
                    userIndex,
                    answerIndex,
                ),
            ),
        "Ordinary task calls must be actual successful root fixture calls matching the independent audit; model-only answers or TypeAgent translation cannot substitute",
    );
}

function gradeOrdinaryCandidate(input, check) {
    const {
        routeEvidence,
        events,
        answer,
        scenario,
        backendAudit,
        executionEvidence,
    } = input;
    if (routeEvidence.route !== "ordinary-copilot") return;
    const receipt = routeEvidence.receipt;
    if (!receipt) return;
    check(
        "ordinary-trusted-current-expectation",
        ordinaryExpectedValid(receipt.expected, scenario),
    );
    const { start, end, userIndex, answerIndex } = ordinaryHookEvidence(
        events,
        answer,
        receipt,
        check,
    );
    ordinarySessionBinding(events, receipt.expected, check);
    ordinaryControlBinding(receipt, start, end, check);
    ordinaryCaptureBinding(receipt, start, end, check);
    ordinaryToolsSettled(events, backendAudit, userIndex, answerIndex, check);
    check(
        "ordinary-no-delegation-or-whole-macro",
        executionEvidence.wholeMacroInvocations === 0 &&
            executionEvidence.effects.length === 0 &&
            !events.some(
                (entry) =>
                    entry.agentId ||
                    entry.type.startsWith("subagent.") ||
                    entry.data?.parentToolCallId,
            ),
    );
    check(
        "ordinary-no-native-hook-errors",
        !events.some(
            (entry) =>
                entry.type === "hook.end" && entry.data?.success === false,
        ),
    );
}

function grammarAttribution(route) {
    if (route === "grammar") return true;
    if (route === "miss") return false;
    return null;
}

function finalizeDocumentGrade(result, routeEvidence) {
    result.taskCorrect = result.checks.every((entry) => entry.passed);
    result.status = result.taskCorrect ? "passed" : "failed";
    if (routeEvidence.route === "ordinary-copilot") {
        result.errors.push(
            "Ordinary native callback attribution is unavailable: callback:null cannot admit bypass or MCP-mixed capture. A trusted current callback/event/process correlation contract is required; startup/status control metadata is not that proof.",
        );
        if (routeEvidence.receipt?.policy === "mcp-mixed-source-capture")
            result.errors.push(
                "Armed/claimed lease bindings do not certify finalized source capture; actual finalized selected trace verification remains an additional native-controller gate.",
            );
        if (result.taskCorrect || !routeEvidence.receipt) {
            result.status = "blocked";
            result.taskCorrect = null;
        }
    } else if (result.taskCorrect && result.grammarHit === null) {
        result.status = "blocked";
        result.errors.push(
            "Task oracle passed, but route attribution remains unknown",
        );
    }
    return result;
}

function gradePositive(
    document,
    backendAudit,
    answer,
    executionEvidence,
    routeEvidence,
    check,
) {
    const [lookup, fetch] = backendAudit;
    check("exact-two-backend-calls", backendAudit.length === 2);
    check(
        "exact-title-lookup",
        lookup?.operation === "lookup_document" &&
            lookup.title === document.title &&
            lookup.returnedId === document.expectedId,
    );
    check(
        "fresh-dependent-id-fetch",
        lookup?.returnedId === document.expectedId &&
            fetch?.operation === "fetch_document" &&
            fetch.id === lookup.returnedId &&
            Date.parse(fetch.timestamp) >= Date.parse(lookup.timestamp),
        "Fetch must follow lookup and use this trial's returned identity",
    );
    check("full-exact-document-content", answer.includes(document.content));
    check("exact-document-title", answer.includes(document.title));
    check("no-extra-effects", executionEvidence.effects.length === 0);
    if (routeEvidence.route !== "unknown")
        check(
            "route-execution-consistent",
            executionEvidence.wholeMacroInvocations ===
                (routeEvidence.route === "grammar" ? 1 : 0),
        );
}

function gradeNegative(
    scenario,
    documents,
    backendAudit,
    answer,
    executionEvidence,
    check,
) {
    check(
        "zero-whole-macro-invocations",
        executionEvidence.wholeMacroInvocations === 0,
    );
    const effects = [
        ...executionEvidence.effects,
        ...backendAudit.map((entry) => entry.operation),
    ].map(effectName);
    for (const forbidden of scenario.forbiddenEffects ?? [])
        check(
            `forbidden-effect:${forbidden}`,
            !effects.includes(effectName(forbidden)),
        );
    if (supportedBehaviors.has(scenario.expectedBehavior)) {
        check(
            "clarification-without-task-calls",
            backendAudit.length === 0 && executionEvidence.effects.length === 0,
        );
        check(
            "explicit-title-clarification",
            /\?/.test(answer) &&
                /\b(title|document)\b/i.test(answer) &&
                /\b(which|what|provide|specify|clarify)\b/i.test(answer),
        );
        check(
            "no-guessed-document",
            !documents.some(
                (entry) =>
                    answer.includes(entry.title) ||
                    answer.includes(entry.expectedId) ||
                    answer.includes(entry.content),
            ),
        );
    }
}

export function gradeDocumentTrial(input) {
    const {
        scenario,
        documents,
        events,
        backendAudit,
        answer,
        routeEvidence,
        executionEvidence,
    } = input ?? {};
    const result = {
        status: "harness-invalid",
        taskCorrect: null,
        grammarHit: null,
        checks: [],
        errors: [],
    };
    result.errors.push(...scenarioInputErrors(scenario));
    if (result.errors.length > 0) return result;
    if (
        scenario?.familyId !== documentFamilyId ||
        scenario.kind === "conversation" ||
        ["pending", "blocked", "blocked-not-accepted"].includes(
            scenario.status,
        ) ||
        (scenario.expectedBehavior !== undefined &&
            !supportedBehaviors.has(scenario.expectedBehavior))
    ) {
        result.status = "blocked";
        result.errors.push(
            "No implemented standalone document oracle for this case or case is pending/blocked",
        );
        return result;
    }
    if (!["training", "positive", "negative"].includes(scenario.kind)) {
        result.errors.push("Unsupported scenario kind");
        return result;
    }
    if (!validDocuments(documents))
        result.errors.push("Complete expected document records are required");
    const document = Array.isArray(documents)
        ? documents.find((entry) => entry?.key === scenario.expectedDocument)
        : undefined;
    if (scenario.kind !== "negative" && !document)
        result.errors.push("Expected document key is not in the corpus");
    if (scenario.kind === "negative" && scenario.wholeMacroInvocations !== 0)
        result.errors.push(
            "Negative scenario must explicitly expect zero whole-macro invocations",
        );
    result.errors.push(...evidenceErrors(input));
    if (result.errors.length > 0) return result;
    result.grammarHit = grammarAttribution(routeEvidence.route);
    const check = (name, passed, detail) => {
        result.checks.push({
            name,
            passed: Boolean(passed),
            ...(detail ? { detail } : {}),
        });
        if (!passed) result.errors.push(detail ?? name);
    };
    gradeCompletion(events, answer, routeEvidence, check);
    gradeOrdinaryCandidate(input, check);
    if (scenario.kind === "negative")
        gradeNegative(
            scenario,
            documents,
            backendAudit,
            answer,
            executionEvidence,
            check,
        );
    else
        gradePositive(
            document,
            backendAudit,
            answer,
            executionEvidence,
            routeEvidence,
            check,
        );
    return finalizeDocumentGrade(result, routeEvidence);
}
