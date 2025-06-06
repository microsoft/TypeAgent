// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    AppAgentManifest,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { AppAgentProvider } from "agent-dispatcher";
import {
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { getLocalWhisperCommandHandlers } from "./localWhisperCommandHandler.js";
import { ShellWindow } from "./shellWindow.js";
import { getObjectProperty, getObjectPropertyNames } from "common-utils";
import { installAndRestart, updateHandlerTable } from "./commands/update.js";
import { isProd } from "./index.js";

export type ShellContext = {
    shellWindow: ShellWindow;
};

const config: AppAgentManifest = {
    emojiChar: "🐚",
    description: "Shell",
};

class ShellShowSettingsCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show shell settings";
    public async run(context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        agentContext.shellWindow.showDialog("settings");
    }
}

class ShellShowHelpCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show shell help";
    public async run(context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        agentContext.shellWindow.showDialog("help");
    }
}

class ShellShowMetricsCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show shell metrics";
    public async run(context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        agentContext.shellWindow.showDialog("Metrics");
    }
}

class ShellShowRawSettingsCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Shows raw JSON shell settings";
    public async run(context: ActionContext<ShellContext>) {
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
        printConfig(agentContext.shellWindow.getUserSettings());
        context.actionIO.setDisplay(message.join("\n"));
    }
}

class ShellSetSettingCommandHandler implements CommandHandler {
    public readonly description: string =
        "Sets a specific setting with the supplied value";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the setting to set",
            },
            value: {
                description: "The new value for the setting",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<ShellContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const agentContext = context.sessionContext.agentContext;
        const { name, value } = params.args;
        if (agentContext.shellWindow.setUserSettingValue(name, value)) {
            displaySuccess(`${name} is changed to ${value}`, context);
        } else {
            displayWarn(`${name} is unchanged from ${value}`, context);
        }
    }
    public async getCompletion(
        context: SessionContext<ShellContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<string[]> {
        const completions: string[] = [];
        for (const name of names) {
            if (name === "name") {
                completions.push(
                    ...getObjectPropertyNames(
                        context.agentContext.shellWindow.getUserSettings(),
                    ),
                );
            }

            if (name === "value") {
                const settingName = params.args?.name;
                if (settingName) {
                    const settings =
                        context.agentContext.shellWindow.getUserSettings();
                    const value = getObjectProperty(settings, settingName);
                    if (typeof value === "boolean") {
                        completions.push("true");
                        completions.push("false");
                    }
                }
            }
        }
        return completions;
    }
}

class ShellRunDemoCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Run Demo";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.shellWindow.runDemo();
    }
}

class ShellRunDemoInteractiveCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Run Demo Interactive";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.shellWindow.runDemo(true);
    }
}

class ShellSetTopMostCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Always keep the shell window on top of other windows";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.shellWindow.toggleTopMost();
    }
}

function getThemeCommandHandlers(): CommandHandlerTable {
    return {
        description: "Set the theme",
        commands: {
            light: {
                description: "Set the theme to light",
                run: async (context: ActionContext<ShellContext>) => {
                    const shellWindow =
                        context.sessionContext.agentContext.shellWindow;
                    shellWindow.setUserSettingValue("darkMode", false);
                },
            },
            dark: {
                description: "Set the theme to dark",
                run: async (context: ActionContext<ShellContext>) => {
                    const shellWindow =
                        context.sessionContext.agentContext.shellWindow;
                    shellWindow.setUserSettingValue("darkMode", true);
                },
            },
        },
    };
}

const handlers: CommandHandlerTable = {
    description: "Shell settings command",
    commands: {
        show: {
            description: "Show shell settings",
            defaultSubCommand: "settings",
            commands: {
                settings: new ShellShowSettingsCommandHandler(),
                help: new ShellShowHelpCommandHandler(),
                metrics: new ShellShowMetricsCommandHandler(),
                raw: new ShellShowRawSettingsCommandHandler(),
            },
        },
        set: new ShellSetSettingCommandHandler(),
        run: {
            description: "Run Demo",
            defaultSubCommand: new ShellRunDemoCommandHandler(),
            commands: {
                interactive: new ShellRunDemoInteractiveCommandHandler(),
            },
        },
        topmost: new ShellSetTopMostCommandHandler(),
        localWhisper: getLocalWhisperCommandHandlers(),
        theme: getThemeCommandHandlers(),
        update: updateHandlerTable,
        restart: {
            description: "Restart the shell",
            run: async () => {
                if (!isProd && process.env["ELECTRON_RENDERER_URL"]) {
                    throw new Error(
                        "Unable to restart running under vite with HMR.",
                    );
                }
                installAndRestart();
            },
        },
    },
};

export function createShellAgentProvider(shellWindow: ShellWindow) {
    const agent: AppAgent = {
        async initializeAgentContext(): Promise<ShellContext> {
            return {
                shellWindow,
            };
        },
        ...getCommandInterface(handlers),
    };

    const shellAgentProvider: AppAgentProvider = {
        getAppAgentNames: () => {
            return ["shell"];
        },
        getAppAgentManifest: async (appAgentName: string) => {
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
        unloadAppAgent: async (appAgentName: string) => {
            if (appAgentName !== "shell") {
                throw new Error(`Unknown app agent: ${appAgentName}`);
            }
        },
    };
    return shellAgentProvider;
}
