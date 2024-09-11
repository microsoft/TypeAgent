// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    TopLevelTranslatorConfig,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/commands";
import { AppAgentProvider } from "agent-dispatcher";
import { ShellSettings } from "./shellSettings.js";

type ShellContext = {
    settings: ShellSettings;
};

const config: TopLevelTranslatorConfig = {
    emojiChar: "🐚",
};

class ShellShowSettingsCommandHandler implements CommandHandler {
    public readonly description = "Show shell settings";
    public async run(_input: string, context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        const message: string[] = [];
        const printConfig = (options: any, prefix: number = 2) => {
            for (const [key, value] of Object.entries(options)) {
                const name = `${" ".repeat(prefix)}${key.padEnd(20 - prefix)}:`;
                if (typeof value === "object") {
                    message.push(name);
                    printConfig(value, prefix + 2);
                } else if (typeof value === "function") {
                } else {
                    message.push(`${name} ${value}`);
                }
            }
        };
        printConfig(agentContext.settings);
        context.actionIO.setActionDisplay(message.join("\n"));
    }
}

class ShellSetSettingCommandHandler implements CommandHandler {
    public readonly description: string =
        "Sets a specific setting with the supplied value";
    public async run(input: string, context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        const name = input.substring(0, input.indexOf(" "));
        const newValue = input.substring(input.indexOf(" ") + 1);

        let found: boolean = false;
        for (const [key, _] of Object.entries(agentContext.settings)) {
            if (key === name) {
                found = true;
                agentContext.settings.set(name, newValue);
                break;
            }
        }

        if (!found) {
            throw new Error(
                `The supplied shell setting '${name}' could not be found.'`,
            );
        }
        context.actionIO.setActionDisplay(`${name} was set to ${newValue}`);
    }
}

const handlers: CommandHandlerTable = {
    description: "Shell settings command",
    defaultSubCommand: new ShellShowSettingsCommandHandler(),
    commands: {
        show: new ShellShowSettingsCommandHandler(),
        set: new ShellSetSettingCommandHandler(),
    },
};

const agent: AppAgent = {
    async initializeAgentContext() {
        return {
            settings: ShellSettings.getinstance(),
        };
    },
    ...getCommandInterface(handlers),
};

export const shellAgentProvider: AppAgentProvider = {
    getAppAgentNames: () => {
        return ["shell"];
    },
    getAppAgentConfig: async (appAgentName: string) => {
        if (appAgentName !== "shell") {
            throw new Error(`Unknown app agent: ${appAgentName}`);
        }
        return config;
    },
    loadAppAgent: async (appAgentName: string) => {
        if (appAgentName !== "shell") {
            throw new Error(`Unknown app agent: ${appAgentName}`);
        }
        return agent;
    },
};
