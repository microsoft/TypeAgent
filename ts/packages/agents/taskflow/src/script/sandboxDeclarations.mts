// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";
import {
    createSandboxDeclarationGenerator,
    type FlowParameterDefinition,
} from "@typeagent/agent-flows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findPackageRoot(): string {
    let current = __dirname;
    while (true) {
        const packageJson = path.join(current, "package.json");
        if (
            fs.existsSync(packageJson) &&
            JSON.parse(fs.readFileSync(packageJson, "utf8")).name ===
                "@typeagent/taskflow-typeagent"
        ) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            throw new Error(
                "Unable to locate the @typeagent/taskflow-typeagent package.",
            );
        }
        current = parent;
    }
}

const generator = createSandboxDeclarationGenerator({
    candidatePaths: [
        path.join(findPackageRoot(), "src", "script", "taskFlowSandbox.d.ts"),
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
