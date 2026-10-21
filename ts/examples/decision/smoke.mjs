// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDecisionModel, stopCopilotClient } from "@typeagent/aiclient";
import { loadRuntimeConfigSync } from "@typeagent/config";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function smoke(config) {
    const lanes = [
        { provider: "copilot" },
        { provider: "azure", region: "eastus" },
        { provider: "azure", region: "swedencentral" },
    ];
    const results = [];
    for (const lane of lanes) {
        const started = performance.now();
        let effective = config;
        if (lane.region) {
            const key = config.decision?.azure?.deploymentKey ?? "decision_1";
            const deployment = config.azureOpenAI.deployments.get(key);
            const endpoints = deployment?.endpoints.filter(
                (endpoint) => endpoint.region === lane.region,
            );
            if (!endpoints?.length) {
                results.push({
                    ...lane,
                    success: false,
                    outcome: "unavailable",
                });
                continue;
            }
            const deployments = new Map(config.azureOpenAI.deployments);
            deployments.set(key, { ...deployment, endpoints });
            effective = {
                ...config,
                azureOpenAI: { ...config.azureOpenAI, deployments },
            };
        }
        const created = createDecisionModel({
            config: effective,
            provider: lane.provider,
        });
        if (!created.success) {
            results.push({
                ...lane,
                success: false,
                outcome: created.code,
            });
            continue;
        }
        const result = await created.data.decide(
            {
                state: "The only visible swatch is red.",
                questions: {
                    present: {
                        type: "noul",
                        instructions: "Is exactly one red swatch described?",
                    },
                    color: {
                        type: "choice",
                        instructions: "What color is the described swatch?",
                        criteria: {
                            red: "Red",
                            blue: "Blue",
                            none: "No swatch",
                        },
                    },
                    clarity: {
                        type: "score",
                        instructions: "How explicit is the color description?",
                        criteria: ["Unspecified", "Explicitly named"],
                    },
                },
            },
            { timeoutMs: 60_000 },
        );
        const color = result.success ? result.data.answers.color : undefined;
        results.push({
            ...lane,
            success:
                result.success &&
                color?.type === "choice" &&
                color.choice === "red",
            outcome: result.success ? "validated" : result.code,
            requestedModel: created.data.model,
            reportedModel: result.success
                ? result.data.reportedModel
                : undefined,
            questionCount: 3,
            durationMs: Math.round(performance.now() - started),
        });
    }
    return results;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    if (!process.argv.includes("--live")) {
        throw new Error(
            "Native smoke requires explicit --live; no credentials are acquired.",
        );
    }
    try {
        const { config } = loadRuntimeConfigSync({
            workspaceRoot: fileURLToPath(new URL("../../", import.meta.url)),
            populateProcessEnv: false,
        });
        const results = await smoke(config);
        process.stdout.write(
            `${JSON.stringify({ lanes: results }, null, 2)}\n`,
        );
        if (results.some((result) => !result.success)) process.exitCode = 1;
    } finally {
        await stopCopilotClient();
    }
}
