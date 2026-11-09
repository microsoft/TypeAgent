// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpTransportConfig } from "./mcpConnection.js";
import type { McpCredentialStore } from "./mcpCredentialStore.js";
import { requireCredential } from "./mcpCredentialStore.js";

import type {
    EnvValue,
    NormalizedMcpServerConfig,
} from "@typeagent/package-installation/mcp-types";
export type * from "@typeagent/package-installation/mcp-types";

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
