// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import {
    CatalogSourceConfig,
    FeedSourceConfig,
    McpConfigSourceConfig,
    PathSourceConfig,
    RegistrySourceConfig,
} from "./config.js";
import { DefaultInstallSourceRegistry } from "./registry.js";
import { expandHome } from "./paths.js";

// Host-owned `@package source add <kind>` command handlers. The dispatcher core
// merges these into the `@package source` table (via
// `InstalledAgentSourceApi.sourceCommands`) so the core never learns the kind
// taxonomy or the per-kind flags. This is where a host would hook in token
// prompts or feed-specific auth UI for adding a source.
//
// Each handler is fully typed (args + flags), so the dispatcher gives the user
// intellisense, completion, and usage for `@package source add feed/catalog/path` -
// exactly like a built-in command - while the grammar lives entirely here.

function validateFeedRegistry(url: string): void {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`'${url}' is not a well-formed URL`);
    }

    if (parsed.protocol !== "https:") {
        throw new Error(`feed registry URL must be https: '${url}'`);
    }
}

function validateRegistryUrl(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`'${url}' is not a well-formed URL`);
    }
    if (parsed.protocol !== "https:") {
        throw new Error(`MCP Registry URL must be https: '${url}'`);
    }
    parsed.search = "";
    parsed.hash = "";
    if (!parsed.pathname.endsWith("/")) {
        parsed.pathname += "/";
    }
    return parsed.toString();
}

function validateCatalogFile(catalog: string): void {
    try {
        JSON.parse(fs.readFileSync(catalog, "utf8"));
    } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT" || err.code === "EACCES") {
            throw new Error(
                `catalog file '${catalog}' is not accessible: ${err.message}`,
            );
        }
        throw new Error(
            `catalog '${catalog}' is not valid JSON: ${err.message}`,
        );
    }
}

function normalizeAbsolutePath(value: string): string {
    return path.resolve(expandHome(value));
}

class FeedAddCommandHandler implements CommandHandler {
    public readonly description =
        "Add a feed (npm-style registry) install source";
    public readonly parameters = {
        args: {
            name: { description: "Unique source name", type: "string" },
        },
        flags: {
            registry: {
                description:
                    "Feed registry URL (https). Optional: omit to use TYPEAGENT_FEED_REGISTRY at runtime",
                char: "r",
                type: "string",
            },
            scope: {
                description: "npm scope to enumerate (repeatable)",
                char: "s",
                type: "string",
                multiple: true,
            },
        },
    } as const;
    constructor(private readonly registry: DefaultInstallSourceRegistry) {}
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { name } = params.args;
        const url = params.flags.registry;
        if (url !== undefined) {
            validateFeedRegistry(url);
        }
        const config: FeedSourceConfig = {
            kind: "feed",
            name,
        };
        if (url !== undefined) {
            config.registry = url;
        }
        if (params.flags.scope !== undefined) {
            config.scopes = params.flags.scope;
        }
        this.registry.add(config);
        displayResult(
            url === undefined
                ? `Added feed source '${name}' (env-backed registry).`
                : `Added feed source '${name}'.`,
            context,
        );
    }
}

class CatalogAddCommandHandler implements CommandHandler {
    public readonly description =
        "Add a catalog (JSON manifest) install source";
    public readonly parameters = {
        args: {
            name: { description: "Unique source name", type: "string" },
        },
        flags: {
            catalog: {
                description: "Path to the catalog JSON file",
                char: "c",
                type: "string",
            },
        },
    } as const;
    constructor(private readonly registry: DefaultInstallSourceRegistry) {}
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { name } = params.args;
        const catalog = params.flags.catalog;
        if (catalog === undefined) {
            throw new Error(
                "--catalog <path> is required for a catalog source",
            );
        }
        const normalizedCatalog = normalizeAbsolutePath(catalog);
        validateCatalogFile(normalizedCatalog);
        const config: CatalogSourceConfig = {
            kind: "catalog",
            name,
            catalog: normalizedCatalog,
        };
        this.registry.add(config);
        displayResult(`Added catalog source '${name}'.`, context);
    }
}

class PathAddCommandHandler implements CommandHandler {
    public readonly description = "Add a filesystem path install source";
    public readonly parameters = {
        args: {
            name: { description: "Unique source name", type: "string" },
        },
        flags: {
            baseDir: {
                description: "Optional base directory for relative refs",
                char: "b",
                type: "string",
            },
        },
    } as const;
    constructor(private readonly registry: DefaultInstallSourceRegistry) {}
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { name } = params.args;
        const config: PathSourceConfig = { kind: "path", name };
        const baseDir = params.flags.baseDir;
        if (baseDir !== undefined) {
            config.baseDir = normalizeAbsolutePath(baseDir);
        }
        this.registry.add(config);
        displayResult(`Added path source '${name}'.`, context);
    }
}

class McpConfigAddCommandHandler implements CommandHandler {
    public readonly description =
        "Add an MCP config file (.mcp.json / .vscode/mcp.json) discovery source";
    public readonly parameters = {
        args: {
            name: { description: "Unique source name", type: "string" },
        },
        flags: {
            file: {
                description: "Path to the MCP config JSON file",
                char: "f",
                type: "string",
            },
        },
    } as const;
    constructor(private readonly registry: DefaultInstallSourceRegistry) {}
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { name } = params.args;
        const file = params.flags.file;
        if (file === undefined) {
            throw new Error(
                "--file <path> is required for an mcp-config source",
            );
        }

        const normalizedFile = normalizeAbsolutePath(file);
        try {
            JSON.parse(fs.readFileSync(normalizedFile, "utf8"));
        } catch (e) {
            const err = e as NodeJS.ErrnoException;
            if (err.code === "ENOENT" || err.code === "EACCES") {
                throw new Error(
                    `MCP config file '${normalizedFile}' is not accessible: ${err.message}`,
                );
            }

            throw new Error(
                `MCP config '${normalizedFile}' is not valid JSON: ${err.message}`,
            );
        }
        const config: McpConfigSourceConfig = {
            kind: "mcp-config",
            name,
            file: normalizedFile,
        };
        this.registry.add(config);
        displayResult(`Added mcp-config source '${name}'.`, context);
    }
}

class RegistryAddCommandHandler implements CommandHandler {
    public readonly description = "Add an MCP Registry v0.1 install source";
    public readonly parameters = {
        args: {
            name: { description: "Unique source name", type: "string" },
        },
        flags: {
            url: {
                description: "MCP Registry base URL (https)",
                char: "u",
                type: "string",
            },
            "cache-ttl": {
                description: "Metadata cache TTL in seconds",
                type: "number",
                optional: true,
            },
        },
    } as const;
    constructor(private readonly registry: DefaultInstallSourceRegistry) {}
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const url = params.flags.url;
        if (url === undefined) {
            throw new Error(
                "--url <https-url> is required for a registry source",
            );
        }
        const ttlSeconds = params.flags["cache-ttl"];
        if (ttlSeconds !== undefined && ttlSeconds <= 0) {
            throw new Error("--cache-ttl must be greater than zero");
        }
        const config: RegistrySourceConfig = {
            kind: "registry",
            name: params.args.name,
            baseUrl: validateRegistryUrl(url),
            ...(ttlSeconds === undefined
                ? {}
                : { cacheTtlMs: ttlSeconds * 1000 }),
        };
        this.registry.add(config);
        displayResult(`Added registry source '${params.args.name}'.`, context);
    }
}

/**
 * Build the host's `@package source add` subcommand table
 * merges this into the `@package source` table via
 * `InstalledAgentSourceApi.sourceCommands()`.
 */
export function getAddSourceCommandHandlers(
    registry: DefaultInstallSourceRegistry,
): CommandHandlerTable {
    return {
        description: "Add an install source",
        commands: {
            feed: new FeedAddCommandHandler(registry),
            catalog: new CatalogAddCommandHandler(registry),
            path: new PathAddCommandHandler(registry),
            "mcp-config": new McpConfigAddCommandHandler(registry),
            registry: new RegistryAddCommandHandler(registry),
        },
    };
}
