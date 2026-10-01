// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

export function toolEvidenceViews(event, redact) {
    return {
        consent: { toolCallId: event.toolCallId, result: event.result },
        persisted: {
            toolCallId: event.toolCallId,
            success: event.success,
            result: redact ? "[network evidence withheld]" : event.result,
        },
    };
}

export function executionRouteViolation(name, candidate, preparation, stopped) {
    if (
        stopped &&
        name !== "ask_user" &&
        !name.endsWith("typeagent-cancelAction")
    )
        return "terminal_execution_stop";
    if (
        candidate.id === 4 &&
        ((!preparation && name.endsWith("typeagent-searchActions")) ||
            (preparation && name.endsWith("typeagent-executeAction")))
    )
        return "reuse_preparation_contract";
    return undefined;
}

export function candidateToolBoundary(candidate, nativeTools) {
    const native =
        candidate.id >= 5
            ? nativeTools.map((name) => name.replace(/^builtin:/, ""))
            : ["ask_user"];
    const servers =
        candidate.id === 7
            ? []
            : candidate.id >= 5
              ? ["typeagent-e2e", "typeagent"]
              : ["typeagent-e2e"];
    const mcp = candidate.tools ?? [];
    const aliases = new Map();
    const checks = [];
    let ready = false;
    const canonical = (name) => aliases.get(name) ?? name;
    return {
        availableTools: [
            ...native.map((name) => `builtin:${name}`),
            ...servers.flatMap((server) =>
                mcp.map((tool) => `mcp:${server}-${tool}`),
            ),
        ],
        async initialize(session) {
            await session.rpc.tools.initializeAndValidate();
            const { tools } = await session.rpc.tools.getCurrentMetadata();
            if (!Array.isArray(tools) || !tools.length)
                throw new Error(
                    "Tool boundary unavailable: no initialized metadata",
                );
            const admitted = [];
            for (const tool of tools) {
                const allowed = tool.mcpServerName
                    ? servers.includes(tool.mcpServerName) &&
                      mcp.includes(tool.mcpToolName)
                    : native.includes(tool.name);
                if (!allowed)
                    throw new Error(`Unexpected exposed tool: ${tool.name}`);
                const canonical = tool.mcpServerName
                    ? `${tool.mcpServerName}-${tool.mcpToolName}`
                    : tool.name;
                for (const alias of [
                    tool.name,
                    tool.namespacedName,
                    canonical,
                ].filter(Boolean)) {
                    if (aliases.has(alias) && aliases.get(alias) !== canonical)
                        throw new Error("Ambiguous runtime tool alias");
                    aliases.set(alias, canonical);
                }
                admitted.push(canonical);
            }
            if (
                !aliases.has("ask_user") ||
                mcp.some(
                    (tool) =>
                        !admitted.some(
                            (name) => name === `typeagent-e2e-${tool}`,
                        ),
                )
            )
                throw new Error("Required candidate tools are not exposed");
            ready = true;
            return admitted;
        },
        check(name) {
            return ready && aliases.has(name);
        },
        canonical,
        hasActiveDomainCall() {
            return checks.some(
                (entry) => entry.allowed && entry.name !== "ask_user",
            );
        },
        recordDecision(name, args, allowed) {
            checks.push({
                name: canonical(name),
                argumentHash: argumentHash(args),
                allowed,
            });
        },
        audit(name, args) {
            const index = checks.findIndex(
                (entry) =>
                    entry.name === canonical(name) &&
                    entry.argumentHash === argumentHash(args),
            );
            if (index < 0)
                throw new Error(
                    `Missing pre-tool enforcement evidence: ${name}`,
                );
            return checks.splice(index, 1)[0].allowed;
        },
    };
}

export function callCorrelation(result, input, sequence) {
    const args = input.arguments ?? input.toolArgs;
    const hash = (value) =>
        typeof value === "string"
            ? createHash("sha256").update(value).digest("hex")
            : null;
    return {
        caseId: result.caseId,
        candidate: result.candidate,
        callSequence: sequence,
        sessionSha256: hash(result.sessionId),
        callSha256: hash(input.toolCallId),
        scopeSha256: hash(args?.scopeId),
        operationSha256: hash(args?.operationId),
        interactionSha256: hash(args?.interactionId),
    };
}

function argumentHash(value) {
    const sorted = (value) => {
        if (Array.isArray(value)) return value.map(sorted);
        if (value && typeof value === "object")
            return Object.fromEntries(
                Object.keys(value)
                    .sort()
                    .map((key) => [key, sorted(value[key])]),
            );
        return value;
    };
    return createHash("sha256")
        .update(JSON.stringify(sorted(value)) ?? "undefined")
        .digest("hex");
}

export function pendingInteractionGate() {
    let pending;
    return {
        observe(result) {
            const value = result?.structuredContent;
            if (value?.status === "requires_interaction") {
                if (
                    ![
                        value.scopeId,
                        value.operationId,
                        value.interactionId,
                    ].every((id) => typeof id === "string" && id.length)
                )
                    throw new Error(
                        "Pending interaction is missing its contract handles",
                    );
                pending = value;
            } else if (
                [
                    "completed",
                    "failed",
                    "cancelled",
                    "execution_uncertain",
                    "unavailable",
                ].includes(value?.status)
            )
                pending = undefined;
        },
        reason(name, args) {
            if (!pending || name === "ask_user") return undefined;
            if (!/typeagent-(continueAction|cancelAction)$/.test(name))
                return "Resolve the pending interaction before starting another tool/action; no action was replayed.";
            if (
                args?.scopeId !== pending.scopeId ||
                args?.operationId !== pending.operationId ||
                args?.interactionId !== pending.interactionId
            )
                return "Continuation/cancellation handles do not match the pending scope, operation and interaction.";
            return undefined;
        },
        clear() {
            pending = undefined;
        },
        assertSettled() {
            if (pending)
                throw new Error(
                    "Final answer arrived with an unresolved structured interaction",
                );
        },
    };
}
