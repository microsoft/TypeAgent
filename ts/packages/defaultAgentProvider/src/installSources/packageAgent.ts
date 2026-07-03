// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    AppAgentManifest,
    CompletionGroup,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import {
    AppAgentHost,
    AppAgentProvider,
    InstallResult,
    InstalledAgentInfo,
} from "agent-dispatcher";
import chalk from "chalk";

// A legal dispatcher agent identifier (matches existing agent names such as
// "github-cli", "osNotifications").
const AGENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * The record-store / registry surface the `@package` handlers use, supplied by
 * the host's `AppAgentSource` (design §3.3). All `agents.json` access and source
 * resolution lives behind this so the handlers never touch the dispatcher's
 * internals. `install`/`uninstall`/`update` mutate the record store and return
 * the affected single-agent provider(s); the handler then registers/tears them
 * down through the session's `AppAgentHost`.
 */
export interface InstalledAgentSourceApi {
    // Resolve + materialize + write a record; returns the freshly built
    // single-agent provider (plus which source won and any non-fatal warnings).
    install(
        name: string,
        ref: string,
        sourceName?: string,
    ): Promise<InstallResult>;
    // Drop the record; returns the shared provider instance to remove from the
    // live session (undefined if it was never registered).
    uninstall(
        name: string,
    ): Promise<{ provider: AppAgentProvider | undefined }>;
    // Re-materialize against the recorded source; returns the old provider (to
    // tear down) and the freshly built one (to register).
    update(
        name: string,
        range?: string,
    ): Promise<{
        oldProvider: AppAgentProvider | undefined;
        newProvider: AppAgentProvider;
    }>;
    // Host-rendered summaries of installed agents, backing `@package list`.
    listInstalled(): InstalledAgentInfo[];
    // Source names in resolution order (for `@package install --source`).
    listSources(): string[];
    // Enumerable agent refs across the configured sources (for `@package install`).
    listAvailable(): Promise<string[]>;
    // The host-owned `@source` command table, nested under `@package source`.
    sourceCommands(): CommandHandlerTable;
}

/**
 * The host-owned `agentContext` of the `@package` app agent (design §3.4). It is
 * NOT the dispatcher's `CommandHandlerContext`: the only dispatcher capability
 * it exposes is the narrow {@link AppAgentHost} (to register/tear down agents in
 * the issuing session), plus the host's own {@link InstalledAgentSourceApi}
 * closures. So a handler can never cast its way back to dispatcher internals.
 */
export interface PackageAgentContext {
    readonly appAgentHost: AppAgentHost;
    readonly source: InstalledAgentSourceApi;
}

type PackageActionContext = ActionContext<PackageAgentContext>;
type PackageSessionContext = SessionContext<PackageAgentContext>;

// Names of agents that can be uninstalled/updated.
function managedAgentNames(context: PackageSessionContext): string[] {
    return context.agentContext.source.listInstalled().map((info) => info.name);
}

class ListInstalledCommandHandler implements CommandHandler {
    public readonly description = "List installed agents";
    public readonly parameters = {} as const;
    public async run(
        context: PackageActionContext,
        _params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { source } = context.sessionContext.agentContext;
        // `@package list` shows mutable installed records only.
        const records = source.listInstalled();
        if (records.length === 0) {
            displayResult("No installed agents found.", context);
            return;
        }

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
            const text: string[][] = [["Agent", "Reference"]];
            for (const record of groupRecords) {
                text.push([
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

        context.actionIO.appendDisplay({
            type: "text",
            content: chalk.gray(
                "Showing installable installed agents only. Use '@config agent' to see all available agents and their status.",
            ),
        });
    }
}

class InstallCommandHandler implements CommandHandler {
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
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { appAgentHost, source } = context.sessionContext.agentContext;
        const { args, flags } = params;
        const { name, ref } = args;
        const sourceName = flags.source ?? undefined;

        // Name validation runs BEFORE materialize so a bad name fails fast
        // without touching disk or the feed (design §5/§12 Q18). Name uniqueness
        // is enforced at the record-store write (design §4).
        if (!AGENT_NAME_RE.test(name)) {
            throw new Error(
                `'${name}' is not a legal agent name (letters, digits, '-' and '_'; must start with a letter).`,
            );
        }

        displayStatus(`Resolving '${ref}'...`, context);
        const {
            provider,
            source: resolvedSource,
            warnings,
        } = await source.install(name, ref, sourceName);
        // Surface any non-fatal source degrade warnings once, for this command.
        for (const warning of warnings ?? []) {
            displayWarn(warning, context);
        }
        displayStatus(
            `Found '${ref}' in source '${resolvedSource}'. Installing as '${name}'...`,
            context,
        );
        // Register into the issuing session via its own AppAgentHost (design
        // §3.4). Phase 1: issuing session only; fan-out is added in Milestone 3.
        await appAgentHost.addProvider(provider, true);
        displayResult(
            `Agent '${name}' installed from source '${resolvedSource}'.`,
            context,
        );
    }

    public async getCompletion(
        context: PackageSessionContext,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        const { source } = context.agentContext;
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "ref") {
                completions.push({
                    name,
                    completions: await source.listAvailable(),
                });
            } else if (name === "--source") {
                completions.push({
                    name,
                    completions: source.listSources(),
                });
            }
        }
        return { groups: completions };
    }
}

class UninstallCommandHandler implements CommandHandler {
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
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { appAgentHost, source } = context.sessionContext.agentContext;
        const name = params.args.name;
        const { provider } = await source.uninstall(name);
        // Tear down the live agent in the issuing session (design §3.4).
        if (provider !== undefined) {
            await appAgentHost.removeProvider(provider);
        }
        displayResult(`Agent '${name}' uninstalled.`, context);
    }

    public async getCompletion(
        context: PackageSessionContext,
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

class UpdateCommandHandler implements CommandHandler {
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
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { appAgentHost, source } = context.sessionContext.agentContext;
        const { name, range } = params.args;

        // The source materializes the new version first and only rewrites the
        // record after it succeeds, so a failed update is a no-op (design §4.7,
        // §12 Q13). Then tear down the old live agent and register the fresh
        // provider (remove-then-add, design §4.6 / §4.7).
        const { oldProvider, newProvider } = await source.update(name, range);
        if (oldProvider !== undefined) {
            await appAgentHost.removeProvider(oldProvider);
        }
        await appAgentHost.addProvider(newProvider, true);
        displayResult(`Agent '${name}' updated.`, context);
    }

    public async getCompletion(
        context: PackageSessionContext,
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

/**
 * The `@package` app agent's manifest (design §3.4). Command-only (no schema):
 * the host contributes this as its own agent so `@package …` runs with the
 * host-owned {@link PackageAgentContext}, never the dispatcher's
 * `CommandHandlerContext`.
 */
export const packageManifest: AppAgentManifest = {
    emojiChar: "📦",
    description: "Manage installed agents and their install sources",
    commandDefaultEnabled: true,
};

/**
 * The dispatcher agent name the `@package` surface registers under.
 */
export const PACKAGE_AGENT_NAME = "package";

/**
 * Build the full `@package` command table (design §3.3): install / uninstall /
 * update / list, plus the host's `@source` table nested under `source`.
 */
export function buildPackageCommandTable(
    sourceCommands: CommandHandlerTable,
): CommandHandlerTable {
    return {
        description: "Manage installed agents and their install sources",
        defaultSubCommand: "list",
        commands: {
            list: new ListInstalledCommandHandler(),
            install: new InstallCommandHandler(),
            update: new UpdateCommandHandler(),
            uninstall: new UninstallCommandHandler(),
            source: sourceCommands,
        },
    };
}

/**
 * Build an in-memory {@link AppAgentProvider} that vends the single command-only
 * `@package` agent bound to the given host-owned context (design §3.4). One is
 * created per connected dispatcher (its `agentContext` carries that session's
 * {@link AppAgentHost}).
 */
export function createPackageAppAgentProvider(
    ctx: PackageAgentContext,
): AppAgentProvider {
    const table = buildPackageCommandTable(ctx.source.sourceCommands());
    const appAgent: AppAgent = {
        initializeAgentContext: async () => ctx,
        ...getCommandInterface(table),
    };
    return {
        getAppAgentNames: () => [PACKAGE_AGENT_NAME],
        getAppAgentManifest: async (name: string) => {
            if (name !== PACKAGE_AGENT_NAME) {
                throw new Error(`Unknown agent '${name}'`);
            }
            return packageManifest;
        },
        loadAppAgent: async (name: string) => {
            if (name !== PACKAGE_AGENT_NAME) {
                throw new Error(`Unknown agent '${name}'`);
            }
            return appAgent;
        },
        unloadAppAgent: async () => {},
    };
}
