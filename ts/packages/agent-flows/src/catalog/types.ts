// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AutomationKind =
    | "webflow"
    | "powershell"
    | "taskflow"
    | "toolMacro";

export type AutomationStatus = "needsReview" | "active" | "disabled";

// Verbs the owning provider supports for an item. The UI renders only these.
export type AutomationVerb = "validate" | "approve" | "disable" | "delete";

export interface AutomationSummary {
    id: string;
    kind: AutomationKind;
    name: string;
    description: string;
    status: AutomationStatus;
    scope: string;
    origin: string;
    triggers: number;
    warnings: string[];
    capabilities: AutomationVerb[];
    version?: number;
    executionClass?: string;
    createdAt?: string;
    updatedAt?: string;
    lastRunAt?: string;
    runCount?: number;
}

export interface AutomationParameter {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    secret?: boolean;
}

export interface AutomationFact {
    label: string;
    value: string;
}

export interface AutomationStep {
    id: string;
    title: string;
    lines: string[];
}

export interface AutomationDetail extends AutomationSummary {
    parameters: AutomationParameter[];
    triggerPhrases: string[];
    body?: { language: string; text: string };
    steps: AutomationStep[];
    safety: AutomationFact[];
}

export interface AutomationProviderStatus {
    kind: AutomationKind;
    available: boolean;
    reason?: string;
}

export interface AutomationCatalog {
    items: AutomationSummary[];
    providers: AutomationProviderStatus[];
}

export type AutomationValidationIssue = {
    severity: "error" | "warning";
    code: string;
    message: string;
    stepId?: string;
};

export interface AutomationValidationReport {
    valid: boolean;
    issues: AutomationValidationIssue[];
}

export function automationId(kind: AutomationKind, nativeId: string): string {
    return `${kind}:${nativeId}`;
}

export function parseAutomationId(
    id: string,
): { kind: AutomationKind; nativeId: string } | undefined {
    const separator = id.indexOf(":");
    if (separator <= 0) return undefined;
    const kind = id.slice(0, separator);
    if (
        kind !== "webflow" &&
        kind !== "powershell" &&
        kind !== "taskflow" &&
        kind !== "toolMacro"
    ) {
        return undefined;
    }
    return { kind, nativeId: id.slice(separator + 1) };
}
