// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import {
    CommandHandlerContext,
    installAppProvider,
} from "../../commandHandlerContext.js";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";

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
