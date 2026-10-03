// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RunbookHostCapabilities,
    RunbookSkillLifecycle,
    RunbookSkillMutation,
} from "@typeagent/agent-server-protocol";
import {
    allowedSkillTransitions,
    type LiveSkillCatalog,
} from "@typeagent/skill-catalog";
import type { PersonalHowToService } from "@typeagent/memory-service";
import type { MacroManager } from "@typeagent/copilot-macros";
import type { RegisteredMcpToolCatalog } from "default-agent-provider";
import { ProcedureArtifactRpcService } from "./procedureArtifacts.js";
import {
    createRunbookBindingCatalog,
    pageBounds,
} from "./runbookBindingCatalog.js";
import { rankRunbookBindings } from "./runbookBindingSuggestions.js";
import { createRunbookBindingValidator } from "./runbookBindingValidator.js";

export type RunbookHostSources = {
    skillCatalog: LiveSkillCatalog;
    macroManager: MacroManager;
    procedureService?: Pick<PersonalHowToService, "getProcedure">;
    readMcpCatalogs?: () => Promise<RegisteredMcpToolCatalog[]>;
};

function lifecycle(
    entry: RunbookSkillLifecycle["entry"],
): RunbookSkillLifecycle {
    const allowedTransitions = allowedSkillTransitions[entry.state];
    const allowedActions: RunbookSkillLifecycle["allowedActions"][number][] =
        [];
    if (allowedTransitions.length > 0) allowedActions.push("changeState");
    if (allowedTransitions.includes("validated"))
        allowedActions.push("validate");
    if (allowedTransitions.includes("disabled")) allowedActions.push("disable");
    if (allowedTransitions.includes("archived")) allowedActions.push("archive");
    if (["approved", "disabled", "active"].includes(entry.state)) {
        allowedActions.push("activate", "rollback");
    }
    return {
        entry,
        allowedTransitions: [...allowedTransitions],
        allowedActions,
    };
}

async function mutateSkill(
    catalog: LiveSkillCatalog,
    request: RunbookSkillMutation,
) {
    if (
        !request.revision ||
        typeof request.expectedActive !== "boolean" ||
        !Object.prototype.hasOwnProperty.call(
            allowedSkillTransitions,
            request.expectedState,
        )
    ) {
        throw new Error(
            "An exact revision and expected current state/active flag are required.",
        );
    }
    const expected = {
        state: request.expectedState,
        active: request.expectedActive,
    };
    switch (request.action) {
        case "activate":
            return catalog.activate(
                request.identity,
                request.revision,
                expected,
            );
        case "rollback":
            return catalog.rollback(
                request.identity,
                request.revision,
                expected,
            );
        case "validate":
            return catalog.validateRevision(
                request.identity,
                request.revision,
                expected,
            );
        case "disable":
            return catalog.transition(
                request.identity,
                request.revision,
                "disabled",
                expected,
            );
        case "archive":
            return catalog.transition(
                request.identity,
                request.revision,
                "archived",
                expected,
            );
        case "changeState":
            if (request.state === undefined)
                throw new Error("A destination state is required.");
            if (request.state === "validated") {
                return catalog.validateRevision(
                    request.identity,
                    request.revision,
                    expected,
                );
            }
            return catalog.transition(
                request.identity,
                request.revision,
                request.state,
                expected,
            );
        default:
            throw new Error("Unsupported skill lifecycle action.");
    }
}

export function createRunbookHostCapabilities(
    sources: RunbookHostSources,
): RunbookHostCapabilities {
    const { skillCatalog, macroManager } = sources;
    const bindings = createRunbookBindingCatalog(
        macroManager,
        sources.readMcpCatalogs,
    );
    const artifacts =
        sources.procedureService === undefined
            ? undefined
            : new ProcedureArtifactRpcService(
                  sources.procedureService,
                  skillCatalog,
                  macroManager,
                  createRunbookBindingValidator(bindings),
              );
    function requireArtifacts() {
        if (artifacts === undefined)
            throw new Error(
                "Procedure artifact catalog is unavailable in this host.",
            );
        return artifacts;
    }
    return {
        async listSkills(request) {
            const { start, end } = pageBounds(request);
            return (await skillCatalog.list())
                .filter(
                    (entry) =>
                        (request?.activeOnly !== true || entry.active) &&
                        (request?.states === undefined ||
                            request.states.includes(entry.state)) &&
                        (request?.scopes === undefined ||
                            request.scopes.includes(
                                entry.revision.identity.scope,
                            )),
                )
                .slice(start, end);
        },
        getSkill: (request) =>
            skillCatalog.get(request.identity, request.revision),
        async readSkillFile(request) {
            const bytes = await skillCatalog.readFile(
                request.identity,
                request.revision,
                request.path,
            );
            return {
                content: Buffer.from(bytes).toString("base64"),
                encoding: "base64",
                mimeType: request.path.endsWith(".json")
                    ? "application/json"
                    : request.path.endsWith(".md")
                      ? "text/markdown"
                      : "application/octet-stream",
            };
        },
        previewProcedureArtifact: async (request) => {
            if (request.kind !== "skill")
                throw new Error("Runbook artifacts support skills only.");
            return requireArtifacts().preview(request);
        },
        promoteProcedureArtifact: async (request) => {
            if (request.kind !== "skill")
                throw new Error("Runbook artifacts support skills only.");
            return requireArtifacts().promote(request);
        },
        async getSkillLifecycle(request) {
            if (!request.revision)
                throw new Error("An exact skill revision is required.");
            const entry = await skillCatalog.get(
                request.identity,
                request.revision,
            );
            if (entry === undefined) throw new Error("Unknown skill revision.");
            return lifecycle(entry);
        },
        changeSkillLifecycle: (request) => mutateSkill(skillCatalog, request),
        ...bindings,
        async suggestBindings(request) {
            return rankRunbookBindings(
                request,
                await bindings.listBindingTargets({ limit: 200 }),
            );
        },
    };
}

export function withRunbookHostCapabilities(
    agentInitOptions: Record<string, unknown> | undefined,
    runbookCapabilities: RunbookHostCapabilities,
): Record<string, unknown> {
    const browser = agentInitOptions?.browser;
    const isOptions =
        typeof browser === "object" &&
        browser !== null &&
        ("browserControl" in browser ||
            "memoryServiceClient" in browser ||
            "automations" in browser ||
            "runbookCapabilities" in browser);
    return {
        ...agentInitOptions,
        browser:
            browser === undefined
                ? { runbookCapabilities }
                : isOptions
                  ? { ...browser, runbookCapabilities }
                  : { browserControl: browser, runbookCapabilities },
    };
}
