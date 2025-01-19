// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import fs from "fs";

import {
    ActionContext,
    ActionResult,
    ActionResultSuccess,
    AppAction,
    AppAgent,
    Entity,
    ParameterDefinitions,
    ParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import {
    CommandHandler,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";

import { searchCode, QueryContext } from "./searchCode.js";
import { SpelunkerAction } from "./spelunkerSchema.js";

class RequestCommandHandler implements CommandHandler {
    public readonly description =
        "Send a natural language request to the Spelunker";
    public readonly parameters: ParameterDefinitions = {
        // Must have a single string parameter and implicit quotes
        // in order to support '@config request <agent>'
        args: {
            question: {
                description: "Request for Spelunker",
                type: "string",
                optional: false,
                implicitQuotes: true,
            },
        },
    };
    public async run(
        actionContext: ActionContext<SpelunkerContext>,
        params: ParsedCommandParams<ParameterDefinitions>,
    ): Promise<void> {
        if (typeof params.args?.question === "string") {
            const result: ActionResult = await searchCode(
                actionContext.sessionContext.agentContext,
                params.args.question,
            );
            if (typeof result.error == "string") {
                actionContext.actionIO.appendDisplay({
                    type: "text",
                    content: result.error,
                    kind: "error",
                });
            } else if (result.displayContent) {
                actionContext.actionIO.appendDisplay(result.displayContent);
            }
        }
    }
}

const handlers: CommandHandlerTable = {
    description: "Spelunker commands",
    defaultSubCommand: "request",
    commands: {
        // Command name "request" is special for '@config request <agent>'
        request: new RequestCommandHandler(),
    },
};

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeSpelunkerContext,
        updateAgentContext: updateSpelunkerContext,
        executeAction: executeSpelunkerAction,
        // TODO: What other standard functions could be handy here?
        ...getCommandInterface(handlers),
    };
}

export type SpelunkerContext = {
    focusFolders: string[];
    queryContext: QueryContext | undefined;
};

async function initializeSpelunkerContext(): Promise<SpelunkerContext> {
    return {
        focusFolders: [],
        queryContext: undefined,
    };
}

async function updateSpelunkerContext(
    enable: boolean,
    context: SessionContext<SpelunkerContext>,
    schemaName: string,
): Promise<void> {
    if (enable) {
        await loadContext(context);
    }
}

const spelunkerStorageName = "spelunker.json";

async function loadContext(
    context: SessionContext<SpelunkerContext>,
): Promise<void> {
    const storage = context.sessionStorage;
    if (storage && (await storage.exists(spelunkerStorageName))) {
        const raw = await storage.read(spelunkerStorageName, "utf8");
        const data = JSON.parse(raw);
        context.agentContext.focusFolders = data.focusFolders ?? [];
    }
}

async function saveContext(
    context: SessionContext<SpelunkerContext>,
): Promise<void> {
    const storage = context.sessionStorage;
    if (storage) {
        await storage.write(
            spelunkerStorageName,
            JSON.stringify({ focusFolders: context.agentContext.focusFolders }),
        );
    }
}

async function executeSpelunkerAction(
    action: AppAction,
    context: ActionContext<SpelunkerContext>,
): Promise<ActionResult> {
    let result = await handleSpelunkerAction(
        action as SpelunkerAction,
        context.sessionContext,
    );
    return result;
}

async function handleSpelunkerAction(
    action: SpelunkerAction,
    context: SessionContext<SpelunkerContext>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "searchCode": {
            if (
                typeof action.parameters.question == "string" &&
                action.parameters.question.trim()
            ) {
                return await searchCode(
                    context.agentContext,
                    action.parameters.question,
                );
            }
            return createActionResultFromError("I see no question to answer");
        }

        case "setFocus": {
            context.agentContext.focusFolders = [
                ...action.parameters.folders
                    .map((folder) => path.resolve(expandHome(folder)))
                    .filter(
                        (f) => fs.existsSync(f) && fs.statSync(f).isDirectory(),
                    ),
            ];
            saveContext(context);
            return focusReport(
                context.agentContext,
                "Focus cleared",
                "Focus set to",
            );
        }

        case "getFocus": {
            return focusReport(
                context.agentContext,
                "Focus is empty",
                "Focus is",
            );
        }

        default:
            // Unreachable
            throw new Error("Unsupported action name");
    }
}

function expandHome(pathname: string): string {
    if (pathname[0] != "~") return pathname;
    return process.env.HOME + pathname.substring(1);
}

function focusReport(
    spelunkerContext: SpelunkerContext,
    ifEmpty: string,
    ifSet: string,
): ActionResultSuccess {
    const literalText = spelunkerContext.focusFolders.length
        ? `${ifSet} ${spelunkerContext.focusFolders.join(", ")}`
        : ifEmpty;
    const entities = [
        ...spelunkerContext.focusFolders.map(
            (folder): Entity => ({
                name: path.basename(folder),
                type: ["folder"],
                additionalEntityText: path.dirname(folder),
                uniqueId: folder,
            }),
        ),
    ];
    return createActionResult(literalText, undefined, entities);
}
