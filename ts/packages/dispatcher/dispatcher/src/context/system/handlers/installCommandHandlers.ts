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
                    "Path of agent package directory or tar file to install",
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
            throw new Error(`Agent path '${fullPath}' does not exist`);
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
