// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { WebTask, TaskExecutionResult } from "./types.js";
import { TraceCollector } from "./tracing/traceCollector.js";
import { TraceCollectorOptions } from "./tracing/types.js";
import { PlanGenerator } from "./planning/planGenerator.js";
import { PlanExecutor } from "./planning/planExecutor.js";
import { PlanSerializer } from "./planning/planSerializer.js";
import { ExecutionPlan } from "./planning/types.js";
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

            // STEP 2: EXECUTE PLAN
            console.log(`[Execution] Executing plan...`);
            const executor = new PlanExecutor();
            const planResult = await executor.executePlan(
                originalPlan,
                this.options,
                this, // Pass WebTaskAgent instance for step execution
                tracer || undefined,
            );

            console.log(
                `[Execution] Plan execution ${planResult.success ? "succeeded" : "failed"}`,
            );
            console.log(
                `[Execution] Executed ${planResult.executedSteps}/${planResult.totalSteps} steps`,
            );
            if (planResult.corrections.length > 0) {
                console.log(
                    `[Execution] ${planResult.corrections.length} corrections made during execution`,
                );
            }

            // STEP 3: LEARN AND UPDATE PLAN (if needed)
            if (tracer) {
                // Evaluate if plan needs updating
                const updateDecision =
                    serializer.shouldUpdatePlan(originalPlan);

                if (updateDecision.shouldUpdate) {
                    console.log(`[Learning] ${updateDecision.reason}`);
                    console.log(
                        `[Learning] Generating revised plan based on execution...`,
                    );

                    const planner = new PlanGenerator(this.options);
                    const trace = tracer.getTrace();

                    const revisedPlan = await planner.revisePlan(
                        originalPlan,
                        trace,
                        {
                            preserveStructure: false,
                            onlyCorrections: false,
                        },
                    );

                    console.log(
                        `[Learning] Generated revised plan (v${revisedPlan.version})`,
                    );

                    // Save revised plan to trace dir
                    const revisedPlanPath = await serializer.saveRevisedPlan(
                        revisedPlan,
                        traceDir,
                    );
                    await serializer.savePlanSummary(revisedPlan, traceDir);
                    await serializer.savePlanComparison(
                        originalPlan,
                        revisedPlan,
                        traceDir,
                    );

                    // Update tracer with revised plan path
                    tracer.setPlanPaths(originalPlanPath, revisedPlanPath);

                    // Save revised plan to library for future use
                    await serializer.savePlanToLibrary(revisedPlan);

                    console.log(`[Learning] Saved revised plan and comparison`);
                } else {
                    console.log(
                        `[Learning] Plan is good, no revision needed: ${updateDecision.reason}`,
                    );

                    // If we generated a new plan (not cached), save it to library
                    if (!usingCachedPlan) {
                        await serializer.savePlanToLibrary(originalPlan);
                        console.log(
                            `[Learning] Saved new plan to library for future use`,
                        );
                    }
                }
            }

            // Mark trace complete and save
            if (tracer) {
                tracer.markComplete(planResult.success, planResult.error);
                await tracer.saveTrace();
            }

            const duration = Date.now() - startTime;

            return {
                taskId: task.id,
                success: planResult.success,
                data: planResult.data,
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

# Available Browser Actions

You have access to browser action tools (via mcp__command-executor__). The available actions are defined by the following TypeScript schema:

\`\`\`typescript
// Open a web page
export type OpenWebPage = {
    actionName: "browser__openWebPage";
    parameters: {
        site: string; // URL to open
        tab?: "new" | "current" | "existing"; // Optional: where to open (default: current)
    };
};

// Get the HTML content of the current page
// ⚠️ USE AS LAST RESORT - Prefer semantic query actions (see below)
// Returns HTML as text that you can read and analyze
export type GetHTML = {
    actionName: "browser__getHTML";
    parameters?: {
        fullHTML?: boolean; // Include complete HTML (default: false)
        extractText?: boolean; // Extract text only (default: false)
    };
};

// Click on an element using a CSS selector
export type ClickOnElement = {
    actionName: "browser__clickOnElement";
    parameters: {
        cssSelector: string; // CSS selector for the element to click
    };
};

// Type text into an input element
export type EnterTextInElement = {
    actionName: "browser__enterTextInElement";
    parameters: {
        cssSelector: string; // CSS selector for the input element
        value: string; // Text to enter
        submitForm?: boolean; // Submit the form after entering text (default: false)
    };
};

// Wait for the page to finish loading
export type AwaitPageLoad = {
    actionName: "browser__awaitPageLoad";
};

// Scroll down on the current page
export type ScrollDown = {
    actionName: "browser__scrollDown";
};

// Scroll up on the current page
export type ScrollUp = {
    actionName: "browser__scrollUp";
};

// Union of all available browser actions
export type BrowserAction =
    | OpenWebPage
    | GetHTML
    | ClickOnElement
    | EnterTextInElement
    | AwaitPageLoad
    | ScrollDown
    | ScrollUp;
\`\`\`

# ⭐ BROWSER SEMANTIC QUERY ACTIONS (PREFER THESE)

You have access to semantic query actions that use LLM to understand page content.
These are CORE BROWSER ACTIONS and are MUCH BETTER than parsing raw HTML.

**Semantic Query Actions** (available for ALL sites via typeagent_action):

1. **queryPageContent** - Extract ANY information from page ⭐ USE THIS FIRST
   \`\`\`typescript
   execute_command({
     request: JSON.stringify({
       tool: "typeagent_action",
       parameters: {
         agent: "browser",
         action: "queryPageContent",
         parameters: { query: "what is the product price?" },
         naturalLanguage: "get product price"
       }
     })
   })
   // Returns: { answered: true, answerText: "$24.99", confidence: 0.9 }
   \`\`\`
   Examples:
   - "how many items in stock?" → stock count
   - "what is the product rating?" → rating value
   - "is the item available?" → availability status
   - "what is the total price?" → price

2. **getElementByDescription** - Find elements without CSS selectors ⭐ USE BEFORE getHTML
   \`\`\`typescript
   execute_command({
     request: JSON.stringify({
       tool: "typeagent_action",
       parameters: {
         agent: "browser",
         action: "getElementByDescription",
         parameters: {
           elementDescription: "Add to Cart button",
           elementType: "button"
         },
         naturalLanguage: "find add to cart button"
       }
     })
   })
   // Returns: { found: true, elementCssSelector: "#add-to-cart", elementText: "Add to Cart" }
   \`\`\`

3. **isPageStateMatched** - Verify page state ⭐ USE FOR VALIDATION
   \`\`\`typescript
   execute_command({
     request: JSON.stringify({
       tool: "typeagent_action",
       parameters: {
         agent: "browser",
         action: "isPageStateMatched",
         parameters: { expectedStateDescription: "shopping cart page is displayed" },
         naturalLanguage: "verify cart page"
       }
     })
   })
   // Returns: { matched: true, confidence: 0.95, explanation: "..." }
   \`\`\`

# Instructions

1. **⭐ PREFER SEMANTIC QUERIES OVER RAW HTML**
   - For ANY data extraction → Use queryPageContent FIRST
   - To find elements → Use getElementByDescription FIRST
   - To verify page state → Use isPageStateMatched
   - Only use browser__getHTML as LAST RESORT if semantic queries fail
   - Raw HTML is slower, harder to parse, and more fragile

2. **When to use each approach:**
   - Extracting data (prices, text, counts) → queryPageContent
   - Finding element selectors → getElementByDescription
   - Verifying state after actions → isPageStateMatched
   - Complex multi-element interactions → getHTML (last resort)

3. **Decision tree:**
   a) Try queryPageContent for data extraction
   b) If that fails (answered: false), try getElementByDescription
   c) If that fails (found: false), then use browser__getHTML
   d) For state validation, always use isPageStateMatched

4. **Example workflow with semantic queries:**
   a) browser__openWebPage({ site: "https://example.com" })
   b) browser__awaitPageLoad()
   c) execute_command({
        request: JSON.stringify({
          tool: "typeagent_action",
          parameters: {
            agent: "browser",
            action: "getElementByDescription",
            parameters: { elementDescription: "search input", elementType: "input" },
            naturalLanguage: "find search box"
          }
        })
      })
      → Returns { found: true, elementCssSelector: "input[name='q']" }
   d) browser__enterTextInElement({ cssSelector: "input[name='q']", value: "LED bulbs", submitForm: true })
   e) browser__awaitPageLoad()
   f) execute_command({
        request: JSON.stringify({
          tool: "typeagent_action",
          parameters: {
            agent: "browser",
            action: "queryPageContent",
            parameters: { query: "get titles and prices of first 5 products" },
            naturalLanguage: "extract product list"
          }
        })
      })
      → Returns { answered: true, answerText: "[product data...]" }

**Old workflow (ONLY if semantic queries fail):**
   a) browser__openWebPage({ site: "https://example.com" })
   b) browser__awaitPageLoad()
   c) browser__getHTML() → Returns HTML content
   d) Use Grep/Read to manually parse HTML and find search input selector
   e) browser__clickOnElement({ cssSelector: "input[name='q']" })
   f) browser__enterTextInElement({ cssSelector: "input[name='q']", value: "LED bulbs", submitForm: true })
   g) browser__awaitPageLoad()
   h) browser__getHTML() → Returns search results HTML
   i) Use Grep/Read to manually parse HTML and extract product information

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
