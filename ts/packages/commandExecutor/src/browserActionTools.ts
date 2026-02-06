// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Dispatcher } from "@typeagent/dispatcher-types";
import fs from "fs/promises";
import path from "path";
import os from "os";

function toolResult(result: string): CallToolResult {
    return {
        content: [{ type: "text", text: result }],
    };
}

interface HTMLFrame {
    frameId: number;
    content: string;
    text?: string;
}

/**
 * Prettify HTML by adding line breaks after major tags
 */
function prettifyHTML(html: string): string {
    return html
        .replace(/<\/(div|section|article|aside|nav|header|footer|main|form|table|ul|ol|li|tr|td|th|thead|tbody|tfoot|h[1-6]|p|blockquote|pre|figure|figcaption|address|hr)>/gi, "</$1>\n")
        .replace(/<(head|body|html)>/gi, "<$1>\n")
        .replace(/<\/(head|body|html)>/gi, "</$1>\n");
}

/**
 * Extract title from HTML content
 */
function extractTitle(html: string): string {
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    return titleMatch ? titleMatch[1] : "Untitled";
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Post-process HTML result from browser
 * - Deserializes nested JSON structure
 * - Saves each frame as a separate prettified HTML file
 * - Returns structured summary instead of raw escaped JSON
 */
async function postProcessHTML(rawResponse: string, logger: any): Promise<string> {
    try {
        // Parse the JSON array structure
        const frames: HTMLFrame[] = JSON.parse(rawResponse);

        if (!Array.isArray(frames) || frames.length === 0) {
            return rawResponse; // Not HTML format, return as-is
        }

        // Get main frame (frameId 0) or first frame
        const mainFrame = frames.find(f => f.frameId === 0) || frames[0];

        // Use task's HTML directory if available (from TYPEAGENT_HTML_DIR env var),
        // otherwise fall back to temp directory
        let htmlDir: string;
        if (process.env.TYPEAGENT_HTML_DIR) {
            htmlDir = process.env.TYPEAGENT_HTML_DIR;
            // Ensure directory exists
            await fs.mkdir(htmlDir, { recursive: true });
            logger.log(`[HTML_PROCESSOR] Using task HTML directory: ${htmlDir}`);
        } else {
            htmlDir = await fs.mkdtemp(path.join(os.tmpdir(), "typeagent-html-"));
            logger.log(`[HTML_PROCESSOR] Using temp directory: ${htmlDir}`);
        }

        // Save each frame as a separate file
        const savedFiles: string[] = [];
        for (const frame of frames) {
            const prettified = prettifyHTML(frame.content);
            const filename = frame.frameId === 0 ? "main-frame.html" : `frame-${frame.frameId}.html`;
            const filepath = path.join(htmlDir, filename);

            await fs.writeFile(filepath, prettified, "utf-8");
            savedFiles.push(filepath);

            logger.log(`[HTML_PROCESSOR] Saved frame ${frame.frameId} to ${filepath} (${frame.content.length} bytes, ~${estimateTokens(frame.content)} tokens)`);
        }

        // Extract metadata from main frame
        const title = extractTitle(mainFrame.content);
        const tokenCount = estimateTokens(mainFrame.content);

        // Return structured summary
        const summary = {
            title,
            frameCount: frames.length,
            mainFrameTokens: tokenCount,
            mainFramePath: savedFiles[0],
            allFramePaths: savedFiles,
            // Include a truncated preview for quick analysis (first 8000 chars)
            preview: mainFrame.content.substring(0, 8000),
        };

        return `HTML content retrieved successfully.

**Page Title**: ${title}
**Frame Count**: ${frames.length}
**Main Frame**: ~${tokenCount} tokens

**Saved HTML Files**:
${savedFiles.map((f, i) => `  - Frame ${i}: ${f}`).join('\n')}

**Quick Preview** (first 8000 characters):
${summary.preview}

**Full HTML**: Use Read tool to access the saved HTML files for detailed analysis.
Each frame is saved as a separate prettified HTML file with line breaks for easy reading.`;

    } catch (error) {
        logger.error(`[HTML_PROCESSOR] Failed to process HTML: ${error}`);
        // If processing fails, return original response
        return rawResponse;
    }
}

interface BrowserActionToolDefinition {
    name: string;
    description: string;
    schema: Record<string, z.ZodType<any>>;
    handler: (
        params: any,
        getDispatcher: () => Dispatcher | null,
        responseCollector: { messages: string[] },
        logger: any,
    ) => Promise<CallToolResult>;
}

async function executeBrowserAction(
    actionName: string,
    parameters: Record<string, any>,
    getDispatcher: () => Dispatcher | null,
    responseCollector: { messages: string[] },
    logger: any,
): Promise<CallToolResult> {
    const dispatcher = getDispatcher();
    if (!dispatcher) {
        const errorMsg = `Cannot execute browser action: not connected to TypeAgent dispatcher. Make sure the TypeAgent server is running.`;
        logger.error(errorMsg);
        return toolResult(errorMsg);
    }

    const paramStr =
        parameters && Object.keys(parameters).length > 0
            ? `--parameters '${JSON.stringify(parameters).replaceAll("'", "\\'")}'`
            : "";

    // const nlStr = `--naturalLanguage 'browser action ${actionName}'`;

    const actionCommand = `@action browser ${actionName} ${paramStr}`.trim();

    logger.log(`[BROWSER_ACTION] Executing: ${actionCommand}`);

    responseCollector.messages = [];

    try {
        await dispatcher.processCommand(actionCommand);

        if (responseCollector.messages.length > 0) {
            const response = responseCollector.messages.join("\n\n");
            return toolResult(response);
        }

        return toolResult(
            `✓ Browser action ${actionName} executed successfully`,
        );
    } catch (error) {
        const errorMsg = `Browser action ${actionName} failed: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(errorMsg);
        return toolResult(errorMsg);
    }
}

const browserActionTools: BrowserActionToolDefinition[] = [
    {
        name: "browser__openWebPage",
        description: "Open a web page in the browser",
        schema: {
            site: z
                .string()
                .describe(
                    "URL or site name to open (e.g., 'google.com', 'https://example.com')",
                ),
        },
        handler: async (params, getDispatcher, responseCollector, logger) => {
            return executeBrowserAction(
                "openWebPage",
                { site: params.site },
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },

    {
        name: "browser__closeWebPage",
        description: "Close the current web page",
        schema: {},
        handler: async (params, getDispatcher, responseCollector, logger) => {
            return executeBrowserAction(
                "closeWebPage",
                {},
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },

    {
        name: "browser__clickOnElement",
        description: "Click on a DOM element specified by CSS selector",
        schema: {
            cssSelector: z
                .string()
                .describe(
                    "CSS selector for the element to click (e.g., '#button-id', '.class-name', 'button[type=submit]')",
                ),
        },
        handler: async (params, getDispatcher, responseCollector, logger) => {
            return executeBrowserAction(
                "clickOnElement",
                { cssSelector: params.cssSelector },
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },

    {
        name: "browser__enterTextInElement",
        description: "Enter text into an input field specified by CSS selector",
        schema: {
            value: z.string().describe("Text to enter into the field"),
            cssSelector: z
                .string()
                .describe("CSS selector for the input element"),
            submitForm: z
                .boolean()
                .optional()
                .describe(
                    "Submit the form after entering text (default: false)",
                ),
        },
        handler: async (params, getDispatcher, responseCollector, logger) => {
            return executeBrowserAction(
                "enterTextInElement",
                {
                    value: params.value,
                    cssSelector: params.cssSelector,
                    submitForm: params.submitForm,
                },
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },

    {
        name: "browser__followLinkByText",
        description: "Follow a link containing specific text",
        schema: {
            keywords: z
                .string()
                .describe("Text contained in the link to follow"),
            openInNewTab: z
                .boolean()
                .optional()
                .describe("Open link in new tab (default: false)"),
        },
        handler: async (params, getDispatcher, responseCollector, logger) => {
            return executeBrowserAction(
                "followLinkByText",
                {
                    keywords: params.keywords,
                    openInNewTab: params.openInNewTab,
                },
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },

    {
        name: "browser__search",
        description: "Perform a web search using the default search engine",
        schema: {
            query: z.string().describe("Search query"),
        },
        handler: async (params, getDispatcher, responseCollector, logger) => {
            return executeBrowserAction(
                "search",
                { query: params.query },
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },

    {
        name: "browser__getHTML",
        description: "Get HTML content from the current page. Returns structured summary with file paths to saved HTML frames.",
        schema: {
            fullHTML: z
                .boolean()
                .optional()
                .describe("Get full HTML or fragments (default: fragments)"),
            extractText: z
                .boolean()
                .optional()
                .describe("Extract only text content (default: false)"),
        },
        handler: async (params, getDispatcher, responseCollector, logger) => {
            const result = await executeBrowserAction(
                "getHTML",
                {
                    fullHTML: params.fullHTML,
                    extractText: params.extractText,
                },
                getDispatcher,
                responseCollector,
                logger,
            );

            // Post-process HTML if we got a successful result
            if (result.content && result.content[0]?.type === "text") {
                const rawResponse = result.content[0].text;

                // Only process if it looks like JSON array (starts with '[{')
                if (rawResponse.trim().startsWith('[{')) {
                    const processedResponse = await postProcessHTML(rawResponse, logger);
                    return toolResult(processedResponse);
                }
            }

            return result;
        },
    },
    
    {
        name: "browser__captureScreenshot",
        description: "Capture a screenshot of the current page",
        schema: {},
        handler: async (params, getDispatcher, responseCollector, logger) => {
            return executeBrowserAction(
                "captureScreenshot",
                {},
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },

    {
        name: "browser__scrollDown",
        description: "Scroll down on the current page",
        schema: {},
        handler: async (params, getDispatcher, responseCollector, logger) => {
            return executeBrowserAction(
                "scrollDown",
                {},
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },

    {
        name: "browser__scrollUp",
        description: "Scroll up on the current page",
        schema: {},
        handler: async (params, getDispatcher, responseCollector, logger) => {
            return executeBrowserAction(
                "scrollUp",
                {},
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },

    {
        name: "browser__awaitPageLoad",
        description: "Wait for the page to finish loading",
        schema: {},
        handler: async (params, getDispatcher, responseCollector, logger) => {
            return executeBrowserAction(
                "awaitPageLoad",
                {},
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },
];

export function registerBrowserActionTools(
    server: McpServer,
    getDispatcher: () => Dispatcher | null,
    responseCollector: { messages: string[] },
    logger: any,
): void {
    for (const tool of browserActionTools) {
        server.registerTool(
            tool.name,
            {
                inputSchema: tool.schema,
                description: tool.description,
            },
            async (params: any) =>
                tool.handler(params, getDispatcher, responseCollector, logger),
        );
    }

    logger.log(`Registered ${browserActionTools.length} browser action tools`);
}
