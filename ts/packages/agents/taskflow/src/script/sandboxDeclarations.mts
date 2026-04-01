// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATE_PATHS = [
    path.resolve(
        __dirname,
        "..",
        "..",
        "src",
        "script",
        "taskFlowSandbox.d.ts",
    ),
    path.resolve(__dirname, "taskFlowSandbox.d.ts"),
];

let cachedSandboxDts: string | undefined;

function getSandboxDts(): string {
    if (!cachedSandboxDts) {
        const dtsPath = CANDIDATE_PATHS.find((p) => fs.existsSync(p));
        if (!dtsPath) {
            throw new Error(
                "taskFlowSandbox.d.ts not found in any candidate path",
            );
        }
        cachedSandboxDts = fs.readFileSync(dtsPath, "utf8");
    }
    return cachedSandboxDts;
}

interface FlowParameterDef {
    type: "string" | "number" | "boolean";
    required?: boolean;
}

export function generateSandboxDeclarations(
    parameters: Record<string, FlowParameterDef>,
): string {
    const paramEntries = Object.entries(parameters);
    let paramsInterface: string;
    if (paramEntries.length === 0) {
        paramsInterface =
            "interface FlowParams {\n    [key: string]: unknown;\n}";
    } else {
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
        paramsInterface = `interface FlowParams {\n${fields}\n}`;
    }
    return `${getSandboxDts()}\n${paramsInterface}\n`;
}

export function generateGenericSandboxDeclarations(): string {
    return `${getSandboxDts()}\ninterface FlowParams {\n    [key: string]: unknown;\n}\n`;
}
