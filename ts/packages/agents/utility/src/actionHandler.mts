// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    AppAgent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromHtmlDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import {
    mkdir,
    readFile as fsReadFile,
    writeFile as fsWriteFile,
} from "node:fs/promises";
import { openai } from "@typeagent/aiclient";
import path from "node:path";
import type { Browser } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createNodeHtmlReducer } from "@typeagent/browser-control-rpc/htmlReducer";
import { convert } from "html-to-text";
import type { UtilityAction } from "./utilitySchema.mjs";

(puppeteer as any).use(StealthPlugin());

const DEFAULT_LLM_MODEL = "copilot:gpt-5.6-sol";

export type UtilityAgentContext = {
    // Lazily-launched browser instance. Held here so closeAgentContext() can
    // shut it down when the agent is disabled, preventing orphaned Chrome processes.
    browserPromise: Promise<Browser> | null;
};

async function initializeUtilityContext(): Promise<UtilityAgentContext> {
    const agentContext: UtilityAgentContext = { browserPromise: null };
    // Pre-warm: launch Chrome in background, ignore startup errors.
    getBrowser(agentContext).catch(() => {});
    return agentContext;
}

async function closeUtilityContext(
    context: SessionContext<UtilityAgentContext>,
): Promise<void> {
    const agentContext = context.agentContext;
    if (agentContext.browserPromise !== null) {
        const browserPromise = agentContext.browserPromise;
        // Clear immediately so any concurrent getBrowser() call starts fresh.
        agentContext.browserPromise = null;
        try {
            const browser = await browserPromise;
            await browser.close();
        } catch {
            // Browser may have already crashed or been closed — ignore.
        }
    }
}

async function executeUtilityAction(
    action: TypeAgentAction<UtilityAction>,
    context: ActionContext<UtilityAgentContext>,
) {
    const a = action as UtilityAction;
    const signal = context.abortSignal;
    const agentContext = context.sessionContext.agentContext;
    try {
        switch (a.actionName) {
            case "webSearch":
                return await handleWebSearch(
                    a.parameters.query,
                    agentContext,
                    signal,
                );
            case "webFetch":
                return await handleWebFetch(
                    a.parameters.url,
                    agentContext,
                    signal,
                );
            case "readFile":
                return await handleReadFile(a.parameters.path);
            case "writeFile":
                return await handleWriteFile(
                    a.parameters.path,
                    a.parameters.content,
                );
            case "llmTransform":
                return await handleLlmTransform(
                    a.parameters.input,
                    a.parameters.prompt,
                    a.parameters.parseJson,
                    a.parameters.htmlOutput,
                    a.parameters.model,
                    signal,
                );
            case "claudeTask":
                return await handleClaudeTask(
                    a.parameters.goal,
                    a.parameters.parseJson,
                    a.parameters.model,
                    a.parameters.maxTurns,
                    signal,
                );
            default:
                return createActionResultFromError(
                    `Unknown utility action: ${(a as any).actionName}`,
                );
        }
    } catch (error) {
        if (
            signal?.aborted ||
            (error instanceof Error && error.name === "AbortError")
        ) {
            throw error; // let the dispatcher handle it as a cancellation
        }
        return createActionResultFromError(
            `Utility action failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

// Singleton browser — launched once per agent context, reused across calls.
// Owned by UtilityAgentContext so closeAgentContext() can shut it down cleanly.

function getBrowser(agentContext: UtilityAgentContext): Promise<Browser> {
    if (!agentContext.browserPromise) {
        const p = (puppeteer as any).launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        }) as Promise<Browser>;

        agentContext.browserPromise = p.then((browser) => {
            browser.on("disconnected", () => {
                agentContext.browserPromise = null;
            });
            return browser;
        });

        agentContext.browserPromise.catch(() => {
            agentContext.browserPromise = null;
        });
    }
    return agentContext.browserPromise;
}

const MAX_PAGE_CHARS = 50_000;

async function getPageContent(
    url: string,
    agentContext: UtilityAgentContext,
    signal?: AbortSignal,
): Promise<string> {
    const browser = await getBrowser(agentContext);
    const page = await browser.newPage();
    // Cancel the navigation if the abort signal fires — Puppeteer doesn't
    // accept AbortSignal directly, so close the page to interrupt goto().
    const onAbort = () => page.close().catch(() => {});
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
        await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30_000,
        });
        const rawHtml = await page.content();
        const reducer = await createNodeHtmlReducer();
        reducer.removeScripts = true;
        reducer.removeStyleTags = true;
        reducer.removeLinkTags = true;
        reducer.removeSvgTags = true;
        reducer.removeCookieJars = true;
        reducer.removeNonVisibleNodes = true;
        reducer.removeMiscTags = true;
        reducer.removeAllClasses = true;
        const reducedHtml = reducer.reduce(rawHtml);
        const text = convert(reducedHtml, { wordwrap: false });
        return text.length > MAX_PAGE_CHARS
            ? text.slice(0, MAX_PAGE_CHARS) +
                  `\n\n[Content truncated at ${MAX_PAGE_CHARS} characters]`
            : text;
    } finally {
        signal?.removeEventListener("abort", onAbort);
        await page.close();
    }
}

async function handleWebSearch(
    searchQuery: string,
    agentContext: UtilityAgentContext,
    signal?: AbortSignal,
) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    const html = await getPageContent(url, agentContext, signal);
    // historyText carries the full results for downstream flow steps;
    // displayContent stays brief so the CLI isn't flooded with the page.
    return createActionResultFromTextDisplay(
        `Fetched ${html.length} chars of search results for "${searchQuery}"`,
        `Search results for "${searchQuery}":\n\n${html}`,
    );
}

async function handleWebFetch(
    url: string,
    agentContext: UtilityAgentContext,
    signal?: AbortSignal,
) {
    // Normalize bare domain/path (no scheme) to https://
    // Also replace spaces with hyphens in the path (genre slugs etc.)
    const withScheme =
        url.startsWith("http://") || url.startsWith("https://")
            ? url
            : `https://${url}`;
    const normalized = withScheme.replace(/ /g, "-");
    const html = await getPageContent(normalized, agentContext, signal);
    // historyText carries the full content for downstream flow steps;
    // displayContent stays brief so the CLI isn't flooded with the page.
    return createActionResultFromTextDisplay(
        `Fetched ${html.length} chars from ${normalized}`,
        `Content from ${normalized}:\n\n${html}`,
    );
}

async function handleReadFile(path: string) {
    const content = await fsReadFile(path, "utf-8");
    return createActionResultFromTextDisplay(content);
}

async function handleWriteFile(filePath: string, content: string) {
    // fs.writeFile does not create missing parent directories, so create them
    // first - otherwise writing into a brand-new folder fails with ENOENT.
    await mkdir(path.dirname(filePath), { recursive: true });
    await fsWriteFile(filePath, content, "utf-8");
    return createActionResultFromTextDisplay(`File written: ${filePath}`);
}

async function handleLlmTransform(
    input: string,
    prompt: string,
    parseJson?: boolean,
    htmlOutput?: boolean,
    model: string = DEFAULT_LLM_MODEL,
    signal?: AbortSignal,
) {
    const fullPrompt = `${prompt}\n\n${input}`;
    const responseText = await completePrompt(fullPrompt, model, signal);

    if (parseJson) {
        const match = responseText.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (match) {
            try {
                JSON.parse(match[0]); // validate it parses
                // historyText carries the JSON string; displayContent is brief
                return {
                    displayContent: {
                        type: "text" as const,
                        content: `Extracted ${match[0].length} chars of JSON`,
                    },
                    historyText: match[0],
                    entities: [],
                };
            } catch {
                // fall through to plain text result
            }
        }
    }

    if (htmlOutput) {
        // Display as rendered HTML in TypeAgent; historyText carries raw HTML for downstream steps
        return createActionResultFromHtmlDisplay(responseText, responseText);
    }

    return createActionResultFromTextDisplay(responseText, responseText);
}

async function handleClaudeTask(
    goal: string,
    parseJson?: boolean,
    model: string = DEFAULT_LLM_MODEL,
    _maxTurns: number = 10,
    signal?: AbortSignal,
) {
    const responseText = await completePrompt(goal, model, signal);

    if (parseJson) {
        const match = responseText.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (match) {
            try {
                JSON.parse(match[0]);
                return {
                    displayContent: {
                        type: "text" as const,
                        content: `claudeTask extracted ${match[0].length} chars of JSON`,
                    },
                    historyText: match[0],
                    entities: [],
                };
            } catch {
                // fall through to plain text result
            }
        }
    }

    return createActionResultFromTextDisplay(responseText, responseText);
}

async function completePrompt(
    prompt: string,
    model: string,
    signal?: AbortSignal,
): Promise<string> {
    const result = await openai
        .createChatModel(model)
        .complete(prompt, undefined, undefined, undefined, signal);
    if (!result.success) {
        throw new Error(result.message);
    }
    if (!result.data.trim()) {
        throw new Error("LLM returned an empty response");
    }
    return result.data;
}

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeUtilityContext,
        closeAgentContext: closeUtilityContext,
        executeAction: executeUtilityAction,
    };
}
