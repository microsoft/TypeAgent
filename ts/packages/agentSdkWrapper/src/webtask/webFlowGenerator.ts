// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ExecutionPlan,
    PlanStep,
    PlannedAction,
    VariableDefinition,
} from "./planning/types.js";

export interface WebFlowDefinitionOutput {
    name: string;
    description: string;
    version: number;
    parameters: Record<
        string,
        {
            type: "string" | "number" | "boolean";
            required: boolean;
            description: string;
            default?: unknown;
        }
    >;
    script: string;
    grammarPatterns: string[];
    scope: { type: "site" | "global"; domains?: string[] };
    source: {
        type: "goal-driven";
        traceId?: string;
        timestamp: string;
        originUrl?: string;
    };
}

const TOOL_TO_WEBFLOW_API: Record<
    string,
    { method: string; mapParams: (params: Record<string, any>) => string }
> = {
    navigateToUrl: {
        method: "navigateTo",
        mapParams: (p) => `${quote(p.url)}`,
    },
    enterTextInElement: {
        method: "enterText",
        mapParams: (p) => `${quote(p.cssSelector)}, ${quote(p.value)}`,
    },
    clickElement: {
        method: "click",
        mapParams: (p) => `${quote(p.cssSelector)}`,
    },
    selectOption: {
        method: "selectOption",
        mapParams: (p) => `${quote(p.cssSelector)}, ${quote(p.value)}`,
    },
    scrollPage: {
        method: "pressKey",
        mapParams: (p) => (p.direction === "up" ? `"PageUp"` : `"PageDown"`),
    },
    goBack: {
        method: "goBack",
        mapParams: () => "",
    },
    waitForElement: {
        method: "awaitPageInteraction",
        mapParams: () => "",
    },
    awaitPageLoad: {
        method: "awaitPageLoad",
        mapParams: () => "",
    },
};

function quote(value: unknown): string {
    if (typeof value === "string") {
        if (value.startsWith("${")) return value;
        return JSON.stringify(value);
    }
    return String(value);
}

/**
 * Generates a WebFlowDefinition from a WebTask ExecutionPlan.
 * The output can be saved directly to a WebFlowStore.
 */
export class WebFlowGenerator {
    generate(
        plan: ExecutionPlan,
        domain?: string,
    ): WebFlowDefinitionOutput | null {
        if (!plan.steps || plan.steps.length === 0) {
            return null;
        }

        const name = this.deriveActionName(plan.task.description);
        const parameters = this.convertVariables(plan.variables);
        const script = this.generateScript(plan.steps, plan.variables);
        const grammarPatterns = this.generatePatterns(
            plan.task.description,
            Object.keys(parameters),
        );

        const domains = domain ? [domain] : [];
        let startDomain: string | undefined;
        try {
            startDomain = new URL(plan.task.startingUrl).hostname;
            if (startDomain && !domains.includes(startDomain)) {
                domains.push(startDomain);
            }
        } catch {
            // invalid URL
        }

        return {
            name,
            description: plan.task.description,
            version: 1,
            parameters,
            script,
            grammarPatterns,
            scope: {
                type: domains.length > 0 ? "site" : "global",
                ...(domains.length > 0 && { domains }),
            },
            source: {
                type: "goal-driven",
                traceId: plan.planId,
                timestamp: new Date().toISOString(),
                originUrl: plan.task.startingUrl,
            },
        };
    }

    private convertVariables(
        variables: VariableDefinition[],
    ): WebFlowDefinitionOutput["parameters"] {
        const params: WebFlowDefinitionOutput["parameters"] = {};
        for (const v of variables) {
            if (v.scope !== "plan") continue;
            params[v.name] = {
                type: this.mapType(v.type),
                required: v.defaultValue === undefined,
                description: v.description,
                ...(v.defaultValue !== undefined && {
                    default: v.defaultValue,
                }),
            };
        }
        return params;
    }

    private mapType(type: string): "string" | "number" | "boolean" {
        if (type === "number") return "number";
        if (type === "boolean") return "boolean";
        return "string";
    }

    private generateScript(
        steps: PlanStep[],
        variables: VariableDefinition[],
    ): string {
        const lines: string[] = [];
        lines.push("async function execute(browser, params) {");

        // Parameter validation
        const requiredVars = variables.filter(
            (v) => v.scope === "plan" && v.defaultValue === undefined,
        );
        for (const v of requiredVars) {
            lines.push(
                `    if (!params.${v.name}) throw new Error("Missing required parameter: ${v.name}");`,
            );
        }

        if (requiredVars.length > 0) {
            lines.push("");
        }

        // Generate step code
        const stepLines = this.generateStepCode(steps, 1);
        lines.push(...stepLines);

        lines.push("");
        lines.push('    return { success: true, message: "Task completed" };');
        lines.push("}");

        return lines.join("\n");
    }

    private generateStepCode(steps: PlanStep[], indent: number): string[] {
        const lines: string[] = [];
        const pad = "    ".repeat(indent);

        for (const step of steps) {
            if (step.objective) {
                lines.push(`${pad}// ${step.objective}`);
            }

            for (const action of step.actions) {
                const code = this.generateActionCode(action, indent);
                if (code) {
                    lines.push(code);
                }
            }

            if (step.controlFlow) {
                const cfLines = this.generateControlFlow(
                    step.controlFlow,
                    indent,
                );
                lines.push(...cfLines);
            }
        }

        return lines;
    }

    private generateActionCode(
        action: PlannedAction,
        indent: number,
    ): string | null {
        const pad = "    ".repeat(indent);
        const mapping = TOOL_TO_WEBFLOW_API[action.tool];

        if (!mapping) {
            return `${pad}// Unmapped tool: ${action.tool}`;
        }

        const resolvedParams = this.resolveBindings(
            action.parameters,
            action.parameterBindings,
        );
        const args = mapping.mapParams(resolvedParams);

        return `${pad}await browser.${mapping.method}(${args});`;
    }

    private generateControlFlow(
        cf: PlanStep["controlFlow"],
        indent: number,
    ): string[] {
        if (!cf) return [];
        const pad = "    ".repeat(indent);
        const lines: string[] = [];

        if (cf.type === "conditional") {
            lines.push(`${pad}// Conditional: ${cf.condition.expression}`);
            const thenLines = this.generateStepCode(cf.thenSteps, indent + 1);
            lines.push(...thenLines);
            if (cf.elseSteps && cf.elseSteps.length > 0) {
                const elseLines = this.generateStepCode(
                    cf.elseSteps,
                    indent + 1,
                );
                lines.push(...elseLines);
            }
        } else if (cf.type === "loop") {
            lines.push(`${pad}for (let i = 0; i < ${cf.maxIterations}; i++) {`);
            const loopLines = this.generateStepCode(cf.loopSteps, indent + 1);
            lines.push(...loopLines);
            lines.push(`${pad}}`);
        } else if (cf.type === "retry") {
            lines.push(
                `${pad}for (let attempt = 0; attempt < ${cf.maxRetries}; attempt++) {`,
            );
            const retryLines = this.generateStepCode(cf.retrySteps, indent + 1);
            lines.push(...retryLines);
            lines.push(`${pad}}`);
        }

        return lines;
    }

    private resolveBindings(
        parameters: Record<string, any>,
        bindings?: Array<{ parameterName: string; variableName: string }>,
    ): Record<string, any> {
        const result: Record<string, any> = { ...parameters };

        if (bindings) {
            for (const binding of bindings) {
                result[binding.parameterName] =
                    `\${params.${binding.variableName}}`;
            }
        }

        return result;
    }

    private generatePatterns(
        description: string,
        paramNames: string[],
    ): string[] {
        const captures = paramNames.map((p) => `$(${p}:wildcard)`).join(" ");
        const base = description.toLowerCase().replace(/[.!?]/g, "");
        const patterns: string[] = [];

        if (captures) {
            patterns.push(`${base} ${captures}`);
        } else {
            patterns.push(base);
        }

        return patterns;
    }

    private deriveActionName(description: string): string {
        const words = description
            .replace(/[^a-zA-Z0-9\s]/g, "")
            .split(/\s+/)
            .slice(0, 5);

        return words
            .map((w, i) =>
                i === 0
                    ? w.toLowerCase()
                    : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
            )
            .join("");
    }
}
