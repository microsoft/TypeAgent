// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppAgentProvider } from "agent-dispatcher";
import { getBundledAppAgentProvider } from "default-agent-provider";
import type { Config } from "@typeagent/config";
import { HOSTED_API_PROFILE } from "./containerBootstrap.js";

export type ApiAgentProfile = "default" | "hosted";

export const HOSTED_API_AGENT_CONFIG = "hosted";
export const HOSTED_API_AGENT_NAMES = [
    "chat",
    "greeting",
    "list",
    "settings",
    "timer",
] as const;

export function resolveApiAgentProfile(
    env: NodeJS.ProcessEnv,
): ApiAgentProfile {
    return env.TYPEAGENT_API_BOOTSTRAP?.trim() === HOSTED_API_PROFILE
        ? "hosted"
        : "default";
}

export function validateHostedApiAgentCapabilities(config: Config): void {
    const deployment = config.azureOpenAI.deployments.get("gpt_6_luna");
    if (
        config.modelProvider !== "azure" ||
        config.azureOpenAI.defaultAuth.kind !== "identity" ||
        deployment === undefined ||
        deployment.endpoints.length === 0 ||
        deployment.endpoints.some(
            (endpoint) => endpoint.auth.kind !== "identity",
        )
    ) {
        throw new Error(
            "Hosted API agents require an identity-authenticated gpt_6_luna deployment.",
        );
    }
}

export async function loadHostedApiAgentProviders(): Promise<
    AppAgentProvider[]
> {
    const providers = [getBundledAppAgentProvider(HOSTED_API_AGENT_CONFIG)];
    const actualNames = providers
        .flatMap((provider) => provider.getAppAgentNames())
        .sort();
    const expectedNames = [...HOSTED_API_AGENT_NAMES].sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
        throw new Error(
            `Hosted API agent profile mismatch: expected ${expectedNames.join(", ")}, got ${actualNames.join(", ")}.`,
        );
    }

    for (const provider of providers) {
        for (const agentName of provider.getAppAgentNames()) {
            await provider.getAppAgentManifest(agentName);
        }
    }
    return providers;
}
