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

export interface WebFlowIndexEntry {
    description: string;
    scope: WebFlowScope;
    flowFile: string;
    scriptFile: string;
    grammarRegistered: boolean;
    source: WebFlowSource["type"];
    created: string;
}

export interface WebFlowResult {
    success: boolean;
    message?: string;
    data?: unknown;
    error?: string;
}

export interface ElementQuery {
    cssSelector?: string;
    role?: string;
    text?: string;
    textContains?: string;
    label?: string;
    placeholder?: string;
    index?: number;
}

export interface ElementHandle {
    selector: string;
    tagName: string;
    text?: string;
    attributes?: Record<string, string>;
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
