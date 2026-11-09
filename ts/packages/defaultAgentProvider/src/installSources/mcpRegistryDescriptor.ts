// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import crypto from "node:crypto";
import type {
    CredentialRef,
    EnvValue,
    NormalizedMcpServerConfig,
} from "../mcp/mcpServerConfig.js";
import type { McpInstallCandidate } from "./config.js";
import type {
    RegistryInput,
    RegistryKeyValue,
    RegistryServerEntry,
    RegistryTransport,
} from "./mcpRegistryClient.js";
import {
    materializeRegistryNpmPackage,
    type RegistryMaterializerDeps,
} from "./mcpRegistryMaterializer.js";

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (typeof value === "object" && value !== null) {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(
                ([key, child]) =>
                    `${JSON.stringify(key)}:${canonicalJson(child)}`,
            )
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

export function registryDescriptorDigest(entry: RegistryServerEntry): string {
    return crypto
        .createHash("sha256")
        .update(canonicalJson(entry))
        .digest("hex");
}

function inputRef(input: RegistryInput, name: string): string | CredentialRef {
    const value = input.value ?? input.default;
    return value ?? { kind: "input", name };
}

function valueFromKeyValue(entry: RegistryKeyValue): EnvValue {
    const value = inputRef(entry, entry.name);
    if (typeof value !== "string" || entry.variables === undefined) {
        return value;
    }
    return {
        value,
        variables: Object.fromEntries(
            Object.entries(entry.variables).map(([name, input]) => [
                name,
                inputRef(input, name),
            ]),
        ),
    };
}

function httpTransport(transport: RegistryTransport) {
    if (transport.type !== "streamable-http" && transport.type !== "sse") {
        throw new Error(
            `Unsupported registry remote transport '${transport.type}'`,
        );
    }
    if (transport.url === undefined) {
        throw new Error(
            `Registry ${transport.type} transport is missing its URL`,
        );
    }
    return {
        kind: "http" as const,
        url: transport.url,
        ...(transport.variables === undefined
            ? {}
            : {
                  urlVariables: Object.fromEntries(
                      Object.entries(transport.variables).map(
                          ([name, input]) => [name, inputRef(input, name)],
                      ),
                  ),
              }),
        ...(transport.headers === undefined
            ? {}
            : {
                  headers: Object.fromEntries(
                      transport.headers.map((entry) => [
                          entry.name,
                          valueFromKeyValue(entry),
                      ]),
                  ),
              }),
        timeoutMs: 30_000,
    };
}

export function registryEntryToCandidate(
    entry: RegistryServerEntry,
    sourceName: string,
    baseUrl: string,
    materializerDeps: RegistryMaterializerDeps,
): McpInstallCandidate {
    if (entry.meta.status === "deleted") {
        throw new Error(
            `Registry server '${entry.server.name}@${entry.server.version}' is deleted`,
        );
    }
    const digest = registryDescriptorDigest(entry);
    const ref = `${entry.server.name}@${entry.server.version}`;
    const description =
        entry.meta.status === "deprecated"
            ? `[DEPRECATED${entry.meta.statusMessage ? `: ${entry.meta.statusMessage}` : ""}] ${entry.server.description}`
            : entry.server.description;
    const commonProvenance = {
        source: sourceName,
        sourceKind: "registry",
        ref,
        version: entry.server.version,
        digest,
        registryBaseUrl: baseUrl,
        canonicalServerName: entry.server.name,
        serverVersion: entry.server.version,
        ...(entry.server.publisher === undefined
            ? {}
            : { publisher: entry.server.publisher }),
        ...(entry.server.repository === undefined
            ? {}
            : { repository: entry.server.repository }),
    };
    const id = `mcp:${encodeURIComponent(sourceName)}:${encodeURIComponent(entry.server.name)}`;
    const remote = entry.server.remotes?.find(
        (candidate) =>
            candidate.type === "streamable-http" || candidate.type === "sse",
    );
    if (remote !== undefined) {
        return {
            extensionKind: "mcp",
            source: sourceName,
            sourceKind: "registry",
            ref,
            config: {
                id,
                name: entry.server.title ?? entry.server.name,
                description,
                transport: httpTransport(remote),
                enabled: false,
                trust: "untrusted",
                scope: "user",
                provenance: {
                    ...commonProvenance,
                    transportType: remote.type,
                },
            },
        };
    }
    const pkg = entry.server.packages?.find(
        (candidate) =>
            candidate.registryType === "npm" &&
            candidate.transport.type === "stdio",
    );
    if (pkg === undefined) {
        const advertised = [
            ...(entry.server.remotes ?? []).map(
                (candidate) => `remote:${candidate.type}`,
            ),
            ...(entry.server.packages ?? []).map(
                (candidate) =>
                    `package:${candidate.registryType}/${candidate.transport.type}`,
            ),
        ];
        throw new Error(
            `Registry server '${entry.server.name}@${entry.server.version}' has no supported remote or package definition${advertised.length === 0 ? "" : ` (${advertised.join(", ")})`}`,
        );
    }
    if (pkg.version === undefined) {
        throw new Error(
            `Registry npm package '${pkg.identifier}' does not specify an exact version`,
        );
    }
    const config: NormalizedMcpServerConfig = {
        id,
        name: entry.server.title ?? entry.server.name,
        description,
        transport: {
            kind: "stdio",
            command: process.execPath,
            args: [],
        },
        enabled: false,
        trust: "untrusted",
        scope: "user",
        provenance: {
            ...commonProvenance,
            packageIdentifier: pkg.identifier,
            packageVersion: pkg.version,
            npmRegistryUrl:
                pkg.registryBaseUrl ?? "https://registry.npmjs.org/",
            ...(pkg.fileSha256 === undefined
                ? {}
                : { packageHash: pkg.fileSha256 }),
            transportType: pkg.transport.type,
        },
    };
    return {
        extensionKind: "mcp",
        source: sourceName,
        sourceKind: "registry",
        ref,
        config,
        materialize: (signal) =>
            materializeRegistryNpmPackage(
                config,
                pkg,
                digest,
                materializerDeps,
                signal,
            ),
    };
}
