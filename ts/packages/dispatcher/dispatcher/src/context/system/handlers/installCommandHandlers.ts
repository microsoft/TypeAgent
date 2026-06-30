// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
    CompletionGroup,
} from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import {
    CommandHandlerContext,
    installAppProvider,
} from "../../commandHandlerContext.js";
import {
    displayStatus,
    displayResult,
} from "@typeagent/agent-sdk/helpers/display";
import chalk from "chalk";

// A legal dispatcher agent identifier (matches existing agent names such as
// "github-cli", "osNotifications").
const AGENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

// Names of agents that can be uninstalled/updated: installed records minus the
// built-ins (which the installer protects). Returns [] when the installer can't
// enumerate its records.
function managedAgentNames(
    context: SessionContext<CommandHandlerContext>,
): string[] {
    const installer = context.agentContext.agentInstaller;
    return (installer?.listInstalled?.() ?? [])
        .filter((info) => info.source !== "builtin")
        .map((info) => info.name);
}

export class ListInstalledCommandHandler implements CommandHandler {
    public readonly description = "List installed agents";
    public readonly parameters = {
        flags: {
            all: {
                description:
                    "Include built-in agents (by default only installed agents are listed)",
                char: "a",
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
        if (installer.listInstalled === undefined) {
            throw new Error(
                "Listing installed agents is not supported by this installer",
            );
        }
        const includeBuiltin = params.flags.all;
        // Built-in agents ship with the app and are always present; by default
        // `@package list` shows only what the user installed. `--all` adds them.
        const records = installer
            .listInstalled()
            .filter((info) => includeBuiltin || info.source !== "builtin");
        if (records.length === 0) {
            displayResult(
                includeBuiltin
                    ? "No agents installed."
                    : "No agents installed. Use '@package list --all' to include built-in agents.",
                context,
            );
            return;
        }

        const agents = systemContext.agents;
        // Best-effort emoji lookup: an installed record may be for an agent
        // that isn't a live app-agent right now (disabled / failed to load),
        // in which case getAppAgentEmoji throws. Fall back to no emoji.
        const safeEmoji = (name: string): string => {
            try {
                return agents.getAppAgentEmoji(name) ?? "";
            } catch {
                return "";
            }
        };

        // Group records by source so each source renders as its own table.
        const groups = new Map<string, typeof records>();
        for (const record of records) {
            const group = groups.get(record.source);
            if (group === undefined) {
                groups.set(record.source, [record]);
            } else {
                group.push(record);
            }
        }

        // Sources listed alphabetically; one table per source, with a heading.
        for (const source of [...groups.keys()].sort()) {
            const groupRecords = groups
                .get(source)!
                .sort((a, b) => a.name.localeCompare(b.name));
            context.actionIO.appendDisplay({
                type: "text",
                content: chalk.yellow(source),
            });
            // Plain-text (CLI / console) — fixed-width via chalk for alignment.
            const text: string[][] = [["", "Agent", "Reference"]];
            for (const record of groupRecords) {
                text.push([
                    safeEmoji(record.name),
                    chalk.cyanBright(record.name),
                    record.handle !== undefined
                        ? chalk.gray(record.handle)
                        : chalk.gray("—"),
                ]);
            }
            context.actionIO.appendDisplay({
                type: "text",
                content: text,
            });
        }

        if (!includeBuiltin) {
            context.actionIO.appendDisplay({
                type: "text",
                content: chalk.gray(
                    "Built-in agents are not shown. Use '@package list --all' to include them.",
                ),
            });
        }
    }
}

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

        displayStatus(`Resolving '${ref}'...`, context);
        const { provider, source } = await installer.install(
            name,
            ref,
            sourceName,
        );
        displayStatus(
            `Found '${ref}' in source '${source}'. Installing as '${name}'...`,
            context,
        );
        await installAppProvider(systemContext, provider);
        displayResult(
            `Agent '${name}' installed from source '${source}'.`,
            context,
        );
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        const installer = context.agentContext.agentInstaller;
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            // `name` is freeform; complete the ref from enumerable sources and
            // the source flag from the configured sources.
            if (name === "ref") {
                completions.push({
                    name,
                    completions: (await installer?.listAvailable?.()) ?? [],
                });
            } else if (name === "--source") {
                completions.push({
                    name,
                    completions: installer?.listSources?.() ?? [],
                });
            }
        }
        return { groups: completions };
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

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "name") {
                completions.push({
                    name,
                    completions: managedAgentNames(context),
                });
            }
        }
        return { groups: completions };
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

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "name") {
                completions.push({
                    name,
                    completions: managedAgentNames(context),
                });
            }
        }
        return { groups: completions };
    }
}
