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
import { parseCommandArgs } from "../utils/args.js";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/commands";
import { ActionContext } from "@typeagent/agent-sdk";
import {
    displayResult,
    displaySuccess,
    displayWarn,
} from "./common/interactiveIO.js";

class SessionNewCommandHandler implements CommandHandler {
    public readonly description = "Create a new empty session";
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { flags } = parseCommandArgs(
            request,
            {
                keep: false,
                memory: false,
                persist: systemContext.session.dir !== undefined,
            },
            true,
        );
        await setSessionOnCommandHandlerContext(
            systemContext,
            await Session.create(
                flags.keep
                    ? systemContext.session.getConfig()
                    : getDefaultSessionConfig(),
                flags.persist,
            ),
        );
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
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const session = await Session.load(request);
        const systemContext = context.sessionContext.agentContext;
        await setSessionOnCommandHandlerContext(systemContext, session);
        displaySuccess(`Session opened: ${session.dir}`, context);
    }
}

class SessionResetCommandHandler implements CommandHandler {
    public readonly description = "Reset config on session and keep the data";
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        await changeContextConfig(getDefaultSessionConfig(), context);
        displaySuccess(`Session settings revert to default.`, context);
    }
}

class SessionToggleHistoryCommandHandler implements CommandHandler {
    public readonly description = "Update the history on the session config";
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        systemContext.session.setConfig({ history: request === "on" });
        displaySuccess(`Session history flag updated.`, context);
    }
}

class SessionClearCommandHandler implements CommandHandler {
    public readonly description =
        "Delete all data on the current sessions, keeping current settings";
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
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
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const persist = systemContext.session.dir !== undefined;
        if (request === "-a") {
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
        } else {
            const del = request !== "" ? request : systemContext.session.dir;
            if (del === undefined) {
                throw new Error("Session is not persisted. Nothing to clear.");
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
            if (del !== systemContext.session.dir) {
                return;
            }
        }
        await reloadSessionOnCommandHandlerContext(systemContext, persist);
    }
}

class SessionListCommandHandler implements CommandHandler {
    public readonly description =
        "List all sessions. The current session is marked green.";
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
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

class SessionInfoCommandHandler implements CommandHandler {
    public readonly description = "Show info about the current session";
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
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
        defaultSubCommand: undefined,
        commands: {
            new: new SessionNewCommandHandler(),
            open: new SessionOpenCommandHandler(),
            reset: new SessionResetCommandHandler(),
            clear: new SessionClearCommandHandler(),
            list: new SessionListCommandHandler(),
            delete: new SessionDeleteCommandHandler(),
            info: new SessionInfoCommandHandler(),
            history: new SessionToggleHistoryCommandHandler(),
        },
    };
}
