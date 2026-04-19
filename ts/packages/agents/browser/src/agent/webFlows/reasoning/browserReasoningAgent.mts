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
import {
    WebFlowToolAdapter,
    RecordedStep,
    WebFlowToolCallbacks,
} from "./webFlowToolAdapter.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflows:reasoning");

const PAGE_LOAD_TIMEOUT_MS = 5000; // 5 second timeout for page loads

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
    private toolAdapter?: WebFlowToolAdapter;

    constructor(
        private browserApi: WebFlowBrowserAPI,
        private callbacks?: BrowserReasoningCallbacks,
    ) {}

    /**
     * Creates an agent using the unified WebFlowBrowserAPI tools.
     * This ensures the reasoning phase uses the same API methods that will appear in saved scripts.
     */
    static withUnifiedTools(
        browserApi: WebFlowBrowserAPI,
        callbacks?: BrowserReasoningCallbacks,
    ): BrowserReasoningAgent {
        const agent = new BrowserReasoningAgent(browserApi, callbacks);
        const toolCallbacks: WebFlowToolCallbacks = {
            onStepRecorded: (step) => {
                callbacks?.onToolResult?.(step.tool, step.result);
            },
        };
        if (callbacks?.onThinking) {
            toolCallbacks.onThinking = callbacks.onThinking;
        }
        if (callbacks?.onText) {
            toolCallbacks.onText = callbacks.onText;
        }
        agent.toolAdapter = new WebFlowToolAdapter(browserApi, toolCallbacks);
        return agent;
    }

    /**
     * Returns whether this agent is using unified WebFlowBrowserAPI tools.
     */
    isUsingUnifiedTools(): boolean {
        return this.toolAdapter !== undefined;
    }

    async executeGoal(
        config: Partial<BrowserReasoningConfig> & { goal: string },
    ): Promise<BrowserReasoningTrace> {
        const fullConfig = {
            ...DEFAULT_BROWSER_REASONING_CONFIG,
            ...config,
        };

        const startTime = Date.now();
        const steps: BrowserTraceStep[] = [];

        const currentUrl = await this.browserApi.getCurrentUrl();
        const startUrl = fullConfig.startUrl || currentUrl;

        // Only navigate if not already on the target URL (avoids unnecessary reload)
        if (fullConfig.startUrl && fullConfig.startUrl !== currentUrl) {
            debug(`Navigating from ${currentUrl} to ${fullConfig.startUrl}`);
            await this.browserApi.navigateTo(fullConfig.startUrl);
            await this.browserApi.awaitPageLoad(PAGE_LOAD_TIMEOUT_MS);
        } else if (fullConfig.startUrl) {
            debug(
                `Already on target URL: ${fullConfig.startUrl}, skipping navigation`,
            );
        }

        // Use unified tools if adapter is available, otherwise fall back to legacy tools
        let tools: SdkMcpToolDefinition<any>[];
        let systemPrompt: string;

        if (this.toolAdapter) {
            this.toolAdapter.clearSteps();
            tools = this.toolAdapter.buildTools();
            systemPrompt = this.buildUnifiedSystemPrompt(fullConfig);
        } else {
            tools = this.buildBrowserMcpTools(steps);
            systemPrompt = this.buildSystemPrompt(fullConfig);
        }

        const options: Options = {
            model: fullConfig.model,
            maxTurns: fullConfig.maxSteps,
            systemPrompt,
            allowedTools: [`mcp__${MCP_SERVER_NAME}__*`],
            canUseTool: async (toolName) => {
                // Only allow browser-tools MCP tools; deny all others
                if (toolName.startsWith(`mcp__${MCP_SERVER_NAME}__`)) {
                    return { behavior: "allow" as const };
                }
                // Explicitly deny ToolSearch and other SDK tools
                const deniedTools = [
                    "ToolSearch",
                    "Bash",
                    "WebFetch",
                    "Read",
                    "Write",
                    "Task",
                    "Glob",
                    "Grep",
                    "Edit",
                    "WebSearch",
                ];
                const isDenied = deniedTools.some(
                    (t) => toolName === t || toolName.includes(t),
                );
                return {
                    behavior: "deny" as const,
                    message: isDenied
                        ? `Tool "${toolName}" is forbidden. All browser tools are already loaded - use mcp__browser-tools__* tools directly.`
                        : `Tool "${toolName}" is not available. Use only mcp__browser-tools__* tools.`,
                };
            },
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

        // Convert recorded steps from tool adapter to trace format
        const finalSteps = this.toolAdapter
            ? this.convertRecordedSteps(this.toolAdapter.getRecordedSteps())
            : steps;

        return {
            goal: fullConfig.goal,
            startUrl,
            steps: finalSteps,
            result: { success, summary },
            duration: Date.now() - startTime,
        };
    }

    /**
     * Converts RecordedStep objects from WebFlowToolAdapter to BrowserTraceStep format.
     */
    private convertRecordedSteps(
        recordedSteps: RecordedStep[],
    ): BrowserTraceStep[] {
        return recordedSteps.map((step) => ({
            stepNumber: step.stepNumber,
            thinking: step.thinking || "",
            action: {
                tool: step.tool,
                args: step.args,
            },
            result: step.result,
            timestamp: step.timestamp,
        }));
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
                    await this.browserApi.awaitPageLoad(PAGE_LOAD_TIMEOUT_MS);
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

    /**
     * Builds system prompt for unified WebFlowBrowserAPI tools.
     * Emphasizes the extractComponent-first pattern for component reuse.
     */
    private buildUnifiedSystemPrompt(config: BrowserReasoningConfig): string {
        return [
            "You are a browser automation agent. Your goal is to complete the user's task by interacting with web pages.",
            "",
            "## CRITICAL: Tool Restrictions",
            "",
            "You have access ONLY to browser automation tools. ALL browser tools are ALREADY LOADED - do NOT use ToolSearch.",
            "",
            "**FORBIDDEN tools (will be denied):** ToolSearch, Bash, WebFetch, Read, Write, Task, Glob, Grep, Edit, WebSearch",
            "",
            "**AVAILABLE tools (use ONLY these):**",
            "- mcp__browser-tools__extractComponent - Find UI elements",
            "- mcp__browser-tools__click - Click an element",
            "- mcp__browser-tools__clickAndWait - Click and wait for page update",
            "- mcp__browser-tools__enterText - Type into a field",
            "- mcp__browser-tools__clearAndType - Clear and type text",
            "- mcp__browser-tools__selectOption - Select dropdown option",
            "- mcp__browser-tools__pressKey - Press keyboard key",
            "- mcp__browser-tools__navigateTo - Navigate to URL",
            "- mcp__browser-tools__awaitPageLoad - Wait for page load",
            "- mcp__browser-tools__checkPageState - Verify page content",
            "- mcp__browser-tools__getPageText - Read page text",
            "- mcp__browser-tools__queryContent - Extract structured data",
            "",
            "## Important Pattern: Extract First, Then Act",
            "",
            "ALWAYS use extractComponent to find UI elements BEFORE interacting with them.",
            "This returns an object with CSS selectors that you use in subsequent actions.",
            "",
            "Example workflow:",
            "1. extractComponent({ typeName: 'SearchInput', ... }, 'search box')",
            "   → Returns: { cssSelector: '#search', submitButtonCssSelector: '#search-btn' }",
            "2. enterText('#search', 'query text')  // Use the cssSelector from step 1",
            "3. click('#search-btn')  // Reuse the submitButtonCssSelector from step 1",
            "",
            "## Available Tools",
            "",
            "**Find UI Components:**",
            "- extractComponent: Find a UI component by description. Returns object with CSS selectors.",
            "  Types: SearchInput, Button, TextInput, DropdownControl, Element",
            "",
            "**Navigation:**",
            "- navigateTo: Navigate to a URL",
            "- awaitPageLoad: Wait for page to finish loading",
            "",
            "**Actions (require CSS selector from extractComponent):**",
            "- click: Click element by CSS selector",
            "- clickAndWait: Click and wait for navigation/update",
            "- enterText: Type text into input field",
            "- clearAndType: Clear field then type text",
            "- selectOption: Select dropdown option",
            "- pressKey: Press keyboard key (Enter, Tab, Escape, etc.)",
            "",
            "**Page State (choose the right tool):**",
            "- checkPageState: PREFERRED for verification. Returns true/false for expected content.",
            "  Use this to verify you're on the right page or that an action succeeded.",
            "  Example: checkPageState({ expectedContent: ['Booking confirmed', 'Order #'] })",
            "- getPageText: Read full visible text. Use when you need to understand page content",
            "  or extract specific information (not just verify presence).",
            "- queryContent: Extract structured data from page using a schema.",
            "",
            "## Strategy",
            "",
            "1. Understand the current page with getPageText (once at start)",
            "2. Use extractComponent to find each UI element you need",
            "3. Perform actions using CSS selectors from extracted components",
            "4. Verify results with checkPageState (not getPageText for simple verification)",
            "5. Report success when goal is achieved",
            "",
            "## When to Use checkPageState vs getPageText",
            "",
            "- Use checkPageState when: Verifying page state, confirming navigation, checking action results",
            "- Use getPageText when: Initially exploring a page, extracting information to display to user",
            "",
            "## Component Reuse",
            "",
            "Components can be extracted once and used multiple times:",
            "- Search inputs often have both cssSelector (for typing) and submitButtonCssSelector (for submitting)",
            "- Dropdown controls include available values you can reference",
            "",
            "## Form Submission Success Criteria",
            "",
            "IMPORTANT: Not all pages show explicit confirmation messages after form submission.",
            "",
            "Consider a form submission SUCCESSFUL if:",
            "- You filled all required fields and clicked submit",
            "- No validation errors appeared (like 'field required' or 'invalid input')",
            "- The page updated in any way (form cleared, new content appeared, or state changed)",
            "",
            "Do NOT keep retrying if:",
            "- The form submitted without errors but shows a different result than expected (e.g., 'no availability')",
            "- The page simply returned to its initial state without error messages",
            "- You've already attempted the same action 2+ times with the same result",
            "",
            "The automation's job is to demonstrate the PROCESS works, not guarantee a specific business outcome.",
            "If form submission completes without validation errors, report SUCCESS and move on.",
            "",
            "Be methodical. If an action fails, try alternative approaches - but don't loop on the same action.",
        ].join("\n");
    }
}
