// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    EnvValue,
    NormalizedMcpServerConfig,
    TransportConfig,
} from "./mcpServerConfig.js";

// The shape of the three supported on-disk config files. Only the fields the
// importer reads are modeled; everything else is ignored so unknown keys never
// break the import.
//
// - `mcpServers`: the Claude / `.mcp.json` / `.github/mcp.json` convention.
// - `vscode`    : the `.vscode/mcp.json` convention, which uses `servers` plus a
//                 top-level `inputs` array declaring prompted values.
export type McpConfigFormat = "mcpServers" | "vscode";

// One imported server plus its source key, or a per-entry error. Importing is
// resilient: a malformed entry is reported without aborting the whole file, so
// one bad server never hides the good ones.
export type ImportedServer = {
    name: string;
    config: NormalizedMcpServerConfig;
};
export type ImportError = { name: string; reason: string };
export type ImportResult = {
    servers: ImportedServer[];
    errors: ImportError[];
};

// Match a value that is EXACTLY one placeholder, e.g. "${input:api-key}" or
// "${env:TOKEN}". Partial interpolations ("Bearer ${input:token}") are left as
// literal strings — turning those into a bare credential reference would lose
// the surrounding text, so we only lift a whole-value placeholder.
const PLACEHOLDER = /^\$\{(input|env):([^}]+)\}$/;

// Convert a raw env/header string into an EnvValue, lifting a whole-value
// `${input:...}` / `${env:...}` placeholder into a credential reference and
// leaving everything else as a literal.
function toEnvValue(raw: string): EnvValue {
    const m = PLACEHOLDER.exec(raw);
    if (m === null) {
        return raw;
    }
    const kind = m[1] === "input" ? "input" : "env";
    return { kind, name: m[2] };
}

function toEnvRecord(raw: unknown): Record<string, EnvValue> | undefined {
    if (raw === null || typeof raw !== "object") {
        return undefined;
    }
    const result: Record<string, EnvValue> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string") {
            result[key] = toEnvValue(value);
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function toStringArray(raw: unknown): string[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }
    const strings = raw.filter((v): v is string => typeof v === "string");
    return strings.length > 0 ? strings : undefined;
}

// Build the transport for one raw server entry. Handles both the explicit
// `type: "stdio" | "http" | "sse"` form (VS Code) and the implicit form where
// presence of `command` means stdio and presence of `url` means http (Claude /
// `.mcp.json`). Throws with a human-readable reason when neither is derivable.
function toTransport(entry: Record<string, unknown>): TransportConfig {
    const type = typeof entry.type === "string" ? entry.type : undefined;
    const hasUrl = typeof entry.url === "string";
    const hasCommand = typeof entry.command === "string";

    const isHttp =
        type === "http" || type === "sse" || (type === undefined && hasUrl);
    if (isHttp) {
        if (!hasUrl) {
            throw new Error("remote server entry is missing a 'url'");
        }
        const headers = toEnvRecord(entry.headers);
        const transport: TransportConfig = {
            kind: "http",
            url: entry.url as string,
        };
        if (headers !== undefined) {
            transport.headers = headers;
        }
        if (
            typeof entry.timeoutMs === "number" &&
            Number.isFinite(entry.timeoutMs) &&
            entry.timeoutMs > 0
        ) {
            transport.timeoutMs = entry.timeoutMs;
        }
        return transport;
    }

    if (!hasCommand) {
        throw new Error("stdio server entry is missing a 'command'");
    }
    const transport: TransportConfig = {
        kind: "stdio",
        command: entry.command as string,
    };
    const args = toStringArray(entry.args);
    if (args !== undefined) {
        transport.args = args;
    }
    const env = toEnvRecord(entry.env);
    if (env !== undefined) {
        transport.env = env;
    }
    if (typeof entry.cwd === "string") {
        transport.cwd = entry.cwd;
    }
    return transport;
}

function toNormalized(
    name: string,
    entry: Record<string, unknown>,
): NormalizedMcpServerConfig {
    const config: NormalizedMcpServerConfig = {
        id: name,
        name,
        transport: toTransport(entry),
        scope: "workspace",
        trust: "untrusted",
        enabled: true,
        provenance: {
            source: "imported-config",
            sourceKind: "mcp-config",
            ref: name,
        },
    };
    if (typeof entry.description === "string") {
        config.description = entry.description;
    }
    const enabledTools = toStringArray(entry.tools ?? entry.enabledTools);
    if (enabledTools !== undefined) {
        config.enabledTools = enabledTools;
    }
    return config;
}

// Pick the server map out of a parsed config object based on the format. VS
// Code nests servers under `servers`; the other conventions use `mcpServers`.
function getServerMap(
    parsed: Record<string, unknown>,
    format: McpConfigFormat,
): Record<string, unknown> | undefined {
    const key = format === "vscode" ? "servers" : "mcpServers";
    const map = parsed[key];
    if (map === null || typeof map !== "object" || Array.isArray(map)) {
        return undefined;
    }
    return map as Record<string, unknown>;
}

// Auto-detect the file convention from its top-level keys. Prefers `servers`
// (VS Code) when both are present, since a file that declares `inputs` +
// `servers` is unambiguously the VS Code form.
export function detectMcpConfigFormat(
    parsed: Record<string, unknown>,
): McpConfigFormat | undefined {
    if (
        parsed.servers !== undefined &&
        typeof parsed.servers === "object" &&
        parsed.servers !== null
    ) {
        return "vscode";
    }
    if (
        parsed.mcpServers !== undefined &&
        typeof parsed.mcpServers === "object" &&
        parsed.mcpServers !== null
    ) {
        return "mcpServers";
    }
    return undefined;
}

// Import a parsed MCP config object into normalized server configs. `format`
// may be omitted to auto-detect. Each server entry is converted independently;
// entries that fail conversion are collected in `errors` rather than aborting
// the whole import, so one malformed server never hides the rest.
export function importMcpConfig(
    parsed: unknown,
    format?: McpConfigFormat,
): ImportResult {
    if (parsed === null || typeof parsed !== "object") {
        return {
            servers: [],
            errors: [{ name: "(root)", reason: "config is not an object" }],
        };
    }
    const root = parsed as Record<string, unknown>;
    const resolvedFormat = format ?? detectMcpConfigFormat(root);
    if (resolvedFormat === undefined) {
        return {
            servers: [],
            errors: [
                {
                    name: "(root)",
                    reason: "no 'mcpServers' or 'servers' object found",
                },
            ],
        };
    }

    const serverMap = getServerMap(root, resolvedFormat);
    if (serverMap === undefined) {
        return {
            servers: [],
            errors: [{ name: "(root)", reason: "server map is not an object" }],
        };
    }

    const servers: ImportedServer[] = [];
    const errors: ImportError[] = [];
    for (const [name, rawEntry] of Object.entries(serverMap)) {
        if (rawEntry === null || typeof rawEntry !== "object") {
            errors.push({ name, reason: "server entry is not an object" });
            continue;
        }
        try {
            const config = toNormalized(
                name,
                rawEntry as Record<string, unknown>,
            );
            servers.push({ name, config });
        } catch (e: any) {
            errors.push({ name, reason: e?.message ?? String(e) });
        }
    }
    return { servers, errors };
}
