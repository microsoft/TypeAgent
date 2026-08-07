// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    AppAgent,
    ParsedCommandParams,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromError,
    createStructuredResult,
} from "@typeagent/agent-sdk/helpers/action";
import {
    CommandHandler,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { createTypeChat } from "@typeagent/agent-runtime";
import { openai } from "@typeagent/aiclient";
import { SelfHelpAction } from "./selfHelpSchema.js";
import {
    CommandHelpResponse,
    commandHelpResponseSchemaText,
} from "./commandHelpResponseSchema.js";
import {
    formatGrounding,
    loadCatalogIndex,
    selectRelevantGroups,
} from "./catalog.js";
import { renderStructured } from "./render.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:selfhelp");

export function instantiate(): AppAgent {
    return {
        executeAction,
        ...getCommandInterface(handlers),
    };
}

const answerInstructions = [
    "You are the Help agent for TypeAgent. The user wants to know how to do something",
    'in TypeAgent - usually "what\'s the command for X" or "how do I X".',
    "You are given a list of available capabilities: each host's @-commands and the",
    "equivalent natural-language actions. Identify the capability or capabilities that",
    "satisfy the request and return them.",
    "Rules:",
    "- Use ONLY hosts, commandPath values, and actionName values that appear in the",
    "  list. Never invent a command, path, host, or action.",
    "- When the same thing can be done by a command AND a natural-language action, fill",
    "  BOTH commandPath and actionName on the same way so the user sees both options.",
    "- Order ways from most to least relevant.",
    "- If nothing in the list matches, return an empty ways array and use summary to say",
    "  so, suggesting the user run @help.",
    "- Keep summary to one or two sentences.",
].join("\n");

type TokenUsage = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
};

async function answerCommandQuestion(
    question: string,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    const trimmed = question.trim();
    if (trimmed.length === 0) {
        return createActionResultFromError(
            "Ask what you want to do in TypeAgent, e.g. 'what's the command to create a new conversation?'",
        );
    }

    const index = loadCatalogIndex();
    if (index === undefined) {
        return createActionResultFromError(
            "The TypeAgent command catalog isn't available. Try `@help` to list commands.",
        );
    }

    // Let the user know work is happening while the model responds; cleared
    // automatically when the final result is emitted.
    context.actionIO.appendDisplay(
        { type: "text", content: "Looking that up…", kind: "status" },
        "temporary",
    );

    const grounding = formatGrounding(selectRelevantGroups(index, trimmed));

    const tokenUsage: TokenUsage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
    };
    const chatModel = openai.createChatModel(
        undefined,
        { response_format: { type: "json_object" } },
        undefined,
        ["selfhelp"],
    );
    chatModel.completionCallback = (_params, data) => {
        const usage = data?.usage;
        if (usage) {
            tokenUsage.prompt_tokens += usage.prompt_tokens ?? 0;
            tokenUsage.completion_tokens += usage.completion_tokens ?? 0;
            tokenUsage.total_tokens += usage.total_tokens ?? 0;
        }
    };

    // maxPromptLength is large so the grounding preamble is never trimmed; there
    // is no chat history to window.
    const chat = createTypeChat<CommandHelpResponse>(
        chatModel,
        commandHelpResponseSchemaText,
        "CommandHelpResponse",
        answerInstructions,
        [],
        1_000_000,
        30,
    );

    const response = await chat.translate(trimmed, grounding);
    if (!response.success) {
        debug(`translate failed: ${response.message}`);
        return createActionResultFromError(
            `Sorry, I couldn't answer that right now: ${response.message}`,
        );
    }

    return {
        ...createStructuredResult(renderStructured(response.data, index)),
        tokenUsage,
    };
}

async function executeAction(
    action: TypeAgentAction<SelfHelpAction>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "answerTypeAgentQuestion":
            return answerCommandQuestion(action.parameters.question, context);
        default:
            throw new Error(
                `Unknown SelfHelp action: ${(action as TypeAgentAction).actionName}`,
            );
    }
}

class AskCommandHandler implements CommandHandler {
    public readonly description =
        "Find the TypeAgent command for what you want to do (e.g. 'create a new conversation').";
    public readonly action = "answerTypeAgentQuestion";
    public readonly parameters = {
        args: {
            question: {
                description: "What you want to do in TypeAgent.",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<ActionResult> {
        return answerCommandQuestion(params.args.question, context);
    }
}

const askHandler = new AskCommandHandler();
const handlers: CommandHandlerTable = {
    description: "Find the TypeAgent command for what you want to do",
    defaultSubCommand: askHandler,
    commands: {
        ask: askHandler,
    },
};
