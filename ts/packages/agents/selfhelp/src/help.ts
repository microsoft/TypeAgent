// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The TypeAgent help grounding library. `runHelp` answers a question about
// TypeAgent itself - command lookup, capability checks, and conceptual/setup
// topics - in a single LLM call grounded on the bundled Action Browser catalog
// (commands + actions) and the overview docs. The dispatcher's built-in
// `system.help` calls this; describing a specific installed agent is handled
// separately by the dispatcher's live describeCore, so it is not here.

import { ActionContext, ActionResult } from "@typeagent/agent-sdk";
import {
    createActionResultFromError,
    createStructuredResult,
} from "@typeagent/agent-sdk/helpers/action";
import { createTypeChat } from "@typeagent/agent-runtime";
import { inferenceClient } from "@typeagent/aiclient";
import { HelpResponse, helpResponseSchemaText } from "./helpResponseSchema.js";
import {
    formatAgentRoster,
    formatGrounding,
    loadCatalogIndex,
    selectRelevantGroups,
} from "./catalog.js";
import { formatDocsGrounding, loadDocChunks, selectDocChunks } from "./docs.js";
import { renderHelp } from "./render.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:selfhelp");

const helpInstructions = [
    "You are the Help agent for TypeAgent. Answer the user's question about TypeAgent",
    "itself, using ONLY the provided capabilities (each host's @-commands and",
    "natural-language actions) and documentation excerpts.",
    "Rules:",
    "- Put a direct answer in `summary` (one to three sentences).",
    "- If the user wants to DO something and a capability matches, list the way(s) in",
    "  `ways`, most relevant first. Copy host, commandPath, and actionName EXACTLY from",
    "  the capabilities list; never invent one. When the same thing has both a command",
    "  and an action, fill BOTH on the same way.",
    "- For conceptual or setup questions (what TypeAgent is, how a feature works, what",
    "  keys/configuration are needed), answer in `summary` and use `details` for",
    "  supporting points or ordered steps, grounded in the documentation excerpts.",
    "- Omit `ways` for purely conceptual questions; omit `details` for pure command",
    "  lookups.",
    "- Never invent commands, actions, features, or settings not present in the input.",
    '- Add `seeAlso` pointers when helpful (e.g. command "help" to list all commands,',
    '  "config agent" to list agents). If nothing matches, say so in `summary`.',
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
    const chatModel = inferenceClient.createChatModel(
        undefined,
        { response_format: { type: "json_object" } },
        undefined,
        ["selfhelp"],
    );
    chatModel.completionCallback = (_params, data) => {
        const u = data?.usage;
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

// Answers any question about TypeAgent itself, returning a structured result
// (summary + optional command cards + details + pointers) and token usage.
export async function runHelp(
    question: string,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    const trimmed = question.trim();
    if (trimmed.length === 0) {
        return createActionResultFromError(
            "Ask a question about TypeAgent, e.g. 'what's the command to create a conversation?' or 'what keys do I need to run it?'",
        );
    }

    const index = loadCatalogIndex();
    const chunks = selectDocChunks(loadDocChunks(), trimmed);
    if (index === undefined && chunks.length === 0) {
        return createActionResultFromError(
            "TypeAgent help data isn't available. Try `@help` to list commands.",
        );
    }

    showStatus(context, "Looking that up…");

    // Ground on both the command catalog (for "how do I / what's the command")
    // and the docs (for concepts and setup), plus a one-line agent roster, so a
    // single answer can cover any question about TypeAgent.
    const parts: string[] = [];
    if (index !== undefined) {
        parts.push(formatGrounding(selectRelevantGroups(index, trimmed)));
    }
    if (chunks.length > 0) {
        parts.push(formatDocsGrounding(chunks));
    }
    if (index !== undefined) {
        parts.push(formatAgentRoster(index));
    }
    const grounding = parts.join("\n\n");

    const tokenUsage = newTokenUsage();
    const chat = createHelpChat<HelpResponse>(
        helpResponseSchemaText,
        "HelpResponse",
        helpInstructions,
        tokenUsage,
    );

    const response = await chat.translate(trimmed, grounding);
    if (!response.success) {
        debug(`help translate failed: ${response.message}`);
        return createActionResultFromError(
            `Sorry, I couldn't answer that right now: ${response.message}`,
        );
    }

    return {
        ...createStructuredResult(renderHelp(response.data, index)),
        tokenUsage,
    };
}
