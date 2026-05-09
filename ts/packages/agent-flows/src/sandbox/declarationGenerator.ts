// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import { FlowParameterDefinition } from "../types.js";

export interface SandboxDeclarationConfig {
    candidatePaths: string[];
    sandboxName: string;
}

function generateFlowParamsInterface(
    parameters: Record<string, FlowParameterDefinition>,
): string {
    const paramEntries = Object.entries(parameters);
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

const GENERIC_FLOW_PARAMS =
    "interface FlowParams {\n    [key: string]: unknown;\n}";

export function createSandboxDeclarationGenerator(
    config: SandboxDeclarationConfig,
): {
    generate(parameters?: Record<string, FlowParameterDefinition>): string;
    generateGeneric(): string;
} {
    let cachedSandboxDts: string | undefined;

    function getSandboxDts(): string {
        if (!cachedSandboxDts) {
            const dtsPath = config.candidatePaths.find((p) => fs.existsSync(p));
            if (!dtsPath) {
                throw new Error(
                    `${config.sandboxName} not found in any candidate path`,
                );
            }
            cachedSandboxDts = fs.readFileSync(dtsPath, "utf8");
        }
        return cachedSandboxDts;
    }

    return {
        generate(parameters?: Record<string, FlowParameterDefinition>): string {
            const paramsInterface = parameters
                ? generateFlowParamsInterface(parameters)
                : GENERIC_FLOW_PARAMS;
            return `${getSandboxDts()}\n${paramsInterface}\n`;
        },
        generateGeneric(): string {
            return `${getSandboxDts()}\n${GENERIC_FLOW_PARAMS}\n`;
        },
    };
}
