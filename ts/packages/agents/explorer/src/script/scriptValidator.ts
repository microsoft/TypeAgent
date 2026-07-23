// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createScriptValidator,
    transpileScript as sharedTranspileScript,
} from "@typeagent/agent-flows";
import {
    exploreFlowParameters,
    generateSandboxDeclarations,
} from "./sandboxDeclarations.js";

const baseValidator = createExploreValidator(false);
const lspValidator = createExploreValidator(true);

export function validateExploreScript(
    source: string,
    enableLsp = false,
): {
    valid: boolean;
    errors: string[];
} {
    const result = (enableLsp ? lspValidator : baseValidator).validate(
        source,
        Object.keys(exploreFlowParameters),
        exploreFlowParameters,
    );
    return {
        valid: result.valid,
        errors: result.errors
            .filter((error) => error.severity === "error")
            .map((error) =>
                `${error.line}:${error.column} ${error.message}`.trim(),
            ),
    };
}

function createExploreValidator(enableLsp: boolean) {
    return createScriptValidator({
        apiParamName: "repo",
        getSandboxDeclarations: (parameters) =>
            generateSandboxDeclarations(parameters, enableLsp),
    });
}

export const transpileExploreScript = sharedTranspileScript;
