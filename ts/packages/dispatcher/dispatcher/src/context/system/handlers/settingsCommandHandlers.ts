// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    loadUserSettings,
    saveUserSettings,
    resetUserSettings,
} from "../../../helpers/userSettings.js";
import chalk from "chalk";

class SettingsShowCommandHandler implements CommandHandler {
    public readonly description = "Show all persistent user settings";
    public readonly parameters = {};

    public async run(context: ActionContext<CommandHandlerContext>) {
        const settings = loadUserSettings();
        const lines = [
            `${chalk.cyan("Persistent User Settings")}`,
            ``,
            `  server.hidden:        ${settings.server.hidden}`,
            `  server.idleTimeout:   ${settings.server.idleTimeout}s`,
            `  conversation.resume:  ${settings.conversation.resume}`,
        ];
        displayResult(lines.join("\n"), context);
    }
}

class SettingsResetCommandHandler implements CommandHandler {
    public readonly description = "Reset all settings to defaults";
    public readonly parameters = {};

    public async run(context: ActionContext<CommandHandlerContext>) {
        resetUserSettings();
        displayResult("All user settings reset to defaults.", context);
    }
}

class SettingsServerHiddenCommandHandler implements CommandHandler {
    public readonly description =
        "Set whether the AgentServer starts hidden (true/false)";
    public readonly parameters = {
        args: {
            value: {
                description: "true or false",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const val = params.args.value;
        if (val !== "true" && val !== "false") {
            displayWarn(`Value must be 'true' or 'false'.`, context);
            return;
        }
        const hidden = val === "true";
        const settings = saveUserSettings({ server: { hidden } });
        displayResult(
            `server.hidden set to ${settings.server.hidden}`,
            context,
        );
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: any,
        names: string[],
    ) {
        return {
            groups: names
                .filter((n) => n === "value")
                .map((n) => ({ name: n, completions: ["true", "false"] })),
        };
    }
}

class SettingsServerIdleTimeoutCommandHandler implements CommandHandler {
    public readonly description = "Set idle timeout in seconds (0 to disable)";
    public readonly parameters = {
        args: {
            seconds: {
                description: "Timeout in seconds (0 = disabled)",
                type: "number",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const seconds = params.args.seconds;
        if (seconds < 0) {
            displayWarn("Timeout must be a non-negative number.", context);
            return;
        }
        const settings = saveUserSettings({ server: { idleTimeout: seconds } });
        displayResult(
            `server.idleTimeout set to ${settings.server.idleTimeout}s`,
            context,
        );
    }
}

class SettingsConversationResumeCommandHandler implements CommandHandler {
    public readonly description =
        "Set whether to resume the last conversation on startup (true/false)";
    public readonly parameters = {
        args: {
            value: {
                description: "true or false",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const val = params.args.value;
        if (val !== "true" && val !== "false") {
            displayWarn(`Value must be 'true' or 'false'.`, context);
            return;
        }
        const resume = val === "true";
        const settings = saveUserSettings({ conversation: { resume } });
        displayResult(
            `conversation.resume set to ${settings.conversation.resume}`,
            context,
        );
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: any,
        names: string[],
    ) {
        return {
            groups: names
                .filter((n) => n === "value")
                .map((n) => ({ name: n, completions: ["true", "false"] })),
        };
    }
}

export function getSettingsCommandHandlers(): CommandHandlerTable {
    return {
        description: "Persistent user settings",
        defaultSubCommand: new SettingsShowCommandHandler(),
        commands: {
            show: new SettingsShowCommandHandler(),
            reset: new SettingsResetCommandHandler(),
            server: {
                description: "Server startup settings",
                commands: {
                    hidden: new SettingsServerHiddenCommandHandler(),
                    idleTimeout: new SettingsServerIdleTimeoutCommandHandler(),
                },
            },
            conversation: {
                description: "Conversation settings",
                commands: {
                    resume: new SettingsConversationResumeCommandHandler(),
                },
            },
        },
    };
}
