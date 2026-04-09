// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, TypeChatLanguageModel } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { openai as ai } from "aiclient";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "node:url";
import { WebFlowDefinition } from "./types.js";
import { BrowserReasoningTrace } from "./reasoning/browserReasoningTypes.mjs";
import { validateWebFlowScript } from "./scriptValidator.mjs";
import { WebFlowGenerationResult } from "./schema/webFlowGeneration.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflows:scriptgen");

const SCRIPT_GEN_MODEL = "GPT_5_2";

export interface ScriptGenerationOptions {
    description?: string;
    suggestedName?: string;
    model?: string;
    // HTML fragments from the page at recording time. Used to extract dropdown
    // options, radio button values, and other fixed-choice element data.
    pageHtml?: string[];
}

async function getSchemaFileContents(fileName: string): Promise<string> {
    const packageRoot = path.join("..", "..", "..");
    return await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(packageRoot, "./src/agent/webFlows/schema", fileName),
                import.meta.url,
            ),
        ),
        "utf8",
    );
}

let cachedSchemas: {
    generationSchema: string;
    browserApiSchema: string;
} | null = null;

async function getSchemas() {
    if (!cachedSchemas) {
        const [generationSchema, browserApiSchema] = await Promise.all([
            getSchemaFileContents("webFlowGeneration.mts"),
            getSchemaFileContents("browserApi.mts"),
        ]);
        cachedSchemas = { generationSchema, browserApiSchema };
    }
    return cachedSchemas;
}

function createModel(modelName?: string): TypeChatLanguageModel {
    const apiSettings = ai.azureApiSettingsFromEnv(
        ai.ModelType.Chat,
        undefined,
        modelName ?? SCRIPT_GEN_MODEL,
    );
    return ai.createChatModel(apiSettings);
}

/**
 * Generates a WebFlowDefinition from a BrowserReasoningTrace.
 * Uses an LLM to parameterize concrete values, generalize the step sequence,
 * add robustness, and produce grammar patterns.
 */
export interface ExistingFlowContext {
    name: string;
    description: string;
    parameters: string[];
}

export async function generateWebFlowFromTrace(
    trace: BrowserReasoningTrace,
    options: ScriptGenerationOptions = {},
    existingFlows?: ExistingFlowContext[],
): Promise<WebFlowDefinition | null> {
    try {
        const schemas = await getSchemas();
        const prompt = buildScriptGenerationPrompt(
            trace,
            options,
            schemas.browserApiSchema,
            schemas.generationSchema,
            existingFlows,
        );

        const model = createModel(options.model);
        const validator =
            createTypeScriptJsonValidator<WebFlowGenerationResult>(
                schemas.generationSchema,
                "WebFlowGenerationResult",
            );
        const translator = createJsonTranslator(model, validator);
        translator.createRequestPrompt = () => prompt;

        debug(
            `Calling TypeChat with ${trace.steps.length} trace steps, model: ${options.model ?? SCRIPT_GEN_MODEL}`,
        );
        const response = await translator.translate("");
        if (!response.success) {
            debug("TypeChat translation failed:", response.message);
            return null;
        }
        debug("TypeChat translation succeeded");

        const parsed = toWebFlowDefinition(response.data, trace.startUrl);

        // Validate the generated TypeScript script
        const validation = validateWebFlowScript(
            parsed.script,
            Object.keys(parsed.parameters),
            parsed,
        );
        if (!validation.valid) {
            const errors = validation.errors
                .filter((e) => e.severity === "error")
                .map((e) => e.message);
            debug("Generated script failed validation:", errors);
            debug("Failed script:\n%s", parsed.script);

            // Retry with validation feedback
            const retryPrompt = buildRetryPrompt(prompt, parsed.script, errors);
            translator.createRequestPrompt = () => retryPrompt;
            const retryResponse = await translator.translate("");
            if (retryResponse.success) {
                const retryParsed = toWebFlowDefinition(
                    retryResponse.data,
                    trace.startUrl,
                );
                const retryValidation = validateWebFlowScript(
                    retryParsed.script,
                    Object.keys(retryParsed.parameters),
                    retryParsed,
                );
                if (retryValidation.valid) {
                    return retryParsed;
                }
                const retryErrors = retryValidation.errors
                    .filter((e) => e.severity === "error")
                    .map((e) => e.message);
                debug("Retry script also failed validation:", retryErrors);
                debug("Retry script:\n%s", retryParsed.script);
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

function toWebFlowDefinition(
    result: WebFlowGenerationResult,
    startUrl?: string,
): WebFlowDefinition {
    const defaultScope = startUrl
        ? { type: "site" as const, domains: [extractDomain(startUrl)] }
        : { type: "global" as const };

    return {
        name: result.name,
        description: result.description,
        version: result.version,
        parameters: result.parameters,
        script: result.script,
        grammarPatterns: result.grammarPatterns ?? [],
        scope: result.scope ?? defaultScope,
        source: result.source ?? {
            type: "goal-driven",
            timestamp: new Date().toISOString(),
        },
    };
}

function buildScriptGenerationPrompt(
    trace: BrowserReasoningTrace,
    options: ScriptGenerationOptions,
    browserApiSchema: string,
    generationSchema: string,
    existingFlows?: ExistingFlowContext[],
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

    const pageHtmlSection = options.pageHtml?.length
        ? `\nPAGE HTML CONTEXT (use this to extract dropdown/select options, radio button values, and other fixed-choice element data for valueOptions):\n${options.pageHtml.map((h) => h.slice(0, 15000)).join("\n---\n")}\n`
        : "";

    return `You are generating a reusable browser automation script from an execution trace.

GOAL: "${trace.goal}"
${options.description ? `DESCRIPTION: "${options.description}"` : ""}
START URL: ${trace.startUrl}
DOMAIN: ${domain}
DURATION: ${trace.duration}ms
RESULT: ${trace.result.success ? "SUCCESS" : "FAILED"} - ${trace.result.summary}

EXECUTION TRACE:
${stepsDescription}
${pageHtmlSection}

${
    existingFlows?.length
        ? `EXISTING FLOWS for this domain (check for overlap before creating a new flow):
${existingFlows.map((f) => `  - ${f.name}: ${f.description} [params: ${f.parameters.join(", ") || "none"}]`).join("\n")}

If your recording overlaps with an existing flow (same purpose, similar parameters), generate a SUPERSET
flow that includes ALL parameters from both the existing flow and the new recording. Use the existing
flow's name. Any new parameters should be optional with sensible defaults.\n`
        : ""
}Generate a WebFlowGenerationResult that turns this trace into a reusable, parameterized TypeScript script.

IMPORTANT: The script MUST be written in TypeScript with type annotations. The following types are available globally (do NOT add import statements):

\`\`\`typescript
${browserApiSchema}

interface WebFlowResult {
    success: boolean;
    message?: string;
    data?: unknown;
    error?: string;
}
\`\`\`

The script function signature must be:
  async function execute(browser: WebFlowBrowserAPI, params: FlowParams): Promise<WebFlowResult>

Where FlowParams is an interface with the declared parameters as typed properties.
Use type annotations on variables where it improves clarity. The script will be type-checked against the WebFlowBrowserAPI interface — only methods defined above are available.

SCRIPT GENERATION RULES:
1. Remove exploratory or corrective steps. Keep only the essential path.
2. Use browser.extractComponent() to find elements. It returns objects with cssSelector fields that you pass directly to click, enterText, selectOption, etc.
3. Include try/catch for graceful error handling.
4. Prefer clickAndWait/followLink over raw click + awaitPageLoad.
5. IMPORTANT: Do NOT include browser.navigateTo() with the start URL at the beginning of the script. The script runs on whatever page the user is currently on. Only use navigateTo() if the flow's purpose is navigation itself.
6. For extractComponent, the schema field must use TypeScript-style type syntax (e.g., "{ title: string; cssSelector: string; }"), NOT JSON Schema format.
7. Action methods (click, enterText, selectOption, clickAndWait, followLink) take a CSS selector string directly. Do NOT use findElement or waitForElement — they do not exist.
8. IMPORTANT — valueOptions for fixed-choice parameters: When the trace shows interaction with a dropdown, radio button group, segmented toggle, or any control with a fixed set of choices, populate the parameter's valueOptions array with ALL available option texts (not just the one selected in the recording). Extract these from the recorded step data (e.g., select element option lists, button group labels). Also include these options in the parameter description. The script should match params against valueOptions case-insensitively before passing to selectOption/click.
9. IMPORTANT — skip empty parameters: When a parameter value is falsy (empty string, null, undefined), the script should skip that parameter's action gracefully and continue with the remaining steps. Only throw an error if ALL parameters are empty. A partially-filled request should apply the values that were provided and leave the rest unchanged.
10. Do NOT add import statements. All types are provided globally in the sandbox.

IMPORTANT patterns for the script:
- To click a link: use extractComponent({typeName: 'NavigationLink', schema: '{ title: string; linkSelector: string; }'}, 'link text') then browser.followLink(link.linkSelector)
- To click a button/element: use extractComponent({typeName: 'Element', schema: '{ title: string; cssSelector: string; }'}, 'element text') then browser.clickAndWait(el.cssSelector)
- To enter text: use extractComponent({typeName: 'TextInput', schema: '{ title: string; cssSelector: string; placeholderText?: string; }'}, 'input label') then browser.enterText(input.cssSelector, value)
- To select from dropdown: use extractComponent({typeName: 'DropdownControl', schema: '{ title: string; cssSelector: string; values: { text: string; value: string; }[] }'}, 'dropdown label') then match the value against dropdown.values, then browser.selectOption(dropdown.cssSelector, matchedValue.text)

Generate a response conforming to this TypeScript schema:

\`\`\`typescript
${generationSchema}
\`\`\`

The source.timestamp should be "${new Date().toISOString()}".

The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:`;
}

function buildRetryPrompt(
    originalPrompt: string,
    failedScript: string,
    errors: string[],
): string {
    return `${originalPrompt}

PREVIOUS ATTEMPT FAILED SCRIPT VALIDATION. Fix these errors in the script field:
${errors.map((e) => `- ${e}`).join("\n")}

Failed script:
${failedScript}

Generate a corrected version.

The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:`;
}

function extractDomain(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return "unknown";
    }
}
