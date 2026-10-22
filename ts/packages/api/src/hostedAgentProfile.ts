// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppAgentProvider } from "agent-dispatcher";
import { getBundledAppAgentProvider } from "default-agent-provider";
import type { Config } from "@typeagent/config";
import { HOSTED_API_PROFILE } from "./containerBootstrap.js";

export type ApiAgentProfile = "default" | "hosted";

export const HOSTED_API_AGENT_CONFIG = "hosted";
/**
 * Independent security policy ratchet for the hosted API surface. The bundled
 * config must match this list exactly; editing config.hosted.json alone cannot
 * enable another agent.
 */
export const HOSTED_API_AGENT_SECURITY_ALLOWLIST = [
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

export function validateHostedApiAgentSecurityPolicy(
    actualNames: readonly string[],
): void {
    const actual = [...actualNames].sort();
    const expected = [...HOSTED_API_AGENT_SECURITY_ALLOWLIST].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
            `Hosted API agent security policy mismatch: expected ${expected.join(", ")}, got ${actual.join(", ")}.`,
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
    validateHostedApiAgentSecurityPolicy(actualNames);

    for (const provider of providers) {
        for (const agentName of provider.getAppAgentNames()) {
            await provider.getAppAgentManifest(agentName);
        }
    }
    return providers;
}
