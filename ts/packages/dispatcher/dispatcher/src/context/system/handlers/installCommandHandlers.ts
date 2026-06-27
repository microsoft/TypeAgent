// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    CommandHandlerContext,
    installAppProvider,
} from "../../commandHandlerContext.js";
import {
    displayResult,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import {
    InstallSourceConfig,
    InstallSourceRegistry,
} from "../../../agentProvider/installSource.js";
import { AppAgentInstaller } from "../../../agentProvider/agentProvider.js";

// A legal dispatcher agent identifier (matches existing agent names such as
// "github-cli", "osNotifications").
const AGENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

export class InstallCommandHandler implements CommandHandler {
    public readonly description = "Install an agent";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the agent",
                type: "string",
            },
            ref: {
                description:
                    "Reference to install: a filesystem path, a catalog short name, or a feed specifier. Interpreted by the matching source in the configured order.",
                type: "string",
            },
        },
        flags: {
            source: {
                description:
                    "Resolve only against this named source, bypassing the order.",
                char: "s",
                type: "string",
                optional: true,
            },
            where: {
                description:
                    "Dry run: report which source would resolve the ref without installing.",
                char: "w",
                type: "boolean",
                default: false,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const installer = systemContext.agentInstaller;
        if (installer === undefined) {
            throw new Error("Agent installer not available");
        }
        const { args, flags } = params;
        const { name, ref } = args;
        const sourceName = flags.source ?? undefined;

        // --where: report which source would win without installing (§5).
        if (flags.where) {
            const registry = installer.sources?.();
            if (registry === undefined) {
                throw new Error("Install sources are not available");
            }
            const candidate = await registry.where(ref);
            if (candidate === undefined) {
                const order = registry
                    .order()
                    .map((s) => s.name)
                    .join(", ");
                displayResult(
                    `No source would resolve '${ref}'. Order: [${order}]`,
                    context,
                );
                return;
            }
            const handle = candidate.path ?? candidate.module ?? ref;
            displayResult(
                `'${ref}' would resolve via source '${candidate.source}' (${handle}).`,
                context,
            );
            return;
        }

        // Name validation runs BEFORE materialize so a bad or colliding name
        // fails fast without touching disk or the feed (design §5, §12 Q18).
        if (!AGENT_NAME_RE.test(name)) {
            throw new Error(
                `'${name}' is not a legal agent name (letters, digits, '-' and '_'; must start with a letter).`,
            );
        }
        if (systemContext.agents.isAppAgentName(name)) {
            throw new Error(`Agent '${name}' already exists`);
        }

        const provider = await installer.install(name, ref, sourceName);
        await installAppProvider(systemContext, provider);
        displayResult(`Agent '${name}' installed.`, context);
    }
}

export class UninstallCommandHandler implements CommandHandler {
    public readonly description = "Uninstall an agent";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the agent",
                type: "string",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const installer = systemContext.agentInstaller;
        if (installer === undefined) {
            throw new Error("Agent installer not available");
        }

        const name = params.args.name;
        await installer.uninstall(name);

        await systemContext.agents.removeAgent(
            name,
            systemContext.agentCache.grammarStore,
        );

        displayResult(`Agent '${name}' uninstalled.`, context);
    }
}

export class UpdateCommandHandler implements CommandHandler {
    public readonly description = "Update an installed agent";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the agent to update",
                type: "string",
            },
            range: {
                description:
                    "Optional version range for feed agents (e.g. ^1.4, ~2.0, '>=3 <4'). Ignored for path/catalog agents.",
                type: "string",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const installer = systemContext.agentInstaller;
        if (installer === undefined) {
            throw new Error("Agent installer not available");
        }
        if (installer.update === undefined) {
            throw new Error("Agent update is not supported by this installer");
        }
        const { name, range } = params.args;

        // The installer materializes the new version first and only rewrites the
        // record after it succeeds, so a failed update is a no-op (design §4.7,
        // §12 Q13). Then tear down the old live agent and register the fresh
        // provider (design §4.6 / §4.7).
        const provider = await installer.update(name, range);
        await systemContext.agents.removeAgent(
            name,
            systemContext.agentCache.grammarStore,
        );
        await installAppProvider(systemContext, provider);
        displayResult(`Agent '${name}' updated.`, context);
    }
}

// Resolve the host install-source registry, erroring if the installer or its
// registry is absent (a host without an installer exposes no `@source`).
function getRegistry(installer: AppAgentInstaller | undefined): {
    installer: AppAgentInstaller;
    registry: InstallSourceRegistry;
} {
    if (installer === undefined) {
        throw new Error("Agent installer not available");
    }
    const registry = installer.sources?.();
    if (registry === undefined) {
        throw new Error("Install sources are not available");
    }
    return { installer, registry };
}

class SourceListCommandHandler implements CommandHandler {
    public readonly description =
        "List install sources and the resolution order";
    public readonly parameters = {} as const;
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        const { registry } = getRegistry(systemContext.agentInstaller);
        const configs = registry.list();
        const order = registry.order().map((source) => source.name);
        const lines: string[] = [];
        lines.push(`Resolution order: [${order.join(", ")}]`);
        lines.push("Sources:");
        for (const config of configs) {
            const inOrder = order.includes(config.name)
                ? `#${order.indexOf(config.name) + 1}`
                : "(not in order)";
            let detail: string;
            switch (config.kind) {
                case "feed":
                    detail = config.registry;
                    break;
                case "catalog":
                    detail = config.catalog;
                    break;
                case "path":
                    detail = config.baseDir ?? "(default base)";
                    break;
                default: {
                    const exhaustive: never = config;
                    detail = String(exhaustive);
                }
            }
            lines.push(
                `  ${config.name} [${config.kind}] ${inOrder} ${detail}`,
            );
        }
        displayResult(lines.join("\n"), context);
    }
}

class SourceOrderCommandHandler implements CommandHandler {
    public readonly description =
        "Set the resolution order (a subset is allowed; remaining sources are appended)";
    public readonly parameters = {
        args: {
            names: {
                description: "Source names in priority order (first wins)",
                type: "string",
                multiple: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { registry } = getRegistry(systemContext.agentInstaller);
        const known = new Set(registry.list().map((config) => config.name));
        const unknown = params.args.names.filter((name) => !known.has(name));
        if (unknown.length > 0) {
            await displayWarn(
                `Ignoring unknown source(s): ${unknown.join(", ")}`,
                context,
            );
        }
        // Keep the requested subset first, then append the remaining configured
        // sources so reordering never silently drops a source (design §5).
        const givenKnown = [
            ...new Set(params.args.names.filter((name) => known.has(name))),
        ];
        const seen = new Set(givenKnown);
        const rest = registry
            .list()
            .map((config) => config.name)
            .filter((name) => !seen.has(name));
        const order = [...givenKnown, ...rest];
        registry.setOrder(order);
        displayResult(`Resolution order: [${order.join(", ")}]`, context);
    }
}

class SourceAddFeedCommandHandler implements CommandHandler {
    public readonly description = "Add a feed (npm registry) source";
    public readonly parameters = {
        args: {
            name: { description: "Unique source name", type: "string" },
        },
        flags: {
            registry: {
                description: "Azure Artifacts npm registry URL",
                char: "r",
                type: "string",
                optional: true,
            },
            scope: {
                description: "npm scope to enumerate (repeatable)",
                char: "s",
                type: "string",
                multiple: true,
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { registry } = getRegistry(systemContext.agentInstaller);
        const { name } = params.args;
        const url = params.flags.registry;
        if (url === undefined) {
            throw new Error("--registry <url> is required for a feed source");
        }
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new Error(`'${url}' is not a well-formed URL`);
        }
        if (parsed.protocol !== "https:") {
            throw new Error(`feed registry URL must be https: '${url}'`);
        }
        const config: InstallSourceConfig = {
            kind: "feed",
            name,
            registry: url,
            scopes: params.flags.scope ?? [],
        };
        registry.add(config);
        displayResult(`Added feed source '${name}'.`, context);
    }
}

class SourceAddCatalogCommandHandler implements CommandHandler {
    public readonly description = "Add a catalog (JSON file) source";
    public readonly parameters = {
        args: {
            name: { description: "Unique source name", type: "string" },
        },
        flags: {
            catalog: {
                description: "Path to the catalog JSON file",
                char: "c",
                type: "string",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { registry } = getRegistry(systemContext.agentInstaller);
        const { name } = params.args;
        const catalog = params.flags.catalog;
        if (catalog === undefined) {
            throw new Error(
                "--catalog <path> is required for a catalog source",
            );
        }
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
        const config: InstallSourceConfig = {
            kind: "catalog",
            name,
            catalog,
        };
        registry.add(config);
        displayResult(`Added catalog source '${name}'.`, context);
    }
}

class SourceAddPathCommandHandler implements CommandHandler {
    public readonly description = "Add a filesystem path source";
    public readonly parameters = {
        args: {
            name: { description: "Unique source name", type: "string" },
        },
        flags: {
            baseDir: {
                description: "Base directory for relative refs",
                char: "b",
                type: "string",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { registry } = getRegistry(systemContext.agentInstaller);
        const { name } = params.args;
        const config: InstallSourceConfig = { kind: "path", name };
        if (params.flags.baseDir !== undefined) {
            config.baseDir = params.flags.baseDir;
        }
        registry.add(config);
        displayResult(`Added path source '${name}'.`, context);
    }
}

class SourceRemoveCommandHandler implements CommandHandler {
    public readonly description = "Remove an install source";
    public readonly parameters = {
        args: {
            name: { description: "Source name to remove", type: "string" },
        },
        flags: {
            force: {
                description:
                    "Remove even when installed agents still reference this source",
                char: "f",
                type: "boolean",
                default: false,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { installer, registry } = getRegistry(
            systemContext.agentInstaller,
        );
        const { name } = params.args;
        const referencing = installer.recordsUsingSource?.(name) ?? [];
        if (referencing.length > 0 && !params.flags.force) {
            // Warn and abort: removal without --force is a no-op when agents
            // still reference the source (design §5).
            await displayWarn(
                `Source '${name}' is still referenced by: ${referencing.join(
                    ", ",
                )}. ` +
                    `Those agents stay loadable but can no longer be '@update'd. ` +
                    `Re-run with --force to remove anyway.`,
                context,
            );
            return;
        }
        registry.remove(name);
        displayResult(`Removed source '${name}'.`, context);
    }
}

export function getSourceCommandHandlers(): CommandHandlerTable {
    return {
        description: "Manage install sources (design §5)",
        defaultSubCommand: "list",
        commands: {
            list: new SourceListCommandHandler(),
            order: new SourceOrderCommandHandler(),
            add: {
                description: "Add an install source",
                commands: {
                    feed: new SourceAddFeedCommandHandler(),
                    catalog: new SourceAddCatalogCommandHandler(),
                    path: new SourceAddPathCommandHandler(),
                },
            },
            remove: new SourceRemoveCommandHandler(),
        },
    };
}
