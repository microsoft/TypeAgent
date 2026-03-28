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
        name: "webflow__list",
        description:
            "List available WebFlow actions for a domain. Returns action names, descriptions, and parameter schemas.",
        schema: {
            domain: z
                .string()
                .optional()
                .describe(
                    "Domain to list flows for (e.g., 'amazon.com'). If omitted, lists all flows.",
                ),
        },
        handler: async (params, getDispatcher, responseCollector, logger) => {
            const dispatcher = getDispatcher();
            if (!dispatcher) {
                return toolResult(
                    "Cannot list WebFlows: not connected to TypeAgent dispatcher.",
                );
            }

            const command = params.domain
                ? `@action browser getWebFlowsForDomain --parameters '{"domain":"${params.domain}"}'`
                : `@action browser getAllWebFlows`;

            logger.log(`[WEBFLOW] Listing flows: ${command}`);
            responseCollector.messages = [];

            try {
                await dispatcher.processCommand(command);
                if (responseCollector.messages.length > 0) {
                    return toolResult(responseCollector.messages.join("\n\n"));
                }
                return toolResult("No WebFlows found.");
            } catch (error) {
                return toolResult(
                    `Failed to list WebFlows: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        },
    },

    {
        name: "webflow__execute",
        description:
            "Execute a saved WebFlow action by name with parameters. Use webflow__list first to discover available flows.",
        schema: {
            flowName: z.string().describe("Name of the WebFlow to execute"),
            parameters: z
                .string()
                .optional()
                .describe(
                    'JSON string of parameters to pass to the flow (e.g., \'{"productName": "shoes"}\')',
                ),
        },
        handler: async (params, getDispatcher, responseCollector, logger) => {
            const dispatcher = getDispatcher();
            if (!dispatcher) {
                return toolResult(
                    "Cannot execute WebFlow: not connected to TypeAgent dispatcher.",
                );
            }

            let paramObj: Record<string, any> = {};
            if (params.parameters) {
                try {
                    paramObj = JSON.parse(params.parameters);
                } catch {
                    return toolResult(
                        `Invalid parameters JSON: ${params.parameters}`,
                    );
                }
            }

            const paramStr =
                Object.keys(paramObj).length > 0
                    ? `--parameters '${JSON.stringify(paramObj).replaceAll("'", "\\'")}'`
                    : "";
            const command =
                `@action browser.webFlows ${params.flowName} ${paramStr}`.trim();

            logger.log(`[WEBFLOW] Executing: ${command}`);
            responseCollector.messages = [];

            try {
                await dispatcher.processCommand(command);
                if (responseCollector.messages.length > 0) {
                    return toolResult(responseCollector.messages.join("\n\n"));
                }
                return toolResult(
                    `WebFlow "${params.flowName}" executed successfully.`,
                );
            } catch (error) {
                return toolResult(
                    `WebFlow "${params.flowName}" failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        },
    },

    {
        name: "webflow__run_draft",
        description:
            "Write and execute a draft WebFlow script using the browser API. " +
            "The script must be: async function execute(browser, params) { ... } " +
            "Available API: browser.click(sel), browser.enterText(sel, text), " +
            "browser.selectOption(sel, value), browser.awaitPageLoad(), " +
            "browser.awaitPageInteraction(), browser.getPageText(), " +
            "browser.captureScreenshot(), browser.navigateTo(url), " +
            "browser.checkPageState(description), browser.queryContent(question), " +
            "browser.followLink(sel), browser.pressKey(key), browser.getCurrentUrl()",
        schema: {
            script: z
                .string()
                .describe(
                    'JavaScript async function source, e.g.: async function execute(browser, params) { await browser.click("#btn"); return { success: true }; }',
                ),
            parameters: z
                .string()
                .optional()
                .describe("JSON string of parameters to pass to the script"),
            timeout: z
                .number()
                .optional()
                .describe(
                    "Execution timeout in milliseconds (default: 120000)",
                ),
        },
        handler: async (params, getDispatcher, responseCollector, logger) => {
            const dispatcher = getDispatcher();
            if (!dispatcher) {
                return toolResult(
                    "Cannot run draft script: not connected to TypeAgent dispatcher.",
                );
            }

            const actionParams: Record<string, unknown> = {
                script: params.script,
            };
            if (params.parameters) {
                actionParams.params = params.parameters;
            }
            if (params.timeout) {
                actionParams.timeout = params.timeout;
            }

            const paramStr = `--parameters '${JSON.stringify(actionParams).replaceAll("'", "\\'")}'`;
            const command =
                `@action browser executeAdHocScript ${paramStr}`.trim();

            logger.log(`[WEBFLOW_DRAFT] Executing draft script`);
            responseCollector.messages = [];

            try {
                await dispatcher.processCommand(command);
                if (responseCollector.messages.length > 0) {
                    return toolResult(responseCollector.messages.join("\n\n"));
                }
                return toolResult("Draft script executed successfully.");
            } catch (error) {
                return toolResult(
                    `Draft script failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
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
