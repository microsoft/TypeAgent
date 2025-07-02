// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    ActionContext,
    AppAgentManifest,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { executeSessionAction } from "./action/sessionActionHandler.js";
import { executeConfigAction } from "./action/configActionHandler.js";
import { CommandHandlerContext } from "../commandHandlerContext.js";
import { getConfigCommandHandlers } from "./handlers/configCommandHandlers.js";
import { getConstructionCommandHandlers } from "./handlers/constructionCommandHandlers.js";
import { DebugCommandHandler } from "./handlers/debugCommandHandlers.js";
import { getSessionCommandHandlers } from "./handlers/sessionCommandHandlers.js";
import { getHistoryCommandHandlers } from "./handlers/historyCommandHandler.js";
import { TraceCommandHandler } from "./handlers/traceCommandHandler.js";
import { getRandomCommandHandlers } from "./handlers/randomCommandHandler.js";
import { getNotifyCommandHandlers } from "./handlers/notifyCommandHandler.js";
import { DisplayCommandHandler } from "./handlers/displayCommandHandler.js";
import {
    getSystemTemplateCompletion,
    getSystemTemplateSchema,
} from "../../translation/actionTemplate.js";
import { getTokenCommandHandlers } from "./handlers/tokenCommandHandler.js";
import { getEnvCommandHandlers } from "./handlers/envCommandHandler.js";
import { executeNotificationAction } from "./action/notificationActionHandler.js";
import { executeHistoryAction } from "./action/historyActionHandler.js";
import { ConfigAction } from "./schema/configActionSchema.js";
import { NotificationAction } from "./schema/notificationActionSchema.js";
import { HistoryAction } from "./schema/historyActionSchema.js";
import { SessionAction } from "./schema/sessionActionSchema.js";
import {
    InstallCommandHandler,
    UninstallCommandHandler,
} from "./handlers/installCommandHandlers.js";
import { ActionCommandHandler } from "./handlers/actionCommandHandler.js";
import { RunCommandScriptHandler } from "./handlers/runScriptCommandHandler.js";
import { HelpCommandHandler } from "./handlers/helpCommandHandler.js";
import { OpenCommandHandler } from "./handlers/openCommandHandler.js";
import { getIndexCommandHandlers } from "./handlers/indexCommandHandler.js";
import { getMemoryCommandHandlers } from "../memory.js";

export const systemHandlers: CommandHandlerTable = {
    description: "Type Agent System Commands",
    commands: {
        action: new ActionCommandHandler(),
        session: getSessionCommandHandlers(),
        history: getHistoryCommandHandlers(),
        memory: getMemoryCommandHandlers(),
        const: getConstructionCommandHandlers(),
        config: getConfigCommandHandlers(),
        display: new DisplayCommandHandler(),
        trace: new TraceCommandHandler(),
        help: new HelpCommandHandler(),
        debug: new DebugCommandHandler(),
        clear: {
            description: "Clear the console",
            async run(context: ActionContext<CommandHandlerContext>) {
                context.sessionContext.agentContext.clientIO.clear();
            },
        },
        run: new RunCommandScriptHandler(),
        exit: {
            description: "Exit the program",
            async run(context: ActionContext<CommandHandlerContext>) {
                const systemContext = context.sessionContext.agentContext;
                systemContext.clientIO.exit();
            },
        },
        random: getRandomCommandHandlers(),
        notify: getNotifyCommandHandlers(),
        token: getTokenCommandHandlers(),
        env: getEnvCommandHandlers(),
        install: new InstallCommandHandler(),
        uninstall: new UninstallCommandHandler(),
        open: new OpenCommandHandler(),
        index: getIndexCommandHandlers(),
    },
};

function executeSystemAction(
    action:
        | TypeAgentAction<SessionAction, "system.session">
        | TypeAgentAction<ConfigAction, "system.config">
        | TypeAgentAction<NotificationAction, "system.notify">
        | TypeAgentAction<HistoryAction, "system.history">,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.schemaName) {
        case "system.session":
            return executeSessionAction(action, context);
        case "system.config":
            return executeConfigAction(action, context);
        case "system.notify":
            return executeNotificationAction(action, context);
        case "system.history":
            return executeHistoryAction(action, context);
        default:
            throw new Error(
                `Invalid system sub-translator: ${(action as TypeAgentAction).schemaName}`,
            );
    }
}

export const systemManifest: AppAgentManifest = {
    emojiChar: "🔧",
    description: "Built-in agent to manage system configuration and sessions",
    subActionManifests: {
        config: {
            schema: {
                description:
                    "System agent that helps you manage system settings and preferences.",
                schemaFile: "./src/context/system/schema/configActionSchema.ts",
                schemaType: "ConfigAction",
            },
        },
        session: {
            schema: {
                description: "System agent that helps you manage your session.",
                schemaFile:
                    "./src/context/system/schema/sessionActionSchema.ts",
                schemaType: "SessionAction",
            },
        },
        notify: {
            schema: {
                description: "System agent that helps manage notifications.",
                schemaFile:
                    "./src/context/system/schema/notificationActionSchema.ts",
                schemaType: "NotificationAction",
            },
        },
        history: {
            schema: {
                description: "System agent that helps manage chat history.",
                schemaFile:
                    "./src/context/system/schema/historyActionSchema.ts",
                schemaType: "HistoryAction",
            },
        },
    },
};

export const systemAgent: AppAgent = {
    getTemplateSchema: getSystemTemplateSchema,
    getTemplateCompletion: getSystemTemplateCompletion,
    executeAction: executeSystemAction,
    ...getCommandInterface(systemHandlers),
};
