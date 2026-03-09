// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ExecutionPlan,
    PlanStep,
    PlannedAction,
    VariableDefinition,
} from "./planning/types.js";

export interface Recipe {
    version: 1;
    actionName: string;
    description: string;
    parameters: RecipeParameter[];
    steps: RecipeStep[];
    grammarPatterns: string[];
    source?: {
        type: "reasoning" | "browser" | "webtask" | "manual";
        sourceId?: string;
        timestamp: string;
    };
}

export interface RecipeParameter {
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
    default?: unknown;
    testValue?: unknown;
}

export interface RecipeStep {
    id: string;
    schemaName: string;
    actionName: string;
    parameters: Record<string, unknown>;
    observedOutputFormat?: string;
}

const TOOL_NAME_MAP: Record<
    string,
    { schemaName: string; actionName: string }
> = {
    navigateToUrl: { schemaName: "browser", actionName: "navigateTo" },
    enterTextInElement: { schemaName: "browser", actionName: "enterText" },
    clickElement: { schemaName: "browser", actionName: "click" },
    selectOption: { schemaName: "browser", actionName: "selectOption" },
    scrollPage: { schemaName: "browser", actionName: "scroll" },
    goBack: { schemaName: "browser", actionName: "goBack" },
    waitForElement: { schemaName: "browser", actionName: "waitForElement" },
};

/**
 * Generates a TaskFlow recipe from a WebTask ExecutionPlan.
 */
export class WebRecipeGenerator {
    generate(plan: ExecutionPlan): Recipe | null {
        if (!plan.steps || plan.steps.length === 0) {
            return null;
        }

        const actionName = this.deriveActionName(plan.task.description);
        const parameters = this.convertVariables(plan.variables);
        const steps = this.flattenSteps(plan.steps);
        const grammarPatterns = this.generatePatterns(
            plan.task.description,
            parameters,
        );

        return {
            version: 1,
            actionName,
            description: plan.task.description,
            parameters,
            steps,
            grammarPatterns,
            source: {
                type: "webtask",
                sourceId: plan.planId,
                timestamp: new Date().toISOString(),
            },
        };
    }

    private convertVariables(
        variables: VariableDefinition[],
    ): RecipeParameter[] {
        return variables
            .filter((v) => v.scope === "plan")
            .map((v) => ({
                name: v.name,
                type: this.mapType(v.type),
                required: v.defaultValue === undefined,
                description: v.description,
                default: v.defaultValue,
            }));
    }

    private mapType(type: string): "string" | "number" | "boolean" {
        if (type === "number") return "number";
        if (type === "boolean") return "boolean";
        return "string";
    }

    private flattenSteps(planSteps: PlanStep[]): RecipeStep[] {
        const result: RecipeStep[] = [];

        for (const step of planSteps) {
            if (step.actions.length === 0) continue;
            const action = step.actions[0];
            const mapped = this.mapAction(action, step.stepId);
            if (mapped) {
                result.push(mapped);
            }

            // Flatten control flow sub-steps
            if (step.controlFlow) {
                const cf = step.controlFlow;
                if (cf.type === "conditional") {
                    for (const sub of cf.thenSteps) {
                        const subSteps = this.flattenSteps([sub]);
                        result.push(...subSteps);
                    }
                } else if (cf.type === "loop") {
                    for (const sub of cf.loopSteps) {
                        const subSteps = this.flattenSteps([sub]);
                        result.push(...subSteps);
                    }
                }
            }
        }

        return result;
    }

    private mapAction(
        action: PlannedAction,
        stepId: string,
    ): RecipeStep | null {
        const mapped = TOOL_NAME_MAP[action.tool];
        const schemaName = mapped?.schemaName ?? "browser";
        const actionName = mapped?.actionName ?? action.tool;

        const params = this.resolveBindings(
            action.parameters,
            action.parameterBindings,
        );

        return {
            id: stepId,
            schemaName,
            actionName,
            parameters: params,
        };
    }

    private resolveBindings(
        parameters: Record<string, any>,
        bindings?: Array<{ parameterName: string; variableName: string }>,
    ): Record<string, unknown> {
        const result: Record<string, unknown> = { ...parameters };

        if (bindings) {
            for (const binding of bindings) {
                result[binding.parameterName] = `\${${binding.variableName}}`;
            }
        }

        return result;
    }

    private generatePatterns(
        description: string,
        parameters: RecipeParameter[],
    ): string[] {
        const captures = parameters
            .map((p) => `$(${p.name}:wildcard)`)
            .join(" ");
        const base = description.toLowerCase().replace(/[.!?]/g, "");
        const patterns: string[] = [];

        if (captures) {
            patterns.push(`${base} ${captures}`);
            patterns.push(`${base} with ${captures}`);
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
