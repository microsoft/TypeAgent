// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpTransportConfig } from "./mcpConnection.js";
import type { McpCredentialStore } from "./mcpCredentialStore.js";
import { requireCredential } from "./mcpCredentialStore.js";

// A reference to a secret value resolved at launch time from a credential
// store, never the plaintext secret itself. Persisted configs store the
// reference so `.mcp.json`/instance config files never contain live secrets.
//
// - `env`  : resolve from the process/instance environment variable `name`.
// - `input`: resolve from a named input the user is prompted for (e.g. a
//            VS Code `${input:api-key}` placeholder), keyed by `name`.
export type CredentialRef = {
    kind: "env" | "input" | "secure";
    name: string;
};

// A single environment variable value: either a literal string or a reference
// to a credential resolved at launch. Keeping these distinct lets the importer
// preserve `${input:...}` / `${env:...}` placeholders as references instead of
// baking a (possibly empty) literal into the persisted config.
export type ValueTemplate = {
    value: string;
    variables: Record<string, string | CredentialRef>;
};

export type EnvValue = string | CredentialRef | ValueTemplate;

// How much the user has authorized a server to run. New servers start
// `untrusted` and must be explicitly promoted before first launch (Phase 5
// enforces this; the field is persisted here so that gate has state to read).
export type TrustLevel = "untrusted" | "trusted";

// Where a server config came from / how widely it applies. `user` = the
// per-instance user config; `workspace` = imported from a repo-local file
// (`.mcp.json`, `.vscode/mcp.json`, etc.); `shipped` = seeded with the app.
export type ConfigScope = "user" | "workspace" | "shipped";

export type McpInstallProvenance = {
    source: string;
    sourceKind?: string;
    ref?: string;
    version?: string;
    digest?: string;
    ownedPaths?: string[];
    registryBaseUrl?: string;
    npmRegistryUrl?: string;
    canonicalServerName?: string;
    serverVersion?: string;
    publisher?: Record<string, unknown>;
    repository?: Record<string, unknown>;
    packageIdentifier?: string;
    packageVersion?: string;
    packageHash?: string;
    transportType?: string;
};

// Launch a local server process over stdio. `command` is a generic executable
// (not restricted to `.js`/`.py`); `args`, `env`, and `cwd` are passed through
// to the child process. Secret env values are stored as credential references.
export type StdioTransport = {
    kind: "stdio";
    command: string;
    args?: EnvValue[];
    env?: Record<string, EnvValue>;
    cwd?: string;
};

// Connect to a remote server over Streamable HTTP. `headers` may carry
// credential references (e.g. an Authorization bearer resolved at launch).
export type HttpTransport = {
    kind: "http";
    url: string;
    urlVariables?: Record<string, string | CredentialRef>;
    headers?: Record<string, EnvValue>;
    timeoutMs?: number;
};

export type TransportConfig = StdioTransport | HttpTransport;

// The normalized, persistable description of one MCP server. This is the single
// internal shape every source (shipped config, imported file, registry install)
// is mapped onto, so downstream code never has to branch on where a server came
// from. Secrets live as references in `env`/`headers`, never as values.
export type NormalizedMcpServerConfig = {
    // Stable persisted identity. Unlike `name`, this does not change when the
    // dispatcher-facing display/agent name is updated.
    id: string;
    name: string;
    description?: string;
    emojiChar?: string;
    transport: TransportConfig;
    // When set, only these tool names are exposed; others are hidden. Absent =
    // expose all tools the server advertises.
    enabledTools?: string[];
    deniedTools?: string[];
    toolApproval?: {
        prompt?: string[];
        allow?: string[];
        deny?: string[];
        persisted?: Record<string, "allow" | "deny">;
    };
    oauth?: {
        enabled: boolean;
        clientId?: string;
        scopes?: string[];
        redirectUrl?: string;
        tokensRef?: CredentialRef;
        clientInformationRef?: CredentialRef;
        verifierRef?: CredentialRef;
    };
    enabled: boolean;
    trust: TrustLevel;
    scope: ConfigScope;
    provenance: McpInstallProvenance;
};

// Resolve a credential reference / env value to a concrete environment string.
// `inputs` supplies values for `input`-kind references (prompted secrets);
// `env`-kind references read from `sourceEnv` (defaults to process.env).
// Returns undefined when a reference cannot be resolved, so callers can decide
// whether a missing secret is fatal.
export function resolveEnvValue(
    value: EnvValue,
    inputs?: Record<string, string>,
    sourceEnv: Record<string, string | undefined> = process.env,
): string | undefined {
    if (typeof value === "string") {
        return value;
    }
    if ("value" in value) {
        return value.value.replace(/\{([^{}]+)\}/g, (_match, name: string) => {
            const variable = value.variables[name];
            const resolved =
                variable === undefined
                    ? undefined
                    : resolveEnvValue(variable, inputs, sourceEnv);
            if (resolved === undefined) {
                throw new Error(
                    `could not resolve template variable '${name}'`,
                );
            }
            return resolved;
        });
    }
    if (value.kind === "env") {
        return sourceEnv[value.name];
    }
    return inputs?.[value.name];
}

async function resolveStoredValue(
    value: EnvValue,
    store: McpCredentialStore,
    configName: string,
): Promise<string> {
    if (typeof value === "string") {
        return value;
    }
    if ("value" in value) {
        let result = value.value;
        for (const [name, variable] of Object.entries(value.variables)) {
            const resolved =
                typeof variable === "string"
                    ? variable
                    : await requireCredential(store, variable, configName);
            result = result.replaceAll(`{${name}}`, resolved);
        }
        return result;
    }
    return requireCredential(store, value, configName);
}

export async function resolveTransportConfig(
    config: NormalizedMcpServerConfig,
    store: McpCredentialStore,
): Promise<McpTransportConfig> {
    if (config.transport.kind === "http") {
        const headers =
            config.transport.headers === undefined
                ? undefined
                : Object.fromEntries(
                      await Promise.all(
                          Object.entries(config.transport.headers).map(
                              async ([name, value]) => [
                                  name,
                                  await resolveStoredValue(
                                      value,
                                      store,
                                      config.name,
                                  ),
                              ],
                          ),
                      ),
                  );
        const url =
            config.transport.urlVariables === undefined
                ? config.transport.url
                : await resolveStoredValue(
                      {
                          value: config.transport.url,
                          variables: config.transport.urlVariables,
                      },
                      store,
                      config.name,
                  );
        return {
            kind: "http",
            url,
            ...(headers === undefined ? {} : { headers }),
            ...(config.transport.timeoutMs === undefined
                ? {}
                : { timeoutMs: config.transport.timeoutMs }),
        };
    }
    return {
        kind: "stdio",
        command: config.transport.command,
        args: await Promise.all(
            (config.transport.args ?? []).map((value) =>
                resolveStoredValue(value, store, config.name),
            ),
        ),
        ...(config.transport.env === undefined
            ? {}
            : {
                  env: Object.fromEntries(
                      await Promise.all(
                          Object.entries(config.transport.env).map(
                              async ([name, value]) => [
                                  name,
                                  await resolveStoredValue(
                                      value,
                                      store,
                                      config.name,
                                  ),
                              ],
                          ),
                      ),
                  ),
              }),
        ...(config.transport.cwd === undefined
            ? {}
            : { cwd: config.transport.cwd }),
    };
}

function resolveEnvRecord(
    env: Record<string, EnvValue> | undefined,
    configName: string,
    valueKind: "environment variable" | "HTTP header",
    inputs?: Record<string, string>,
    sourceEnv?: Record<string, string | undefined>,
): Record<string, string> | undefined {
    if (env === undefined) {
        return undefined;
    }
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        const v = resolveEnvValue(value, inputs, sourceEnv);
        if (v === undefined) {
            const reference =
                typeof value === "string"
                    ? key
                    : "kind" in value
                      ? `${value.kind}:${value.name}`
                      : "template";
            throw new Error(
                `MCP server '${configName}' could not resolve required ${valueKind} '${key}' (${reference})`,
            );
        }
        resolved[key] = v;
    }
    return resolved;
}

// Lower a normalized config to the connection-layer transport config, resolving
// any credential references in `env` or `headers`. References are required:
// launching with a silently omitted secret would produce a misleading remote
// authentication or child-process failure.
export function toTransportConfig(
    config: NormalizedMcpServerConfig,
    inputs?: Record<string, string>,
    sourceEnv?: Record<string, string | undefined>,
): McpTransportConfig {
    const transport = config.transport;
    if (transport.kind === "http") {
        const headers = resolveEnvRecord(
            transport.headers,
            config.name,
            "HTTP header",
            inputs,
            sourceEnv,
        );
        const resolvedUrl =
            transport.urlVariables === undefined
                ? transport.url
                : resolveEnvValue(
                      {
                          value: transport.url,
                          variables: transport.urlVariables,
                      },
                      inputs,
                      sourceEnv,
                  );
        if (resolvedUrl === undefined) {
            throw new Error(
                `MCP server '${config.name}' could not resolve its URL`,
            );
        }
        return {
            kind: "http",
            url: resolvedUrl,
            ...(headers === undefined ? {} : { headers }),
            ...(transport.timeoutMs === undefined
                ? {}
                : { timeoutMs: transport.timeoutMs }),
        };
    }
    const env = resolveEnvRecord(
        transport.env,
        config.name,
        "environment variable",
        inputs,
        sourceEnv,
    );
    const result: McpTransportConfig = {
        kind: "stdio",
        command: transport.command,
        args: (transport.args ?? []).map((arg) => {
            const value = resolveEnvValue(arg, inputs, sourceEnv);
            if (value === undefined) {
                throw new Error(
                    `MCP server '${config.name}' could not resolve a required command argument`,
                );
            }
            return value;
        }),
    };
    if (env !== undefined) {
        result.env = env;
    }
    if (transport.cwd !== undefined) {
        result.cwd = transport.cwd;
    }
    return result;
}
