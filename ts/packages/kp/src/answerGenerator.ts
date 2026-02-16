// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Answer Generator (RAG step)
 *
 * Takes scored chunks from the query engine + the user's original question,
 * packs chunks into a prompt up to a character budget, and asks the LLM
 * to produce a grounded natural-language answer.
 *
 * Tries aiclient OpenAI first (direct API, no subprocess).
 * Falls back to Claude Agent SDK query() if aiclient is not available.
 */

import { openai, ChatModel } from "aiclient";
import { PromptSection } from "typechat";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ScoredChunkResult, SearchResult } from "./types.js";

import registerDebug from "debug";
const debug = registerDebug("kp:answer");

/** Default character budget for the evidence block in the prompt. */
const DEFAULT_CHAR_BUDGET = 12_000;
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/** Lazy singleton chat model for answer generation. */
let answerModel: ChatModel | undefined;
let answerModelAvailable: boolean | undefined;

function getAnswerModel(): ChatModel | undefined {
    if (answerModelAvailable === false) return undefined;
    if (answerModel) return answerModel;

    try {
        const settings = openai.getChatModelSettings("GPT_5_MINI");
        settings.timeout = 120_000;
        answerModel = openai.createChatModel(settings);
        answerModel.completionSettings.max_completion_tokens = 4096;
        delete (answerModel.completionSettings as any).temperature;
        answerModelAvailable = true;
        debug("aiclient answer model created (GPT_5_MINI)");
        return answerModel;
    } catch (e) {
        debug("aiclient answer model not available: %s", e);
        answerModelAvailable = false;
        return undefined;
    }
}

export interface AnswerGeneratorConfig {
    model?: string;
    /** Max characters of chunk text to include in the prompt. */
    charBudget?: number;
    /** When true, instruct the LLM to produce HTML-formatted answers. */
    htmlOutput?: boolean;
}

export interface AnswerContext {
    /** The user's original natural language question. */
    userQuery: string;
    /** Search results from QueryEngine.execute(). */
    searchResult: SearchResult;
    /**
     * Callback to fetch full chunk text + metadata by chunkId.
     * The answer generator calls this for the top chunks until
     * the budget is exhausted.
     */
    getChunk: (chunkId: number) => ChunkContent | undefined;
    /** Display name of the logged-in user (for personalized answers). */
    userName?: string;
}

export interface ChunkContent {
    text: string;
    metadata?: Record<string, string[]>;
    groupId?: string;
    timestamp?: string;
}

export interface AnswerResult {
    /** The LLM-generated answer grounded in the retrieved chunks. */
    answer: string;
    /** How many chunks were packed into the prompt. */
    chunksUsed: number;
    /** Total characters of evidence included. */
    charsUsed: number;
}

/**
 * Generate a grounded answer from search results.
 *
 * Walks the ranked chunks top-down, fetching full text via getChunk(),
 * accumulating until the character budget is hit, then calls the LLM.
 */
export async function generateAnswer(
    ctx: AnswerContext,
    config?: AnswerGeneratorConfig,
): Promise<AnswerResult> {
    const agentModel = config?.model ?? DEFAULT_MODEL;
    const charBudget = config?.charBudget ?? DEFAULT_CHAR_BUDGET;

    // Pack chunks into evidence block up to budget
    const evidenceParts: string[] = [];
    let charsUsed = 0;
    let chunksUsed = 0;

    for (const scored of ctx.searchResult.chunks) {
        const chunk = ctx.getChunk(scored.chunkId);
        if (!chunk) continue;

        const block = formatChunkEvidence(scored, chunk);
        if (charsUsed + block.length > charBudget && chunksUsed > 0) {
            break; // budget exhausted, but always include at least one
        }

        evidenceParts.push(block);
        charsUsed += block.length;
        chunksUsed++;
    }

    if (chunksUsed === 0) {
        return {
            answer: "No relevant content found to answer this question.",
            chunksUsed: 0,
            charsUsed: 0,
        };
    }

    debug(
        "Generating answer: %d chunks, %d chars, query=%s",
        chunksUsed,
        charsUsed,
        ctx.userQuery,
    );

    const evidence = evidenceParts.join("\n---\n");
    const userPrompt = `<evidence>\n${evidence}\n</evidence>\n\nUser question: "${ctx.userQuery}"`;

    // Build system prompt, injecting user identity when available
    let systemPrompt = ANSWER_SYSTEM_PROMPT;
    if (ctx.userName) {
        systemPrompt += `\n\nThe user's name is "${ctx.userName}". When referring to them, use "you" or their name. Emails sent from or to this person are the user's own emails.`;
    }
    if (config?.htmlOutput) {
        systemPrompt += ANSWER_HTML_SUFFIX;
    }

    // Try aiclient first, fall back to agent SDK
    const model = getAnswerModel();
    let responseText: string;
    if (model) {
        try {
            responseText = await callLLMOpenAI(model, systemPrompt, userPrompt);
        } catch (e: any) {
            debug(
                "aiclient answer failed, falling back to agent SDK: %s",
                e?.message,
            );
            answerModelAvailable = false;
            answerModel = undefined;
            responseText = await callLLMAgentSdk(
                `${systemPrompt}\n\n${userPrompt}`,
                agentModel,
            );
        }
    } else {
        responseText = await callLLMAgentSdk(
            `${systemPrompt}\n\n${userPrompt}`,
            agentModel,
        );
    }

    if (!responseText) {
        responseText =
            "Unable to generate an answer from the retrieved content.";
    }

    return {
        answer: responseText.trim(),
        chunksUsed,
        charsUsed,
    };
}

/**
 * Call the LLM via aiclient OpenAI chat model.
 */
async function callLLMOpenAI(
    model: ChatModel,
    systemPrompt: string,
    userPrompt: string,
): Promise<string> {
    const messages: PromptSection[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
    ];
    const result = await model.complete(messages);
    if (!result.success) {
        throw new Error(result.message);
    }
    return result.data;
}

/**
 * Call the LLM via the agent SDK query() API (fallback).
 */
async function callLLMAgentSdk(
    prompt: string,
    modelName: string,
): Promise<string> {
    const queryInstance = query({
        prompt,
        options: { model: modelName },
    });

    let responseText = "";
    for await (const message of queryInstance) {
        if (message.type === "result") {
            if (message.subtype === "success") {
                responseText = message.result || "";
                break;
            }
        }
    }
    return responseText;
}

/**
 * Format a single chunk as an evidence block for the prompt.
 * Includes metadata headers (sender, date, subject) before the body.
 */
function formatChunkEvidence(
    scored: ScoredChunkResult,
    chunk: ChunkContent,
): string {
    const parts: string[] = [];

    // Add metadata if available
    if (chunk.metadata) {
        if (chunk.metadata.sender) {
            parts.push(`From: ${chunk.metadata.sender.join(", ")}`);
        }
        if (chunk.metadata.recipient) {
            parts.push(`To: ${chunk.metadata.recipient.join(", ")}`);
        }
        if (chunk.metadata.subject) {
            parts.push(`Subject: ${chunk.metadata.subject.join(", ")}`);
        }
        if (chunk.metadata.webLink) {
            parts.push(`Link: ${chunk.metadata.webLink[0]}`);
        }
    }
    if (chunk.timestamp) {
        parts.push(`Date: ${chunk.timestamp}`);
    }

    // If the chunk text already has From:/To:/Subject: headers, just use it as-is
    // (the email bridge formats text this way). Avoid duplicating headers.
    const textAlreadyHasHeaders = chunk.text.startsWith("From:");
    if (textAlreadyHasHeaders) {
        return `[Chunk ${scored.chunkId}, score=${scored.score.toFixed(1)}]\n${chunk.text}`;
    }

    if (parts.length > 0) {
        parts.push("");
    }
    parts.push(chunk.text);

    return `[Chunk ${scored.chunkId}, score=${scored.score.toFixed(1)}]\n${parts.join("\n")}`;
}

// =========================================================================
// Answer Prompt
// =========================================================================

const ANSWER_SYSTEM_PROMPT = `You are an assistant answering questions based on retrieved email content. The evidence below contains email messages ranked by relevance.

Rules:
1. Answer the user's question using ONLY the information in the evidence. Do not make up facts.
2. If the evidence doesn't contain enough information, say so clearly.
3. Quote or cite specific emails when relevant (by sender, date, or subject).
4. Be concise but thorough. Match the answer style to the question intent:
   - factual: give the specific fact
   - summary: provide a brief summary of the relevant content
   - list: enumerate the items found
   - recall: describe what you found in the emails
5. If multiple emails are relevant, synthesize the information coherently.`;

const ANSWER_HTML_SUFFIX = `

Format your answer as clean HTML suitable for inline display. Use these elements:
- <strong> for emphasis, names, and key terms
- <em> for email subjects or titles
- <ul>/<li> for lists
- <p> for paragraphs
- Use inline styles sparingly (e.g. style="color:#555") for secondary info like dates
- When referencing an email that has a Link in its evidence, make the subject a clickable link: <a href="THE_LINK_URL" target="_blank">Subject</a>
Do NOT include <html>, <head>, <body>, or <div> wrapper tags. Just produce the content HTML directly.`;
