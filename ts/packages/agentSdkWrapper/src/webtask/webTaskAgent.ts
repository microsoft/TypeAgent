// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { WebTask, TaskExecutionResult } from "./types.js";
import { TraceCollector } from "./tracing/traceCollector.js";
import { TraceCollectorOptions } from "./tracing/types.js";
import { PlanGenerator } from "./planning/planGenerator.js";
import { PlanSerializer } from "./planning/planSerializer.js";
import { ExecutionPlan } from "./planning/types.js";
import { WebFlowGenerator } from "./webFlowGenerator.js";
import path from "path";

/**
 * Task execution options
 */
export interface TaskExecutionOptions {
    collectTraces?: boolean | undefined;
    traceDir?: string | undefined;
    captureScreenshots?: boolean | undefined;
    captureHTML?: boolean | undefined;
    usePlanning?: boolean | undefined; // Enable explicit planning and learning
    planDetailLevel?: "minimal" | "standard" | "detailed" | undefined;
}

/**
 * WebTask Agent that executes browser automation tasks using subagents
 */
export class WebTaskAgent {
    private options: Options;
    private isFirstQuery: boolean = true;
    private runId: string;

    constructor(options: Options, runId?: string | undefined) {
        this.options = options;
        this.runId = runId || this.generateRunId();
    }

    /**
     * Generate a unique run ID
     */
    private generateRunId(): string {
        const date = new Date().toISOString().split("T")[0];
        const timestamp = Date.now().toString().slice(-6);
        return `${date}_run-${timestamp}`;
    }

    /**
     * Execute a single WebTask using a subagent (with optional planning)
     */
    async executeTask(
        task: WebTask,
        execOptions?: TaskExecutionOptions | undefined,
    ): Promise<TaskExecutionResult> {
        const startTime = Date.now();

        console.log(`\n[Task ${task.id}] ${task.description}`);
        console.log(`[URL] ${task.startingUrl}`);
        console.log(
            `[Category] ${task.category} | [Difficulty] ${task.difficulty}`,
        );

        // Route to plan-based execution if enabled
        if (execOptions?.usePlanning) {
            console.log(`[Planning] Explicit planning enabled`);
            return await this.executeTaskWithPlanning(task, execOptions);
        }

        // Initialize trace collector if enabled
        let tracer: TraceCollector | null = null;
        if (execOptions?.collectTraces) {
            const modelName =
                typeof this.options.model === "string"
                    ? this.options.model
                    : "claude-sonnet-4-5-20250929";

            const traceOptions: TraceCollectorOptions = {
                task,
                runId: this.runId,
                traceDir: execOptions.traceDir,
                captureScreenshots: execOptions.captureScreenshots ?? false, // Phase 2
                captureHTML: execOptions.captureHTML ?? true,
                model: modelName,
            };

            tracer = new TraceCollector(traceOptions);
            await tracer.initialize();

            // Set environment variable for MCP tools to access HTML directory
            const htmlDir = path.join(tracer.getTraceDir(), "html");
            process.env.TYPEAGENT_HTML_DIR = htmlDir;

            console.log(
                `[Trace] Collecting traces to: ${tracer.getTraceDir()}`,
            );
        }

        try {
            // Build subagent prompt
            const prompt = this.buildSubagentPrompt(task);

            // Launch subagent via Task tool
            console.log(`[Subagent] Launching browser automation subagent...`);

            const queryOptions: Options = {
                ...this.options,
                continue: !this.isFirstQuery,
            };

            if (this.isFirstQuery) {
                this.isFirstQuery = false;
            }

            // Execute query and collect all messages
            const queryInstance = query({
                prompt: prompt,
                options: queryOptions,
            });

            let finalResponse = "";
            let steps: string[] = [];

            // Track pending tool calls for trace collection
            const pendingToolCalls = new Map<
                string,
                { name: string; input: any }
            >();

            for await (const message of queryInstance) {
                if (message.type === "result") {
                    if (message.subtype === "success") {
                        finalResponse = message.result || "";
                    }
                    break;
                } else if (message.type === "assistant") {
                    // Track assistant responses
                    const msg = message.message;

                    // TRACE: Record agent thinking
                    if (tracer) {
                        tracer.recordThinking(msg);
                    }

                    if (msg.content) {
                        for (const block of msg.content) {
                            if (block.type === "text") {
                                finalResponse += block.text;
                            } else if (block.type === "tool_use") {
                                steps.push(
                                    `${block.name}(${JSON.stringify(block.input).substring(0, 100)}...)`,
                                );

                                // Track tool call for later result matching
                                pendingToolCalls.set(block.id, {
                                    name: block.name,
                                    input: block.input,
                                });

                                // TRACE: Record tool call
                                if (tracer) {
                                    tracer.recordToolCall(
                                        block.id,
                                        block.name,
                                        block.input,
                                    );
                                }
                            }
                        }
                    }
                } else if (message.type === "user") {
                    // Tool results come back as user messages with tool_result content blocks
                    const msg = (message as any).message;
                    if (tracer && msg && msg.content) {
                        for (const block of msg.content) {
                            if (block.type === "tool_result") {
                                const toolUseId = block.tool_use_id;
                                let content = "";
                                const isError = block.is_error || false;

                                // Extract content from tool_result
                                if (Array.isArray(block.content)) {
                                    for (const contentBlock of block.content) {
                                        if (contentBlock.type === "text") {
                                            content += contentBlock.text;
                                        }
                                    }
                                } else if (typeof block.content === "string") {
                                    content = block.content;
                                }

                                // Record and process (copies files to trace dir)
                                await tracer.recordToolResult(
                                    toolUseId,
                                    content,
                                    isError,
                                );
                            }
                        }
                    }
                }
            }

            console.log(`[Subagent] Execution complete`);

            // Try to parse structured result
            const result = this.parseSubagentResult(finalResponse);

            const duration = Date.now() - startTime;

            // TRACE: Mark complete and save
            if (tracer) {
                tracer.markComplete(result.success, result.error);
                await tracer.saveTrace();
            }

            const executionResult: TaskExecutionResult = {
                taskId: task.id,
                success: result.success,
                data: result.data,
                duration: duration,
                steps: steps,
            };

            if (result.error) {
                executionResult.error = result.error;
            }

            return executionResult;
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(
                `[Error] ${error instanceof Error ? error.message : String(error)}`,
            );

            // TRACE: Mark failed and save
            if (tracer) {
                const errorMsg =
                    error instanceof Error ? error.message : String(error);
                tracer.markComplete(false, errorMsg);
                await tracer.saveTrace();
            }

            return {
                taskId: task.id,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                duration: duration,
            };
        }
    }

    /**
     * Execute a single step with the subagent and capture state
     * Used by PlanExecutor to execute individual plan steps
     */
    async executeStep(
        stepPrompt: string,
        tracer?: TraceCollector | undefined,
    ): Promise<{
        success: boolean;
        response: string;
        capturedUrl?: string;
        toolCalls: Array<{ name: string; input: any; result: any }>;
    }> {
        const queryOptions: Options = {
            ...this.options,
            continue: !this.isFirstQuery,
        };

        if (this.isFirstQuery) {
            this.isFirstQuery = false;
        }

        const queryInstance = query({
            prompt: stepPrompt,
            options: queryOptions,
        });

        let finalResponse = "";
        let capturedUrl: string | undefined;
        const toolCalls: Array<{ name: string; input: any; result: any }> = [];

        // Track pending tool calls for result matching
        const pendingToolCalls = new Map<
            string,
            { name: string; input: any }
        >();

        for await (const message of queryInstance) {
            if (message.type === "result") {
                if (message.subtype === "success") {
                    finalResponse = message.result || "";
                }
                break;
            } else if (message.type === "assistant") {
                const msg = message.message;

                // Record thinking in tracer
                if (tracer) {
                    tracer.recordThinking(msg);
                }

                if (msg.content) {
                    for (const block of msg.content) {
                        if (block.type === "text") {
                            finalResponse += block.text;
                        } else if (block.type === "tool_use") {
                            // Track tool call
                            pendingToolCalls.set(block.id, {
                                name: block.name,
                                input: block.input,
                            });

                            // Record in tracer
                            if (tracer) {
                                tracer.recordToolCall(
                                    block.id,
                                    block.name,
                                    block.input,
                                );
                            }
                        }
                    }
                }
            } else if (message.type === "user") {
                // Tool results
                const msg = (message as any).message;
                if (msg && msg.content) {
                    for (const block of msg.content) {
                        if (block.type === "tool_result") {
                            const toolUseId = block.tool_use_id;
                            let content = "";
                            const isError = block.is_error || false;

                            // Extract content
                            if (Array.isArray(block.content)) {
                                for (const contentBlock of block.content) {
                                    if (contentBlock.type === "text") {
                                        content += contentBlock.text;
                                    }
                                }
                            } else if (typeof block.content === "string") {
                                content = block.content;
                            }

                            // Record in tracer
                            if (tracer) {
                                await tracer.recordToolResult(
                                    toolUseId,
                                    content,
                                    isError,
                                );
                            }

                            // Extract URL from getCurrentUrl results
                            const toolInfo = pendingToolCalls.get(toolUseId);
                            if (toolInfo && toolInfo.name === "getCurrentUrl") {
                                const urlMatch = content.match(
                                    /Current URL:\s*(https?:\/\/[^\s\n]+)/i,
                                );
                                if (urlMatch) {
                                    capturedUrl = urlMatch[1];
                                }
                            }

                            // Store tool call result
                            if (toolInfo) {
                                toolCalls.push({
                                    name: toolInfo.name,
                                    input: toolInfo.input,
                                    result: content,
                                });
                            }
                        }
                    }
                }
            }
        }

        const result: {
            success: boolean;
            response: string;
            capturedUrl?: string;
            toolCalls: Array<{ name: string; input: any; result: any }>;
        } = {
            success: true,
            response: finalResponse,
            toolCalls,
        };

        if (capturedUrl !== undefined) {
            result.capturedUrl = capturedUrl;
        }

        return result;
    }

    /**
     * Execute task with explicit planning and learning
     */
    private async executeTaskWithPlanning(
        task: WebTask,
        execOptions: TaskExecutionOptions,
    ): Promise<TaskExecutionResult> {
        const startTime = Date.now();
        const traceDir = execOptions.traceDir || "./traces";

        // Initialize trace collector
        let tracer: TraceCollector | null = null;
        if (execOptions.collectTraces) {
            const modelName =
                typeof this.options.model === "string"
                    ? this.options.model
                    : "claude-sonnet-4-5-20250929";

            const traceOptions: TraceCollectorOptions = {
                task,
                runId: this.runId,
                traceDir: execOptions.traceDir,
                captureScreenshots: execOptions.captureScreenshots ?? false,
                captureHTML: execOptions.captureHTML ?? true,
                model: modelName,
            };

            tracer = new TraceCollector(traceOptions);
            await tracer.initialize();

            // Set environment variable for MCP tools to access HTML directory
            const htmlDir = path.join(tracer.getTraceDir(), "html");
            process.env.TYPEAGENT_HTML_DIR = htmlDir;

            console.log(
                `[Trace] Collecting traces to: ${tracer.getTraceDir()}`,
            );
        }

        try {
            // STEP 1: LOAD OR GENERATE PLAN
            const serializer = new PlanSerializer();
            let originalPlan: ExecutionPlan;
            let usingCachedPlan = false;

            // Check for existing plan
            const existingPlan = await serializer.loadExistingPlan(task.id);

            if (existingPlan) {
                console.log(
                    `[Planning] Using existing plan v${existingPlan.version} (${existingPlan.steps.length} steps)`,
                );
                originalPlan = existingPlan;
                usingCachedPlan = true;
            } else {
                console.log(`[Planning] Generating new execution plan...`);
                const planner = new PlanGenerator(this.options);
                originalPlan = await planner.generatePlan(task, {
                    detailLevel: execOptions.planDetailLevel || "standard",
                    includeControlFlow: true,
                });

                console.log(
                    `[Planning] Generated plan with ${originalPlan.steps.length} steps`,
                );
            }

            // Save original plan to trace dir
            const originalPlanPath = await serializer.saveOriginalPlan(
                originalPlan,
                traceDir,
            );
            await serializer.savePlanSummary(originalPlan, traceDir);

            // Set plan in tracer
            if (tracer) {
                tracer.setPlan(originalPlan);
                tracer.setPlanPaths(originalPlanPath);
            }

            // STEP 2: Convert plan to WebFlow for store-based execution
            let domain: string | undefined;
            try {
                domain = new URL(task.startingUrl).hostname;
            } catch {
                // invalid URL
            }

            const flowGen = new WebFlowGenerator();
            const webFlow = flowGen.generate(originalPlan, domain);

            if (webFlow) {
                console.log(
                    `[WebFlow] Generated: ${webFlow.name} (${webFlow.grammarPatterns.length} patterns)`,
                );

                const flowPath = path.join(
                    traceDir,
                    `${webFlow.name}.webflow.json`,
                );
                const fs = await import("node:fs/promises");
                await fs.writeFile(flowPath, JSON.stringify(webFlow, null, 2));
                console.log(`[WebFlow] Saved to: ${flowPath}`);
            }

            // Save plan to library for future use
            if (!usingCachedPlan) {
                await serializer.savePlanToLibrary(originalPlan);
                console.log(`[Planning] Saved plan to library for future use`);
            }

            // Mark trace complete and save
            if (tracer) {
                tracer.markComplete(true);
                await tracer.saveTrace();
            }

            const duration = Date.now() - startTime;

            return {
                taskId: task.id,
                success: true,
                data: { plan: originalPlan },
                duration: duration,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[Error] Plan-based execution failed:`, error);

            if (tracer) {
                tracer.markComplete(
                    false,
                    error instanceof Error ? error.message : String(error),
                );
                await tracer.saveTrace();
            }

            return {
                taskId: task.id,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                duration: duration,
            };
        }
    }

    /**
     * Build the subagent prompt for a WebTask
     */
    private buildSubagentPrompt(task: WebTask): string {
        return `Execute this browser automation task using a subagent:

Task: "${task.description}"
Starting URL: ${task.startingUrl}
Category: ${task.category}
Difficulty: ${task.difficulty}

Use the Task tool to launch a general-purpose subagent with this prompt:

"""
You are a browser automation expert. Execute this task:
"${task.description}"

Starting URL: ${task.startingUrl}

# Tool Categories

You have two categories of browser tools (via mcp__command-executor__):

## 1. WebFlow Tools — For performing actions on the page

Use these to discover and execute saved automation flows:

- **webflow__list** — List available WebFlow actions for the current domain.
  Call this first to see what actions are available.
  \`\`\`
  webflow__list({ domain: "amazon.com" })
  → Returns list of flows with names, descriptions, and parameters
  \`\`\`

- **webflow__execute** — Execute a WebFlow by name with parameters.
  \`\`\`
  webflow__execute({ flowName: "searchForProduct", parameters: '{"productName": "shoes"}' })
  → Executes the saved automation flow
  \`\`\`

## 2. Draft Script Tool — For new interactions where no WebFlow exists

- **webflow__run_draft** — Write and run a browser automation script on the fly.

  The script must be an async function using the WebFlow browser API:
  \`\`\`
  webflow__run_draft({
      script: "async function execute(browser, params) { await browser.enterText('#search', params.query); await browser.click('#go'); await browser.awaitPageLoad(); return { success: true }; }",
      parameters: '{"query": "flights to Portland"}'
  })
  \`\`\`

  Available browser API methods:
  - browser.click(cssSelector) — Click an element
  - browser.enterText(cssSelector, text) — Type into an input
  - browser.enterTextOnPage(text, submitForm?) — Type at page scope
  - browser.selectOption(cssSelector, value) — Select dropdown value
  - browser.pressKey(key) — Press a key (e.g., "Enter", "Escape")
  - browser.awaitPageLoad(timeout?) — Wait for page navigation
  - browser.awaitPageInteraction(timeout?) — Wait for dynamic content
  - browser.navigateTo(url) — Navigate to a URL
  - browser.getCurrentUrl() — Get current URL
  - browser.getPageText() — Get visible text content
  - browser.captureScreenshot() — Take screenshot (returns data URL)
  - browser.checkPageState(description) — Verify page state (LLM-based)
  - browser.queryContent(question) — Ask about page content (LLM-based)
  - browser.extractComponent(def, request?) — Extract structured data
  - browser.followLink(cssSelector) — Click link and wait for navigation
  - browser.clickAndWait(cssSelector) — Click and wait for page load

## 3. Navigation & Observation Tools — For exploring pages

- **browser__openWebPage** — Navigate to a URL: \`browser__openWebPage({ site: "https://example.com" })\`
- **browser__captureScreenshot** — Take a screenshot to see the current page state
- **browser__scrollDown / browser__scrollUp** — Scroll to reveal more content
- **browser__followLinkByText** — Click a link by its visible text: \`browser__followLinkByText({ keywords: "Sign In" })\`
- **browser__closeWebPage** — Close the current page

# Workflow

1. **Navigate** to the starting URL with browser__openWebPage
2. **Observe** the page with browser__captureScreenshot
3. **Check** for saved WebFlows with webflow__list
4. If a matching flow exists → **webflow__execute**
5. If not → **Write a draft script** and run with webflow__run_draft
6. **Verify** results with browser__captureScreenshot or browser.checkPageState
7. **Iterate** as needed for multi-step tasks

# IMPORTANT RULES

- **ALL web page interactions MUST go through webflow__run_draft or webflow__execute.**
  Do NOT use execute_command for browser actions — it uses unreliable natural language matching.
- webflow__run_draft gives you full control: exact CSS selectors, structured return values,
  and the same sandboxed API as saved WebFlows.
- For extracting data from a page, write a draft script using browser.queryContent() or browser.getPageText().
- For filling forms, clicking buttons, or selecting options, write a draft script using
  browser.enterText(), browser.click(), browser.selectOption(), etc.
- Navigation tools (browser__openWebPage, browser__scrollDown, browser__captureScreenshot,
  browser__followLinkByText) can be used directly — they don't modify page state.

# Tips for writing draft scripts

- Use browser__captureScreenshot first to understand the page layout
- Keep scripts focused — one logical step per script
- Use browser.queryContent() to extract data from the page
- Use browser.checkPageState() to verify results before proceeding
- If you need to find a CSS selector, use browser.captureScreenshot() and reason about the page structure,
  or use browser.getPageText() and look for landmarks near the target element

${this.getCategorySpecificGuidance(task.category)}

Return format:
{
  "success": true,
  "data": <extracted or confirmed data>,
  "steps": ["step 1", "step 2", ...]
}

If something fails, return:
{
  "success": false,
  "error": "description of what went wrong",
  "steps": ["step 1", "step 2 (failed)", ...]
}
"""

Launch the subagent and return its result.`;
    }

    /**
     * Get category-specific guidance
     */
    private getCategorySpecificGuidance(category: string): string {
        switch (category) {
            case "READ":
                return `
This is a READ task - extract information from the page.
Expected result: Structured data (array of objects, list of items, etc.)
Example: [{"title": "...", "price": "..."}]`;

            case "CREATE":
                return `
This is a CREATE task - add new content (post, comment, item, etc.)
Expected result: Confirmation that item was created
Example: {"success": true, "created": "blog post", "id": "123"}`;

            case "DELETE":
                return `
This is a DELETE task - remove existing content
Expected result: Confirmation that item was deleted
Example: {"success": true, "deleted": "item #5"}`;

            case "UPDATE":
                return `
This is an UPDATE task - modify existing content
Expected result: Confirmation that item was updated
Example: {"success": true, "updated": "profile settings"}`;

            default:
                return "";
        }
    }

    /**
     * Parse subagent result from text response
     */
    private parseSubagentResult(response: string): {
        success: boolean;
        data?: any;
        error?: string;
    } {
        // Try to extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*"success"[\s\S]*\}/);

        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                return parsed;
            } catch (e) {
                // Failed to parse JSON
            }
        }

        // If no JSON found, check if response indicates success
        if (response.toLowerCase().includes("success")) {
            return {
                success: true,
                data: { raw: response },
            };
        }

        // Default to failure
        return {
            success: false,
            error: "Could not parse subagent result",
            data: { raw: response },
        };
    }

    /**
     * Execute multiple tasks sequentially
     */
    async executeTasks(
        tasks: WebTask[],
        execOptions?: TaskExecutionOptions | undefined,
    ): Promise<TaskExecutionResult[]> {
        const results: TaskExecutionResult[] = [];

        console.log(`\n=== Executing ${tasks.length} WebBench Tasks ===`);

        if (execOptions?.collectTraces) {
            console.log(`[Trace] Run ID: ${this.runId}`);
            console.log(
                `[Trace] Traces will be saved to: ${execOptions.traceDir || "./traces"}/${this.runId}`,
            );
        }

        for (let i = 0; i < tasks.length; i++) {
            console.log(`\n--- Task ${i + 1}/${tasks.length} ---`);
            const result = await this.executeTask(tasks[i], execOptions);
            results.push(result);

            // Print result summary
            if (result.success) {
                console.log(`✓ SUCCESS (${result.duration}ms)`);
            } else {
                console.log(`✗ FAILED (${result.duration}ms): ${result.error}`);
            }
        }

        return results;
    }
}
