// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { fileURLToPath } from "node:url";
import {
    createSandboxDeclarationGenerator,
    type FlowParameterDefinition,
} from "@typeagent/agent-flows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const generator = createSandboxDeclarationGenerator({
    candidatePaths: [
        path.resolve(
            __dirname,
            "..",
            "..",
            "src",
            "script",
            "taskFlowSandbox.d.ts",
        ),
        path.resolve(__dirname, "taskFlowSandbox.d.ts"),
    ],
    sandboxName: "taskFlowSandbox.d.ts",
});

export function generateSandboxDeclarations(
    parameters: Record<string, FlowParameterDefinition>,
): string {
    return generator.generate(parameters);
}

export function generateGenericSandboxDeclarations(): string {
    return generator.generateGeneric();
}
