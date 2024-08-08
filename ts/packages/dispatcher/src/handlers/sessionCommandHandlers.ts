// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandlerContext,
    reloadSessionOnCommandHandlerContext,
} from "./common/commandHandlerContext.js";
import { CommandHandler, HandlerTable } from "./common/commandHandler.js";
import { setSessionOnCommandHandlerContext } from "./common/commandHandlerContext.js";
import {
    Session,
    deleteAllSessions,
    deleteSession,
    getSessionNames,
    defaultSessionConfig,
    getSessionCaches,
} from "../session/session.js";
import chalk from "chalk";
import { parseRequestArgs } from "../utils/args.js";

class SessionNewCommandHandler implements CommandHandler {
    public readonly description = "Create a new empty session";
    public async run(request: string, context: CommandHandlerContext) {
        const { flags } = parseRequestArgs(
            request,
            {
                keep: false,
                memory: false,
                persist: context.session.dir !== undefined,
            },
            true,
        );
        await setSessionOnCommandHandlerContext(
            context,
            await Session.create(
                flags.keep ? context.session.getConfig() : defaultSessionConfig,
                flags.persist,
            ),
        );
        context.requestIO.success(
            `New session created${
                context.session.dir ? `: ${context.session.dir}` : ""
            }`,
        );
    }
}

class SessionOpenCommandHandler implements CommandHandler {
    public readonly description = "Open an existing session";
    public async run(request: string, context: CommandHandlerContext) {
        const session = await Session.load(request);
        await setSessionOnCommandHandlerContext(context, session);
        context.requestIO.success(`Session opened: ${session.dir}`);
    }
}

class SessionResetCommandHandler implements CommandHandler {
    public readonly description = "Reset config on session and keep the data";
    public async run(request: string, context: CommandHandlerContext) {
        context.session.setConfig(defaultSessionConfig);
        context.requestIO.success(`Session resetted.`);
    }
}

class SessionToggleHistoryCommandHandler implements CommandHandler {
    public readonly description = "Update the history on the session config";
    public async run(request: string, context: CommandHandlerContext) {
        context.session.setConfig({ history: request === "on" });
        context.requestIO.success(`Session history flag updated.`);
    }
}

class SessionClearCommandHandler implements CommandHandler {
    public readonly description =
        "Delete all data on the current sessions, keeping current settings";
    public async run(request: string, context: CommandHandlerContext) {
        if (context.session.dir === undefined) {
            throw new Error("Session is not persisted. Nothing to clear.");
        }

        if (
            !(await context.requestIO.askYesNo(
                `Are you sure you want to clear data for current session '${context.session.dir}'?`,
                false,
            ))
        ) {
            context.requestIO.error("Cancelled!");
            return;
        }
        await context.session.clear();
        // Force a reinitialize of the context
        await setSessionOnCommandHandlerContext(context, context.session);
        context.requestIO.success(`Session cleared.`);
    }
}

class SessionDeleteCommandHandler implements CommandHandler {
    public readonly description =
        "Delete a session. If no session is specified, delete the current session and start a new session.\n-a to delete all sessions";
    public async run(request: string, context: CommandHandlerContext) {
        const persist = context.session.dir !== undefined;
        if (request === "-a") {
            if (
                !(await context.requestIO.askYesNo(
                    "Are you sure you want to delete all sessions?",
                    false,
                ))
            ) {
                context.requestIO.error("Cancelled!");
                return;
            }
            await deleteAllSessions();
        } else {
            const del = request !== "" ? request : context.session.dir;
            if (del === undefined) {
                throw new Error("Session is not persisted. Nothing to clear.");
            }
            if (
                !(await context.requestIO.askYesNo(
                    `Are you sure you want to delete session '${del}'?`,
                    false,
                ))
            ) {
                context.requestIO.error("Cancelled!");
                return;
            }
            await deleteSession(del);
            if (del !== context.session.dir) {
                return;
            }
        }
        await reloadSessionOnCommandHandlerContext(context, persist);
    }
}

class SessionListCommandHandler implements CommandHandler {
    public readonly description =
        "List all sessions. The current session is marked green.";
    public async run(request: string, context: CommandHandlerContext) {
        const names = await getSessionNames();
        context.requestIO.result(
            names
                .map((n) => (n === context.session.dir ? chalk.green(n) : n))
                .join("\n"),
        );
    }
}

class SessionInfoCommandHandler implements CommandHandler {
    public readonly description = "Show info about the current session";
    public async run(request: string, context: CommandHandlerContext) {
        const constructionFiles = context.session.dir
            ? await getSessionCaches(context.session.dir)
            : [];
        context.requestIO.result((log: (message?: string) => void) => {
            log(
                `Session settings (${
                    context.session.dir
                        ? chalk.green(context.session.dir)
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
            printConfig(context.session.getConfig());

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
        });
    }
}

export function getSessionCommandHandlers(): HandlerTable {
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
            history: new SessionToggleHistoryCommandHandler(),
        },
    };
}
