// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
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
    PathSourceConfig,
} from "./config.js";
import { DefaultInstallSourceRegistry } from "./registry.js";

// Expand a leading "~" to the user's home directory.
export function expandHome(pathname: string): string {
    if (pathname === "~") {
        return os.homedir();
    }
    if (pathname.startsWith(`~/`) || pathname.startsWith(`~\\`)) {
        return path.join(os.homedir(), pathname.substring(2));
    }
    return pathname;
}

// Host-owned `@package source add <kind>` command handlers. The dispatcher core
// merges these into the `@package source` table (via
// `InstalledAgentSourceApi.sourceCommands`) so the core never learns the kind
// taxonomy or the per-kind flags. This is where a host would hook in richer
// prompting / auth UI for adding a source.
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

/**
 * Build the host's `@package source add` subcommand table
 * (`feed`/`catalog`/`path`), bound to the given registry. The dispatcher core
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
        },
    };
}
