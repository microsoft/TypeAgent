// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    assertAllowedExplorerModel,
    createDefaultLanguageServers,
    defaultTypeScriptLanguageServerCommand,
    type LanguageServerOptions,
} from "explorer-typeagent";
import path from "node:path";

export interface ExploreServerOptions {
    repoRoot: string;
    model: string;
    baseUrl: string;
    apiKeyEnv: string;
    maxToolCalls: number;
    reasoningRequestTimeoutMs?: number;
    telemetryFile?: string | undefined;
    lsp?: LanguageServerOptions;
}

export function parseExploreServerOptions(
    argv: string[],
    env: Record<string, string | undefined>,
    cwd: string,
): ExploreServerOptions {
    const flags = new Map<string, string[]>();
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const equals = argument.indexOf("=");
        const name = equals >= 0 ? argument.slice(0, equals) : argument;
        if (!SUPPORTED_FLAGS.has(name)) {
            throw new Error(`Unknown argument: ${argument}`);
        }
        if (BOOLEAN_FLAGS.has(name)) {
            if (equals >= 0) {
                throw new Error(`${name} does not accept a value`);
            }
            flags.set(name, ["true"]);
            continue;
        }
        const value =
            equals >= 0 ? argument.slice(equals + 1) : argv[(index += 1)];
        if (value === undefined || value.trim() === "") {
            throw new Error(`${name} requires a value`);
        }
        const values = flags.get(name) ?? [];
        values.push(value.trim());
        flags.set(name, values);
    }

    const model = flag(flags, "--model") ?? env.TYPEAGENT_EXPLORE_MODEL?.trim();
    if (!model) {
        throw new Error("--model is required (or set TYPEAGENT_EXPLORE_MODEL)");
    }
    assertAllowedExplorerModel(model);

    const rawBaseUrl =
        flag(flags, "--base-url") ?? env.TYPEAGENT_EXPLORE_BASE_URL?.trim();
    if (!rawBaseUrl) {
        throw new Error(
            "--base-url is required (or set TYPEAGENT_EXPLORE_BASE_URL)",
        );
    }
    const baseUrl = normalizeProviderBaseUrl(rawBaseUrl);

    const apiKeyEnv =
        flag(flags, "--api-key-env") ??
        env.TYPEAGENT_EXPLORE_API_KEY_ENV?.trim() ??
        "CUSTOM_PROVIDER_API_KEY";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
        throw new Error("--api-key-env must be an environment variable name");
    }

    const repo =
        flag(flags, "--repo") ?? env.TYPEAGENT_EXPLORE_ROOT?.trim() ?? cwd;
    const maxToolCalls = Number(flag(flags, "--max-tool-calls") ?? "8");
    if (
        !Number.isInteger(maxToolCalls) ||
        maxToolCalls < 1 ||
        maxToolCalls > 64
    ) {
        throw new Error("--max-tool-calls must be an integer from 1 to 64");
    }
    const telemetry =
        flag(flags, "--telemetry-file") ??
        env.TYPEAGENT_EXPLORE_TELEMETRY_FILE?.trim();
    const reasoningRequestTimeout = flag(flags, "--request-timeout-ms");
    const reasoningRequestTimeoutMs = reasoningRequestTimeout
        ? Number(reasoningRequestTimeout)
        : undefined;
    if (
        reasoningRequestTimeoutMs !== undefined &&
        (!Number.isInteger(reasoningRequestTimeoutMs) ||
            reasoningRequestTimeoutMs < 1_000 ||
            reasoningRequestTimeoutMs > 600_000)
    ) {
        throw new Error(
            "--request-timeout-ms must be an integer from 1000 to 600000",
        );
    }
    const lsp = flags.has("--enable-lsp")
        ? languageServerOptions(flags)
        : undefined;
    return {
        repoRoot: path.resolve(cwd, repo),
        model,
        baseUrl,
        apiKeyEnv,
        maxToolCalls,
        ...(reasoningRequestTimeoutMs !== undefined
            ? { reasoningRequestTimeoutMs }
            : {}),
        ...(telemetry ? { telemetryFile: path.resolve(cwd, telemetry) } : {}),
        ...(lsp ? { lsp } : {}),
    };
}

export function resolveExploreApiKey(
    options: Pick<ExploreServerOptions, "apiKeyEnv">,
    env: Record<string, string | undefined>,
): string {
    const apiKey = env[options.apiKeyEnv]?.trim();
    if (!apiKey) {
        throw new Error(
            `Missing credential environment variable: ${options.apiKeyEnv}`,
        );
    }
    return apiKey;
}

export function normalizeProviderBaseUrl(baseUrl: string): string {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("--base-url must use http or https");
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
}

const SUPPORTED_FLAGS = new Set([
    "--repo",
    "--model",
    "--base-url",
    "--api-key-env",
    "--max-tool-calls",
    "--telemetry-file",
    "--request-timeout-ms",
    "--enable-lsp",
    "--python-lsp-command",
    "--python-lsp-arg",
    "--typescript-lsp-command",
    "--typescript-lsp-arg",
    "--lsp-server-command",
    "--lsp-server-arg",
    "--disable-lsp-server",
]);

const BOOLEAN_FLAGS = new Set(["--enable-lsp"]);

function flag(flags: Map<string, string[]>, name: string): string | undefined {
    return flags.get(name)?.at(-1);
}

function languageServerOptions(
    flags: Map<string, string[]>,
): LanguageServerOptions {
    const defaultTypescript = defaultTypeScriptLanguageServerCommand();
    const typescriptCommand = flag(flags, "--typescript-lsp-command");
    const typescriptArgs = flags.get("--typescript-lsp-arg");
    const servers = createDefaultLanguageServers({
        python: {
            command: flag(flags, "--python-lsp-command") ?? "pylsp",
            args: flags.get("--python-lsp-arg") ?? [],
        },
        typescript: typescriptCommand
            ? {
                  command: typescriptCommand,
                  args: typescriptArgs ?? ["--stdio"],
              }
            : defaultTypescript,
    });
    const known = new Set(servers.map((server) => server.id));
    const commandOverrides = keyedValues(
        flags.get("--lsp-server-command") ?? [],
        "--lsp-server-command",
        false,
    );
    const argumentOverrides = keyedValues(
        flags.get("--lsp-server-arg") ?? [],
        "--lsp-server-arg",
        true,
    );
    const disabled = new Set(flags.get("--disable-lsp-server") ?? []);
    for (const id of [
        ...commandOverrides.keys(),
        ...argumentOverrides.keys(),
        ...disabled,
    ]) {
        if (!known.has(id)) {
            throw new Error(`Unknown LSP server ID: ${id}`);
        }
    }
    return {
        requestTimeoutMs: 30_000,
        servers: servers
            .filter((server) => !disabled.has(server.id))
            .map((server) => ({
                ...server,
                command: {
                    ...server.command,
                    ...(commandOverrides.has(server.id)
                        ? { command: commandOverrides.get(server.id)![0] }
                        : {}),
                    ...(argumentOverrides.has(server.id)
                        ? { args: argumentOverrides.get(server.id)! }
                        : {}),
                },
            })),
    };
}

function keyedValues(
    values: string[],
    flagName: string,
    repeatable: boolean,
): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const value of values) {
        const separator = value.indexOf("=");
        const id = value.slice(0, separator);
        const item = value.slice(separator + 1);
        if (
            separator < 1 ||
            !/^[a-z0-9-]+$/.test(id) ||
            item.trim() === ""
        ) {
            throw new Error(`${flagName} expects <server-id>=<value>`);
        }
        if (!repeatable && result.has(id)) {
            throw new Error(`${flagName} may set ${id} only once`);
        }
        result.set(id, [...(result.get(id) ?? []), item]);
    }
    return result;
}
