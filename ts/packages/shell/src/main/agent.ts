// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
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
import { ShellAction } from "./shellActionSchema.js";
import { ShellWindow } from "./shellWindow.js";
import { getObjectProperty, getObjectPropertyNames } from "common-utils";

const port = process.env.PORT || 9001;

type ShellContext = {
    shellWindow: ShellWindow;
};

const config: AppAgentManifest = {
    emojiChar: "🐚",
    description: "Shell",
    schema: {
        description: "Graphical user interface (shell) for the user.",
        schemaFile: "../shell/src/main/shellActionSchema.ts",
        schemaType: "ShellAction",
    },
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
            case "montage":
                // TODO: agents should publish their port #s in manifests
                targetUrl = new URL(`http://localhost:9012/`);

                break;
            default:
                try {
                    targetUrl = new URL(params.args.site);
                } catch (e) {
                    // if the URL is invalid let's try to open the last used canvas item if we have one
                    // if we don't, then we've tried our best
                    return this.run(context, {
                        args: {
                            site: {
                                description: "",
                                value: context.sessionContext.agentContext.shellWindow.getUserSettings()
                                    .canvas,
                            },
                        },
                    } as any);
                }

                break;
        }
        context.sessionContext.agentContext.shellWindow.openInlineBrowser(
            targetUrl,
        );
    }
}

class ShellCloseWebContentView implements CommandHandlerNoParams {
    public readonly description = "Close the new Web Content view";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.shellWindow.closeInlineBrowser();
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

export function createShellAgentProvider(shellWindow: ShellWindow) {
    const agent: AppAgent = {
        async initializeAgentContext(): Promise<ShellContext> {
            return {
                shellWindow,
            };
        },
        async executeAction(
            action: AppAction,
            context: ActionContext<ShellContext>,
        ) {
            const shellAction = action as ShellAction;
            switch (shellAction.actionName) {
                case "openCanvas":
                    const openCmd = new ShellOpenWebContentView();
                    const parameters = {
                        args: {
                            site: shellAction.parameters.site,
                        },
                    };
                    openCmd.run(context, parameters as any);
                    break;
                case "closeCanvas":
                    const closeCmd = new ShellCloseWebContentView();
                    closeCmd.run(context);
                    break;
            }

            return undefined;
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
