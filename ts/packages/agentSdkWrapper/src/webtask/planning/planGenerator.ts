// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Plan Generator - Uses LLM to generate execution plans for WebTask tasks
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { WebTask } from "../types.js";
import { TraceFile } from "../tracing/types.js";
import {
    ExecutionPlan,
    PlanGenerationOptions,
    PlanRevisionOptions,
} from "./types.js";

export class PlanGenerator {
    private options: Options;

    constructor(options: Options) {
        this.options = options;
    }

    /**
     * Generate initial execution plan for a task
     */
    async generatePlan(
        task: WebTask,
        options?: PlanGenerationOptions,
    ): Promise<ExecutionPlan> {
        const prompt = this.buildPlanGenerationPrompt(task, options);

        console.log(`[PlanGenerator] Generating plan for task ${task.id}...`);

        try {
            // Execute query
            const queryInstance = query({
                prompt,
                options: this.options,
            });

            // Collect response text
            let responseText = "";
            for await (const message of queryInstance) {
                if (message.type === "result") {
                    if (message.subtype === "success") {
                        responseText = message.result || "";
                    }
                    break;
                }
            }

            if (!responseText) {
                throw new Error("No response received from LLM");
            }

            // Extract JSON from response
            const planJson = this.extractPlanJson(responseText);

            // Create full execution plan
            const plan: ExecutionPlan = {
                planId: `plan-${task.id}-v1`,
                taskId: task.id,
                createdAt: new Date().toISOString(),
                version: 1,
                task: {
                    description: task.description,
                    startingUrl: task.startingUrl,
                    category: task.category,
                    difficulty: task.difficulty,
                },
                ...planJson,
            };

            console.log(
                `[PlanGenerator] Generated plan with ${plan.steps.length} steps`,
            );

            return plan;
        } catch (error) {
            console.error(`[PlanGenerator] Error generating plan:`, error);
            throw new Error(
                `Failed to generate plan: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Generate revised plan based on execution trace
     */
    async revisePlan(
        originalPlan: ExecutionPlan,
        executionTrace: TraceFile,
        options?: PlanRevisionOptions,
    ): Promise<ExecutionPlan> {
        const prompt = this.buildPlanRevisionPrompt(
            originalPlan,
            executionTrace,
            options,
        );

        console.log(
            `[PlanGenerator] Generating revised plan for ${originalPlan.taskId}...`,
        );

        try {
            // Execute query
            const queryInstance = query({
                prompt,
                options: this.options,
            });

            // Collect response text
            let responseText = "";
            for await (const message of queryInstance) {
                if (message.type === "result") {
                    if (message.subtype === "success") {
                        responseText = message.result || "";
                    }
                    break;
                }
            }

            if (!responseText) {
                throw new Error("No response received from LLM");
            }

            // Extract JSON from response
            const revisedPlanJson = this.extractPlanJson(responseText);

            // Create revised execution plan
            const revisedPlan: ExecutionPlan = {
                planId: `plan-${originalPlan.taskId}-v${originalPlan.version + 1}`,
                taskId: originalPlan.taskId,
                createdAt: new Date().toISOString(),
                version: originalPlan.version + 1,
                task: originalPlan.task,
                ...revisedPlanJson,
            };

            console.log(
                `[PlanGenerator] Generated revised plan with ${revisedPlan.steps.length} steps`,
            );

            return revisedPlan;
        } catch (error) {
            console.error(`[PlanGenerator] Error revising plan:`, error);
            throw new Error(
                `Failed to revise plan: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Build prompt for initial plan generation
     */
    private buildPlanGenerationPrompt(
        task: WebTask,
        options?: PlanGenerationOptions,
    ): string {
        const detailLevel = options?.detailLevel || "standard";
        const includeControlFlow = options?.includeControlFlow !== false;

        return `You are a browser automation planning expert. Generate a detailed execution plan for this web automation task.

# Task Details

**Task Description**: ${task.description}
**Starting URL**: ${task.startingUrl}
**Category**: ${task.category}
**Difficulty**: ${task.difficulty}

${options?.taskSpecificHints ? `\n**Hints**: ${options.taskSpecificHints.join(", ")}\n` : ""}

# Your Mission

Generate a structured execution plan in JSON format that:
1. Predicts the goal state (what the page should look like when task completes)
2. Breaks the task into logical steps
3. For each step, predicts the expected page state
4. Defines variables that flow between steps
5. Includes preconditions to ensure correct execution order
${includeControlFlow ? "6. Uses control flow (if/then/else, loops, retry) for dynamic behavior" : ""}

# Output Format

Generate ONLY valid JSON (no markdown, no explanations) following this schema:

\`\`\`json
{
  "goalState": {
    "expectedPageType": "string - type of page when task completes",
    "expectedElements": [
      {
        "role": "button|input|heading|etc",
        "description": "what element should exist",
        "required": true|false
      }
    ],
    "expectedContent": [
      {
        "location": "where to find this content",
        "containsKeywords": ["keyword1", "keyword2"]
      }
    ],
    "stateVariables": {
      "variableName": "expected value"
    },
    "confidence": 0.0-1.0
  },
  "steps": [
    {
      "stepId": "step1",
      "stepNumber": 1,
      "objective": "what this step achieves",
      "description": "human-readable description",
      "preconditions": [
        {
          "type": "pageState|variable|stepCompleted|elementExists",
          "description": "what must be true",
          "condition": {
            "type": "pageState|variable|elementExists|custom",
            "expression": "condition expression"
          },
          "required": true|false
        }
      ],
      "actions": [
        {
          "actionId": "action1-1",
          "tool": "navigateToUrl|clickOnElement|enterTextInElement|pressKey|getHTML|findElement|scrollPage",
          "parameters": {
            "cssSelector": "CSS selector (if applicable)",
            "text": "text to enter (if applicable)",
            "url": "URL (if applicable)"
          },
          "rationale": "why this action is needed"
        }
      ],
      "predictedState": {
        "expectedPageType": "type of page (e.g., 'search results', 'article page')",
        "expectedElements": [
          {
            "role": "input|button|heading|link|form (NOT image or img)",
            "description": "what element should be present",
            "required": true|false
          }
        ],
        "expectedContent": [
          {
            "location": "where to find content",
            "containsKeywords": ["keyword1", "keyword2"]
          }
        ],
        "stateVariables": {"varName": "expected value"}
      },
      "inputVariables": ["var1", "var2"],
      "outputVariables": [
        {
          "variableName": "newVariable",
          "source": "toolResult|pageState|computation",
          "extractionPath": "JSONPath for extraction",
          "computation": "expression to compute value"
        }
      ]${
          includeControlFlow
              ? `,
      "controlFlow": {
        "type": "conditional|loop|retry",
        "condition": {
          "type": "elementExists|pageState|variable|custom",
          "expression": "condition expression"
        },
        "thenSteps": [...],
        "elseSteps": [...]
      }`
              : ""
      }
    }
  ],
  "variables": [
    {
      "name": "variableName",
      "type": "string|number|boolean|object|array",
      "description": "what this variable represents",
      "scope": "plan|step"
    }
  ]
}
\`\`\`

# Available Tools

## General Browser Tools
- **navigateToUrl(url: string)** - Navigate to a URL
- **clickOnElement(cssSelector: string)** - Click an element
- **enterTextInElement(cssSelector: string, text: string)** - Type text in an input field
- **pressKey(key: string)** - Press a keyboard key (Enter, Tab, etc.)
- **getHTML()** - Get page HTML for analysis
- **findElement(description: string)** - Find element by natural language description
- **scrollPage(direction: "up"|"down")** - Scroll the page

${
    this.isCommerceTask(task)
        ? `
## Commerce Tools (PREFERRED for shopping/reservation tasks)

⚠️ **IMPORTANT**: These tools are automatically available for commerce tasks. Use them directly:
- **getLocationInStore(productName: string, position?: number)** - Find product's physical location in store
  * Parameters: { "productName": "LED light bulbs", "position": 1 }
  * Returns: aisle number, shelf location, stock quantity, store name
  * Use for: "where is X", "which aisle", "find location"
  * IMPORTANT: Use product name only, e.g., "LED light bulbs" NOT "find LED light bulbs"

- **findNearbyStore()** - Get nearest store location
  * Parameters: {}
  * Returns: store name, address, zip code
  * Use for: "find store", "nearest location"

- **viewShoppingCart()** - View shopping cart contents
  * Parameters: {}
  * Returns: products, prices, delivery info, total
  * Use for: "what's in cart", "view cart"

- **buyProduct(userRequest: string)** - Complete shopping flow (search + select + add to cart)
  * Parameters: { "userRequest": "AAA batteries" } - JUST the product name, no action verbs
  * Returns: completion status, purchase details
  * Use for: "buy X", "purchase Y", "add to cart"
  * IMPORTANT: Parameter should be product name only, e.g., "LED light bulbs" NOT "buy LED light bulbs"
  * NOTE: This tool handles search, selection, and add-to-cart automatically

- **searchForReservation(restaurantName: string, numberOfPeople: number, time: string)** - Find reservation slots
  * Parameters: { "restaurantName": "Olive Garden", "numberOfPeople": 4, "time": "7:00 PM" }
  * Returns: available time slots
  * Use for: "book table", "find reservation"

- **selectReservation(restaurantName: string, time: string)** - Confirm reservation
  * Parameters: { "restaurantName": "Olive Garden", "time": "7:00 PM" }
  * Returns: confirmation status
  * Use for: selecting from searchForReservation results

**Commerce tools are FASTER and MORE RELIABLE than general browser tools for e-commerce sites.**
`
        : ""
}

# Guidelines

${
    detailLevel === "detailed"
        ? `
1. Be very specific with CSS selectors
2. Include detailed rationale for each action
3. Predict page states focusing on content and structure, NOT exact URLs
4. Include extensive preconditions
5. Define all intermediate variables
6. Do NOT predict image elements (they are removed from HTML for efficiency)
`
        : detailLevel === "minimal"
          ? `
1. Focus on essential steps only
2. Use simple, direct actions
3. Minimal preconditions
4. Only critical variables
5. Ignore exact URLs and images in predictions
`
          : `
1. Balance detail with clarity
2. Include key preconditions
3. Define important variables
4. Use control flow where needed
5. Focus on page content/structure, not exact URLs or images
`
}

# Special Considerations for ${this.isCommerceTask(task) ? "COMMERCE" : task.category} Tasks

${this.getCategoryGuidelines(this.isCommerceTask(task) ? "COMMERCE" : task.category)}

# Generate Plan

Generate the plan now as valid JSON:`;
    }

    /**
     * Build prompt for plan revision based on execution
     */
    private buildPlanRevisionPrompt(
        originalPlan: ExecutionPlan,
        executionTrace: TraceFile,
        options?: PlanRevisionOptions,
    ): string {
        const preserveStructure = options?.preserveStructure !== false;
        const onlyCorrections = options?.onlyCorrections || false;

        return `You are a browser automation learning expert. Review the execution trace and generate a revised plan that incorporates learnings.

# Original Plan

${JSON.stringify(originalPlan, null, 2)}

# Execution Trace

**Task**: ${executionTrace.task.description}
**Status**: ${executionTrace.execution.status}
**Duration**: ${executionTrace.execution.duration}ms
**Steps Executed**: ${executionTrace.steps.length}

## Execution Steps

${executionTrace.steps
    .map(
        (step, i) => `
### Step ${i + 1}

**Thinking**: ${step.thinking?.summary || "N/A"}
**Action**: ${step.action ? `${step.action.tool}(${JSON.stringify(step.action.parameters)})` : "N/A"}
**Result**: ${step.result?.success ? "Success" : "Failed"}
${step.result?.error ? `**Error**: ${step.result.error}` : ""}
${step.observation ? `**Observation**: ${step.observation.summary}` : ""}
`,
    )
    .join("\n")}

# Your Mission

Generate a revised plan that:
${
    onlyCorrections
        ? `
1. ONLY incorporates corrections/adaptations that were needed
2. Keeps original structure for steps that worked
3. Updates predicted states based on actual outcomes
`
        : `
1. Incorporates all learnings from execution
2. Updates predicted states to match reality
3. Adds missing steps that were discovered during execution
4. Removes unnecessary steps
5. Improves action sequences based on what worked
`
}

${
    preserveStructure
        ? `
**Preserve Structure**: Keep the same number of steps and overall flow, only update details within steps.
`
        : `
**Optimize Structure**: Feel free to reorganize, add, or remove steps as needed.
`
}

# Output Format

Generate the revised plan as valid JSON using the SAME schema as the original plan:

\`\`\`json
{
  "goalState": {...},
  "steps": [...],
  "variables": [...]
}
\`\`\`

# Key Questions to Answer

1. Which predicted states were accurate? Which were wrong?
2. Which actions worked as expected? Which needed modification?
3. Were there unexpected page states or elements?
4. Were additional steps needed that weren't in the original plan?
5. Could the execution order be improved?
6. Did variables flow correctly between steps?

# Generate Revised Plan

Generate the revised plan now as valid JSON:`;
    }

    /**
     * Get category-specific planning guidelines
     */
    /**
     * Detect if task is commerce-related (shopping, reservations)
     */
    private isCommerceTask(task: WebTask): boolean {
        // Check URL for common commerce domains
        const commerceDomains = [
            "homedepot.com",
            "target.com",
            "walmart.com",
            "amazon.com",
            "bestbuy.com",
            "lowes.com",
            "acehardware.com",
            "opentable.com",
            "resy.com",
            "shop",
            "store",
            "buy",
            "cart",
        ];

        const urlMatch = commerceDomains.some((domain) =>
            task.startingUrl.toLowerCase().includes(domain),
        );

        // Check description for commerce keywords
        const commerceKeywords = [
            "buy",
            "purchase",
            "shopping",
            "cart",
            "checkout",
            "product",
            "store",
            "inventory",
            "stock",
            "price",
            "reservation",
            "book",
            "reserve",
            "restaurant",
            "table",
            "add to cart",
            "in store",
            "location",
            "aisle",
        ];

        const descriptionMatch = commerceKeywords.some((keyword) =>
            task.description.toLowerCase().includes(keyword),
        );

        return urlMatch || descriptionMatch;
    }

    private getCategoryGuidelines(category: string): string {
        const guidelines: Record<string, string> = {
            READ: `
**READ tasks** extract information from pages:
- Step 1: Navigate and locate content
- Step 2: Extract data ⭐ PREFER queryPageContent over getHTML
  * Use queryPageContent for: prices, ratings, stock, counts, text, ANY data extraction
  * Only use getHTML as last resort if queryPageContent fails
- Step 3: Validate data completeness
- Variables: Store extracted data (products, prices, etc.)
- Keep steps minimal, focus on data extraction
- ⚠️ ALWAYS try semantic queries (queryPageContent, getElementByDescription) BEFORE raw HTML
`,
            CREATE: `
**CREATE tasks** create new entities (accounts, posts, etc.):
- Step 1: Navigate to creation form
- Step 2: Fill required fields (use multiple actions)
- Step 3: Handle optional fields (use conditionals)
- Step 4: Submit form (use retry logic)
- Step 5: Verify creation success
- Variables: Form field selectors, submission results
- Include retry logic for form submission
`,
            UPDATE: `
**UPDATE tasks** modify existing data:
- Step 1: Navigate to target entity
- Step 2: Locate edit controls
- Step 3: Modify fields
- Step 4: Save changes (use retry logic)
- Step 5: Verify update success
- Variables: Entity identifiers, updated values
`,
            DELETE: `
**DELETE tasks** remove entities:
- Step 1: Navigate to target entity
- Step 2: Locate delete control
- Step 3: Confirm deletion (handle confirmation dialogs)
- Step 4: Verify deletion success
- Variables: Entity identifiers, confirmation status
- Include conditional for confirmation dialogs
`,
            SEARCH: `
**SEARCH tasks** find and filter content:
- Step 1: Locate search interface
- Step 2: Enter search query
- Step 3: Apply filters (use conditionals)
- Step 4: Extract results
- Variables: Search query, filters, results
`,
            FORM_FILL: `
**FORM_FILL tasks** complete forms:
- Step 1: Analyze form structure
- Step 2: Fill fields in logical order
- Step 3: Handle validation errors (use retry)
- Step 4: Submit form
- Variables: Form data, field selectors
- Include retry for validation failures
`,
            COMMERCE: `
**COMMERCE tasks** involve shopping, reservations, and e-commerce:

⚠️ IMPORTANT: Commerce sites support specialized tools that are FASTER and MORE RELIABLE than general browser tools.

**Available Browser Semantic Query Actions** (use these for ALL browser automation):
⭐ These are CORE BROWSER ACTIONS - use typeagent_action with agent="browser"

- **queryPageContent** - Answer questions about page content ⭐ USE THIS FIRST
  * Tool: typeagent_action with agent="browser", action="queryPageContent"
  * Use for: Extracting ANY information from the page (prices, stock, ratings, counts, text, etc.)
  * Parameters: { query: "how many batteries are in stock?" }
  * Natural language: "query page for battery stock"
  * Returns: { answered: true/false, answerText: "150 batteries in stock", confidence: 0.9, evidence: [...] }
  * Examples:
    - "What is the product price?" → { query: "product price" }
    - "How many items in cart?" → { query: "number of items in shopping cart" }
  * ⚠️ Only fall back to getHTML (browser tool) if this returns answered: false

- **getElementByDescription** - Find element by natural language ⭐ USE THIS FIRST
  * Tool: typeagent_action with agent="browser", action="getElementByDescription"
  * Use for: Locating elements without CSS selectors
  * Parameters: { elementDescription: "Add to Cart button", elementType: "button" }
  * Natural language: "find add to cart button"
  * Returns: { found: true, elementCssSelector: "#add-to-cart", ... }
  * ⚠️ Only fall back to getHTML (browser tool) if this returns found: false

- **isPageStateMatched** - Verify page state ⭐ USE FOR VALIDATION
  * Tool: typeagent_action with agent="browser", action="isPageStateMatched"
  * Use for: Checking page state after actions
  * Parameters: { expectedStateDescription: "page shows shopping cart" }
  * Natural language: "verify shopping cart page"
  * Returns: { matched: true/false, confidence: 0.95, explanation: "..." }
  * ⚠️ Use this instead of getHTML (browser tool) for state verification

**Commerce-Specific Actions**:
Commerce actions use typeagent_action with agent="browser.commerce", action=<actionName>, parameters={...}, naturalLanguage="user's original request"

**SHOPPING & CART ACTIONS**:

- **buyProduct** - Complete shopping flow with automated planning
  * Use for: "buy X", "purchase Y", "add to cart"
  * Parameters: { userRequest: "AAA batteries" } - just product name, NOT "buy AAA batteries"
  * Natural language: "buy AAA batteries" (user's original request)
  * This tool handles search, selection, add-to-cart automatically
  * Returns: completion status, entities collected during purchase

- **getLocationInStore** - Find product's physical location in store (aisle, shelf)
  * Use for: "where is X in store", "which aisle", "find location"
  * Parameters: { productName: "LED light bulbs", position: 1 }
  * Natural language: "where are LED light bulbs in store"
  * Returns: aisle number, shelf location, stock quantity, store name

- **findNearbyStore** - Get nearest store location
  * Use for: "find store", "nearest location", "store hours"
  * Parameters: {} (no parameters)
  * Natural language: "find nearby store"
  * Returns: store name, address, zip code

- **viewShoppingCart** - View shopping cart contents
  * Use for: "what's in cart", "cart total", "view cart"
  * Parameters: {} (no parameters)
  * Natural language: "view shopping cart"
  * Returns: products in cart, prices, delivery info, total amount

- **searchForReservation** - Find restaurant reservation slots
  * Use for: "book table at", "reserve at", "find reservation"
  * Parameters: { restaurantName: "Olive Garden", numberOfPeople: 4, time: "7:00 PM" }
  * Natural language: "search for reservation at Olive Garden for 4 people at 7pm"
  * Returns: available time slots with selectors

- **selectReservation** - Book specific reservation
  * Use for: confirming a time slot from searchForReservation results
  * Parameters: { restaurantName: "Olive Garden", time: "7:00 PM" }
  * Natural language: "select reservation at 7pm"
  * Returns: confirmation status

**Commerce Task Pattern Example** (Buy AAA Batteries from Home Depot):

Step 1: Navigate to Home Depot
{
  "actionId": "action1-1",
  "tool": "navigateToUrl",
  "parameters": { "url": "https://www.homedepot.com" },
  "rationale": "Navigate to starting URL"
}

Step 2: Buy product using commerce tool
{
  "actionId": "action2-1",
  "tool": "typeagent_action",
  "parameters": {
    "agent": "browser.commerce",
    "action": "buyProduct",
    "parameters": { "userRequest": "AAA batteries" },
    "naturalLanguage": "buy AAA batteries"
  },
  "rationale": "Purchase AAA batteries using specialized commerce tool"
}

**Semantic Query Example** (Extract product info from page):

Step 1: Query for price
{
  "actionId": "query1",
  "tool": "typeagent_action",
  "parameters": {
    "agent": "browser",
    "action": "queryPageContent",
    "parameters": { "query": "what is the product price?" },
    "naturalLanguage": "get product price"
  },
  "rationale": "Extract price using semantic query - faster than parsing HTML"
}

Step 2: Query for stock status
{
  "actionId": "query2",
  "tool": "typeagent_action",
  "parameters": {
    "agent": "browser",
    "action": "queryPageContent",
    "parameters": { "query": "how many items are in stock?" },
    "naturalLanguage": "check stock availability"
  },
  "rationale": "Check stock with semantic query"
}

Step 3: Find element if needed (ONLY if query failed)
{
  "actionId": "find1",
  "tool": "typeagent_action",
  "parameters": {
    "agent": "browser",
    "action": "getElementByDescription",
    "parameters": {
      "elementDescription": "Add to Cart button",
      "elementType": "button"
    },
    "naturalLanguage": "find add to cart button"
  },
  "rationale": "Locate button using semantic search - only if queryPageContent failed"
}

**CRITICAL MCP Syntax Rules**:
- Browser semantic query actions: Use typeagent_action with agent="browser", action name, parameters object, and naturalLanguage
  * Examples: queryPageContent, getElementByDescription, isPageStateMatched
  * naturalLanguage: User's original request for cache population (REQUIRED)
- Commerce actions: Use typeagent_action with agent="browser.commerce", action name, parameters object, and naturalLanguage
  * Parameters: Just the product/item name, NOT action verbs (e.g., "AAA batteries" NOT "buy AAA batteries")
  * naturalLanguage: User's original request for cache population (REQUIRED)
- ALWAYS navigate to startingUrl FIRST before using specialized tools

**Decision Tree for Information Extraction**:
1. ⭐ FIRST: Try queryPageContent for ANY information extraction
2. If queryPageContent returns answered: false, THEN try getElementByDescription
3. If getElementByDescription returns found: false, THEN fall back to getHTML (browser tool)
4. For state validation, use isPageStateMatched instead of getHTML

**When to Use Raw HTML (browser.getHTML)**:
- ONLY as a LAST RESORT after semantic queries fail
- Raw HTML is SLOWER, HARDER TO PARSE, and MORE FRAGILE than semantic queries
- Semantic queries handle:
  * Dynamic content (JavaScript-rendered)
  * Complex layouts (iframes, shadow DOM)
  * Accessibility features (ARIA labels)
  * Multiple page formats automatically
- Raw HTML requires:
  * Manual parsing with complex regex/selectors
  * Handling minified HTML, escape sequences
  * Different logic per website layout
  * Token limits (files can be huge)

**General browser tools still available**:
- Use clickOnElement, enterTextInElement ONLY if commerce tools don't fit
- Commerce tools are optimized for e-commerce sites (faster, more reliable)
`,
        };

        return (
            guidelines[category] ||
            "Use general browser automation best practices."
        );
    }

    /**
     * Extract plan JSON from LLM response
     */
    private extractPlanJson(responseText: string): any {
        // Remove markdown code blocks if present
        let jsonText = responseText.trim();

        // Remove ```json and ``` markers
        jsonText = jsonText.replace(/^```json\s*\n?/i, "");
        jsonText = jsonText.replace(/\n?```\s*$/i, "");

        // Find JSON object boundaries
        const startIndex = jsonText.indexOf("{");
        const endIndex = jsonText.lastIndexOf("}");

        if (startIndex === -1 || endIndex === -1) {
            throw new Error("No JSON object found in response");
        }

        jsonText = jsonText.substring(startIndex, endIndex + 1);

        try {
            return JSON.parse(jsonText);
        } catch (error) {
            console.error("Failed to parse JSON:", jsonText);
            throw new Error(
                `Invalid JSON in response: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}
