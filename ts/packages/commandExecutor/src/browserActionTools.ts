// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Dispatcher } from "@typeagent/dispatcher-types";

function toolResult(result: string): CallToolResult {
    return {
        content: [{ type: "text", text: result }],
    };
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
        description: "Get HTML content from the current page",
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
            return executeBrowserAction(
                "getHTML",
                {
                    fullHTML: params.fullHTML,
                    extractText: params.extractText,
                },
                getDispatcher,
                responseCollector,
                logger,
            );
        },
    },
    /*
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
*/
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
