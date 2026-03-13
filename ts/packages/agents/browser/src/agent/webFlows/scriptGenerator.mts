// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { WebFlowDefinition } from "./types.js";
import { BrowserReasoningTrace } from "./reasoning/browserReasoningTypes.mjs";
import { validateWebFlowScript } from "./scriptValidator.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflows:scriptgen");

const SCRIPT_GEN_MODEL = "claude-sonnet-4-5-20250929";

export interface ScriptGenerationOptions {
    description?: string;
    suggestedName?: string;
    model?: string;
}

/**
 * Generates a WebFlowDefinition from a BrowserReasoningTrace.
 * Uses an LLM to parameterize concrete values, generalize the step sequence,
 * add robustness, and produce grammar patterns.
 */
export async function generateWebFlowFromTrace(
    trace: BrowserReasoningTrace,
    options: ScriptGenerationOptions = {},
): Promise<WebFlowDefinition | null> {
    const prompt = buildScriptGenerationPrompt(trace, options);

    try {
        const result = await callLLM(prompt, options.model);
        if (!result) {
            debug("LLM returned no result");
            return null;
        }

        const parsed = parseGeneratedFlow(result);
        if (!parsed) {
            debug("Failed to parse LLM output");
            return null;
        }

        // Validate the generated script
        const validation = validateWebFlowScript(
            parsed.script,
            Object.keys(parsed.parameters),
        );
        if (!validation.valid) {
            const errors = validation.errors
                .filter((e) => e.severity === "error")
                .map((e) => e.message);
            debug("Generated script failed validation:", errors);
            // Try once more with validation feedback
            const retryResult = await callLLM(
                buildRetryPrompt(prompt, parsed.script, errors),
                options.model,
            );
            if (retryResult) {
                const retryParsed = parseGeneratedFlow(retryResult);
                if (retryParsed) {
                    const retryValidation = validateWebFlowScript(
                        retryParsed.script,
                        Object.keys(retryParsed.parameters),
                    );
                    if (retryValidation.valid) {
                        return retryParsed;
                    }
                }
            }
            debug("Retry also failed validation");
            return null;
        }

        return parsed;
    } catch (error) {
        debug("Script generation failed:", error);
        return null;
    }
}

function buildScriptGenerationPrompt(
    trace: BrowserReasoningTrace,
    options: ScriptGenerationOptions,
): string {
    const stepsDescription = trace.steps
        .map((step) => {
            const args = JSON.stringify(step.action.args);
            const resultSummary = step.result.success
                ? step.result.data
                    ? JSON.stringify(step.result.data).slice(0, 200)
                    : "success"
                : `FAILED: ${step.result.data ?? "unknown error"}`;
            return `  Step ${step.stepNumber}: ${step.action.tool}(${args}) → ${resultSummary}`;
        })
        .join("\n");

    const domain = extractDomain(trace.startUrl);

    return `You are generating a reusable browser automation script from an execution trace.

GOAL: "${trace.goal}"
${options.description ? `DESCRIPTION: "${options.description}"` : ""}
START URL: ${trace.startUrl}
DOMAIN: ${domain}
DURATION: ${trace.duration}ms
RESULT: ${trace.result.success ? "SUCCESS" : "FAILED"} - ${trace.result.summary}

EXECUTION TRACE:
${stepsDescription}

Generate a WebFlowDefinition JSON object that turns this trace into a reusable, parameterized script.

REQUIREMENTS:
1. PARAMETERIZATION: Identify concrete values that should become parameters.
   - Search terms, product names, prices → string/number parameters
   - URLs with variable parts → parameterized URLs
   - Fixed UI element names (button text, labels) should NOT be parameters

2. GENERALIZATION: Remove exploratory or corrective steps. Keep only the essential path.

3. ROBUSTNESS: The script should:
   - Use browser.waitForElement() before interacting with elements
   - Use semantic queries (role, label, text) over CSS selectors when possible
   - Include try/catch for graceful error handling
   - Call browser.awaitPageLoad() after navigation

4. GRAMMAR PATTERNS: Generate 3-5 natural language patterns using:
   - $(paramName:wildcard) for string captures
   - $(paramName:number) for number captures
   - (optional word)? for optional words
   - word1 | word2 for alternatives

5. SCOPE: Determine if this is site-specific or global based on the actions.

The script must be an async function with signature: async function execute(browser, params)
It can ONLY use browser.* methods and params.* values. No other globals.

Available browser methods:
- browser.navigateTo(url)
- browser.goBack()
- browser.awaitPageLoad(timeout?)
- browser.awaitPageInteraction(timeout?)
- browser.getCurrentUrl()
- browser.findElement({cssSelector?, role?, text?, label?, placeholder?, index?})
- browser.findElements(query)
- browser.click(element)
- browser.enterText(element, text)
- browser.clearAndType(element, text)
- browser.pressKey(key)
- browser.selectOption(element, value)
- browser.getText(element)
- browser.getAttribute(element, attr)
- browser.getPageText()
- browser.captureScreenshot()
- browser.waitForElement(query, timeout?)
- browser.waitForNavigation(timeout?)

Return ONLY a JSON object with this structure (no markdown, no explanation):
{
  "name": "camelCaseName",
  "description": "what this flow does",
  "version": 1,
  "parameters": {
    "paramName": {
      "type": "string|number|boolean",
      "required": true|false,
      "description": "what this param is for",
      "default": optionalDefault
    }
  },
  "script": "async function execute(browser, params) { ... }",
  "grammarPatterns": ["pattern with $(param:wildcard) captures"],
  "scope": {
    "type": "site|global",
    "domains": ["domain.com"]
  },
  "source": {
    "type": "goal-driven",
    "timestamp": "${new Date().toISOString()}"
  }
}`;
}

function buildRetryPrompt(
    originalPrompt: string,
    failedScript: string,
    errors: string[],
): string {
    return `${originalPrompt}

PREVIOUS ATTEMPT FAILED VALIDATION. Fix these errors:
${errors.map((e) => `- ${e}`).join("\n")}

Failed script:
${failedScript}

Generate a corrected version. Return ONLY the JSON object.`;
}

async function callLLM(prompt: string, model?: string): Promise<string | null> {
    let result = "";

    const queryInstance = query({
        prompt,
        options: {
            model: model ?? SCRIPT_GEN_MODEL,
            maxTurns: 1,
        },
    });

    for await (const message of queryInstance) {
        if (message.type === "result" && message.subtype === "success") {
            result = message.result;
        }
    }

    return result || null;
}

function parseGeneratedFlow(llmOutput: string): WebFlowDefinition | null {
    // Extract JSON from response (may be wrapped in markdown)
    const jsonMatch =
        llmOutput.match(/```json\s*([\s\S]*?)\s*```/) ||
        llmOutput.match(/```\s*([\s\S]*?)\s*```/) ||
        llmOutput.match(/(\{[\s\S]*\})/);

    if (!jsonMatch) {
        debug("Could not extract JSON from LLM response");
        return null;
    }

    try {
        const parsed = JSON.parse(jsonMatch[1]);

        if (!parsed.name || !parsed.script || !parsed.parameters) {
            debug("Missing required fields in generated flow");
            return null;
        }

        // Ensure source has required fields
        if (!parsed.source) {
            parsed.source = {
                type: "goal-driven",
                timestamp: new Date().toISOString(),
            };
        }

        // Ensure grammarPatterns is an array
        if (!Array.isArray(parsed.grammarPatterns)) {
            parsed.grammarPatterns = [];
        }

        // Ensure scope has required fields
        if (!parsed.scope) {
            parsed.scope = { type: "global" };
        }

        return parsed as WebFlowDefinition;
    } catch (error) {
        debug("Failed to parse generated flow JSON:", error);
        return null;
    }
}

function extractDomain(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return "unknown";
    }
}
