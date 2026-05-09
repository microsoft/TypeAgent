// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createScriptValidator,
    transpileScript as sharedTranspile,
    BLOCKED_IDENTIFIERS as SHARED_BLOCKED,
    type FlowParameterDefinition,
} from "@typeagent/agent-flows";
import { ValidationResult } from "./types.mjs";
import {
    generateSandboxDeclarations,
    generateGenericSandboxDeclarations,
} from "./sandboxDeclarations.mjs";

export const BLOCKED_IDENTIFIERS = SHARED_BLOCKED;

const validator = createScriptValidator({
    apiParamName: "api",
    getSandboxDeclarations: (params) =>
        params
            ? generateSandboxDeclarations(params)
            : generateGenericSandboxDeclarations(),
});

export function validateTaskFlowScript(
    source: string,
    declaredParams: string[],
    flowParameters?: Record<
        string,
        { type: "string" | "number" | "boolean"; required?: boolean }
    >,
): ValidationResult {
    return validator.validate(
        source,
        declaredParams,
        flowParameters as Record<string, FlowParameterDefinition> | undefined,
    );
}

export const transpileScript = sharedTranspile;
