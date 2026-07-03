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
    InstalledAgentInfo,
} from "agent-dispatcher";
import chalk from "chalk";

// A legal dispatcher agent identifier (matches existing agent names such as
// "github-cli", "osNotifications").
const AGENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * The record-store / registry surface the `@package` handlers use, supplied by
 * the host's `AppAgentSource` (design §3.3). All `agents.json` access, source
 * resolution, AND the cross-session fan-out (design §4) live behind this so the
 * handlers never touch the dispatcher's internals. Each mutating op takes the
 * `issuingHost` (the session that ran the command, reached off the package
 * agent's own `agentContext`) so the source can register/enable it awaited while
 * fanning out to siblings best-effort (design §4, §5).
 */
export interface InstalledAgentSourceApi {
    // Resolve + materialize + write a record, then fan out `addProvider`:
    // issuing session awaited + enabled; siblings best-effort + disabled +
    // notified (design §4, §5). Returns which source won + any warnings.
    install(
        name: string,
        ref: string,
        sourceName: string | undefined,
        issuingHost: AppAgentHost,
    ): Promise<{ source: string; warnings?: string[] }>;
    // Drop the record, then fan out `removeProvider` (issuing awaited; siblings
    // best-effort + notified).
    uninstall(name: string, issuingHost: AppAgentHost): Promise<void>;
    // Re-materialize against the recorded source, then fan out remove-then-add
    // per client (issuing awaited; siblings best-effort + notified).
    update(
        name: string,
        range: string | undefined,
        issuingHost: AppAgentHost,
    ): Promise<void>;
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
        // The source resolves + writes the record + fans out to every connected
        // session (issuing awaited + enabled; siblings best-effort + disabled +
        // notified — design §4, §5). Errors registering into THIS session
        // surface here to the user.
        const { source: resolvedSource, warnings } = await source.install(
            name,
            ref,
            sourceName,
            appAgentHost,
        );
        // Surface any non-fatal source degrade warnings once, for this command.
        for (const warning of warnings ?? []) {
            displayWarn(warning, context);
        }
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
        // Drop the record + fan out removeProvider (issuing awaited; siblings
        // best-effort + notified — design §4, §5).
        await source.uninstall(name, appAgentHost);
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
        // §12 Q13). It then fans out remove-then-add per client (issuing
        // awaited; siblings best-effort + notified — design §4).
        await source.update(name, range, appAgentHost);
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
