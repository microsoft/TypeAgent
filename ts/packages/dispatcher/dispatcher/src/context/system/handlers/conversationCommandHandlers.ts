// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    changeContextConfig,
    CommandHandlerContext,
    reloadSessionOnCommandHandlerContext,
} from "../../commandHandlerContext.js";
import { setSessionOnCommandHandlerContext } from "../../commandHandlerContext.js";
import {
    Session,
    deleteAllSessions,
    deleteSession,
    getSessionNames,
    getSessionConstructionDirPaths,
    getSessionName,
} from "../../session.js";
import chalk from "chalk";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { askYesNoWithContext } from "../../interactiveIO.js";
import { appAgentStateKeys } from "../../appAgentStateConfig.js";

class SessionNewCommandHandler implements CommandHandler {
    public readonly description = "Create a new empty session";
    public readonly parameters = {
        flags: {
            keep: {
                description:
                    "Copy the current session settings in the new session",
                default: false,
            },

            persist: {
                description:
                    "Persist the new session.  Default to whether the current session is persisted.",
                type: "boolean",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { flags } = params;
        if (flags.persist && systemContext.persistDir === undefined) {
            throw new Error("User data storage disabled.");
        }
        await setSessionOnCommandHandlerContext(
            systemContext,
            await Session.create(
                flags.keep ? systemContext.session.getConfig() : undefined,
                (flags.persist ??
                    systemContext.session.sessionDirPath !== undefined)
                    ? systemContext.persistDir
                    : undefined,
            ),
        );

        context.sessionContext.agentContext.chatHistory.clear();

        displaySuccess(
            `New session created${
                systemContext.session.sessionDirPath
                    ? `: ${getSessionName(systemContext.session.sessionDirPath)}`
                    : ""
            }`,
            context,
        );
    }
}

class SessionOpenCommandHandler implements CommandHandler {
    public readonly description = "Open an existing session";
    public readonly parameters = {
        args: {
            session: {
                description: "Name of the session to open.",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        if (systemContext.persistDir === undefined) {
            throw new Error("User data storage disabled.");
        }
        const session = await Session.load(
            systemContext.persistDir,
            params.args.session,
            systemContext.indexingServiceRegistry,
        );
        await setSessionOnCommandHandlerContext(systemContext, session);
        displaySuccess(`Session opened: ${params.args.session}`, context);
    }
}

class SessionResetCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Reset config on session and keep the data";
    public async run(context: ActionContext<CommandHandlerContext>) {
        await changeContextConfig(null, context);
        displaySuccess(`Session settings revert to default.`, context);
    }
}

class SessionClearCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Delete all data on the current sessions, keeping current settings";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        if (systemContext.session.sessionDirPath === undefined) {
            throw new Error("Session is not persisted. Nothing to clear.");
        }

        if (
            !(await askYesNoWithContext(
                systemContext,
                `Are you sure you want to clear data for current session '${getSessionName(systemContext.session.sessionDirPath)}'?`,
                false,
            ))
        ) {
            displayWarn("Cancelled!", context);
            return;
        }
        await systemContext.session.clear();
        // Force a reinitialize of the context
        await setSessionOnCommandHandlerContext(
            systemContext,
            systemContext.session,
        );
        displaySuccess(`Session data cleared.`, context);
    }
}

class SessionDeleteCommandHandler implements CommandHandler {
    public readonly description =
        "Delete a session. If no session is specified, delete the current session and start a new session.\n-a to delete all sessions";
    public readonly parameters = {
        args: {
            session: {
                description: "Session name to delete",
                optional: true,
            },
        },
        flags: {
            all: {
                description: "Delete all sessions",
                char: "a",
                type: "boolean",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        if (systemContext.persistDir === undefined) {
            throw new Error("Persist profile disabled.");
        }
        const persist = systemContext.session.sessionDirPath !== undefined;
        if (params.flags.all === true) {
            if (
                !(await askYesNoWithContext(
                    systemContext,
                    "Are you sure you want to delete all sessions?",
                    false,
                ))
            ) {
                displayWarn("Cancelled!", context);
                return;
            }
            await deleteAllSessions(systemContext.persistDir);
            displaySuccess("All session deleted.", context);
        } else {
            const currentSessionName = systemContext.session.sessionDirPath
                ? getSessionName(systemContext.session.sessionDirPath)
                : undefined;
            const del = params.args.session ?? currentSessionName;
            if (del === undefined) {
                throw new Error(
                    "The current session is not persisted. Nothing to clear.",
                );
            }
            const sessionNames = await getSessionNames(
                systemContext.persistDir,
            );
            if (!sessionNames.includes(del)) {
                throw new Error(`'${del}' is not a session name`);
            }
            if (
                !(await askYesNoWithContext(
                    systemContext,
                    `Are you sure you want to delete session '${del}'?`,
                    false,
                ))
            ) {
                displayWarn("Cancelled!", context);
                return;
            }
            await deleteSession(systemContext.persistDir, del);
            displaySuccess(`Session '${del}' deleted.`, context);
            if (del !== currentSessionName) {
                return;
            }
        }
        await reloadSessionOnCommandHandlerContext(systemContext, persist);
    }
}

class SessionListCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "List all sessions. The current session is marked green.";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        if (systemContext.persistDir === undefined) {
            throw new Error("User data storage disabled.");
        }
        const names = await getSessionNames(systemContext.persistDir);
        displayResult(
            names
                .map((n) =>
                    n === systemContext.session.sessionDirPath
                        ? chalk.green(n)
                        : n,
                )
                .join("\n"),
            context,
        );
    }
}

class SessionInfoCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show info about the current session";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        const constructionFiles = systemContext.session.sessionDirPath
            ? await getSessionConstructionDirPaths(
                  systemContext.session.sessionDirPath,
              )
            : [];

        displayResult(
            `${chalk.bold("Instance Dir:")} ${systemContext.persistDir}`,
            context,
        );
        const session = systemContext.session;
        displayResult(
            `${chalk.bold("Session settings")} (${
                session.sessionDirPath
                    ? chalk.green(getSessionName(session.sessionDirPath))
                    : "in-memory"
            }):`,
            context,
        );

        const table: string[][] = [["Name", "Value"]];
        const addConfig = (
            options: any,
            settings: any,
            override: readonly string[] | boolean = false,
            prefix: number = 0,
        ) => {
            for (const [key, value] of Object.entries(options)) {
                const name = `${" ".repeat(prefix)}${key.padEnd(20 - prefix)}`;
                const currentSetting = settings?.[key];
                const overrideKey = Array.isArray(override)
                    ? override.includes(key)
                    : override;
                if (typeof value === "object") {
                    table.push([chalk.bold(name), ""]);
                    addConfig(value, currentSetting, overrideKey, prefix + 2);
                } else {
                    const valueStr =
                        !overrideKey && currentSetting === undefined
                            ? chalk.grey(value)
                            : currentSetting !== value
                              ? chalk.yellow(value)
                              : String(value);
                    table.push([name, valueStr]);
                }
            }
        };
        addConfig(
            session.getConfig(),
            session.getSettings(),
            appAgentStateKeys,
        );

        displayResult(table, context);

        if (constructionFiles.length) {
            displayResult(`\n${chalk.bold("Construction Files:")}`, context);
            for (const file of constructionFiles) {
                displayResult(
                    `  ${
                        file.current ? chalk.green(file.name) : file.name
                    } (${file.explainer})`,
                    context,
                );
            }
        }
    }
}

export function getSessionCommandHandlers(): CommandHandlerTable {
    return {
        description: "Session commands",
        commands: {
            new: new SessionNewCommandHandler(),
            open: new SessionOpenCommandHandler(),
            reset: new SessionResetCommandHandler(),
            clear: new SessionClearCommandHandler(),
            list: new SessionListCommandHandler(),
            delete: new SessionDeleteCommandHandler(),
            info: new SessionInfoCommandHandler(),
        },
    };
}
