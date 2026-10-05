// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryService,
    PersonalHowToService,
    ProcedureVersion,
} from "@typeagent/memory-service";
import {
    getRunbookCatalogBindings,
    runbookPreferences,
    validateRunbookBindingArguments,
    validateRunbookArgumentReadiness,
    type RunbookBindingArguments,
    type AgentEditionStep,
    type RunbookBinding,
} from "@typeagent/memory-service";
import { isDeepStrictEqual } from "node:util";
import type {
    RunbookHostCapabilities,
    RunbookBindingCheck,
    RunbookBindingTarget,
} from "@typeagent/agent-server-protocol";
import type {
    MemoryHubRunbookFunctions,
    RunbookBindingSuggestion,
} from "@typeagent/browser-control-rpc/viewRpc";
import { timed } from "./memoryHubQuery.mjs";

type Service = MemoryService & PersonalHowToService;
type Accept = Parameters<
    MemoryHubRunbookFunctions["memoryHubAcceptBinding"]
>[0];

export async function requireRunbookVersion(
    service: PersonalHowToService,
    corpusId: string,
    procedureId: string,
    version: number,
): Promise<ProcedureVersion> {
    const procedure = await timed(
        service.getProcedure(corpusId, procedureId, version),
    );
    if (!procedure)
        throw new Error(`Procedure version ${version} is unavailable`);
    return procedure;
}

export function catalogReferences(
    procedure: ProcedureVersion,
): RunbookBindingCheck[] {
    const edition = procedure.document.agentEdition;
    if (!edition) return [];
    return getRunbookCatalogBindings(edition).map((binding) => ({
        kind: binding.kind,
        id:
            binding.kind === "mcp"
                ? JSON.stringify([binding.serverId, binding.targetId])
                : binding.targetId,
        version: String(binding.version),
        fingerprint: binding.fingerprint,
        ...(binding.kind === "mcp" ? { serverConfigId: binding.serverId } : {}),
        ...(binding.arguments === undefined
            ? {}
            : { arguments: binding.arguments }),
    }));
}

function hasArgumentProof(
    readiness: Awaited<
        ReturnType<RunbookHostCapabilities["checkBindingTargets"]>
    >,
    reference: RunbookBindingCheck,
    index: number,
): boolean {
    const proofs =
        readiness.argumentChecks?.filter(
            (proof) => proof.bindingIndex === index,
        ) ?? [];
    return (
        proofs.length === 1 &&
        proofs[0].argumentsValidated === true &&
        isDeepStrictEqual(proofs[0].binding, reference)
    );
}

export async function runbookDrift(
    procedure: ProcedureVersion,
    capabilities: RunbookHostCapabilities | undefined,
): Promise<Array<{ stepId: string; reason: string }>> {
    const references = catalogReferences(procedure);
    if (!references.length) return [];
    const readiness = capabilities
        ? await timed(
              capabilities.checkBindingTargets({
                  bindings: references,
                  inputSchema: stepInputSchema(procedure),
                  inputs: procedure.document.agentEdition?.inputs ?? [],
              }),
          )
        : {
              valid: false,
              issues: references.map((binding) => ({
                  binding,
                  message:
                      "Binding catalog is unavailable; exact target cannot be revalidated.",
              })),
          };
    const issues = [
        ...readiness.issues,
        ...references.flatMap((reference, index) =>
            hasArgumentProof(readiness, reference, index) ||
            readiness.issues.some((issue) =>
                isDeepStrictEqual(issue.binding, reference),
            )
                ? []
                : [
                      {
                          binding: reference,
                          message:
                              "Exact argument-template validation is unavailable; revalidate this binding before publication.",
                      },
                  ],
        ),
    ];
    return (procedure.document.agentEdition?.steps ?? []).flatMap((step) => {
        const binding = step.binding;
        if (
            !binding ||
            !["mcp", "macro", "flow"].includes(binding.kind) ||
            !("targetId" in binding)
        )
            return [];
        return issues
            .filter(
                (issue) =>
                    issue.binding.id ===
                        (binding.kind === "mcp"
                            ? JSON.stringify([
                                  binding.serverId,
                                  binding.targetId,
                              ])
                            : binding.targetId) &&
                    issue.binding.kind === binding.kind &&
                    isDeepStrictEqual(
                        issue.binding.arguments,
                        binding.arguments,
                    ),
            )
            .map((issue) => ({ stepId: step.id, reason: issue.message }));
    });
}

function stepInputSchema(procedure: ProcedureVersion): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const input of procedure.document.agentEdition?.inputs ?? []) {
        properties[input.id] = {
            type: input.type === "enum" ? "string" : input.type,
            ...(input.enumValues === undefined
                ? {}
                : { enum: input.enumValues }),
        };
        if (input.required) required.push(input.id);
    }
    return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
    };
}

function targetSafety(
    target: RunbookBindingTarget,
): RunbookBindingSuggestion["safety"] {
    if (target.safety.readOnly === true) return "readOnly";
    if (target.safety.readOnly === false || target.safety.destructive === true)
        return "changesData";
    return "unknown";
}

export async function suggestRunbookBindings(
    service: Service,
    capabilities: RunbookHostCapabilities,
    request: Parameters<
        MemoryHubRunbookFunctions["memoryHubSuggestBindings"]
    >[0],
) {
    const procedure = await requireRunbookVersion(
        service,
        request.corpusId,
        request.procedureId,
        request.version,
    );
    const step = procedure.document.agentEdition?.steps.find(
        (step) => step.id === request.stepId,
    );
    if (!step) throw new Error("Agent-edition step is unavailable");
    const preferences = runbookPreferences(
        await timed(service.getPersonalHowToSettings(request.corpusId)),
    );
    const result = await timed(
        capabilities.suggestBindings({
            inputSchema: stepInputSchema(procedure),
            commandText: step.agentInstruction,
        }),
    );
    const suggestions: RunbookBindingSuggestion[] = [];
    for (const suggestion of result.suggestions) {
        const target = suggestion.target;
        if (!target) continue;
        if (target.kind === "mcp" && preferences?.mcpTools !== true) continue;
        if (target.kind !== "mcp" && preferences?.approvedAutomations !== true)
            continue;
        suggestions.push({
            targetId: target.id,
            kind: target.kind,
            name: target.name,
            description: target.description,
            version: target.version,
            fingerprint: target.fingerprint,
            inputSchema: target.inputSchema,
            safety: targetSafety(target),
            score:
                (target.kind === "mcp" ? 20 : 40) +
                (suggestion.schemaFit === "exact" ? 10 : 0),
            reasons: [
                ...suggestion.reasons,
                `Schema fit: ${suggestion.schemaFit}`,
                "Runtime permissions are checked separately; accepting this binding grants no permission.",
            ],
        });
    }
    suggestions.sort(
        (left, right) =>
            right.score - left.score ||
            left.targetId.localeCompare(right.targetId),
    );
    return {
        suggestions,
        warnings: [
            ...result.notices,
            ...(preferences === undefined
                ? [
                      "Enable agent-edition and catalog suggestion preferences for this corpus to see catalog targets. Commands and manual steps remain available.",
                  ]
                : []),
        ],
    };
}

async function selectTarget(
    capabilities: RunbookHostCapabilities,
    request: Accept,
    procedure: ProcedureVersion,
): Promise<RunbookBindingTarget> {
    let offset = 0;
    for (;;) {
        const page = await timed(
            capabilities.listBindingTargets({ limit: 100, offset }),
        );
        const target = page.targets.find(
            (target) => target.id === request.targetId,
        );
        if (target) {
            if (
                target.version !== request.targetVersion ||
                target.fingerprint !== request.fingerprint
            )
                throw new Error(
                    "Tool binding changed; reload suggestions before accepting it",
                );
            if (targetSafety(target) !== request.safety)
                throw new Error(
                    "Binding safety does not match current catalog metadata",
                );
            const reference: RunbookBindingCheck = {
                kind: target.kind,
                id: target.id,
                version: target.version,
                fingerprint: target.fingerprint,
                ...(request.arguments === undefined
                    ? {}
                    : { arguments: request.arguments }),
                ...(target.serverConfigId === undefined
                    ? {}
                    : { serverConfigId: target.serverConfigId }),
            };
            const checked = await timed(
                capabilities.checkBindingTargets({
                    bindings: [reference],
                    inputSchema: stepInputSchema(procedure),
                    inputs: procedure.document.agentEdition?.inputs ?? [],
                }),
            );
            if (!checked.valid || checked.issues.length)
                throw new Error(
                    checked.issues.map((issue) => issue.message).join("; "),
                );
            if (!hasArgumentProof(checked, reference, 0)) {
                throw new Error(
                    "Binding catalog did not attest exact argument-template and input-schema validation",
                );
            }
            return target;
        }
        offset += page.targets.length;
        if (!page.targets.length || offset >= page.total)
            throw new Error("Selected tool binding is unavailable");
    }
}

function acceptedTarget(
    target: RunbookBindingTarget,
    argumentsTemplate?: RunbookBindingArguments,
): RunbookBinding {
    const common = {
        accepted: true,
        targetId: target.id,
        fingerprint: target.fingerprint,
        ...(argumentsTemplate === undefined
            ? {}
            : { arguments: structuredClone(argumentsTemplate) }),
    };
    if (target.kind === "mcp") {
        if (!target.serverConfigId)
            throw new Error("MCP target is missing its owning server identity");
        const components: unknown = JSON.parse(target.id);
        if (
            !Array.isArray(components) ||
            components.length !== 2 ||
            components[0] !== target.serverConfigId ||
            typeof components[1] !== "string" ||
            JSON.stringify(components) !== target.id
        ) {
            throw new Error(
                "MCP target does not have a canonical server-qualified identity",
            );
        }
        return {
            ...common,
            targetId: components[1],
            kind: "mcp",
            serverId: target.serverConfigId,
            version: target.version,
        };
    }
    if (target.kind === "macro") {
        const version = Number(target.version);
        if (
            !Number.isSafeInteger(version) ||
            version < 1 ||
            String(version) !== target.version
        )
            throw new Error(
                "Macro catalog returned an invalid canonical version",
            );
        return { ...common, kind: "macro", version };
    }
    return { ...common, kind: "flow", version: target.version };
}

export async function acceptRunbookBinding(
    service: Service,
    capabilities: RunbookHostCapabilities | undefined,
    request: Accept,
): Promise<ProcedureVersion> {
    if (!request.safetyConfirmed)
        throw new Error(
            "Explicit safety confirmation is required to accept a binding",
        );
    const current = await timed(
        service.getProcedure(request.corpusId, request.procedureId),
    );
    if (!current || current.version !== request.expectedVersion)
        throw new Error(
            "Procedure version conflict; reload the current version before accepting a binding",
        );
    if (current.state !== "saved")
        throw new Error("Only a current saved procedure can accept a binding");
    const document = structuredClone(current.document);
    const edition = document.agentEdition;
    const step: AgentEditionStep | undefined = edition?.steps.find(
        (step) => step.id === request.stepId,
    );
    if (!step || !edition) throw new Error("Agent-edition step is unavailable");
    let binding: RunbookBinding;
    if (request.targetId !== undefined) {
        if (!capabilities) throw new Error("Binding catalogs are unavailable");
        if (request.arguments !== undefined) {
            validateRunbookBindingArguments(request.arguments, edition.inputs);
            validateRunbookArgumentReadiness(request.arguments, edition.inputs);
        }
        const target = await selectTarget(capabilities, request, current);
        binding = acceptedTarget(target, request.arguments);
    } else if (request.command !== undefined) {
        binding = { kind: "command", accepted: true, text: request.command };
    } else if (request.manualReason !== undefined) {
        binding = {
            kind: "manual",
            accepted: true,
            reason: request.manualReason,
        };
    } else throw new Error("Choose a catalog target, command, or manual step");
    step.binding = binding;
    step.safety = request.safety;
    edition.review = {
        state: "draft",
        reason: "Binding changed; review the saved procedure version",
    };
    return service.saveProcedure({
        corpusId: request.corpusId,
        procedureId: request.procedureId,
        expectedVersion: request.expectedVersion,
        document,
    });
}
