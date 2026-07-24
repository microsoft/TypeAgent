// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createSandboxDeclarationGenerator,
    type FlowParameterDefinition,
} from "@typeagent/agent-flows";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const exploreFlowParameters: Record<string, FlowParameterDefinition> = {
    query: { type: "string", required: true },
    maxResults: { type: "number", required: true },
};

const generator = createSandboxDeclarationGenerator({
    candidatePaths: [
        fileURLToPath(new URL("./repositorySandbox.d.ts", import.meta.url)),
    ],
    sandboxName: "TypeAgent repository Code Mode declarations",
});

const lspDeclarations = readFileSync(
    new URL("./repositoryLspSandbox.d.ts", import.meta.url),
    "utf8",
);

export function generateSandboxDeclarations(
    parameters: Record<string, FlowParameterDefinition> = exploreFlowParameters,
    enableLsp = false,
    requireLocations = false,
): string {
    const generated = generator.generate(parameters);
    const declarations = requireLocations
        ? generated.replace(
              "    locations?: ExploreLocation[];",
              "    locations: ExploreLocation[];",
          )
        : generated;
    if (requireLocations && declarations === generated) {
        throw new Error(
            "Repository sandbox is missing the optional locations declaration",
        );
    }
    return enableLsp ? `${declarations}\n${lspDeclarations}\n` : declarations;
}
