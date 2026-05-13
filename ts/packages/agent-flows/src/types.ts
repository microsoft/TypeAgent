// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface ValidationError {
    line: number;
    column: number;
    message: string;
    severity: "error" | "warning";
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

export interface ScriptResult {
    success: boolean;
    message?: string;
    data?: unknown;
    error?: string;
}

export interface FlowParameterDefinition {
    type: "string" | "number" | "boolean";
    required?: boolean;
}

export interface FlowSchemaEntry {
    actionName: string;
    description: string;
    parameters?: FlowSchemaParameter[] | undefined;
}

export interface FlowSchemaParameter {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    valueOptions?: string[];
}
