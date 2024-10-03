// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    AppAgentManifest,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { AppAgentProvider } from "agent-dispatcher";
import { ShellSettings } from "./shellSettings.js";
import path from "path";
import { BrowserWindow } from "electron";

type ShellContext = {
    settings: ShellSettings;
    inlineWindow: BrowserWindow | undefined;
};

const config: AppAgentManifest = {
    emojiChar: "🐚",
};

class ShellShowSettingsCommandHandler implements CommandHandler {
    public readonly description = "Show shell settings";
    public async run(context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        agentContext.settings.show("settings");
    }
}

class ShellShowHelpCommandHandler implements CommandHandler {
    public readonly description = "Show shell help";
    public async run(context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        agentContext.settings.show("help");
    }
}

class ShellShowMetricsCommandHandler implements CommandHandler {
    public readonly description = "Show shell metrics";
    public async run(context: ActionContext<ShellContext>) {
        const agentContext = context.sessionContext.agentContext;
        agentContext.settings.show("Metrics");
    }
}

class ShellShowRawSettingsCommandHandler implements CommandHandler {
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
    public async run(context: ActionContext<ShellContext>, input: string) {
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
        context.actionIO.setDisplay(`${name} was set to ${newValue}`);
    }
}

class ShellRunDemoCommandHandler implements CommandHandler {
    public readonly description = "Run Demo";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.settings.runDemo();
    }
}

class ShellRunDemoInteractiveCommandHandler implements CommandHandler {
    public readonly description = "Run Demo Interactive";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.settings.runDemo(true);
    }
}

class ShellSetTopMostCommandHandler implements CommandHandler {
    public readonly description =
        "Always keep the shell window on top of other windows";
    public async run(context: ActionContext<ShellContext>) {
        context.sessionContext.agentContext.settings.toggleTopMost();
    }
}

class ShellOpenWebContentView implements CommandHandler {
    public readonly description = "Show a new Web Content view";
    public async run(context: ActionContext<ShellContext>, input: string) {
        let targetUrl: URL;
        switch (input.toLowerCase()) {
            case "paleoBioDb":
                targetUrl = new URL("https://paleobiodb.org/navigator/");

                break;
            case "crossword":
                targetUrl = new URL(
                    "https://www.seattletimes.com/games-nytimes-crossword/",
                );

                break;
            case "commerce":
                targetUrl = new URL("https://www.target.com/");

                break;
            default:
                targetUrl = new URL(input);
        }

        if (targetUrl) {
            if (
                !context.sessionContext.agentContext.inlineWindow ||
                context.sessionContext.agentContext.inlineWindow.isDestroyed()
            ) {
                const win = new BrowserWindow({
                    width: 800,
                    height: 1500,
                    autoHideMenuBar: true,

                    webPreferences: {
                        preload: path.join(__dirname, "../preload/webview.mjs"),
                        sandbox: false,
                    },
                });
                win.removeMenu();

                context.sessionContext.agentContext.inlineWindow = win;
            }

            const inlineWindow =
                context.sessionContext.agentContext.inlineWindow;
            inlineWindow.loadURL(targetUrl.toString());

            inlineWindow.webContents.on("did-finish-load", () => {
                inlineWindow.webContents.send("setupSiteAgent");
            });
        }
    }
}

const handlers: CommandHandlerTable = {
    description: "Shell settings command",
    commands: {
        show: {
            description: "Show shell settings",
            defaultSubCommand: new ShellShowSettingsCommandHandler(),
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
    },
};

const agent: AppAgent = {
    async initializeAgentContext() {
        return {
            settings: ShellSettings.getinstance(),
            inlineWindow: undefined,
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
};
