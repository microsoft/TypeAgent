// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import {
    WebFlowBrowserAPI,
    ComponentDefinition,
} from "../webFlowBrowserApi.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflows:tooladapter");

/**
 * Recorded step from tool execution.
 * Captures tool name, arguments, and results for trace generation.
 */
export interface RecordedStep {
    stepNumber: number;
    tool: string;
    args: Record<string, unknown>;
    result: {
        success: boolean;
        data?: unknown;
        error?: string;
    };
    thinking?: string;
    timestamp: number;
}

export interface WebFlowToolCallbacks {
    onStepRecorded?: (step: RecordedStep) => void;
    onThinking?: (text: string) => void;
    onText?: (text: string) => void;
}

/**
 * Creates SDK MCP tools that directly map to WebFlowBrowserAPI methods.
 * This ensures the reasoning agent uses the same API as saved scripts.
 *
 * Key design: Separate extraction from action to enable component reuse.
 * - extractComponent: Find UI component, returns selectors
 * - click/enterText/selectOption: Use selectors from extractComponent
 */
export class WebFlowToolAdapter {
    private steps: RecordedStep[] = [];
    private stepCounter = 0;

    constructor(
        private browserApi: WebFlowBrowserAPI,
        private callbacks?: WebFlowToolCallbacks,
    ) {}

    getRecordedSteps(): RecordedStep[] {
        return [...this.steps];
    }

    clearSteps(): void {
        this.steps = [];
        this.stepCounter = 0;
    }

    setThinkingForLastStep(thinking: string): void {
        if (this.steps.length > 0) {
            this.steps[this.steps.length - 1].thinking = thinking;
        }
    }

    buildTools(): SdkMcpToolDefinition<any>[] {
        return [
            this.createExtractComponentTool(),
            this.createNavigateToTool(),
            this.createClickTool(),
            this.createClickAndWaitTool(),
            this.createEnterTextTool(),
            this.createClearAndTypeTool(),
            this.createSelectOptionTool(),
            this.createPressKeyTool(),
            this.createGetPageTextTool(),
            this.createAwaitPageLoadTool(),
            this.createCheckPageStateTool(),
            this.createQueryContentTool(),
        ];
    }

    private recordStep(
        tool: string,
        args: Record<string, unknown>,
        result: RecordedStep["result"],
    ): void {
        this.stepCounter++;
        const step: RecordedStep = {
            stepNumber: this.stepCounter,
            tool,
            args,
            result,
            timestamp: Date.now(),
        };
        this.steps.push(step);
        debug(`Step ${step.stepNumber}: ${tool}`, args, result);
        this.callbacks?.onStepRecorded?.(step);
    }

    private createExtractComponentTool(): SdkMcpToolDefinition<any> {
        return {
            name: "extractComponent",
            description: `Find a UI component on the page by description. Returns an object with CSS selectors.
Use this BEFORE click/enterText/selectOption to find elements.

Common component types and their schemas:
- SearchInput: { cssSelector: string; submitButtonCssSelector?: string; }
- Button: { title: string; cssSelector: string; }
- TextInput: { title: string; cssSelector: string; placeholderText?: string; }
- DropdownControl: { title: string; cssSelector: string; values: { text: string; value: string; }[] }
- Element: { title: string; cssSelector: string; }
- ProductDetailsHero: { name: string; price: string; addToCartButtonSelector?: string; }
- NavigationLink: { title: string; linkSelector: string; }`,
            inputSchema: {
                typeName: z
                    .string()
                    .describe(
                        "Component type (SearchInput, Button, TextInput, DropdownControl, Element, etc.)",
                    ),
                schema: z
                    .string()
                    .describe(
                        "TypeScript schema, e.g. '{ title: string; cssSelector: string; }'",
                    ),
                description: z
                    .string()
                    .describe(
                        "What to find, e.g. 'search box', 'submit button', 'pickup location dropdown'",
                    ),
            },
            handler: async (args) => {
                const componentDef: ComponentDefinition = {
                    typeName: args.typeName as string,
                    schema: args.schema as string,
                };
                const description = args.description as string;

                try {
                    const component = await this.browserApi.extractComponent(
                        componentDef,
                        description,
                    );

                    this.recordStep(
                        "extractComponent",
                        { componentDef, userRequest: description },
                        { success: true, data: component },
                    );

                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: JSON.stringify(component, null, 2),
                            },
                        ],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "extractComponent",
                        { componentDef, userRequest: description },
                        { success: false, error: msg },
                    );
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

    private createNavigateToTool(): SdkMcpToolDefinition<any> {
        return {
            name: "navigateTo",
            description: "Navigate the browser to a URL.",
            inputSchema: {
                url: z.string().describe("The URL to navigate to"),
            },
            handler: async (args) => {
                const url = args.url as string;
                const NAVIGATION_TIMEOUT_MS = 5000; // 5 second timeout

                try {
                    // Wrap navigation in a timeout to prevent hanging
                    const navigationPromise = (async () => {
                        await this.browserApi.navigateTo(url);
                        await this.browserApi.awaitPageLoad(3000);
                        return await this.browserApi.getCurrentUrl();
                    })();

                    const timeoutPromise = new Promise<never>((_, reject) => {
                        setTimeout(
                            () => reject(new Error("Navigation timeout")),
                            NAVIGATION_TIMEOUT_MS,
                        );
                    });

                    const pageUrl = await Promise.race([
                        navigationPromise,
                        timeoutPromise,
                    ]);

                    this.recordStep(
                        "navigateTo",
                        { url },
                        { success: true, data: { pageUrl } },
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Navigated to ${pageUrl}`,
                            },
                        ],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "navigateTo",
                        { url },
                        { success: false, error: msg },
                    );
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

    private createClickTool(): SdkMcpToolDefinition<any> {
        return {
            name: "click",
            description:
                "Click element by CSS selector. Use extractComponent first to find the selector.",
            inputSchema: {
                cssSelector: z
                    .string()
                    .describe("CSS selector from extractComponent result"),
            },
            handler: async (args) => {
                const selector = args.cssSelector as string;
                try {
                    await this.browserApi.click(selector);
                    this.recordStep(
                        "click",
                        { cssSelector: selector },
                        { success: true },
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Clicked: ${selector}`,
                            },
                        ],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "click",
                        { cssSelector: selector },
                        { success: false, error: msg },
                    );
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

    private createClickAndWaitTool(): SdkMcpToolDefinition<any> {
        return {
            name: "clickAndWait",
            description:
                "Click element and wait for page update. Use for buttons that trigger navigation or content changes.",
            inputSchema: {
                cssSelector: z
                    .string()
                    .describe("CSS selector from extractComponent result"),
            },
            handler: async (args) => {
                const selector = args.cssSelector as string;
                try {
                    await this.browserApi.clickAndWait(selector);
                    this.recordStep(
                        "clickAndWait",
                        { cssSelector: selector },
                        { success: true },
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Clicked and waited: ${selector}`,
                            },
                        ],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "clickAndWait",
                        { cssSelector: selector },
                        { success: false, error: msg },
                    );
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

    private createEnterTextTool(): SdkMcpToolDefinition<any> {
        return {
            name: "enterText",
            description: "Type text into an input field by CSS selector.",
            inputSchema: {
                cssSelector: z.string().describe("CSS selector of the input"),
                text: z.string().describe("Text to enter"),
            },
            handler: async (args) => {
                const selector = args.cssSelector as string;
                const text = args.text as string;
                try {
                    await this.browserApi.enterText(selector, text);
                    this.recordStep(
                        "enterText",
                        { cssSelector: selector, text },
                        { success: true },
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Entered text into ${selector}`,
                            },
                        ],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "enterText",
                        { cssSelector: selector, text },
                        { success: false, error: msg },
                    );
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

    private createClearAndTypeTool(): SdkMcpToolDefinition<any> {
        return {
            name: "clearAndType",
            description:
                "Clear input field and type new text. Use when you need to replace existing content.",
            inputSchema: {
                cssSelector: z.string().describe("CSS selector of the input"),
                text: z.string().describe("Text to enter"),
            },
            handler: async (args) => {
                const selector = args.cssSelector as string;
                const text = args.text as string;
                try {
                    await this.browserApi.clearAndType(selector, text);
                    this.recordStep(
                        "clearAndType",
                        { cssSelector: selector, text },
                        { success: true },
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Cleared and typed into ${selector}`,
                            },
                        ],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "clearAndType",
                        { cssSelector: selector, text },
                        { success: false, error: msg },
                    );
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

    private createSelectOptionTool(): SdkMcpToolDefinition<any> {
        return {
            name: "selectOption",
            description: "Select an option from a dropdown by CSS selector.",
            inputSchema: {
                cssSelector: z
                    .string()
                    .describe("CSS selector of the select/dropdown"),
                value: z.string().describe("Option text or value to select"),
            },
            handler: async (args) => {
                const selector = args.cssSelector as string;
                const value = args.value as string;
                try {
                    await this.browserApi.selectOption(selector, value);
                    this.recordStep(
                        "selectOption",
                        { cssSelector: selector, value },
                        { success: true },
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Selected "${value}" in ${selector}`,
                            },
                        ],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "selectOption",
                        { cssSelector: selector, value },
                        { success: false, error: msg },
                    );
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

    private createPressKeyTool(): SdkMcpToolDefinition<any> {
        return {
            name: "pressKey",
            description:
                "Press a keyboard key (e.g., 'Enter', 'Tab', 'Escape'). Use after entering text to submit forms.",
            inputSchema: {
                key: z
                    .string()
                    .describe("Key name to press (Enter, Tab, Escape, etc.)"),
            },
            handler: async (args) => {
                const key = args.key as string;
                try {
                    await this.browserApi.pressKey(key);
                    this.recordStep("pressKey", { key }, { success: true });
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Pressed key: ${key}`,
                            },
                        ],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "pressKey",
                        { key },
                        { success: false, error: msg },
                    );
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

    private createGetPageTextTool(): SdkMcpToolDefinition<any> {
        return {
            name: "getPageText",
            description:
                "Get the text content of the current page. Use to understand page structure.",
            inputSchema: {},
            handler: async () => {
                try {
                    const text = await this.browserApi.getPageText();
                    this.recordStep(
                        "getPageText",
                        {},
                        { success: true, data: text.slice(0, 500) },
                    );
                    return {
                        content: [{ type: "text" as const, text }],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "getPageText",
                        {},
                        { success: false, error: msg },
                    );
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

    private createAwaitPageLoadTool(): SdkMcpToolDefinition<any> {
        return {
            name: "awaitPageLoad",
            description:
                "Wait for the page to finish loading. Use after navigation or after actions that trigger page updates.",
            inputSchema: {
                timeout: z
                    .number()
                    .optional()
                    .describe("Timeout in milliseconds (default: 5000)"),
            },
            handler: async (args) => {
                const timeout = (args.timeout as number) || 5000;
                try {
                    await this.browserApi.awaitPageLoad(timeout);
                    this.recordStep(
                        "awaitPageLoad",
                        { timeout },
                        { success: true },
                    );
                    return {
                        content: [
                            { type: "text" as const, text: "Page loaded" },
                        ],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "awaitPageLoad",
                        { timeout },
                        { success: false, error: msg },
                    );
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

    private createCheckPageStateTool(): SdkMcpToolDefinition<any> {
        return {
            name: "checkPageState",
            description:
                "Check if the page is in an expected state. Use to verify actions succeeded.",
            inputSchema: {
                expectedState: z
                    .string()
                    .describe(
                        "Description of expected state, e.g. 'search results are displayed'",
                    ),
            },
            handler: async (args) => {
                const expectedState = args.expectedState as string;
                try {
                    const result =
                        await this.browserApi.checkPageState(expectedState);
                    this.recordStep(
                        "checkPageState",
                        { expectedState },
                        { success: true, data: result },
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `State check: ${result.matched ? "MATCHED" : "NOT MATCHED"} - ${result.explanation}`,
                            },
                        ],
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "checkPageState",
                        { expectedState },
                        { success: false, error: msg },
                    );
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

    private createQueryContentTool(): SdkMcpToolDefinition<any> {
        return {
            name: "queryContent",
            description:
                "Ask a question about the page content. Use to extract specific information.",
            inputSchema: {
                question: z
                    .string()
                    .describe(
                        "Question about the page, e.g. 'What is the total price?'",
                    ),
            },
            handler: async (args) => {
                const question = args.question as string;
                try {
                    const result = await this.browserApi.queryContent(question);
                    this.recordStep(
                        "queryContent",
                        { question },
                        { success: true, data: result },
                    );
                    if (result.answered) {
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: `Answer: ${result.answerText} (confidence: ${result.confidence})`,
                                },
                            ],
                        };
                    } else {
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: "Could not find answer on this page",
                                },
                            ],
                        };
                    }
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    this.recordStep(
                        "queryContent",
                        { question },
                        { success: false, error: msg },
                    );
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
}
