// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { fileURLToPath } from "node:url";
import {
    createSandboxDeclarationGenerator,
    type FlowParameterDefinition,
} from "@typeagent/agent-flows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// At runtime this code lives in dist/agent/webFlows/. The .d.ts source file
// lives in src/agent/webFlows/. Try both the source-relative path (from dist)
// and the co-located path (for dev/test scenarios).
const generator = createSandboxDeclarationGenerator({
    candidatePaths: [
        path.resolve(
            __dirname,
            "..",
            "..",
            "..",
            "src",
            "agent",
            "webFlows",
            "webFlowSandbox.d.ts",
        ),
        path.resolve(__dirname, "webFlowSandbox.d.ts"),
    ],
    sandboxName: "webFlowSandbox.d.ts",
});

export function generateSandboxDeclarations(
    parameters: Record<string, FlowParameterDefinition>,
): string {
    return generator.generate(parameters);
}

export function generateGenericSandboxDeclarations(): string {
    return generator.generateGeneric();
}
