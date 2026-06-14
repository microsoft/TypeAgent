// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import fs from "node:fs";
import {
    CommandHandlerContext,
    installAppProvider,
} from "../../commandHandlerContext.js";
import path from "node:path";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import { expandHome } from "../../../utils/fsUtils.js";

// Heuristic: an npm specifier like "@scope/name@1.2.3" or "name@^1", but not a
// filesystem path (those are handled by existence check before this is called).
function isNpmSpecifier(s: string): boolean {
    if (s.includes("\\") || s.includes(":") || /^[.~/]/.test(s)) {
        return false;
    }
    return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[^/\\]+)?$/i.test(s);
}

export class InstallCommandHandler implements CommandHandler {
    public readonly description = "Install an agent";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the agent",
                type: "string",
            },
            agent: {
                description:
                    "Path of an agent package directory/tar file, or an npm specifier (e.g. @scope/agent@1.2.3) to install from the feed",
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
        const { args } = params;
        const { name, agent } = args;
        const fullPath = path.resolve(expandHome(agent));
        if (!fs.existsSync(fullPath)) {
            // Not an on-disk path — try it as an npm specifier from the feed.
            if (!isNpmSpecifier(agent)) {
                throw new Error(
                    `Agent path '${fullPath}' does not exist and '${agent}' is not a valid npm specifier`,
                );
            }
            if (installer.installNpm === undefined) {
                throw new Error(
                    "Installing from an npm specifier is not supported by this installer",
                );
            }
            const provider = await installer.installNpm(name, agent);
            await installAppProvider(systemContext, provider);
            displayResult(`Agent '${name}' installed from '${agent}'.`, context);
            return;
        }
        const packageJsonPath = path.join(fullPath, "package.json");
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error(
                `Agent path '${fullPath}' is not a NPM package. Missing 'package.json'`,
            );
        }

        const moduleName = JSON.parse(
            fs.readFileSync(packageJsonPath, "utf8"),
        ).name;

        const provider = installer.install(name, moduleName, fullPath);
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
        installer.uninstall(name);

        await systemContext.agents.removeAgent(
            name,
            systemContext.agentCache.grammarStore,
        );

        displayResult(`Agent '${name}' uninstalled.`, context);
    }
}
