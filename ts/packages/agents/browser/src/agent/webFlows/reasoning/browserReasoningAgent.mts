// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createSdkMcpServer,
    Options,
    query,
    SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import { WebFlowBrowserAPI } from "../webFlowBrowserApi.mjs";
import {
    BrowserReasoningConfig,
    BrowserReasoningTrace,
    BrowserTraceStep,
    DEFAULT_BROWSER_REASONING_CONFIG,
} from "./browserReasoningTypes.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflows:reasoning");

const MCP_SERVER_NAME = "browser-tools";

export interface BrowserReasoningCallbacks {
    onThinking?: (text: string) => void;
    onToolCall?: (tool: string, args: unknown) => void;
    onToolResult?: (tool: string, result: unknown) => void;
    onText?: (text: string) => void;
}

/**
 * Executes goal-driven browser automation using a reasoning model.
 * The model receives browser tools and works toward the user's goal,
 * capturing a trace of all actions for later script generation.
 */
export class BrowserReasoningAgent {
    constructor(
        private browserApi: WebFlowBrowserAPI,
        private callbacks?: BrowserReasoningCallbacks,
    ) {}

    async executeGoal(
        config: Partial<BrowserReasoningConfig> & { goal: string },
    ): Promise<BrowserReasoningTrace> {
        const fullConfig = {
            ...DEFAULT_BROWSER_REASONING_CONFIG,
            ...config,
        };

        const startTime = Date.now();
        const steps: BrowserTraceStep[] = [];

        const startUrl = fullConfig.startUrl
            ? fullConfig.startUrl
            : await this.browserApi.getCurrentUrl();

        if (fullConfig.startUrl) {
            await this.browserApi.navigateTo(fullConfig.startUrl);
            await this.browserApi.awaitPageLoad();
        }

        const tools = this.buildBrowserMcpTools(steps);
        const systemPrompt = this.buildSystemPrompt(fullConfig);

        const options: Options = {
            model: fullConfig.model,
            maxTurns: fullConfig.maxSteps,
            systemPrompt,
            allowedTools: [`mcp__${MCP_SERVER_NAME}__*`],
            canUseTool: async () => ({ behavior: "allow" as const }),
            mcpServers: {
                [MCP_SERVER_NAME]: createSdkMcpServer({
                    name: MCP_SERVER_NAME,
                    tools,
                }),
            },
        };

        let success = false;
        let summary = "";

        try {
            const queryInstance = query({
                prompt: fullConfig.goal,
                options,
            });

            for await (const message of queryInstance) {
                debug(message);

                if (message.type === "assistant") {
                    for (const content of message.message.content) {
                        if (content.type === "text") {
                            this.callbacks?.onText?.(content.text);
                        } else if (content.type === "tool_use") {
                            this.callbacks?.onToolCall?.(
                                content.name,
                                content.input,
                            );
                        } else if ((content as any).type === "thinking") {
                            const thinkingContent = (content as any).thinking;
                            if (thinkingContent) {
                                this.callbacks?.onThinking?.(thinkingContent);
                                if (steps.length > 0) {
                                    steps[steps.length - 1].thinking =
                                        thinkingContent;
                                }
                            }
                        }
                    }
                } else if (message.type === "result") {
                    if (message.subtype === "success") {
                        success = true;
                        summary = message.result;
                    } else {
                        const errors =
                            "errors" in message
                                ? (message as any).errors
                                : undefined;
                        summary = `Error: ${errors?.join(", ") ?? "Unknown error"}`;
                    }
                }
            }
        } catch (error) {
            summary = error instanceof Error ? error.message : String(error);
        }

        return {
            goal: fullConfig.goal,
            startUrl,
            steps,
            result: { success, summary },
            duration: Date.now() - startTime,
        };
    }

    private buildBrowserMcpTools(
        steps: BrowserTraceStep[],
    ): SdkMcpToolDefinition<any>[] {
        let stepCounter = 0;

        const recordStep = (
            tool: string,
            args: Record<string, unknown>,
            result: BrowserTraceStep["result"],
        ) => {
            stepCounter++;
            steps.push({
                stepNumber: stepCounter,
                thinking: "",
                action: { tool, args },
                result,
                timestamp: Date.now(),
            });
            this.callbacks?.onToolResult?.(tool, result);
        };

        return [
            this.createTool(
                "navigateTo",
                "Navigate the browser to a URL",
                { url: z.string().describe("The URL to navigate to") },
                async (args) => {
                    await this.browserApi.navigateTo(args.url as string);
                    await this.browserApi.awaitPageLoad();
                    const pageUrl = await this.browserApi.getCurrentUrl();
                    recordStep("navigateTo", args, {
                        success: true,
                        pageUrl,
                    });
                    return {
                        content: [
                            { type: "text", text: `Navigated to ${pageUrl}` },
                        ],
                    };
                },
            ),
            this.createTool(
                "goBack",
                "Go back to the previous page",
                {},
                async (args) => {
                    await this.browserApi.goBack();
                    const pageUrl = await this.browserApi.getCurrentUrl();
                    recordStep("goBack", args, { success: true, pageUrl });
                    return {
                        content: [
                            { type: "text", text: `Went back to ${pageUrl}` },
                        ],
                    };
                },
            ),
            this.createTool(
                "getCurrentUrl",
                "Get the current page URL",
                {},
                async (args) => {
                    const url = await this.browserApi.getCurrentUrl();
                    recordStep("getCurrentUrl", args, {
                        success: true,
                        data: url,
                    });
                    return { content: [{ type: "text", text: url }] };
                },
            ),
            this.createTool(
                "getPageText",
                "Get the text content of the current page",
                {},
                async (args) => {
                    const text = await this.browserApi.getPageText();
                    recordStep("getPageText", args, {
                        success: true,
                        data: text.slice(0, 500),
                    });
                    return { content: [{ type: "text", text }] };
                },
            ),
            this.createTool(
                "click",
                "Click on an element identified by its CSS selector",
                {
                    selector: z
                        .string()
                        .describe("CSS selector of the element"),
                },
                async (args) => {
                    await this.browserApi.click(args.selector as string);
                    await this.browserApi.awaitPageInteraction();
                    const pageUrl = await this.browserApi.getCurrentUrl();
                    recordStep("click", args, { success: true, pageUrl });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Clicked element: ${args.selector}`,
                            },
                        ],
                    };
                },
            ),
            this.createTool(
                "enterText",
                "Type text into an input element",
                {
                    selector: z.string().describe("CSS selector of the input"),
                    text: z.string().describe("Text to enter"),
                },
                async (args) => {
                    await this.browserApi.enterText(
                        args.selector as string,
                        args.text as string,
                    );
                    recordStep("enterText", args, { success: true });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Entered text into ${args.selector}`,
                            },
                        ],
                    };
                },
            ),
            this.createTool(
                "pressKey",
                "Press a keyboard key (e.g., 'Enter', 'Tab', 'Escape')",
                {
                    key: z.string().describe("Key name to press"),
                },
                async (args) => {
                    await this.browserApi.pressKey(args.key as string);
                    recordStep("pressKey", args, { success: true });
                    return {
                        content: [
                            { type: "text", text: `Pressed key: ${args.key}` },
                        ],
                    };
                },
            ),
            this.createTool(
                "selectOption",
                "Select an option from a dropdown/select element",
                {
                    selector: z
                        .string()
                        .describe("CSS selector of the select element"),
                    value: z.string().describe("Value to select"),
                },
                async (args) => {
                    await this.browserApi.selectOption(
                        args.selector as string,
                        args.value as string,
                    );
                    recordStep("selectOption", args, { success: true });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Selected "${args.value}" in ${args.selector}`,
                            },
                        ],
                    };
                },
            ),
            this.createTool(
                "captureScreenshot",
                "Take a screenshot of the current page",
                {},
                async (args) => {
                    const screenshot =
                        await this.browserApi.captureScreenshot();
                    recordStep("captureScreenshot", args, {
                        success: true,
                        screenshot: screenshot.slice(0, 100) + "...",
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Screenshot captured (${screenshot.length} chars base64)`,
                            },
                        ],
                    };
                },
            ),
        ];
    }

    private createTool(
        name: string,
        description: string,
        schema: Record<string, any>,
        handler: (args: Record<string, unknown>) => Promise<{
            content: Array<{ type: "text"; text: string }>;
        }>,
    ): SdkMcpToolDefinition<any> {
        return {
            name,
            description,
            inputSchema: schema,
            handler: async (args: Record<string, unknown>) => {
                try {
                    return await handler(args);
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    return {
                        content: [
                            { type: "text" as const, text: `Error: ${msg}` },
                        ],
                        isError: true,
                    };
                }
            },
        };
    }

    private buildSystemPrompt(config: BrowserReasoningConfig): string {
        return [
            "You are a browser automation agent. Your goal is to complete the user's task by interacting with web pages.",
            "",
            "Available tools:",
            "- navigateTo: Navigate to a URL",
            "- goBack: Go back to previous page",
            "- getCurrentUrl: Get current page URL",
            "- getPageText: Read page text content",
            "- click: Click on an element by CSS selector",
            "- enterText: Type text into an input by CSS selector",
            "- pressKey: Press a keyboard key",
            "- selectOption: Select from a dropdown by CSS selector",
            "- captureScreenshot: Take a page screenshot",
            "",
            "Strategy:",
            "1. Start by understanding the current page (getPageText or captureScreenshot)",
            "2. Interact with elements to achieve the goal",
            "3. Verify results after each action",
            "4. When the goal is achieved, report success with a summary",
            "",
            "Be methodical. If an action fails, try alternative approaches.",
            "Always verify the page state after navigation or form submission.",
        ].join("\n");
    }
}
