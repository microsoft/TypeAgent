// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createScriptValidator,
    transpileScript as sharedTranspile,
    BLOCKED_IDENTIFIERS as SHARED_BLOCKED,
    ALLOWED_GLOBALS as SHARED_ALLOWED,
    type FlowParameterDefinition,
} from "@typeagent/agent-flows";
import { ValidationResult, WebFlowDefinition } from "./types.js";
import {
    generateSandboxDeclarations,
    generateGenericSandboxDeclarations,
} from "./sandboxDeclarations.mjs";

export const BLOCKED_IDENTIFIERS = SHARED_BLOCKED;
export const ALLOWED_GLOBALS = SHARED_ALLOWED;

const validator = createScriptValidator({
    apiParamName: "browser",
    getSandboxDeclarations: (params) =>
        params
            ? generateSandboxDeclarations(params)
            : generateGenericSandboxDeclarations(),
});

export function validateWebFlowScript(
    source: string,
    declaredParams: string[],
    flow?: WebFlowDefinition,
): ValidationResult {
    const flowParams: Record<string, FlowParameterDefinition> | undefined =
        flow
            ? Object.fromEntries(
                  Object.entries(flow.parameters).map(([k, v]) => [
                      k,
                      { type: v.type, required: v.required },
                  ]),
              )
            : undefined;
    return validator.validate(source, declaredParams, flowParams);
}

export const transpileScript = sharedTranspile;
