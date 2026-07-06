// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    CompletionGroup,
    ParameterDefinitions,
    PartialParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    displayResult,
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import chalk from "chalk";
import { DefaultInstallSourceRegistry } from "./registry.js";
import { getAddSourceCommandHandlers } from "./addSource.js";

// The host owns the entire `@package source` command surface. The dispatcher
// core has no install-source registry interface: it exposes only the
// per-session `AppAgentHost` mutation surface, and merges this whole table in
// under `@package` as `source` (via `InstalledAgentSourceApi.sourceCommands()`).
// All knowledge of the kind taxonomy, listing/ordering, resolution preview, and
// the add grammar lives here.

export interface SourceCommandsDeps {
    registry: DefaultInstallSourceRegistry;
    // Returns the names of installed agents whose record was acquired from
    // `sourceName`, powering `@package source remove`'s "still referenced" warning.
    // Injected (rather than imported) so this command module stays decoupled
    // from the installed-agent record store: the installer owns agents.json
    // access and supplies a closure over it (see createDefaultInstalledAgentSource).
    recordsUsingSource: (sourceName: string) => string[];
}

class SourceListCommandHandler implements CommandHandler {
    public readonly description =
        "List install sources and the resolution order";
    public readonly parameters = {} as const;
    constructor(private readonly deps: SourceCommandsDeps) {}
    public async run(context: ActionContext<unknown>) {
        const { registry } = this.deps;
        const infos = registry.list();
        if (infos.length === 0) {
            displayResult("No install sources configured.", context);
            return;
        }

        // Plain-text (CLI / console) table — chalk for color/alignment. The
        // list order is the resolution order, so the row index is the position.
        const text: string[][] = [["Order", "Source", "Kind", "Detail"]];
        infos.forEach((info, index) => {
            text.push([
                chalk.gray(`#${index + 1}`),
                chalk.cyanBright(info.name),
                chalk.yellow(info.kind),
                info.detail ? chalk.gray(info.detail) : chalk.gray("—"),
            ]);
        });

        context.actionIO.appendDisplay({
            type: "text",
            content: text,
        });
    }
}

class SourceOrderCommandHandler implements CommandHandler {
    public readonly description =
        "Set the resolution order (a subset is allowed; the named sources move to the front)";
    public readonly parameters = {
        args: {
            names: {
                description: "Source names in priority order (first wins)",
                type: "string",
                multiple: true,
            },
        },
    } as const;
    constructor(private readonly deps: SourceCommandsDeps) {}
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { registry } = this.deps;
        const known = new Set(registry.list().map((config) => config.name));
        const unknown = params.args.names.filter((name) => !known.has(name));
        if (unknown.length > 0) {
            await displayWarn(
                `Ignoring unknown source(s): ${unknown.join(", ")}`,
                context,
            );
        }
        // The registry moves the named sources to the front (de-duplicated,
        // unknown names skipped) and keeps the rest in their current relative
        // order, so reordering never silently drops a source.
        registry.setOrder(params.args.names);
        const order = registry.list().map((info) => info.name);
        displayResult(`Resolution order: [${order.join(", ")}]`, context);
    }

    public async getCompletion(
        _context: SessionContext<unknown>,
        params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "names") {
                const used = new Set(
                    (params.args?.names as string[] | undefined) ?? [],
                );
                completions.push({
                    name,
                    completions: this.deps.registry
                        .list()
                        .map((info) => info.name)
                        .filter((n) => !used.has(n)),
                });
            }
        }
        return { groups: completions };
    }
}

class SourceWhereCommandHandler implements CommandHandler {
    public readonly description =
        "Report which source would resolve a ref, without installing";
    public readonly parameters = {
        args: {
            ref: {
                description:
                    "Reference to resolve: a filesystem path, a catalog short name, or a feed specifier.",
                type: "string",
            },
        },
    } as const;
    constructor(private readonly deps: SourceCommandsDeps) {}
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { registry } = this.deps;
        const { ref } = params.args;
        // Surface non-fatal source degrade warnings (e.g. a corrupt catalog
        // skipped during the walk) once, for this dry-run command. The status
        // callback reports which source is being probed as the sequential walk
        // advances.
        const candidate = await registry.where(
            ref,
            (m) => displayWarn(m, context),
            (m) => displayStatus(m, context),
        );
        if (candidate === undefined) {
            const order = registry
                .list()
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
    }

    public async getCompletion(
        _context: SessionContext<unknown>,
        _params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "ref") {
                // Enumerable sources (catalog/feed) advertise their agents;
                // path sources don't, so refs there stay freeform.
                const lists = await Promise.all(
                    this.deps.registry
                        .list()
                        .map((info) => this.deps.registry.get(info.name))
                        .map((source) => source?.listAgents?.() ?? []),
                );
                completions.push({
                    name,
                    completions: [...new Set(lists.flat())],
                });
            }
        }
        return { groups: completions };
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
    constructor(private readonly deps: SourceCommandsDeps) {}
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { registry, recordsUsingSource } = this.deps;
        const { name } = params.args;
        const referencing = recordsUsingSource(name);
        if (referencing.length > 0 && !params.flags.force) {
            // Warn and abort: removal without --force is a no-op when agents
            // still reference the source.
            await displayWarn(
                `Source '${name}' is still referenced by: ${referencing.join(
                    ", ",
                )}. ` +
                    `Those agents stay loadable but can no longer be '@package update'd. ` +
                    `Re-run with --force to remove anyway.`,
                context,
            );
            return;
        }
        registry.remove(name);
        displayResult(`Removed source '${name}'.`, context);
    }

    public async getCompletion(
        _context: SessionContext<unknown>,
        _params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "name") {
                completions.push({
                    name,
                    completions: this.deps.registry
                        .list()
                        .map((info) => info.name),
                });
            }
        }
        return { groups: completions };
    }
}

/**
 * Build the host's full `@package source` command table (list / order / where /
 * remove / add). The dispatcher core merges this in under `@package` as
 * `source` via `InstalledAgentSourceApi.sourceCommands()`.
 */
export function getSourceCommands(
    deps: SourceCommandsDeps,
): CommandHandlerTable {
    return {
        description: "Manage install sources",
        defaultSubCommand: "list",
        commands: {
            list: new SourceListCommandHandler(deps),
            order: new SourceOrderCommandHandler(deps),
            where: new SourceWhereCommandHandler(deps),
            remove: new SourceRemoveCommandHandler(deps),
            add: getAddSourceCommandHandlers(deps.registry),
        },
    };
}
