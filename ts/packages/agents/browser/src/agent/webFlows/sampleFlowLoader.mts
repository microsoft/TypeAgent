// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebFlowDefinition } from "./types.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The samples directory lives in the source tree. From the compiled output
// (dist/agent/webFlows/), we go up to the package root then into src/.
// Also try the source-relative path for dev scenarios.
const CANDIDATE_DIRS = [
    path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "src",
        "agent",
        "webFlows",
        "samples",
    ),
    path.resolve(__dirname, "samples"),
];

let cachedSamples: WebFlowDefinition[] | undefined;

export function loadSampleFlows(): WebFlowDefinition[] {
    if (cachedSamples) return cachedSamples;

    const samples: WebFlowDefinition[] = [];

    const samplesDir = CANDIDATE_DIRS.find((d) => fs.existsSync(d));
    if (!samplesDir) {
        cachedSamples = samples;
        return samples;
    }

    const files = fs.readdirSync(samplesDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
        try {
            const content = fs.readFileSync(
                path.join(samplesDir, file),
                "utf8",
            );
            const flow = JSON.parse(content) as WebFlowDefinition;
            if (flow.name && flow.script) {
                samples.push(flow);
            }
        } catch {
            // Skip invalid sample files
        }
    }

    cachedSamples = samples;
    return samples;
}
