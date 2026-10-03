// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    CopilotToolMacro,
    MacroManager,
    ValueExpression,
} from "@typeagent/copilot-macros";
import type { RegisteredMcpToolCatalog } from "default-agent-provider";
import type {
    RunbookBindingCatalog,
    RunbookBindingReadiness,
    RunbookBindingTarget,
    RunbookCatalogPageRequest,
} from "@typeagent/agent-server-protocol";
import { validateRunbookBindingArguments } from "./runbookBindingArguments.js";
import { createRunbookInputSchema } from "./runbookBindingInputs.js";
import type { RunbookBindingCheckRequest } from "@typeagent/agent-server-protocol";
import { validateRunbookBinding } from "@typeagent/memory-service/agent-edition-validation";

export function pageBounds(request?: RunbookCatalogPageRequest | null): {
    start: number;
    end: number;
} {
    request ??= {};
    const limit = request.limit ?? 100;
    const offset = request.offset ?? 0;
    if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 200 ||
        !Number.isSafeInteger(offset) ||
        offset < 0
    ) {
        throw new Error(
            "Catalog pagination requires limit 1..200 and nonnegative offset.",
        );
    }
    return { start: offset, end: offset + limit };
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, child]) => [key, canonical(child)]),
        );
    }
    return value;
}

function referencedMacroInputs(expression: ValueExpression): string[] {
    if (expression.kind === "input") return [expression.name];
    if (expression.kind === "template") {
        return expression.bindings.flatMap((binding) =>
            referencedMacroInputs(binding.expression),
        );
    }
    return [];
}

function macroTarget(macro: CopilotToolMacro): RunbookBindingTarget {
    const inputSchema: Record<string, unknown> = {
        type: "object",
        properties: Object.fromEntries(
            macro.inputs.map((input) => [
                input.name,
                {
                    ...(input.valueType === undefined
                        ? {}
                        : { type: input.valueType }),
                    description: input.description,
                },
            ]),
        ),
        required: [
            ...new Set([
                ...macro.inputs
                    .filter((input) => input.required)
                    .map((input) => input.name),
                ...macro.steps.flatMap((step) =>
                    referencedMacroInputs(step.arguments),
                ),
            ]),
        ],
        additionalProperties: false,
    };
    return {
        kind: "macro",
        id: macro.macroId,
        name: macro.name,
        version: String(macro.version),
        fingerprint: createHash("sha256")
            .update(
                JSON.stringify(
                    canonical({
                        inputSchema,
                        steps: macro.steps,
                        executionClass: macro.executionClass,
                    }),
                ),
            )
            .digest("hex"),
        inputSchema,
        description: macro.description,
        safety: { requiresConfirmation: true },
        permission: {
            status: "runtime-check-required",
            requiresLivePermissions: true,
        },
    };
}

function hasSecretInput(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasSecretInput);
    if (value === null || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    if (
        record.writeOnly === true ||
        record.secret === true ||
        record["x-secret"] === true ||
        record.format === "password"
    )
        return true;
    const properties = record.properties;
    if (
        properties !== null &&
        typeof properties === "object" &&
        Object.keys(properties).some((name) =>
            /password|secret|token|credential|api[-_]?key/i.test(name),
        )
    )
        return true;
    return Object.values(record).some(hasSecretInput);
}

function mcpTargets(
    catalogs: RegisteredMcpToolCatalog[],
    notices: string[],
): RunbookBindingTarget[] {
    return catalogs.flatMap((catalog) => {
        notices.push(...(catalog.notices ?? []));
        if (!catalog.available) {
            notices.push(
                `MCP catalog unavailable: ${catalog.name}; load its registered provider first.`,
            );
            return [];
        }
        if (!catalog.enabled || catalog.trust === "untrusted") {
            notices.push(
                `MCP catalog excluded: ${catalog.name} is disabled or untrusted.`,
            );
            return [];
        }
        return catalog.entries
            .filter((tool) => {
                if (tool.permission?.configuredDecision === "deny") {
                    notices.push(
                        `MCP tool excluded: ${tool.id}; current configured permission denies it.`,
                    );
                    return false;
                }
                try {
                    validateRunbookBinding({
                        kind: "mcp",
                        accepted: false,
                        serverId: tool.serverConfigId,
                        targetId: tool.name,
                        version: tool.fingerprint,
                        fingerprint: tool.fingerprint,
                    });
                } catch {
                    notices.push(
                        `MCP tool excluded: ${tool.id}; its actual server/name identity is unsupported by the canonical binding schema.`,
                    );
                    return false;
                }
                if (!hasSecretInput(tool.inputSchema)) return true;
                notices.push(
                    `MCP tool excluded: ${tool.id}; secret-input schemas are unsupported.`,
                );
                return false;
            })
            .map((tool) => ({
                kind: "mcp" as const,
                id: tool.id,
                serverConfigId: tool.serverConfigId,
                name: tool.name,
                version: tool.fingerprint,
                fingerprint: tool.fingerprint,
                description: tool.description ?? "",
                inputSchema: tool.inputSchema,
                ...(tool.outputSchema === undefined
                    ? {}
                    : { outputSchema: tool.outputSchema }),
                ...(tool.annotations === undefined
                    ? {}
                    : { annotations: tool.annotations }),
                safety: {
                    requiresConfirmation: true as const,
                    readOnly: tool.annotations?.readOnlyHint === true,
                    destructive: tool.annotations?.destructiveHint !== false,
                },
                permission: {
                    status: "runtime-check-required" as const,
                    trust: catalog.trust,
                    enabled: catalog.enabled,
                    ...(tool.permission === undefined ? {} : tool.permission),
                },
            }));
    });
}

export function createRunbookBindingCatalog(
    macros: Pick<MacroManager, "getApprovedMacros" | "listMacros">,
    readMcp?: () => Promise<RegisteredMcpToolCatalog[]>,
) {
    async function snapshot(): Promise<RunbookBindingCatalog> {
        const notices = [
            "Flow bindings unavailable: flow catalogs do not expose immutable approved version snapshots.",
        ];
        const approved = await macros.getApprovedMacros();
        const summaries = await macros.listMacros();
        const safeMacros = approved.filter(
            (macro) =>
                macro.state === "approved" &&
                summaries.some(
                    (summary) =>
                        summary.macroId === macro.macroId &&
                        summary.version === macro.version &&
                        summary.state === "approved",
                ) &&
                macro.executionClass === "replayable" &&
                Number.isSafeInteger(macro.version) &&
                macro.version > 0 &&
                !macro.inputs.some((input) => input.secret),
        );
        for (const summary of summaries) {
            if (
                !safeMacros.some(
                    (macro) =>
                        macro.macroId === summary.macroId &&
                        macro.version === summary.version,
                )
            ) {
                notices.push(
                    `Macro excluded: ${summary.macroId}; requires current approval, replayability, version and non-secret inputs.`,
                );
            }
        }
        let catalogs: RegisteredMcpToolCatalog[] = [];
        if (readMcp === undefined)
            notices.push(
                "Registered MCP tool catalog is unavailable in this host.",
            );
        else {
            try {
                catalogs = await readMcp();
            } catch (error) {
                notices.push(
                    error instanceof Error ? error.message : String(error),
                );
            }
        }
        if (readMcp !== undefined && catalogs.length === 0) {
            notices.push(
                "No registered current MCP tool catalogs are available.",
            );
        }
        const targets = [
            ...safeMacros.map(macroTarget),
            ...mcpTargets(catalogs, notices),
        ];
        return { targets, notices, total: targets.length };
    }

    return {
        async listBindingTargets(
            request?: RunbookCatalogPageRequest,
        ): Promise<RunbookBindingCatalog> {
            const { start, end } = pageBounds(request);
            const catalog = await snapshot();
            return {
                ...catalog,
                targets: catalog.targets.slice(start, end),
                notices:
                    catalog.total > end
                        ? [
                              ...catalog.notices,
                              `Catalog page ends at ${end} of ${catalog.total}; request the next offset for more targets.`,
                          ]
                        : catalog.notices,
            };
        },
        async checkBindingTargets(
            request: RunbookBindingCheckRequest,
        ): Promise<RunbookBindingReadiness> {
            if (request.bindings.length > 200)
                throw new Error("At most 200 bindings can be checked.");
            const catalog = await snapshot();
            const inputSchema =
                request.inputs === undefined
                    ? request.inputSchema
                    : createRunbookInputSchema(request.inputs);
            const argumentChecks: NonNullable<
                RunbookBindingReadiness["argumentChecks"]
            > = [];
            const issues = request.bindings.flatMap(
                (binding, bindingIndex): RunbookBindingReadiness["issues"] => {
                    const target = catalog.targets.find(
                        (item) =>
                            item.kind === binding.kind &&
                            item.id === binding.id,
                    );
                    if (
                        target !== undefined &&
                        binding.kind === "mcp" &&
                        binding.serverConfigId !== undefined &&
                        target.serverConfigId !== binding.serverConfigId
                    ) {
                        return [
                            {
                                binding,
                                bindingIndex,
                                code: "unavailable",
                                message:
                                    "MCP server identity does not match the actual current catalog.",
                            },
                        ];
                    }
                    if (
                        target !== undefined &&
                        target.version === binding.version &&
                        target.fingerprint === binding.fingerprint
                    ) {
                        const validation = validateRunbookBindingArguments(
                            target.inputSchema,
                            binding.arguments,
                            inputSchema,
                        );
                        if (!validation.valid) {
                            return [
                                {
                                    binding,
                                    bindingIndex,
                                    message:
                                        validation.reason ??
                                        "Binding arguments do not fit the actual current target.",
                                    code: validation.code ?? "invalidArguments",
                                },
                            ];
                        }
                        argumentChecks.push({
                            binding,
                            bindingIndex,
                            argumentsValidated: true,
                        });
                    }
                    const message =
                        target === undefined
                            ? "Target unavailable, unsupported, or no longer approved."
                            : target.version !== binding.version ||
                                target.fingerprint !== binding.fingerprint
                              ? "Target version or schema fingerprint drifted; review the current target."
                              : undefined;
                    return message === undefined
                        ? []
                        : [
                              {
                                  binding,
                                  bindingIndex,
                                  message,
                                  code:
                                      target === undefined
                                          ? ("unavailable" as const)
                                          : ("drifted" as const),
                              },
                          ];
                },
            );
            return { valid: issues.length === 0, issues, argumentChecks };
        },
    };
}
