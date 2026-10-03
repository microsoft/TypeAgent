// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RunbookHostCapabilities,
    RunbookBindingReference,
    RunbookBindingReadiness,
    RunbookBindingCheck,
} from "@typeagent/agent-server-protocol";
import type {
    AgentEditionInput,
    CatalogRunbookBinding,
    RunbookBindingValidator,
} from "@typeagent/memory-service";
import { canonicalizeProcedure } from "@typeagent/memory-service/agent-edition-validation";

function bindingArguments(
    binding: CatalogRunbookBinding,
): Record<string, unknown> | undefined {
    if (!("arguments" in binding) || binding.arguments === undefined)
        return undefined;
    if (
        typeof binding.arguments !== "object" ||
        binding.arguments === null ||
        Array.isArray(binding.arguments)
    )
        throw new Error("Catalog binding arguments must be a JSON object.");
    return binding.arguments as Record<string, unknown>;
}

function referenceId(binding: CatalogRunbookBinding): string {
    if (binding.kind !== "mcp") return binding.targetId;
    return JSON.stringify([binding.serverId, binding.targetId]);
}

function sameReference(
    left: RunbookBindingReference,
    right: RunbookBindingReference,
): boolean {
    return (
        left.kind === right.kind &&
        left.id === right.id &&
        left.version === right.version &&
        left.fingerprint === right.fingerprint
    );
}

function argumentProof(
    readiness: RunbookBindingReadiness,
    reference: RunbookBindingCheck,
    index: number,
): boolean {
    if (!Array.isArray(readiness.argumentChecks)) return false;
    const proofs = readiness.argumentChecks.filter(
        (proof) =>
            proof !== null &&
            typeof proof === "object" &&
            proof.binding !== null &&
            typeof proof.binding === "object" &&
            proof.bindingIndex === index &&
            proof.argumentsValidated === true &&
            sameReference(proof.binding, reference) &&
            proof.binding.serverConfigId === reference.serverConfigId &&
            canonicalizeProcedure({ arguments: proof.binding.arguments }) ===
                canonicalizeProcedure({ arguments: reference.arguments }),
    );
    return proofs.length === 1;
}

function knownIssue(
    issue: RunbookBindingReadiness["issues"][number],
    references: readonly RunbookBindingReference[],
): boolean {
    if (issue.binding === null || typeof issue.binding !== "object")
        return false;
    if (issue.bindingIndex !== undefined) {
        return (
            Number.isSafeInteger(issue.bindingIndex) &&
            issue.bindingIndex >= 0 &&
            issue.bindingIndex < references.length &&
            sameReference(issue.binding, references[issue.bindingIndex])
        );
    }
    return (
        references.filter((reference) =>
            sameReference(issue.binding, reference),
        ).length === 1
    );
}

function unmappedFailure(
    readiness: RunbookBindingReadiness,
    references: readonly RunbookBindingReference[],
): boolean {
    if (readiness.valid) return readiness.issues.length !== 0;
    return (
        readiness.issues.length === 0 ||
        readiness.issues.some((issue) => !knownIssue(issue, references))
    );
}

export function createRunbookBindingValidator(
    catalog: Pick<RunbookHostCapabilities, "checkBindingTargets">,
) {
    return async (
        bindings: Parameters<RunbookBindingValidator>[0],
        context?: { inputs: readonly AgentEditionInput[] },
    ): ReturnType<RunbookBindingValidator> => {
        const references = bindings.map((binding) => {
            const arguments_ = bindingArguments(binding);
            return {
                kind: binding.kind,
                id: referenceId(binding),
                version: String(binding.version),
                fingerprint: binding.fingerprint,
                ...(binding.kind === "mcp"
                    ? { serverConfigId: binding.serverId }
                    : {}),
                ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
            };
        });
        const readiness = await catalog.checkBindingTargets({
            bindings: references,
            ...(context === undefined ? {} : { inputs: context.inputs }),
        });
        const groupFailure = unmappedFailure(readiness, references);
        return bindings.map((binding, index) => {
            const reference = references[index];
            if (binding.kind === "mcp") {
                let identity: unknown;
                try {
                    identity = JSON.parse(reference.id);
                } catch {
                    identity = undefined;
                }
                if (
                    !Array.isArray(identity) ||
                    identity.length !== 2 ||
                    typeof identity[0] !== "string" ||
                    identity[0] !== binding.serverId ||
                    typeof identity[1] !== "string" ||
                    JSON.stringify(identity) !== reference.id
                ) {
                    return {
                        binding,
                        status: "rejected" as const,
                        reason: "MCP binding server identity does not match the immutable tool identity.",
                    };
                }
            }
            if (groupFailure) {
                return {
                    binding,
                    status: "rejected" as const,
                    reason: "Catalog validation failed without unambiguous per-target results.",
                };
            }
            const issue = readiness.issues.find((item) =>
                item.bindingIndex !== undefined
                    ? item.bindingIndex === index
                    : sameReference(item.binding, reference),
            );
            if (
                issue === undefined &&
                !argumentProof(readiness, reference, index)
            ) {
                return {
                    binding,
                    status: "unavailable" as const,
                    reason: "Current catalog argument validation was not explicitly attested.",
                };
            }
            return {
                binding,
                ...(issue === undefined ? { argumentsValidated: true } : {}),
                status:
                    issue === undefined
                        ? ("accepted" as const)
                        : issue.code === "drifted"
                          ? ("drifted" as const)
                          : issue.code === "invalidArguments"
                            ? ("rejected" as const)
                            : ("unavailable" as const),
                ...(issue === undefined ? {} : { reason: issue.message }),
            };
        });
    };
}
