// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type {
    AssistantMessageEvent,
    MessageOptions,
    SessionConfig,
} from "@github/copilot-sdk";
import { claudeExecutableOption } from "@typeagent/agent-sdk/node";
import os from "node:os";
import path from "node:path";
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
const COPILOT_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw signal.reason ?? new Error("Browser reasoning was cancelled.");
    }
}

export interface BrowserReasoningCopilotSession {
    sendAndWait(
        promptOrOptions: string | MessageOptions,
        timeout?: number,
    ): Promise<AssistantMessageEvent | undefined>;
    abort(): Promise<void>;
    disconnect(): Promise<void>;
}

export interface BrowserReasoningCopilotClient {
    start(): Promise<void>;
    createSession(
        config: SessionConfig,
    ): Promise<BrowserReasoningCopilotSession>;
    stop(): Promise<unknown>;
}

export type BrowserReasoningCopilotClientFactory =
    () => Promise<BrowserReasoningCopilotClient>;

export async function createCopilotClient(
    clientFactory?: () =>
        | BrowserReasoningCopilotClient
        | Promise<BrowserReasoningCopilotClient>,
): Promise<BrowserReasoningCopilotClient> {
    const client = clientFactory
        ? await clientFactory()
        : new (await import("@github/copilot-sdk")).CopilotClient({
              mode: "empty",
              baseDirectory: path.join(os.homedir(), ".typeagent", "copilot"),
          });
    try {
        await client.start();
        return client;
    } catch (error) {
        try {
            await client.stop();
        } catch (stopError) {
            debug(
                "Failed to stop Copilot client after startup failure: %O",
                stopError,
            );
        }
        throw error;
    }
}

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
    private readonly toolAdapter: WebFlowToolAdapter;

    constructor(
        private browserApi: WebFlowBrowserAPI,
        private callbacks?: BrowserReasoningCallbacks,
        private copilotClientFactory: BrowserReasoningCopilotClientFactory = createCopilotClient,
    ) {
        this.toolAdapter = this.createToolAdapter();
    }

    private createToolAdapter(): WebFlowToolAdapter {
        const toolCallbacks: WebFlowToolCallbacks = {
            onStepRecorded: (step) => {
                this.callbacks?.onToolResult?.(step.tool, step.result);
            },
            onToolCall: (tool, args) => {
                this.callbacks?.onToolCall?.(tool, args);
            },
        };
        if (this.callbacks?.onThinking) {
            toolCallbacks.onThinking = this.callbacks.onThinking;
        }
        if (this.callbacks?.onText) {
            toolCallbacks.onText = this.callbacks.onText;
        }
        return new WebFlowToolAdapter(this.browserApi, toolCallbacks);
    }

    /**
     * Creates an agent using the unified WebFlowBrowserAPI tools.
     * This ensures the reasoning phase uses the same API methods that will appear in saved scripts.
     */
    static withUnifiedTools(
        browserApi: WebFlowBrowserAPI,
        callbacks?: BrowserReasoningCallbacks,
    ): BrowserReasoningAgent {
        return new BrowserReasoningAgent(browserApi, callbacks);
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
        const provider =
            config.provider ??
            (config.model?.startsWith("claude-") ? "claude" : "copilot");
        const fullConfig: BrowserReasoningConfig = {
            ...DEFAULT_BROWSER_REASONING_CONFIG,
            ...config,
            provider,
            model:
                config.model ??
                (provider === "claude"
                    ? DEFAULT_CLAUDE_MODEL
                    : DEFAULT_BROWSER_REASONING_CONFIG.model),
        };

        const startTime = Date.now();
        throwIfAborted(fullConfig.abortSignal);
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
        throwIfAborted(fullConfig.abortSignal);

        this.toolAdapter.clearSteps();
        const systemPrompt = this.buildUnifiedSystemPrompt(fullConfig);
        const result =
            fullConfig.provider === "claude"
                ? await this.executeWithClaude(fullConfig, systemPrompt)
                : await this.executeWithCopilot(fullConfig, systemPrompt);

        return {
            goal: fullConfig.goal,
            startUrl,
            steps: this.convertRecordedSteps(
                this.toolAdapter.getRecordedSteps(),
            ),
            result,
            duration: Date.now() - startTime,
        };
    }

    private async executeWithClaude(
        config: BrowserReasoningConfig,
        systemPrompt: string,
    ): Promise<BrowserReasoningTrace["result"]> {
        const { createSdkMcpServer, query } = await import(
            "@anthropic-ai/claude-agent-sdk"
        );
        const tools = this.toolAdapter.buildTools();
        const abortController = new AbortController();
        const abortListener = () =>
            abortController.abort(config.abortSignal?.reason);
        config.abortSignal?.addEventListener("abort", abortListener, {
            once: true,
        });
        if (config.abortSignal?.aborted) {
            abortListener();
        }
        const options: Options = {
            model: config.model,
            maxTurns: config.maxSteps,
            systemPrompt,
            abortController,
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
                prompt: config.goal,
                options: { ...options, ...claudeExecutableOption() },
            });

            for await (const message of queryInstance) {
                throwIfAborted(config.abortSignal);
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
                                this.toolAdapter.setThinkingForLastStep(
                                    thinkingContent,
                                );
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
        } finally {
            config.abortSignal?.removeEventListener("abort", abortListener);
        }

        return { success, summary };
    }

    private async executeWithCopilot(
        config: BrowserReasoningConfig,
        systemPrompt: string,
    ): Promise<BrowserReasoningTrace["result"]> {
        const client = await this.copilotClientFactory();
        let session: BrowserReasoningCopilotSession | undefined;
        let abortListener: (() => void) | undefined;
        let stepLimitReached = false;

        try {
            throwIfAborted(config.abortSignal);
            let toolCallCount = 0;
            const tools = this.toolAdapter.buildCopilotTools(() => {
                if (toolCallCount >= config.maxSteps) {
                    stepLimitReached = true;
                    void session
                        ?.abort()
                        .catch((error) =>
                            debug(
                                "Failed to abort Copilot session at step limit: %O",
                                error,
                            ),
                        );
                    throw new Error(
                        `Maximum browser reasoning steps (${config.maxSteps}) reached.`,
                    );
                }
                toolCallCount++;
            });
            session = await client.createSession({
                clientName: "TypeAgent Browser WebFlow",
                model: config.model,
                reasoningEffort: "high",
                streaming: true,
                tools,
                availableTools: tools.map((tool) => `custom:${tool.name}`),
                toolSearch: { enabled: false },
                systemMessage: { mode: "replace", content: systemPrompt },
                skipCustomInstructions: true,
                onPermissionRequest: () => ({
                    kind: "reject",
                    feedback:
                        "Only the configured WebFlow browser tools are allowed.",
                }),
            });

            if (config.abortSignal) {
                const activeSession = session;
                let rejectForAbort: (reason?: unknown) => void = () => {};
                const aborted = new Promise<never>((_, reject) => {
                    rejectForAbort = reject;
                });
                abortListener = () => {
                    void activeSession
                        .abort()
                        .catch((error) =>
                            debug("Failed to abort Copilot session: %O", error),
                        );
                    rejectForAbort(config.abortSignal?.reason);
                };
                config.abortSignal.addEventListener("abort", abortListener, {
                    once: true,
                });
                if (config.abortSignal.aborted) {
                    abortListener();
                }
                const response = await Promise.race([
                    session.sendAndWait(
                        { prompt: config.goal },
                        COPILOT_TIMEOUT_MS,
                    ),
                    aborted,
                ]);
                if (stepLimitReached) {
                    return this.stepLimitResult(config.maxSteps);
                }
                return this.copilotResponseResult(response);
            }

            const response = await session.sendAndWait(
                { prompt: config.goal },
                COPILOT_TIMEOUT_MS,
            );
            if (stepLimitReached) {
                return this.stepLimitResult(config.maxSteps);
            }
            return this.copilotResponseResult(response);
        } catch (error) {
            if (stepLimitReached) {
                return this.stepLimitResult(config.maxSteps);
            }
            return {
                success: false,
                summary: error instanceof Error ? error.message : String(error),
            };
        } finally {
            if (abortListener && config.abortSignal) {
                config.abortSignal.removeEventListener("abort", abortListener);
            }
            if (session) {
                try {
                    await session.disconnect();
                } catch (error) {
                    debug("Failed to disconnect Copilot session: %O", error);
                }
            }
            try {
                await client.stop();
            } catch (error) {
                debug("Failed to stop Copilot client: %O", error);
            }
        }
    }

    private stepLimitResult(maxSteps: number): BrowserReasoningTrace["result"] {
        return {
            success: false,
            summary: `Maximum browser reasoning steps (${maxSteps}) reached.`,
        };
    }

    private copilotResponseResult(
        response: AssistantMessageEvent | undefined,
    ): BrowserReasoningTrace["result"] {
        const summary = response?.data.content ?? "";
        if (summary) {
            this.callbacks?.onText?.(summary);
        }
        return {
            success: response !== undefined,
            summary: summary || "Copilot returned no final response.",
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
            "- extractComponent - Find UI elements",
            "- click - Click an element",
            "- clickAndWait - Click and wait for page update",
            "- enterText - Type into a field",
            "- clearAndType - Clear and type text",
            "- selectOption - Select dropdown option",
            "- pressKey - Press keyboard key",
            "- navigateTo - Navigate to URL",
            "- awaitPageLoad - Wait for page load",
            "- checkPageState - Verify page content",
            "- getPageText - Read page text",
            "- queryContent - Extract structured data",
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
            `Complete the goal in at most ${config.maxSteps} browser actions.`,
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
