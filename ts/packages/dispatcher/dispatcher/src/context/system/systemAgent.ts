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
import { executeConversationAction } from "./action/conversationActionHandler.js";
import { executeConfigAction } from "./action/configActionHandler.js";
import {
    type CommandHandlerContext,
    getRequestId,
} from "../commandHandlerContext.js";

import {
    getSystemTemplateCompletion,
    getSystemTemplateSchema,
} from "../../translation/actionTemplate.js";

import { executeNotificationAction } from "./action/notificationActionHandler.js";
import { executeHistoryAction } from "./action/historyActionHandler.js";
import { executeGrammarAction } from "./action/grammarActionHandler.js";
import { executeSettingsAction } from "./action/settingsActionHandler.js";
import { ConfigAction } from "./schema/configActionSchema.js";
import { NotificationAction } from "./schema/notificationActionSchema.js";
import { HistoryAction } from "./schema/historyActionSchema.js";
import { ConversationAction } from "./schema/conversationActionSchema.js";
import { GrammarAction } from "./schema/grammarActionSchema.js";
import { UserSettingsAction } from "./schema/settingsActionSchema.js";

// handlers
import { getConfigCommandHandlers } from "./handlers/configCommandHandlers.js";
import { getConstructionCommandHandlers } from "./handlers/constructionCommandHandlers.js";
import { DebugCommandHandler } from "./handlers/debugCommandHandlers.js";
import { getSessionCommandHandlers } from "./handlers/sessionCommandHandlers.js";
import { getHistoryCommandHandlers } from "./handlers/historyCommandHandler.js";
import { TraceCommandHandler } from "./handlers/traceCommandHandler.js";
import { getRandomCommandHandlers } from "./handlers/randomCommandHandler.js";
import { getNotifyCommandHandlers } from "./handlers/notifyCommandHandler.js";
import { DisplayCommandHandler } from "./handlers/displayCommandHandler.js";
import { getTokenCommandHandlers } from "./handlers/tokenCommandHandler.js";
import { getEnvCommandHandlers } from "./handlers/envCommandHandler.js";
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
import { getSettingsCommandHandlers } from "./handlers/settingsCommandHandlers.js";

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
                const systemContext = context.sessionContext.agentContext;
                systemContext.clientIO.clear(getRequestId(systemContext));
            },
        },
        run: new RunCommandScriptHandler(),
        exit: {
            description: "Exit the program",
            async run(context: ActionContext<CommandHandlerContext>) {
                const systemContext = context.sessionContext.agentContext;
                systemContext.clientIO.exit(getRequestId(systemContext));
            },
        },
        shutdown: {
            description: "Shut down the agent server and exit",
            async run(context: ActionContext<CommandHandlerContext>) {
                const systemContext = context.sessionContext.agentContext;
                systemContext.clientIO.shutdown(getRequestId(systemContext));
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
        settings: getSettingsCommandHandlers(),
    },
};

function executeSystemAction(
    action:
        | TypeAgentAction<ConversationAction, "system.conversation">
        | TypeAgentAction<ConfigAction, "system.config">
        | TypeAgentAction<NotificationAction, "system.notify">
        | TypeAgentAction<HistoryAction, "system.history">
        | TypeAgentAction<GrammarAction, "system.grammar">
        | TypeAgentAction<UserSettingsAction, "system.settings">,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.schemaName) {
        case "system.conversation":
            return executeConversationAction(action, context);
        case "system.config":
            return executeConfigAction(action, context);
        case "system.notify":
            return executeNotificationAction(action, context);
        case "system.history":
            return executeHistoryAction(action, context);
        case "system.grammar":
            return executeGrammarAction(action, context);
        case "system.settings":
            return executeSettingsAction(action, context);
        default:
            throw new Error(
                `Invalid system sub-translator: ${(action as TypeAgentAction).schemaName}`,
            );
    }
}

export const systemManifest: AppAgentManifest = {
    emojiChar: "🔧",
    description:
        "Built-in agent to manage system configuration and conversations",
    subActionManifests: {
        config: {
            schema: {
                description:
                    "System agent that helps you manage system settings and preferences.",
                schemaFile: "./src/context/system/schema/configActionSchema.ts",
                schemaType: "ConfigAction",
            },
        },
        conversation: {
            schema: {
                description:
                    "System agent that manages conversations. " +
                    "Use this agent when the user wants to: " +
                    "CREATE a new conversation (e.g. 'create a new conversation', 'start a new conversation called test', 'new conversation named work', 'open a new conversation test'), " +
                    "LIST conversations (e.g. 'list our conversations', 'show all conversations', 'what conversations do I have'), " +
                    "SWITCH to an existing conversation (e.g. 'switch to conversation test', 'go to my work conversation', 'switch to test'), " +
                    "DELETE a conversation (e.g. 'delete conversation test', 'remove the work conversation'), " +
                    "RENAME the current conversation, " +
                    "or SHOW info about the current conversation.",
                schemaFile:
                    "./src/context/system/schema/conversationActionSchema.ts",
                schemaType: "ConversationAction",
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
        grammar: {
            schema: {
                description:
                    "Manage dynamic grammar rules learned from user interactions. " +
                    "List all rules or filter by agent (e.g. 'show grammar rules for calendar', " +
                    "'list player grammar rules'). Show rule details or delete individual rules by ID " +
                    "('show grammar rule 3', 'delete grammar rule 5'). Clear all rules or rules for " +
                    "one agent ('clear calendar grammar rules').",
                schemaFile:
                    "./src/context/system/schema/grammarActionSchema.ts",
                schemaType: "GrammarAction",
            },
        },
        settings: {
            schema: {
                description:
                    "Manage persistent user settings for the TypeAgent system. " +
                    "Set whether the agent server starts hidden in the background (e.g. 'start the server hidden', 'run the server in the background', 'show the server window'). " +
                    "Set the idle timeout for the agent server (e.g. 'shut down the server after 5 minutes of inactivity', 'set idle timeout to 300 seconds', 'disable idle timeout'). " +
                    "Set whether to resume the last conversation on startup (e.g. 'always resume my last conversation', 'pick up where I left off', 'start fresh each time').",
                schemaFile:
                    "./src/context/system/schema/settingsActionSchema.ts",
                schemaType: "UserSettingsAction",
            },
        },
    },
};

const commandInterface = getCommandInterface(systemHandlers);

export const systemAgent: AppAgent = {
    getTemplateSchema: getSystemTemplateSchema,
    getTemplateCompletion: getSystemTemplateCompletion,
    executeAction: executeSystemAction as unknown as AppAgent["executeAction"],
    getCommands: commandInterface.getCommands,
    getCommandCompletion: commandInterface.getCommandCompletion,
    executeCommand: commandInterface.executeCommand,
} as AppAgent;
