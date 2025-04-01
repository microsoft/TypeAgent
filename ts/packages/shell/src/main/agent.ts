// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    AppAgentManifest,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { AppAgentProvider } from "agent-dispatcher";
import { ShellSettings } from "./shellSettings.js";
import {
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { getLocalWhisperCommandHandlers } from "./localWhisperCommandHandler.js";

const port = process.env.PORT || 9001;

type ShellContext = {
    settings: ShellSettings;
};

const config: AppAgentManifest = {
    emojiChar: "🐚",
    description: "Shell",
};

class ShellShowSettingsCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show shell settings";
    public async run(context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        agentContext.settings.show("settings");
    }
}

class ShellShowHelpCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show shell help";
    public async run(context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        agentContext.settings.show("help");
    }
}

class ShellShowMetricsCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show shell metrics";
    public async run(context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        agentContext.settings.show("Metrics");
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
        printConfig(agentContext.settings);
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
            },
        },
    } as const;
    public async run(
        context: ActionContext<ShellContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const agentContext = context.sessionContext.agentContext;
        const { name, value } = params.args;
        let found: boolean = false;
        let oldValue: any;
        for (const [key, v] of Object.entries(agentContext.settings)) {
            if (key === name) {
                found = true;
                if (typeof agentContext.settings[key] === "object") {
                    try {
                        agentContext.settings.set(name, value);
                    } catch (e) {
                        throw new Error(
                            `Unable to set ${key} to ${value}. Details: ${e}`,
                        );
                    }
                } else {
                    agentContext.settings.set(name, value);
                }
                oldValue = v;
                break;
            }
        }

        if (!found) {
            throw new Error(
                `The supplied shell setting '${name}' could not be found.'`,
            );
        }
        const currValue = agentContext.settings[name];
        if (oldValue !== currValue) {
            displaySuccess(`${name} is changed to ${currValue}`, context);
        } else {
            displayWarn(`${name} is unchanged from ${currValue}`, context);
        }
    }
}

class ShellRunDemoCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Run Demo";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.settings.runDemo();
    }
}

class ShellRunDemoInteractiveCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Run Demo Interactive";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.settings.runDemo(true);
    }
}

class ShellSetTopMostCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Always keep the shell window on top of other windows";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.settings.toggleTopMost();
    }
}

function getThemeCommandHandlers(): CommandHandlerTable {
    return {
        description: "Set the theme",
        commands: {
            light: {
                description: "Set the theme to light",
                run: async (context: ActionContext<ShellContext>) => {
                    context.sessionContext.agentContext.settings.set(
                        "darkMode",
                        false,
                    );
                },
            },
            dark: {
                description: "Set the theme to dark",
                run: async (context: ActionContext<ShellContext>) => {
                    context.sessionContext.agentContext.settings.set(
                        "darkMode",
                        true,
                    );
                },
            },
        },
    };
}

class ShellOpenWebContentView implements CommandHandler {
    public readonly description = "Show a new Web Content view";
    public readonly parameters = {
        args: {
            site: {
                description: "Alias or URL for the site of the open.",
            },
        },
    } as const;
    public async run(
        context: ActionContext<ShellContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        let targetUrl: URL;
        switch (params.args.site.toLowerCase()) {
            case "paleobiodb":
                targetUrl = new URL("https://paleobiodb.org/navigator/");

                break;
            case "crossword":
                targetUrl = new URL(
                    "https://aka.ms/typeagent/sample-crossword",
                );

                break;
            case "commerce":
                targetUrl = new URL("https://www.target.com/");

                break;
            case "markdown":
                targetUrl = new URL(`http://localhost:${port}/`);

                break;
            default:
                targetUrl = new URL(params.args.site);
        }
        context.sessionContext.agentContext.settings.openInlineBrowser(
            targetUrl,
        );
    }
}

class ShellCloseWebContentView implements CommandHandlerNoParams {
    public readonly description = "Close the new Web Content view";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.settings.closeInlineBrowser();
    }
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
        open: new ShellOpenWebContentView(),
        close: new ShellCloseWebContentView(),
        localWhisper: getLocalWhisperCommandHandlers(),
        theme: getThemeCommandHandlers(),
    },
};

const agent: AppAgent = {
    async initializeAgentContext(): Promise<ShellContext> {
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
