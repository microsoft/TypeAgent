// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebFlowDefinition, WebFlowParameter, WebFlowScope } from "./types.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflows:converter");

/**
 * Subset of StoredMacro fields needed for conversion.
 * Avoids importing the full MacroStore types (which are in a separate module).
 */
export interface ConvertibleMacro {
    id: string;
    name: string;
    description: string;
    author: "discovered" | "user";
    scope: {
        type: "global" | "domain" | "pattern" | "page";
        domain?: string;
        priority: number;
    };
    urlPatterns?: Array<{ pattern: string; type: string }>;
    definition: {
        intentJson?: {
            actionName: string;
            parameters: Array<{
                shortName: string;
                name?: string;
                type: "string" | "number" | "boolean" | string;
                required: boolean;
                defaultValue?: unknown;
                description: string;
                valueOptions?: string[];
            }>;
        };
        detectedSchema?: {
            actionName: string;
            parameters?: Record<string, unknown>;
        };
        macroSteps?: Array<{
            type: string;
            target?: string;
            value?: unknown;
            options?: Record<string, unknown>;
        }>;
        steps?: unknown;
        macroDefinition?: unknown;
    };
}

/**
 * Converts StoredMacro instances (from MacroStore) into WebFlowDefinition
 * objects for the webFlows system.
 *
 * Handles two macro shapes:
 * - Single-action macros (discovered): Generate simple click/enterText scripts
 * - Multi-step macros (authored/recorded): Generate step-sequence scripts
 */
export class MacroToWebFlowConverter {
    convert(macro: ConvertibleMacro): WebFlowDefinition | null {
        try {
            const name = toCamelCase(
                macro.definition?.intentJson?.actionName ?? macro.name,
            );
            const params = this.extractParameters(macro);
            const script = this.generateScript(macro, params);
            const scope = this.deriveScope(macro);
            const grammarPatterns = this.generateGrammarPatterns(
                name,
                macro.description,
                params,
            );

            return {
                name,
                description:
                    macro.description || `Converted from macro: ${macro.name}`,
                version: 1,
                parameters: params,
                script,
                grammarPatterns,
                scope,
                source: {
                    type: "discovered",
                    timestamp: new Date().toISOString(),
                    ...(macro.urlPatterns?.[0]?.pattern && {
                        originUrl: macro.urlPatterns[0].pattern,
                    }),
                },
            };
        } catch (error) {
            debug(`Failed to convert macro "${macro.name}":`, error);
            return null;
        }
    }

    convertMany(macros: ConvertibleMacro[]): WebFlowDefinition[] {
        const results: WebFlowDefinition[] = [];
        for (const macro of macros) {
            const flow = this.convert(macro);
            if (flow) {
                results.push(flow);
            }
        }
        debug(
            `Converted ${results.length}/${macros.length} macros to webFlows`,
        );
        return results;
    }

    private extractParameters(
        macro: ConvertibleMacro,
    ): Record<string, WebFlowParameter> {
        const params: Record<string, WebFlowParameter> = {};
        const intentParams = macro.definition?.intentJson?.parameters;

        if (intentParams) {
            for (const p of intentParams) {
                params[p.shortName] = {
                    type: normalizeParamType(p.type),
                    required: p.required,
                    description: p.description,
                    ...(p.defaultValue !== undefined && {
                        default: p.defaultValue,
                    }),
                };
            }
        }

        return params;
    }

    private generateScript(
        macro: ConvertibleMacro,
        params: Record<string, WebFlowParameter>,
    ): string {
        const steps = macro.definition?.macroSteps;
        const intent = macro.definition?.intentJson;

        if (steps && steps.length > 0) {
            return this.generateMultiStepScript(steps, params, intent);
        }

        // Single-action macro (from discovery)
        if (macro.definition?.detectedSchema) {
            return this.generateSingleActionScript(
                macro.definition.detectedSchema,
                params,
            );
        }

        // Fallback: minimal script
        return `async function execute(browser, params) {\n  // Converted from macro: ${macro.name}\n  const text = await browser.getPageText();\n  return { success: true, message: "Executed ${macro.name}", data: text };\n}`;
    }

    private generateMultiStepScript(
        steps: NonNullable<ConvertibleMacro["definition"]["macroSteps"]>,
        params: Record<string, WebFlowParameter>,
        intent?: ConvertibleMacro["definition"]["intentJson"],
    ): string {
        const lines: string[] = ["async function execute(browser, params) {"];

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const stepLine = this.convertStep(step, i, params, intent);
            if (stepLine) {
                lines.push(`  ${stepLine}`);
            }
        }

        lines.push('  return { success: true, message: "Flow completed" };');
        lines.push("}");
        return lines.join("\n");
    }

    private convertStep(
        step: NonNullable<ConvertibleMacro["definition"]["macroSteps"]>[number],
        stepIndex: number,
        params: Record<string, WebFlowParameter>,
        intent?: ConvertibleMacro["definition"]["intentJson"],
    ): string | null {
        // YAML macro steps use `action` field; legacy steps use `type`
        const stepType = step.type ?? (step as any).action;
        const stepParams = (step as any).parameters as
            | Record<string, any>
            | undefined;

        switch (stepType) {
            case "click":
                if (step.target) {
                    const selector = escapeString(step.target);
                    return `await browser.click("${selector}");`;
                }
                return null;

            case "type":
            case "input":
            case "enterText": {
                const selector = step.target ? escapeString(step.target) : "";
                const value = this.resolveValue(
                    stepParams?.textParameter ?? step.value,
                    params,
                    intent,
                );
                return `await browser.enterText("${selector}", ${value});`;
            }

            case "enterTextAtPageScope": {
                const value = this.resolveValue(
                    stepParams?.textParameter ?? step.value,
                    params,
                    intent,
                );
                return `await browser.enterTextOnPage(${value});`;
            }

            case "selectValueFromDropdown":
            case "select": {
                const selector = step.target ? escapeString(step.target) : "";
                const value = this.resolveValue(
                    stepParams?.valueTextParameter ?? step.value,
                    params,
                    intent,
                );
                if (selector) {
                    return `await browser.selectOption("${selector}", ${value});`;
                }
                const dd = `dropdown${stepIndex}`;
                const mv = `matchedVal${stepIndex}`;
                return (
                    `const ${dd} = await browser.extractComponent({ typeName: "DropdownControl", schema: "{ title: string; cssSelector: string; values: { text: string; value: string; }[] }" }, ${value});\n` +
                    `  const ${mv} = ${dd}.values.find(v => v.text.toLowerCase().includes(String(${value}).toLowerCase()));\n` +
                    `  await browser.selectOption(${dd}.cssSelector, ${mv} ? ${mv}.text : ${value});`
                );
            }

            case "navigate":
            case "navigation":
                if (step.value && typeof step.value === "string") {
                    return `await browser.navigateTo("${escapeString(step.value)}"); await browser.awaitPageLoad();`;
                }
                return null;

            case "clickOnButton":
            case "clickOnElement": {
                const text =
                    stepParams?.elementText ??
                    stepParams?.buttonText ??
                    step.value;
                if (text && typeof text === "string") {
                    const el = `el${stepIndex}`;
                    return (
                        `const ${el} = await browser.extractComponent({ typeName: "Element", schema: "{ title: string; cssSelector: string; }" }, "${escapeString(text)}");\n` +
                        `  await browser.clickAndWait(${el}.cssSelector);`
                    );
                }
                return null;
            }

            case "ClickOnLink":
            case "clickOnLink": {
                const value = this.resolveValue(
                    stepParams?.linkTextParameter ?? step.value,
                    params,
                    intent,
                );
                const lnk = `link${stepIndex}`;
                return (
                    `const ${lnk} = await browser.extractComponent({ typeName: "NavigationLink", schema: "{ title: string; linkSelector: string; }" }, ${value});\n` +
                    `  await browser.followLink(${lnk}.linkSelector);`
                );
            }

            case "selectElementByText": {
                const value = this.resolveValue(
                    stepParams?.text ?? step.value,
                    params,
                    intent,
                );
                const el = `el${stepIndex}`;
                return (
                    `const ${el} = await browser.extractComponent({ typeName: "Element", schema: "{ title: string; cssSelector: string; }" }, ${value});\n` +
                    `  await browser.clickAndWait(${el}.cssSelector);`
                );
            }

            case "wait":
                return "await browser.awaitPageLoad();";

            default:
                debug(`Unknown step type: ${stepType}`);
                return `// Unknown step: ${stepType}`;
        }
    }

    private resolveValue(
        value: unknown,
        params: Record<string, WebFlowParameter>,
        intent?: ConvertibleMacro["definition"]["intentJson"],
    ): string {
        if (typeof value !== "string") {
            return JSON.stringify(value ?? "");
        }

        // Check if value references a parameter shortName
        if (params[value]) {
            return `params.${value}`;
        }

        // Check intent parameters for matching shortNames
        if (intent?.parameters) {
            const match = intent.parameters.find(
                (p) => p.shortName === value || p.name === value,
            );
            if (match && params[match.shortName]) {
                return `params.${match.shortName}`;
            }
        }

        return `"${escapeString(value)}"`;
    }

    private generateSingleActionScript(
        schema: NonNullable<ConvertibleMacro["definition"]["detectedSchema"]>,
        params: Record<string, WebFlowParameter>,
    ): string {
        const paramEntries = Object.keys(params);
        if (paramEntries.length === 0) {
            return `async function execute(browser, params) {\n  // Single action: ${schema.actionName}\n  const text = await browser.getPageText();\n  return { success: true, message: "Executed ${schema.actionName}" };\n}`;
        }

        // Generate a simple script that uses the first param as search/input
        const firstParam = paramEntries[0];
        return [
            "async function execute(browser, params) {",
            `  // Auto-generated from discovered action: ${schema.actionName}`,
            `  const text = await browser.getPageText();`,
            `  return { success: true, message: "Executed ${schema.actionName}", data: { input: params.${firstParam} } };`,
            "}",
        ].join("\n");
    }

    private deriveScope(macro: ConvertibleMacro): WebFlowScope {
        if (macro.scope.type === "global") {
            return { type: "global" };
        }

        if (macro.scope.domain) {
            return {
                type: "site",
                domains: [macro.scope.domain],
            };
        }

        // Try to extract domain from URL patterns
        if (macro.urlPatterns?.length) {
            const domains = macro.urlPatterns
                .map((p) => extractDomainFromPattern(p.pattern))
                .filter((d): d is string => d !== null);
            if (domains.length > 0) {
                return {
                    type: "site",
                    domains: [...new Set(domains)],
                };
            }
        }

        return { type: "global" };
    }

    private generateGrammarPatterns(
        name: string,
        description: string,
        params: Record<string, WebFlowParameter>,
    ): string[] {
        const patterns: string[] = [];
        const paramEntries = Object.entries(params);

        // Generate a basic pattern from the description
        const baseWords = description
            .toLowerCase()
            .replace(/[^\w\s]/g, "")
            .split(/\s+/)
            .filter((w) => w.length > 2)
            .slice(0, 5);

        if (baseWords.length > 0 && paramEntries.length > 0) {
            const paramCaptures = paramEntries
                .filter(([, p]) => p.required)
                .map(([name, p]) => {
                    const captureType =
                        p.type === "number" ? "number" : "wildcard";
                    return `$(${name}:${captureType})`;
                });

            if (paramCaptures.length > 0) {
                patterns.push(
                    `${baseWords.join(" ")} ${paramCaptures.join(" ")}`,
                );
            }
        }

        // Generate a "run X" pattern
        if (paramEntries.length > 0) {
            const requiredParams = paramEntries
                .filter(([, p]) => p.required)
                .map(([name, p]) => {
                    const captureType =
                        p.type === "number" ? "number" : "wildcard";
                    return `$(${name}:${captureType})`;
                });
            if (requiredParams.length > 0) {
                patterns.push(
                    `run ${name} (with)? ${requiredParams.join(" ")}`,
                );
            }
        }

        return patterns;
    }
}

function toCamelCase(str: string): string {
    return str
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .split(/\s+/)
        .map((word, i) =>
            i === 0
                ? word.toLowerCase()
                : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join("");
}

function escapeString(str: string): string {
    return str
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
}

function normalizeParamType(type: string): "string" | "number" | "boolean" {
    switch (type.toLowerCase()) {
        case "number":
        case "integer":
        case "float":
            return "number";
        case "boolean":
        case "bool":
            return "boolean";
        default:
            return "string";
    }
}

function extractDomainFromPattern(pattern: string): string | null {
    try {
        const url = new URL(
            pattern.startsWith("http") ? pattern : `https://${pattern}`,
        );
        return url.hostname;
    } catch {
        // Try regex-like patterns
        const match = pattern.match(
            /(?:https?:\/\/)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
        );
        return match ? match[1] : null;
    }
}
