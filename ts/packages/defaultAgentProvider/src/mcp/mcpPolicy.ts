// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { NormalizedMcpServerConfig } from "./mcpServerConfig.js";

export interface McpPolicy {
    allowedTransports?: readonly ("stdio" | "http")[];
    allowedCommands?: readonly string[];
    allowedRuntimeHints?: readonly string[];
    allowedHttpDomains?: readonly string[];
    allowedNpmPackages?: readonly string[];
    allowedNpmRegistries?: readonly string[];
    allowPublicNpmRegistry?: boolean;
}

export const defaultMcpPolicy: McpPolicy = {
    allowedTransports: ["stdio", "http"],
    allowedRuntimeHints: ["node", "npx"],
    allowPublicNpmRegistry: false,
};

function matches(value: string, patterns: readonly string[] | undefined) {
    return (
        patterns === undefined ||
        patterns.some(
            (pattern) =>
                pattern === value ||
                (pattern.startsWith("*.") && value.endsWith(pattern.slice(1))),
        )
    );
}

export function enforceMcpPolicy(
    policy: McpPolicy,
    operation: string,
    config: NormalizedMcpServerConfig,
): void {
    if (!policy.allowedTransports?.includes(config.transport.kind)) {
        throw new Error(
            `MCP policy denied ${operation} for '${config.name}': transport '${config.transport.kind}' is not allowed.`,
        );
    }
    if (config.transport.kind === "http") {
        const host = new URL(config.transport.url).hostname;
        if (!matches(host, policy.allowedHttpDomains)) {
            throw new Error(
                `MCP policy denied ${operation} for '${config.name}': HTTP domain '${host}' is not allowed.`,
            );
        }
    } else if (
        policy.allowedCommands !== undefined &&
        !policy.allowedCommands.includes(config.transport.command)
    ) {
        throw new Error(
            `MCP policy denied ${operation} for '${config.name}': command '${config.transport.command}' is not allowed.`,
        );
    }
    const packageName = config.provenance.packageIdentifier;
    if (
        packageName !== undefined &&
        !matches(packageName, policy.allowedNpmPackages)
    ) {
        throw new Error(
            `MCP policy denied ${operation} for '${config.name}': npm package '${packageName}' is not allowed.`,
        );
    }
    const registry = config.provenance.npmRegistryUrl;
    if (registry !== undefined) {
        const normalized = new URL(registry).origin;
        if (
            normalized === "https://registry.npmjs.org" &&
            policy.allowPublicNpmRegistry !== true
        ) {
            throw new Error(
                `MCP policy denied ${operation} for '${config.name}': public npm registry materialization is disabled.`,
            );
        }
        if (
            policy.allowedNpmRegistries !== undefined &&
            !policy.allowedNpmRegistries.includes(normalized)
        ) {
            throw new Error(
                `MCP policy denied ${operation} for '${config.name}': npm registry '${normalized}' is not allowed.`,
            );
        }
    }
}
