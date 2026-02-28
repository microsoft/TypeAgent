// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    AppAgent,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromHtmlDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import {
    readFile as fsReadFile,
    writeFile as fsWriteFile,
} from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Browser } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createNodeHtmlReducer } from "browser-typeagent/htmlReducer";
import { convert } from "html-to-text";
import type { UtilityAction } from "./utilitySchema.mjs";

(puppeteer as any).use(StealthPlugin());

export type UtilityAgentContext = {};

async function initializeUtilityContext(): Promise<UtilityAgentContext> {
    getBrowser().catch(() => {}); // pre-warm: launch Chrome in background, ignore startup errors
    return {};
}

async function executeUtilityAction(
    action: TypeAgentAction<UtilityAction>,
    _context: ActionContext<UtilityAgentContext>,
) {
    const a = action as UtilityAction;
    try {
        switch (a.actionName) {
            case "webSearch":
                return await handleWebSearch(a.parameters.query);
            case "webFetch":
                return await handleWebFetch(a.parameters.url);
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
                );
            case "claudeTask":
                return await handleClaudeTask(
                    a.parameters.goal,
                    a.parameters.parseJson,
                    a.parameters.model,
                    a.parameters.maxTurns,
                );
            default:
                return createActionResultFromError(
                    `Unknown utility action: ${(a as any).actionName}`,
                );
        }
    } catch (error) {
        return createActionResultFromError(
            `Utility action failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

// Singleton browser — launched once, reused across calls
let _browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
    if (!_browserPromise) {
        const p = (puppeteer as any).launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        }) as Promise<Browser>;

        _browserPromise = p.then((browser) => {
            browser.on("disconnected", () => {
                _browserPromise = null;
            });
            return browser;
        });

        _browserPromise.catch(() => {
            _browserPromise = null;
        });
    }
    return _browserPromise;
}

const MAX_PAGE_CHARS = 50_000;

async function getPageContent(url: string): Promise<string> {
    const browser = await getBrowser();
    const page = await browser.newPage();
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
        await page.close();
    }
}

async function handleWebSearch(searchQuery: string) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    const html = await getPageContent(url);
    return createActionResultFromTextDisplay(
        `Search results for "${searchQuery}":\n\n${html}`,
        `Search results for "${searchQuery}":\n\n${html}`,
    );
}

async function handleWebFetch(url: string) {
    // Normalize bare domain/path (no scheme) to https://
    // Also replace spaces with hyphens in the path (genre slugs etc.)
    const withScheme =
        url.startsWith("http://") || url.startsWith("https://")
            ? url
            : `https://${url}`;
    const normalized = withScheme.replace(/ /g, "-");
    const html = await getPageContent(normalized);
    return createActionResultFromTextDisplay(
        `Content from ${normalized}:\n\n${html}`,
        `Content from ${normalized}:\n\n${html}`,
    );
}

async function handleReadFile(path: string) {
    const content = await fsReadFile(path, "utf-8");
    return createActionResultFromTextDisplay(content);
}

async function handleWriteFile(path: string, content: string) {
    await fsWriteFile(path, content, "utf-8");
    return createActionResultFromTextDisplay(`File written: ${path}`);
}

async function handleLlmTransform(
    input: string,
    prompt: string,
    parseJson?: boolean,
    htmlOutput?: boolean,
    model: string = "claude-haiku-4-5-20251001",
) {
    const fullPrompt = `${prompt}\n\n${input}`;
    const queryInstance = query({ prompt: fullPrompt, options: { model } });
    let responseText = "";
    for await (const message of queryInstance) {
        if (message.type === "result" && message.subtype === "success") {
            responseText = (message as any).result || "";
            break;
        }
    }

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

// Compute the monorepo ts/ root from this module's compiled location.
// Compiled path: packages/agents/utility/dist/actionHandler.mjs → up 4 levels = ts/
function getRepoRoot(): string {
    const thisFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(thisFile), "../../../..");
}

async function handleClaudeTask(
    goal: string,
    parseJson?: boolean,
    model: string = "claude-haiku-4-5-20251001",
    maxTurns: number = 10,
) {
    const queryInstance = query({
        prompt: goal,
        options: {
            model,
            maxTurns,
            permissionMode: "acceptEdits",
            canUseTool: async () => ({ behavior: "allow" as const }),
            allowedTools: ["WebSearch", "WebFetch"],
            cwd: getRepoRoot(),
            settingSources: [],
            maxThinkingTokens: 10000,
            systemPrompt: {
                type: "preset",
                preset: "claude_code",
            },
        },
    });
    let responseText = "";
    for await (const message of queryInstance) {
        if (message.type === "result" && message.subtype === "success") {
            responseText = (message as any).result || "";
            break;
        }
    }

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

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeUtilityContext,
        executeAction: executeUtilityAction,
    };
}
