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
    ExplainResponse,
    explainResponseSchemaText,
} from "./explainResponseSchema.js";
import {
    // TODO(describeAgent): findAgent and groupForAgent back the disabled
    // describeAgent action (see selfHelpSchema.ts). They stay exported and
    // tested for a future pass that may combine this with the built-in describe.
    // findAgent,
    formatAgentRoster,
    formatGrounding,
    // groupForAgent,
    loadCatalogIndex,
    selectRelevantGroups,
} from "./catalog.js";
import { formatDocsGrounding, loadDocChunks, selectDocChunks } from "./docs.js";
import { renderExplain, renderStructured } from "./render.js";
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
    'in TypeAgent - usually "what\'s the command for X", "how do I X", or "can I X".',
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
    "  so - i.e. TypeAgent does not support that - suggesting the user run @help.",
    "- Keep summary to one or two sentences.",
].join("\n");

// TODO(describeAgent): disabled along with the describeAgent action; see the
// TODO in selfHelpSchema.ts.
/*
const describeInstructions = [
    "You are the Help agent for TypeAgent. The user wants to know what a specific",
    "application agent can do. You are given that agent's capabilities: its @-commands",
    "and its equivalent natural-language actions.",
    "Rules:",
    "- In summary, say in one or two sentences what this agent is for.",
    "- List the agent's capabilities in `ways`, most useful first, each with a short",
    "  `does`. Use ONLY hosts, commandPath values, and actionName values from the list;",
    "  never invent one. Pair a command with its action on the same way when both exist.",
    "- If the user asked whether the agent can do a specific thing, answer that directly",
    "  in summary (yes or no) and include the matching capability in `ways` if it exists.",
    "- If the capability list is empty, return an empty ways array and say in summary that",
    "  the agent has no described actions.",
].join("\n");
*/

const explainInstructions = [
    "You are the Help agent for TypeAgent. Answer the user's conceptual or setup",
    "question about TypeAgent using ONLY the documentation excerpts provided.",
    "Rules:",
    "- Answer directly in `summary` (one to three sentences).",
    "- Use `details` only for supporting points or ordered setup steps that add value",
    "  beyond the summary; otherwise omit it.",
    "- Do not invent features, commands, or settings that are not in the excerpts.",
    "- If the excerpts do not answer the question, say so in `summary` and suggest @help.",
    "- When relevant, add `seeAlso` pointers such as listing all commands (command",
    '  "help") or the configured agents (command "config agent").',
].join("\n");

type TokenUsage = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
};

function newTokenUsage(): TokenUsage {
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

// Creates a TypeChat translator over a JSON-returning chat model, accumulating
// token usage into the passed object. maxPromptLength is large so the grounding
// preamble is never trimmed; there is no chat history to window.
function createHelpChat<T extends object>(
    schemaText: string,
    typeName: string,
    instructions: string,
    usage: TokenUsage,
) {
    const chatModel = openai.createChatModel(
        undefined,
        { response_format: { type: "json_object" } },
        undefined,
        ["selfhelp"],
    );
    chatModel.completionCallback = (_params, data) => {
        const u = (data as any)?.usage;
        if (u) {
            usage.prompt_tokens += u.prompt_tokens ?? 0;
            usage.completion_tokens += u.completion_tokens ?? 0;
            usage.total_tokens += u.total_tokens ?? 0;
        }
    };
    return createTypeChat<T>(
        chatModel,
        schemaText,
        typeName,
        instructions,
        [],
        1_000_000,
        30,
    );
}

// Lets the user know work is happening while the model responds; cleared
// automatically when the final result is emitted.
function showStatus(context: ActionContext<unknown>, message: string): void {
    context.actionIO.appendDisplay(
        { type: "text", content: message, kind: "status" },
        "temporary",
    );
}

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

    showStatus(context, "Looking that up…");

    const grounding = formatGrounding(selectRelevantGroups(index, trimmed));

    const tokenUsage = newTokenUsage();
    const chat = createHelpChat<CommandHelpResponse>(
        commandHelpResponseSchemaText,
        "CommandHelpResponse",
        answerInstructions,
        tokenUsage,
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

async function answerExplainQuestion(
    question: string,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    const trimmed = question.trim();
    if (trimmed.length === 0) {
        return createActionResultFromError(
            "Ask a question about TypeAgent, e.g. 'what is TypeAgent?' or 'how do I set it up?'",
        );
    }

    const chunks = selectDocChunks(loadDocChunks(), trimmed);
    if (chunks.length === 0) {
        return createActionResultFromError(
            "The TypeAgent documentation isn't available. Try `@help` to list commands.",
        );
    }

    showStatus(context, "Looking that up…");

    // Append a one-line agent roster so "what can TypeAgent do" gets concrete
    // examples without bundling every agent's docs.
    let grounding = formatDocsGrounding(chunks);
    const index = loadCatalogIndex();
    if (index !== undefined) {
        grounding += `\n\n${formatAgentRoster(index)}`;
    }

    const tokenUsage = newTokenUsage();
    const chat = createHelpChat<ExplainResponse>(
        explainResponseSchemaText,
        "ExplainResponse",
        explainInstructions,
        tokenUsage,
    );

    const response = await chat.translate(trimmed, grounding);
    if (!response.success) {
        debug(`explain translate failed: ${response.message}`);
        return createActionResultFromError(
            `Sorry, I couldn't answer that right now: ${response.message}`,
        );
    }

    return {
        ...createStructuredResult(renderExplain(response.data)),
        tokenUsage,
    };
}

// TODO(describeAgent): disabled - overlaps the built-in
// system.describe.describeAgent. Kept for a future pass that may combine the
// two. See the TODO in selfHelpSchema.ts.
/*
async function answerDescribeAgent(
    question: string,
    agentName: string | undefined,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    const trimmed = question.trim();
    if (trimmed.length === 0 && !agentName) {
        return createActionResultFromError(
            "Name an agent to describe, e.g. 'what can the browser agent do?'",
        );
    }

    const index = loadCatalogIndex();
    if (index === undefined) {
        return createActionResultFromError(
            "The TypeAgent command catalog isn't available. Try `@help` to list commands.",
        );
    }

    const agent = findAgent(index, trimmed, agentName);
    if (agent === undefined) {
        return createStructuredResult([
            {
                kind: "text",
                text: 'I couldn\'t tell which agent you mean. Run `@config agent` to list the installed agents, or name one - e.g. "what can the browser agent do?".',
            },
        ]);
    }

    showStatus(context, `Looking up the ${agent.name} agent…`);

    const grounding = formatGrounding([groupForAgent(index, agent)]);

    const tokenUsage = newTokenUsage();
    const chat = createHelpChat<CommandHelpResponse>(
        commandHelpResponseSchemaText,
        "CommandHelpResponse",
        describeInstructions,
        tokenUsage,
    );

    const response = await chat.translate(trimmed || agent.name, grounding);
    if (!response.success) {
        debug(`describe translate failed: ${response.message}`);
        return createActionResultFromError(
            `Sorry, I couldn't answer that right now: ${response.message}`,
        );
    }

    return {
        ...createStructuredResult(renderStructured(response.data, index)),
        tokenUsage,
    };
}
*/

async function executeAction(
    action: TypeAgentAction<SelfHelpAction>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "answerTypeAgentQuestion":
            return answerCommandQuestion(action.parameters.question, context);
        case "explainTypeAgent":
            return answerExplainQuestion(action.parameters.question, context);
        // TODO(describeAgent): disabled - see selfHelpSchema.ts.
        // case "describeAgent":
        //     return answerDescribeAgent(
        //         action.parameters.question,
        //         action.parameters.agent,
        //         context,
        //     );
        default:
            throw new Error(
                `Unknown SelfHelp action: ${(action as TypeAgentAction).actionName}`,
            );
    }
}

class AskCommandHandler implements CommandHandler {
    public readonly description =
        "Find the TypeAgent command for what you want to do (e.g. 'create a new conversation').";
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

class AboutCommandHandler implements CommandHandler {
    public readonly description =
        "Explain TypeAgent itself - what it is, what it can do, or how to set it up.";
    public readonly parameters = {
        args: {
            question: {
                description: "Your question about TypeAgent.",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<ActionResult> {
        return answerExplainQuestion(params.args.question, context);
    }
}

// TODO(describeAgent): disabled - overlaps the built-in
// system.describe.describeAgent. See the TODO in selfHelpSchema.ts.
/*
class AgentCommandHandler implements CommandHandler {
    public readonly description =
        "Describe what a specific agent can do (e.g. 'browser' or 'what can the list agent do').";
    public readonly parameters = {
        args: {
            query: {
                description: "The agent name or your question about it.",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<ActionResult> {
        return answerDescribeAgent(params.args.query, undefined, context);
    }
}
*/

const askHandler = new AskCommandHandler();
const handlers: CommandHandlerTable = {
    description: "Ask about TypeAgent - commands and concepts",
    defaultSubCommand: askHandler,
    commands: {
        ask: askHandler,
        about: new AboutCommandHandler(),
        // TODO(describeAgent): disabled - see selfHelpSchema.ts.
        // agent: new AgentCommandHandler(),
    },
};
