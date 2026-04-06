// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { WebFlowDefinition } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// At runtime this code lives in dist/agent/webFlows/. The .d.ts source file
// lives in src/agent/webFlows/. Try both the source-relative path (from dist)
// and the co-located path (for dev/test scenarios).
const CANDIDATE_PATHS = [
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
];

let cachedSandboxDts: string | undefined;

function getSandboxDts(): string {
    if (!cachedSandboxDts) {
        const dtsPath = CANDIDATE_PATHS.find((p) => fs.existsSync(p));
        if (!dtsPath) {
            throw new Error(
                "webFlowSandbox.d.ts not found in any candidate path",
            );
        }
        cachedSandboxDts = fs.readFileSync(dtsPath, "utf8");
    }
    return cachedSandboxDts;
}

function generateFlowParamsInterface(flow: WebFlowDefinition): string {
    const paramEntries = Object.entries(flow.parameters);
    if (paramEntries.length === 0) {
        return "interface FlowParams {\n    [key: string]: unknown;\n}";
    }
    const fields = paramEntries
        .map(([name, param]) => {
            const tsType =
                param.type === "string"
                    ? "string"
                    : param.type === "number"
                      ? "number"
                      : "boolean";
            return `    readonly ${name}${param.required ? "" : "?"}: ${tsType};`;
        })
        .join("\n");
    return `interface FlowParams {\n${fields}\n}`;
}

export function generateSandboxDeclarations(flow: WebFlowDefinition): string {
    return `${getSandboxDts()}\n${generateFlowParamsInterface(flow)}\n`;
}

export function generateGenericSandboxDeclarations(): string {
    return `${getSandboxDts()}\ninterface FlowParams {\n    [key: string]: unknown;\n}\n`;
}
