// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isDeepStrictEqual } from "node:util";
import { macroProtocolVersion } from "./macro-eval-plan.mjs";

const root = (event) => !event.agentId && !event.data?.parentToolCallId;
const text = (value) => typeof value === "string" && value.trim().length > 0;
const time = (value) => (typeof value === "string" ? Date.parse(value) : NaN);
const planner = (event) =>
    /(?:^|:)typeagent-macro-runner-host$/u.test(event.data?.agentName ?? "");

async function loadPluginHost() {
    const [paths, transport] = await Promise.all([
        import("../../copilot-plugin/dist/shared/recipe-local-paths.js"),
        import("../../copilot-plugin/dist/shared/recipe-transport.js"),
    ]);
    return { ...paths, ...transport };
}

export async function collectPluginProgramBinding(
    { workspace, profileId, sessionId, runId, startedAt, endedAt },
    loadHost = loadPluginHost,
) {
    if (![workspace, profileId, sessionId, runId].every(text))
        throw new Error(
            "Actual workspace/profile/session/run identity is required.",
        );
    const host = await loadHost();
    const registeredWorkspace =
        await host.resolveLocalRecipeWorkspace(sessionId);
    const scope = host.localRecipeScope(workspace);
    if (
        scope.profileId !== profileId ||
        !isDeepStrictEqual(host.localRecipeScope(registeredWorkspace), scope)
    )
        throw new Error(
            "Native registration does not match the requested plugin workspace/profile.",
        );
    const reconciledRun = await host.callLocalRecipe(
        workspace,
        sessionId,
        "getMacroRun",
        [runId],
    );
    if (reconciledRun?.runId !== runId || !text(reconciledRun?.macroId))
        throw new Error("Current plugin run could not be reconciled.");
    const macro = await host.callLocalRecipe(
        workspace,
        sessionId,
        "inspectMacro",
        [
            {
                macroId: reconciledRun.macroId,
                version: reconciledRun.version,
            },
        ],
    );
    const catalogDirectory = host.localRecipeDirectory(workspace);
    return {
        owner: "plugin",
        macro,
        reconciledRun,
        registration: { ...scope, sessionId, catalogDirectory },
        expected: {
            ...scope,
            sessionId,
            catalogDirectory,
            runId,
            startedAt,
            endedAt,
        },
    };
}

function parseResponse(event) {
    try {
        if (
            event.type === "hook.end" &&
            event.data?.hookType === "userPromptSubmitted" &&
            event.data.success === true &&
            event.data.output?.handled === true &&
            event.data.output.handledBy === "typeagent"
        )
            return JSON.parse(event.data.output.responseContent);
        if (
            event.type === "tool.execution_complete" &&
            event.data?.success === true
        ) {
            const result = event.data.result;
            if (Array.isArray(result?.content)) {
                const content = result.content.filter(
                    (item) => item.type === "text",
                );
                if (content.length === 1) return JSON.parse(content[0].text);
            }
            if (typeof result?.content === "string")
                return JSON.parse(result.content);
        }
    } catch {
        return undefined;
    }
}

export function extractNativeEvidence(events, backendAudit, binding = {}) {
    const answer =
        events.findLast(
            (event) =>
                root(event) &&
                event.type === "assistant.message" &&
                text(event.data?.content) &&
                !event.data.toolRequests?.length,
        )?.data.content ?? "";
    const responses = events
        .map((event) => ({ event, response: parseResponse(event) }))
        .filter(({ response }) => response?.run?.program);
    const starts = events.filter(
        (event) => event.type === "tool.execution_start",
    );
    const mcp = starts.filter((event) =>
        /(?:^|[-_])run_macro$/u.test(event.data?.toolName ?? ""),
    );
    const hooks = responses.filter(({ event }) => event.type === "hook.end");
    const selected = responses.length === 1 ? responses[0] : undefined;
    const route =
        hooks.length === 1 && mcp.length === 0
            ? "grammar"
            : mcp.length === 1 && hooks.length === 0
              ? "explicit-mcp"
              : responses.length === 0 && mcp.length === 0
                ? "miss"
                : "unknown";
    const run = selected?.response.run;
    return {
        protocolVersion: macroProtocolVersion,
        events,
        backendAudit,
        answer,
        routeEvidence: {
            route,
            ...(run
                ? {
                      macroId: run.macroId,
                      version: run.version,
                      runId: run.runId,
                  }
                : {}),
        },
        executionEvidence: {
            wholeMacroInvocations: hooks.length + mcp.length,
            effects: starts
                .filter(
                    (event) =>
                        !/(?:^|[-_])(?:lookup_document|fetch_document|run_macro)$/u.test(
                            event.data?.toolName ?? "",
                        ),
                )
                .map((event) => event.data?.toolName ?? "unknown-tool"),
        },
        ...(selected
            ? {
                  programEvidence: {
                      ...binding,
                      eventId: selected.event.id,
                      response: selected.response,
                  },
              }
            : {}),
    };
}

function outputStrings(value) {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(outputStrings);
    if (value && typeof value === "object")
        return Object.values(value).flatMap(outputStrings);
    return [];
}

function invocationMatches(event, events, run, route) {
    if (!event || !root(event)) return false;
    if (route === "grammar") return event.type === "hook.end";
    const starts = events.filter(
        (entry) =>
            entry.type === "tool.execution_start" &&
            root(entry) &&
            entry.data?.toolCallId === event.data?.toolCallId &&
            /(?:^|[-_])run_macro$/u.test(entry.data?.toolName ?? ""),
    );
    return (
        event.type === "tool.execution_complete" &&
        starts.length === 1 &&
        starts[0].data.arguments?.macroId === run?.macroId &&
        (starts[0].data.arguments.version === undefined ||
            starts[0].data.arguments.version === run?.version)
    );
}

function gradeIdentity(evidence, routeEvidence, check) {
    const run = evidence.response?.run ?? {};
    const program = run.program ?? {};
    const macro = evidence.macro ?? {};
    const artifact = macro.program ?? {};
    check(
        "program-immutable-macro-version-revision",
        text(run.macroId) &&
            Number.isInteger(run.version) &&
            run.version > 0 &&
            run.macroId === routeEvidence.macroId &&
            run.version === routeEvidence.version &&
            run.runId === routeEvidence.runId &&
            macro.macroId === run.macroId &&
            macro.version === run.version &&
            macro.state === "approved" &&
            macro.executionKind === "program" &&
            text(program.recipeId) &&
            text(program.revision) &&
            artifact.recipeId === program.recipeId &&
            artifact.revision === program.revision,
    );
}

function gradeBinding(evidence, check) {
    const run = evidence.response?.run ?? {};
    const expected = evidence.expected ?? {};
    const program = run.program ?? {};
    check(
        "program-current-run-reconciled",
        text(expected.runId) &&
            run.runId === expected.runId &&
            program.runId === expected.runId &&
            isDeepStrictEqual(evidence.reconciledRun, run),
    );
    const scope = evidence.registration ?? {};
    check(
        "program-plugin-workspace-profile-session",
        text(expected.sessionId) &&
            text(expected.workspaceId) &&
            text(expected.profileId) &&
            scope.workspaceId === expected.workspaceId &&
            scope.profileId === expected.profileId &&
            scope.sessionId === expected.sessionId &&
            text(expected.catalogDirectory) &&
            scope.catalogDirectory === expected.catalogDirectory &&
            evidence.owner === "plugin",
    );
}

function gradeTerminal(evidence, event, backendAudit, check) {
    const response = evidence.response ?? {};
    const run = response.run ?? {};
    const program = run.program ?? {};
    const expected = evidence.expected ?? {};
    check(
        "program-accepted-terminal-no-fallback",
        response.status === "completed" &&
            run.status === "completed" &&
            program.accepted === true &&
            program.status === "completed" &&
            program.fallback === "never",
    );
    const start = time(expected.startedAt),
        end = time(expected.endedAt);
    check(
        "program-fresh-current-trial",
        Number.isFinite(start) &&
            end >= start &&
            time(run.startedAt) >= start &&
            time(run.completedAt) >= time(run.startedAt) &&
            time(run.completedAt) <= end &&
            time(event?.timestamp) >= time(run.completedAt) &&
            time(event?.timestamp) <= end &&
            backendAudit.every(
                (entry) =>
                    time(entry.timestamp) >= time(run.startedAt) &&
                    time(entry.timestamp) <= time(run.completedAt),
            ),
    );
}

function gradeDispatch(evidence, backendAudit, check) {
    const program = evidence?.response?.run?.program;
    const checkpoints = program?.checkpoints;
    const capabilities = evidence?.macro?.program?.capabilities;
    check(
        "program-two-read-dispatch-checkpoints",
        Array.isArray(checkpoints) &&
            Array.isArray(capabilities) &&
            checkpoints.length === 2 &&
            checkpoints.every(
                (point, index) =>
                    text(point?.callId) &&
                    point.effect === "read" &&
                    point.phase === "completed" &&
                    capabilities?.some(
                        (capability) =>
                            capability.id === point.capabilityId &&
                            capability.providerId === "eval-docs" &&
                            capability.transport === "mcp" &&
                            capability.effect === "read" &&
                            capability.operation ===
                                backendAudit[index]?.operation,
                    ),
            ) &&
            new Set(checkpoints.map((point) => point.callId)).size === 2 &&
            isDeepStrictEqual(
                program.completedCallIds,
                checkpoints.map((point) => point.callId),
            ),
    );
}

function sourceIsAncestor(events, sourceId, answer) {
    const byId = new Map(
        events
            .filter((event) => text(event.id))
            .map((event) => [event.id, event]),
    );
    let current = events.findLast(
        (event) =>
            root(event) &&
            event.type === "assistant.message" &&
            event.data?.content === answer,
    );
    const seen = new Set();
    while (current && !seen.has(current.id)) {
        if (current.id === sourceId) return true;
        seen.add(current.id);
        current = byId.get(current.parentId);
    }
    return false;
}

export function programDisplayAnswer(input) {
    try {
        if (
            ["grammar", "explicit-mcp"].includes(input.routeEvidence.route) &&
            isDeepStrictEqual(
                JSON.parse(input.answer),
                input.programEvidence?.response,
            )
        )
            return outputStrings(
                input.programEvidence.response.run.program.output,
            ).join("\n");
    } catch {
        return input.answer;
    }
    return input.answer;
}

export function gradeProgramEvidence(input, check) {
    const {
        events,
        backendAudit,
        routeEvidence,
        programEvidence: suppliedEvidence,
    } = input;
    const evidence = suppliedEvidence ?? {};
    check(
        "no-execution-planner-child",
        !events.some(planner),
        "Execution-planner children are retired; restricted author/verifier children are distinct.",
    );
    if (!["grammar", "explicit-mcp"].includes(routeEvidence.route)) return;
    const run = evidence?.response?.run;
    const event = events.find((entry) => entry.id === evidence?.eventId);
    const observed = extractNativeEvidence(events, backendAudit);
    check(
        "program-invocation-source",
        event &&
            isDeepStrictEqual(parseResponse(event), evidence.response) &&
            invocationMatches(event, events, run, routeEvidence.route) &&
            observed.routeEvidence.route === routeEvidence.route &&
            observed.executionEvidence.wholeMacroInvocations === 1,
    );
    check(
        "program-invocation-terminal-correlation",
        text(evidence?.eventId) &&
            sourceIsAncestor(events, evidence.eventId, input.answer),
    );
    gradeIdentity(evidence, routeEvidence, check);
    gradeBinding(evidence, check);
    gradeTerminal(evidence, event, backendAudit, check);
    gradeDispatch(evidence, backendAudit, check);
    const document = input.documents.find(
        (entry) => entry.key === input.scenario.expectedDocument,
    );
    check(
        "program-fresh-output",
        document &&
            Object.hasOwn(run?.program ?? {}, "output") &&
            outputStrings(run?.program?.output).some((value) =>
                value.includes(document.content),
            ),
    );
}
