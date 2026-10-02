// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    automationId,
    type AutomationDetail,
    type AutomationFact,
    type AutomationParameter,
    type AutomationStatus,
    type AutomationStep,
    type AutomationSummary,
    type AutomationVerb,
} from "./types.js";
import { extractRulePatterns } from "../grammar/grammarBuilder.js";

export { extractRulePatterns };

// The inputs below describe only the fields the catalog reads. They match the
// persisted shapes of each store without importing the owning agent package.

export interface FlowIndexParameterLike {
    name: string;
    type: string;
    required: boolean;
    description?: string;
}

export interface FlowIndexEntryLike {
    actionName: string;
    displayName?: string;
    description: string;
    grammarRuleText?: string;
    parameters: FlowIndexParameterLike[];
    created: string;
    updated: string;
    source: string;
    usageCount: number;
    lastUsed?: string;
    enabled: boolean;
}

export interface PowerShellDefinitionLike {
    grammarPatterns?: { pattern: string }[];
    sandbox?: {
        allowedCmdlets?: string[];
        allowedPaths?: string[];
        allowedModules?: string[];
        maxExecutionTime?: number;
        networkAccess?: boolean;
    };
    expectedOutputFormat?: string;
}

export interface TaskFlowDefinitionLike {
    grammarPatterns?: string[];
}

export interface WebFlowLike {
    name: string;
    description?: string;
    parameters?: Record<
        string,
        {
            type?: string;
            required?: boolean;
            description?: string;
            valueOptions?: string[];
        }
    >;
    script?: string;
    grammarPatterns?: string[];
    source?: { type?: string; timestamp?: string; originUrl?: string };
    scope?: { type?: string; domains?: string[]; urlPatterns?: string[] };
}

export type MacroValueExpressionLike =
    | { kind: "literal"; value: unknown }
    | { kind: "input"; name: string }
    | { kind: "stepResult"; stepId: string; path?: string[] }
    | {
          kind: "template";
          value: unknown;
          bindings: {
              path: string[];
              expression: MacroValueExpressionLike;
          }[];
      };

export interface MacroLike {
    macroId: string;
    version: number;
    name: string;
    description: string;
    state: "draft" | "approved" | "disabled";
    executionClass: string;
    inputs: {
        name: string;
        description: string;
        required: boolean;
        secret: boolean;
        valueType?: string;
    }[];
    steps: {
        id: string;
        toolName: string;
        mcpServerName?: string;
        arguments: MacroValueExpressionLike;
        executionClass: string;
        schemaFingerprint?: string;
        postconditions?: unknown[];
    }[];
    sourceTraceId: string;
    createdAt: string;
    warnings: string[];
    candidateProvenance?: unknown;
    learning?: { cwd: string; grammarRules: string[]; mode: string };
}

function flowStatus(enabled: boolean): AutomationStatus {
    return enabled ? "active" : "disabled";
}

function toParameters(
    parameters: FlowIndexParameterLike[],
): AutomationParameter[] {
    return parameters.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        ...(p.description ? { description: p.description } : {}),
    }));
}

export function summarizePowerShellFlow(
    entry: FlowIndexEntryLike,
    definition?: PowerShellDefinitionLike,
): AutomationSummary {
    const phrases =
        definition?.grammarPatterns?.map((p) => p.pattern) ??
        extractRulePatterns(entry.grammarRuleText);
    return {
        id: automationId("powershell", entry.actionName),
        kind: "powershell",
        name: entry.displayName || entry.actionName,
        description: entry.description,
        status: flowStatus(entry.enabled),
        scope: "This machine",
        origin: entry.source,
        triggers: phrases.length,
        warnings: [],
        capabilities: [],
        createdAt: entry.created,
        updatedAt: entry.updated,
        runCount: entry.usageCount,
        ...(entry.lastUsed ? { lastRunAt: entry.lastUsed } : {}),
    };
}

function formatList(values: string[] | undefined): string {
    return values && values.length > 0 ? values.join(", ") : "none";
}

export function detailForPowerShellFlow(
    entry: FlowIndexEntryLike,
    definition: PowerShellDefinitionLike | undefined,
    script: string | undefined,
): AutomationDetail {
    const sandbox = definition?.sandbox;
    const safety: AutomationFact[] = sandbox
        ? [
              {
                  label: "Allowed cmdlets",
                  value: formatList(sandbox.allowedCmdlets),
              },
              {
                  label: "Allowed paths",
                  value: formatList(sandbox.allowedPaths),
              },
              {
                  label: "Allowed modules",
                  value: formatList(sandbox.allowedModules),
              },
              {
                  label: "Network access",
                  value: sandbox.networkAccess ? "yes" : "no",
              },
              {
                  label: "Max run time",
                  value:
                      sandbox.maxExecutionTime === undefined
                          ? "default"
                          : `${sandbox.maxExecutionTime} s`,
              },
          ]
        : [];
    return {
        ...summarizePowerShellFlow(entry, definition),
        parameters: toParameters(entry.parameters),
        triggerPhrases:
            definition?.grammarPatterns?.map((p) => p.pattern) ??
            extractRulePatterns(entry.grammarRuleText),
        ...(script !== undefined
            ? { body: { language: "powershell", text: script } }
            : {}),
        steps: [],
        safety,
    };
}

export function summarizeTaskFlow(
    entry: FlowIndexEntryLike,
    definition?: TaskFlowDefinitionLike,
): AutomationSummary {
    const phrases =
        definition?.grammarPatterns ??
        extractRulePatterns(entry.grammarRuleText);
    return {
        id: automationId("taskflow", entry.actionName),
        kind: "taskflow",
        name: entry.actionName,
        description: entry.description,
        status: flowStatus(entry.enabled),
        scope: "Any agent",
        origin: entry.source,
        triggers: phrases.length,
        warnings: [],
        capabilities: [],
        createdAt: entry.created,
        updatedAt: entry.updated,
        runCount: entry.usageCount,
        ...(entry.lastUsed ? { lastRunAt: entry.lastUsed } : {}),
    };
}

export function detailForTaskFlow(
    entry: FlowIndexEntryLike,
    definition: TaskFlowDefinitionLike | undefined,
    script: string | undefined,
): AutomationDetail {
    return {
        ...summarizeTaskFlow(entry, definition),
        parameters: toParameters(entry.parameters),
        triggerPhrases:
            definition?.grammarPatterns ??
            extractRulePatterns(entry.grammarRuleText),
        ...(script !== undefined
            ? { body: { language: "typescript", text: script } }
            : {}),
        steps: [],
        safety: [],
    };
}

function webFlowScope(flow: WebFlowLike): string {
    const scope = flow.scope;
    if (scope?.type === "site" && scope.domains && scope.domains.length > 0) {
        return scope.domains.join(", ");
    }
    return "Any site";
}

export function summarizeWebFlow(flow: WebFlowLike): AutomationSummary {
    const capabilities: AutomationVerb[] = ["delete"];
    return {
        id: automationId("webflow", flow.name),
        kind: "webflow",
        name: flow.name,
        description: flow.description ?? "",
        status: "active",
        scope: webFlowScope(flow),
        origin: flow.source?.type ?? "unknown",
        triggers: flow.grammarPatterns?.length ?? 0,
        warnings: [],
        capabilities,
        ...(flow.source?.timestamp ? { createdAt: flow.source.timestamp } : {}),
    };
}

export function detailForWebFlow(flow: WebFlowLike): AutomationDetail {
    const parameters: AutomationParameter[] = Object.entries(
        flow.parameters ?? {},
    ).map(([name, p]) => ({
        name,
        type: p.type ?? "string",
        required: p.required ?? false,
        ...(p.description ? { description: p.description } : {}),
    }));
    const safety: AutomationFact[] = [
        {
            label: "Scope",
            value:
                flow.scope?.type === "site"
                    ? `Sites: ${formatList(flow.scope.domains)}`
                    : "Any site",
        },
    ];
    if (flow.scope?.urlPatterns && flow.scope.urlPatterns.length > 0) {
        safety.push({
            label: "URL patterns",
            value: flow.scope.urlPatterns.join(", "),
        });
    }
    if (flow.source?.originUrl) {
        safety.push({ label: "Created on", value: flow.source.originUrl });
    }
    return {
        ...summarizeWebFlow(flow),
        parameters,
        triggerPhrases: flow.grammarPatterns ?? [],
        ...(flow.script !== undefined
            ? { body: { language: "javascript", text: flow.script } }
            : {}),
        steps: [],
        safety,
    };
}

const MAX_LITERAL_LENGTH = 120;

function shorten(value: unknown): string {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > MAX_LITERAL_LENGTH
        ? `${text.slice(0, MAX_LITERAL_LENGTH)}...`
        : text;
}

export function describeExpression(
    expression: MacroValueExpressionLike,
): string[] {
    switch (expression.kind) {
        case "literal":
            return [`literal ${shorten(expression.value)}`];
        case "input":
            return [`input: ${expression.name}`];
        case "stepResult":
            return [
                `result of ${expression.stepId}${
                    expression.path && expression.path.length > 0
                        ? `: ${expression.path.join(".")}`
                        : ""
                }`,
            ];
        case "template":
            return expression.bindings.map(
                (binding) =>
                    `${binding.path.join(".") || "(value)"} <- ${describeExpression(binding.expression).join(" ")}`,
            );
    }
}

const MACRO_STATUS: Record<MacroLike["state"], AutomationStatus> = {
    draft: "needsReview",
    approved: "active",
    disabled: "disabled",
};

const MACRO_VERBS: Record<MacroLike["state"], AutomationVerb[]> = {
    draft: ["validate", "approve", "delete"],
    approved: ["disable", "delete"],
    disabled: ["delete"],
};

function macroOrigin(macro: MacroLike): string {
    if (macro.candidateProvenance) return "candidate";
    if (macro.sourceTraceId.startsWith("procedure:")) return "procedure";
    return "trace";
}

export function summarizeMacro(macro: MacroLike): AutomationSummary {
    return {
        id: automationId("toolMacro", macro.macroId),
        kind: "toolMacro",
        name: macro.name,
        description: macro.description,
        status: MACRO_STATUS[macro.state],
        scope: macro.learning?.cwd ?? "Copilot tools",
        origin: macroOrigin(macro),
        triggers: macro.learning?.grammarRules.length ?? 0,
        warnings: macro.warnings,
        capabilities: MACRO_VERBS[macro.state],
        version: macro.version,
        executionClass: macro.executionClass,
        createdAt: macro.createdAt,
        updatedAt: macro.createdAt,
    };
}

export function detailForMacro(macro: MacroLike): AutomationDetail {
    const steps: AutomationStep[] = macro.steps.map((step) => ({
        id: step.id,
        title: step.mcpServerName
            ? `${step.mcpServerName} / ${step.toolName}`
            : step.toolName,
        lines: describeExpression(step.arguments),
    }));
    const safety: AutomationFact[] = [
        { label: "Execution class", value: macro.executionClass },
        {
            label: "Tools",
            value: formatList(
                macro.steps.map((s) =>
                    s.mcpServerName
                        ? `${s.mcpServerName}/${s.toolName}`
                        : s.toolName,
                ),
            ),
        },
        {
            label: "Secret inputs",
            value: formatList(
                macro.inputs.filter((i) => i.secret).map((i) => i.name),
            ),
        },
        {
            label: "Schema fingerprints",
            value: macro.steps.every((s) => s.schemaFingerprint)
                ? "recorded for every step"
                : "not recorded for every step",
        },
    ];
    if (macro.learning) {
        safety.push({ label: "Learning mode", value: macro.learning.mode });
    }
    return {
        ...summarizeMacro(macro),
        parameters: macro.inputs.map((input) => ({
            name: input.name,
            type: input.valueType ?? "string",
            required: input.required,
            description: input.description,
            secret: input.secret,
        })),
        triggerPhrases: macro.learning?.grammarRules ?? [],
        steps,
        safety,
    };
}
