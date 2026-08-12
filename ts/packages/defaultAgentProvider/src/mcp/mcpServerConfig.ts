// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpTransportConfig } from "./mcpConnection.js";

// A reference to a secret value resolved at launch time from a credential
// store, never the plaintext secret itself. Persisted configs store the
// reference so `.mcp.json`/instance config files never contain live secrets.
//
// - `env`  : resolve from the process/instance environment variable `name`.
// - `input`: resolve from a named input the user is prompted for (e.g. a
//            VS Code `${input:api-key}` placeholder), keyed by `name`.
export type CredentialRef = {
    kind: "env" | "input";
    name: string;
};

// A single environment variable value: either a literal string or a reference
// to a credential resolved at launch. Keeping these distinct lets the importer
// preserve `${input:...}` / `${env:...}` placeholders as references instead of
// baking a (possibly empty) literal into the persisted config.
export type EnvValue = string | CredentialRef;

// How much the user has authorized a server to run. New servers start
// `untrusted` and must be explicitly promoted before first launch (Phase 5
// enforces this; the field is persisted here so that gate has state to read).
export type TrustLevel = "untrusted" | "trusted";

// Where a server config came from / how widely it applies. `user` = the
// per-instance user config; `workspace` = imported from a repo-local file
// (`.mcp.json`, `.vscode/mcp.json`, etc.); `shipped` = seeded with the app.
export type ConfigScope = "user" | "workspace" | "shipped";

// Launch a local server process over stdio. `command` is a generic executable
// (not restricted to `.js`/`.py`); `args`, `env`, and `cwd` are passed through
// to the child process. Secret env values are stored as credential references.
export type StdioTransport = {
    kind: "stdio";
    command: string;
    args?: string[];
    env?: Record<string, EnvValue>;
    cwd?: string;
};

// Connect to a remote server over Streamable HTTP. `headers` may carry
// credential references (e.g. an Authorization bearer resolved at launch).
export type HttpTransport = {
    kind: "http";
    url: string;
    headers?: Record<string, EnvValue>;
    timeoutMs?: number;
};

export type TransportConfig = StdioTransport | HttpTransport;

// The normalized, persistable description of one MCP server. This is the single
// internal shape every source (shipped config, imported file, registry install)
// is mapped onto, so downstream code never has to branch on where a server came
// from. Secrets live as references in `env`/`headers`, never as values.
export type NormalizedMcpServerConfig = {
    // Stable identifier within its source (e.g. the key in a `mcpServers`
    // object). Combined with the owning source id to form the catalog identity.
    name: string;
    description?: string;
    emojiChar?: string;
    transport: TransportConfig;
    // When set, only these tool names are exposed; others are hidden. Absent =
    // expose all tools the server advertises.
    enabledTools?: string[];
    trust?: TrustLevel;
    scope?: ConfigScope;
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
    if (value.kind === "env") {
        return sourceEnv[value.name];
    }
    return inputs?.[value.name];
}

function resolveEnvRecord(
    env: Record<string, EnvValue> | undefined,
    inputs?: Record<string, string>,
    sourceEnv?: Record<string, string | undefined>,
): Record<string, string> | undefined {
    if (env === undefined) {
        return undefined;
    }
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        const v = resolveEnvValue(value, inputs, sourceEnv);
        if (v !== undefined) {
            resolved[key] = v;
        }
    }
    return resolved;
}

// Lower a normalized config to the connection-layer transport config, resolving
// any credential references in `env`. HTTP header resolution is not yet plumbed
// through the connection layer, so `headers` are carried on the normalized
// config but not applied here; only `url` is forwarded for now.
export function toTransportConfig(
    config: NormalizedMcpServerConfig,
    inputs?: Record<string, string>,
    sourceEnv?: Record<string, string | undefined>,
): McpTransportConfig {
    const transport = config.transport;
    if (transport.kind === "http") {
        return { kind: "http", url: transport.url };
    }
    const env = resolveEnvRecord(transport.env, inputs, sourceEnv);
    const result: McpTransportConfig = {
        kind: "stdio",
        command: transport.command,
        args: transport.args ?? [],
    };
    if (env !== undefined) {
        result.env = env;
    }
    if (transport.cwd !== undefined) {
        result.cwd = transport.cwd;
    }
    return result;
}
