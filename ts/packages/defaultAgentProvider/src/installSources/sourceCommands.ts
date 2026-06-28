// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { DefaultInstallSourceRegistry } from "./registry.js";
import { getAddSourceCommandHandlers } from "./addSource.js";

// The host owns the entire `@source` command surface. The dispatcher core has
// no install-source registry interface: it contributes only the live-session
// `@install`/`@uninstall`/`@update` commands and merges this whole table in as
// `@source` (via `AppAgentInstaller.sourceCommands()`). All knowledge of the
// kind taxonomy, listing/ordering, resolution preview, and the add grammar
// lives here.

export interface SourceCommandsDeps {
    registry: DefaultInstallSourceRegistry;
    // Returns the names of installed agents whose record was acquired from
    // `sourceName`, powering `@source remove`'s "still referenced" warning.
    // Injected (rather than imported) so this command module stays decoupled
    // from the installed-agent record store: the installer owns agents.json
    // access and supplies a closure over it (see getDefaultAppAgentInstaller).
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
        const order = registry.order().map((source) => source.name);
        const lines: string[] = [];
        lines.push(`Resolution order: [${order.join(", ")}]`);
        lines.push("Sources:");
        for (const info of infos) {
            const inOrder = order.includes(info.name)
                ? `#${order.indexOf(info.name) + 1}`
                : "(not in order)";
            lines.push(
                `  ${info.name} [${info.kind}] ${inOrder} ${info.detail}`,
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

/**
 * Build the host's full `@source` command table (list / order / where / remove
 * / add). The dispatcher core merges this in as `@source` via
 * `AppAgentInstaller.sourceCommands()`.
 */
export function getSourceCommands(deps: SourceCommandsDeps): CommandHandlerTable {
    return {
        description: "Manage install sources (design §5)",
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
