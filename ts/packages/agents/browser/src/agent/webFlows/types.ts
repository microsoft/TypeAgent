// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface WebFlowDefinition {
    name: string;
    description: string;
    version: number;
    parameters: Record<string, WebFlowParameter>;
    script: string;
    grammarPatterns: string[];
    scope: WebFlowScope;
    source: WebFlowSource;
}

export interface WebFlowParameter {
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
    default?: unknown;
    // Known valid values for this parameter (e.g., dropdown options, radio button choices).
    // When present, the runtime should match user input against these values case-insensitively.
    valueOptions?: string[];
}

export interface WebFlowScope {
    type: "site" | "global";
    domains?: string[];
    urlPatterns?: string[];
}

export interface WebFlowSource {
    type: "goal-driven" | "recording" | "discovered" | "manual";
    traceId?: string;
    timestamp: string;
    originUrl?: string;
}

export interface WebFlowIndex {
    version: number;
    lastUpdated: string;
    flows: Record<string, WebFlowIndexEntry>;
}

export interface WebFlowParameterMeta {
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
    valueOptions?: string[];
}

export interface WebFlowIndexEntry {
    description: string;
    scope: WebFlowScope;
    flowFile: string;
    scriptFile: string;
    grammarRegistered: boolean;
    grammarRuleText?: string;
    parameters?: WebFlowParameterMeta[];
    source: WebFlowSource["type"];
    created: string;
}

export interface WebFlowResult {
    success: boolean;
    message?: string;
    data?: unknown;
    error?: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

export interface ValidationError {
    line: number;
    column: number;
    message: string;
    severity: "error" | "warning";
}
