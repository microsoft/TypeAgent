// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isDeepStrictEqual } from "node:util";

function requireProof(value, message) {
    if (!value) throw new Error(`Native WorkIQ projection: ${message}`);
}

function ancestor(events, descendant, parent) {
    const indexes = new Map(events.map((event, index) => [event.id, index]));
    let cursor = indexes.get(descendant.id);
    const target = indexes.get(parent.id);
    while (cursor > target) {
        const previous = indexes.get(events[cursor].parentId);
        if (previous === undefined || previous >= cursor) return false;
        cursor = previous;
    }
    return cursor === target && target !== undefined;
}

function exactPair(events, call, user, terminal) {
    const starts = events.filter(
        (event) =>
            event.type === "tool.execution_start" &&
            event.data?.toolCallId === call.toolCallId,
    );
    const ends = events.filter(
        (event) =>
            event.type === "tool.execution_complete" &&
            event.data?.toolCallId === call.toolCallId &&
            event.agentId === starts[0]?.agentId,
    );
    requireProof(
        starts.length === 1 &&
            ends.length === 1 &&
            ends[0].data?.success === true &&
            starts[0].data.toolName === call.name &&
            starts[0].data.mcpServerName === call.mcpServerName &&
            isDeepStrictEqual(starts[0].data.arguments, call.arguments) &&
            call.status === "completed" &&
            ancestor(events, starts[0], user) &&
            ancestor(events, ends[0], starts[0]) &&
            ancestor(events, terminal, ends[0]),
        "missing/ambiguous/noncausal current tool start/completion",
    );
    return [starts[0], ends[0]];
}

function currentHost(events, trace, audit, publication, callback) {
    const hosts = events.filter((event) => event.type === "subagent.started");
    requireProof(
        hosts.length === 1 &&
            [
                "typeagent-macro-runner-host",
                "typeagent:typeagent-macro-runner-host",
            ].includes(hosts[0].data?.agentName),
        "reuse requires one actual normal macro host child",
    );
    const host = hosts[0];
    const coreId = host.data.toolCallId?.match(
        /^typeagent-macro-([a-f0-9]{64})$/u,
    )?.[1];
    requireProof(
        coreId &&
            (!trace.handoffRunId || trace.handoffRunId === coreId) &&
            audit.runId === coreId &&
            audit.macroId === publication?.macroId &&
            audit.version === publication.version &&
            ["completed", "agentRequired"].includes(audit.status) &&
            callback.handled === true,
        "actual macro launch/core audit/publication/handled hook disagree",
    );
    const completions = events.filter(
        (event) =>
            event.type === "subagent.completed" &&
            event.agentId === host.agentId &&
            event.data?.toolCallId === host.data.toolCallId,
    );
    requireProof(
        completions.length === 1 && !completions[0].data.cancelled,
        "actual macro host did not complete once",
    );
    return { host, coreId, completion: completions[0] };
}

/**
 * Pure negative verifier; does not create a trusted brand or admit execution.
 * The production lifecycle supplies only physically loaded current sources.
 */
export function verifyNativeWorkiqProjectionSources({
    events,
    trace,
    discovery,
    callback,
    phase,
    audit,
    publication,
    routes,
}) {
    requireProof(
        events.length === new Set(events.map((event) => event.id)).size,
        "duplicate native event identity",
    );
    const user = events.find(
        (event) => event.id === callback.native.rootUserEventId,
    );
    const terminal = events.find(
        (event) => event.id === callback.native.terminalEventId,
    );
    requireProof(user && terminal, "actual root user/terminal missing");
    const calls = trace.toolCalls;
    const document = calls.filter((call) =>
        discovery.tools.some(
            (tool) =>
                tool.callableName === call.name &&
                tool.mcpServerName === call.mcpServerName,
        ),
    );
    requireProof(
        document.length === 4,
        "exact four current WorkIQ reads required",
    );
    const controls = calls.filter((call) => !document.includes(call));
    const pairs = new Map(
        calls.map((call) => [call, exactPair(events, call, user, terminal)]),
    );
    const allStarts = events.filter(
        (event) =>
            event.type === "tool.execution_start" &&
            Date.parse(event.timestamp) >= Date.parse(user.timestamp) &&
            Date.parse(event.timestamp) <= Date.parse(terminal.timestamp),
    );
    requireProof(
        allStarts.length === calls.length &&
            allStarts.every((event) =>
                calls.some(
                    (call) =>
                        call.toolCallId === event.data.toolCallId &&
                        pairs.get(call)[0].agentId === event.agentId,
                ),
            ),
        "unrecorded/extra native tool calls",
    );
    if (phase === "capture-a") {
        requireProof(
            controls.length === 0 &&
                !trace.handoffRunId &&
                !events.some((event) => event.type === "subagent.started"),
            "capture cannot hide tasks, controls, or a core handoff",
        );
        return { document, controls, pairs, handoffRunId: null };
    }
    requireProof(
        ["reuse-b", "restart-b"].includes(phase),
        "unknown native phase",
    );
    const { host, coreId, completion } = currentHost(
        events,
        trace,
        audit,
        publication,
        callback,
    );
    requireProof(
        controls.length === 1 &&
            controls[0].name === "task" &&
            controls[0].toolCallId === host.data.toolCallId &&
            !pairs.get(controls[0])[0].agentId &&
            ancestor(events, host, user) &&
            ancestor(events, completion, host) &&
            ancestor(events, terminal, completion) &&
            document.every(
                (call) =>
                    pairs.get(call)[0].agentId === host.agentId &&
                    pairs.get(call)[0].data.parentToolCallId ===
                        host.data.toolCallId,
            ),
        "unproved outer control/host child relation",
    );
    const grammar = routes.filter(
        (entry) =>
            entry.event === "explained" &&
            entry.data?.fromCache === "grammar" &&
            entry.data.detail?.phrase === user.data.content &&
            entry.data.detail?.action ===
                `macros.run_${publication.macroId}_v${publication.version}`,
    );
    requireProof(
        grammar.length === 1,
        "current approved grammar route missing/ambiguous",
    );
    requireProof(
        isDeepStrictEqual(
            document.map((call) => call.name),
            discovery.tools.length === 3
                ? ["retrieve", "fetch", "fetch_blob", "fetch"].map(
                      (name) =>
                          discovery.tools.find(
                              (tool) => tool.advertisedName === name,
                          )?.callableName,
                  )
                : [],
        ),
        "current four-read order differs",
    );
    return { document, controls, pairs, handoffRunId: coreId };
}
