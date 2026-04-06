// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface TaskFlowScriptResult {
    success: boolean;
    message?: string;
    data?: unknown;
    error?: string;
}

export interface ActionStepResult {
    text: string;
    data: unknown;
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
