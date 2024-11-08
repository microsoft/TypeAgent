// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    changeContextConfig,
    CommandHandlerContext,
    reloadSessionOnCommandHandlerContext,
} from "./common/commandHandlerContext.js";
import { setSessionOnCommandHandlerContext } from "./common/commandHandlerContext.js";
import {
    Session,
    deleteAllSessions,
    deleteSession,
    getSessionNames,
    getDefaultSessionConfig,
    getSessionCaches,
} from "../session/session.js";
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
import { getToggleHandlerTable } from "./common/commandHandler.js";

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
        await setSessionOnCommandHandlerContext(
            systemContext,
            await Session.create(
                flags.keep ? systemContext.session.getConfig() : undefined,
                flags.persist ?? systemContext.session.dir !== undefined,
            ),
        );

        context.sessionContext.agentContext.chatHistory.entries.length = 0;

        displaySuccess(
            `New session created${
                systemContext.session.dir
                    ? `: ${systemContext.session.dir}`
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
        const session = await Session.load(params.args.session);
        const systemContext = context.sessionContext.agentContext;
        await setSessionOnCommandHandlerContext(systemContext, session);
        displaySuccess(`Session opened: ${session.dir}`, context);
    }
}

class SessionResetCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Reset config on session and keep the data";
    public async run(context: ActionContext<CommandHandlerContext>) {
        await changeContextConfig(getDefaultSessionConfig(), context);
        await changeContextConfig(
            {
                translators: null,
                actions: null,
                commands: null,
            },
            context,
        );
        displaySuccess(`Session settings revert to default.`, context);
    }
}

class SessionClearCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Delete all data on the current sessions, keeping current settings";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        if (systemContext.session.dir === undefined) {
            throw new Error("Session is not persisted. Nothing to clear.");
        }

        if (
            !(await systemContext.requestIO.askYesNo(
                `Are you sure you want to clear data for current session '${systemContext.session.dir}'?`,
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
        displaySuccess(`Session cleared.`, context);
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
        const persist = systemContext.session.dir !== undefined;
        if (params.flags.all === true) {
            if (
                !(await systemContext.requestIO.askYesNo(
                    "Are you sure you want to delete all sessions?",
                    false,
                ))
            ) {
                displayWarn("Cancelled!", context);
                return;
            }
            await deleteAllSessions();
            displaySuccess("All session deleted.", context);
        } else {
            const del = params.args.session ?? systemContext.session.dir;
            if (del === undefined) {
                throw new Error(
                    "The current session is not persisted. Nothing to clear.",
                );
            }
            const sessionNames = await getSessionNames();
            if (!sessionNames.includes(del)) {
                throw new Error(`'${del}' is not a session name`);
            }
            if (
                !(await systemContext.requestIO.askYesNo(
                    `Are you sure you want to delete session '${del}'?`,
                    false,
                ))
            ) {
                displayWarn("Cancelled!", context);
                return;
            }
            await deleteSession(del);
            displaySuccess(`Session '${del}' deleted.`, context);
            if (del !== systemContext.session.dir) {
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
        const names = await getSessionNames();
        displayResult(
            names
                .map((n) =>
                    n === systemContext.session.dir ? chalk.green(n) : n,
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
        const constructionFiles = systemContext.session.dir
            ? await getSessionCaches(systemContext.session.dir)
            : [];
        displayResult((log: (message?: string) => void) => {
            log(
                `Session settings (${
                    systemContext.session.dir
                        ? chalk.green(systemContext.session.dir)
                        : "in-memory"
                }):`,
            );
            const printConfig = (options: any, prefix: number = 2) => {
                for (const [key, value] of Object.entries(options)) {
                    const name = `${" ".repeat(prefix)}${key.padEnd(
                        20 - prefix,
                    )}:`;
                    if (typeof value === "object") {
                        log(name);
                        printConfig(value, prefix + 2);
                    } else {
                        log(`${name} ${value}`);
                    }
                }
            };
            printConfig(systemContext.session.getConfig());

            if (constructionFiles.length) {
                log("\nConstruction Files:");
                for (const file of constructionFiles) {
                    log(
                        `  ${
                            file.current ? chalk.green(file.name) : file.name
                        } (${file.explainer})`,
                    );
                }
            }
        }, context);
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
            history: getToggleHandlerTable(
                "history",
                async (
                    context: ActionContext<CommandHandlerContext>,
                    enable: boolean,
                ) => {
                    const systemContext = context.sessionContext.agentContext;
                    systemContext.session.setConfig({
                        history: enable,
                    });
                },
            ),
        },
    };
}
